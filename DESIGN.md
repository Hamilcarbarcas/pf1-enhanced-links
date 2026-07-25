# Enhanced Links — Design

A standalone PF1 module that extends the system's class-association and supplement
mechanics into one gate-driven engine, so any class-associated item can grant
nested features and route linked spells into the right spellbook automatically.

- **Target:** pf1 v11.x (Foundry v13)
- **Storage:** module flags (migration-safe; not `system.links`)

## The idea — one gating engine, two tabs

The system already grants items when a *class* reaches a level (`_onLevelChange`)
and materializes *supplements* during actor prep — but neither is spellbook-aware,
and both are welded to the class item. Because every capability here is
level-gated, the two features collapse onto a single primitive:

> **evaluate a gate → create-as-child on cross → remove on gate-down**

Two link tabs feed one engine with different configs.

**Why build rather than bootstrap the supplement UI:** the supplement pipeline
gives zero spellbook awareness and its storage/CRUD are hardcoded to the system's
own link types. Rolling our own means routing is book-aware *at creation* — no
post-hoc reconciliation — and the data lives in our namespace, safe from the
coming DataModel migration.

## Shared foundation

### Tab injection
The links sub-tabs come from a hardcoded push-list in `_prepareLinks` — there is
no registry. Both tabs are injected via a `renderItemSheetPF` hook that adds a nav
entry + panel into the links section and wires its own drag/drop and rows. We do
not extend the system's link handlers; they key off literal type strings. Drops
are intercepted with a capture-phase listener so the system's `_onLinksDrop` never
sees our tab ids.

### Storage — module flags, not `system.links.*`
Living in the system's `system.links` persists today (loose template.json) but
would be stripped once PF1 moves to strict DataModels. Namespaced flags are
migration-proof and can't collide.

```
// per configured item, under flags["pf1-enhanced-links"]
classFeatures    = [ { uuid, level } ]
spellSupplements = {
  mode:  "class" | "spelllike",       // destination
  gated: boolean,                     // unchecked ⇒ every entry treated as threshold 0
  requireCastable: boolean,           // class mode only; DEFAULTS TRUE (absent ⇒ on)
  items: [ { uuid, level } ]          // `level` = GRANT threshold, not spell level
}
granted          = { [createdItemId]: { source, level } }   // teardown ledger (Phase 2)
```

> **Naming:** a config entry's `level` is the *grant threshold* (class level or
> HD at which it appears). It is **not** the spell's own spell level (0–9), which
> is read from `learnedAt.class[tag]` the way `_adjustNewItem` does.

### Associated class = `system.class` (runtime-only)
The engine reads the associated class from `system.class`. **Important:** that
field is populated by the system at grant/drop time on the **actor** (see
`item-class._onLevelChange` and actor-sheet drop handling) — it is empty on a bare
compendium/world definition, which is exactly where these tabs are authored. So:

- **Tab visibility and the class-mode option key on item TYPE** (`canClassAssociate`
  — currently `feat`), never on `system.class` being present.
- **The actual class tag is resolved later by the engine** from the on-actor copy.

This means Feature 1 and Feature 2's class mode are authored on class-feature
definitions (feats) and only bind to a concrete class once the item lands on an
actor. *(Open: whether to extend `canClassAssociate` beyond `feat` — e.g. buffs,
which the system can also stamp with `system.class` via class associations.)*

## The engine (Phase 2)

- **Trigger:** `pf1ClassLevelChange (actor, classItem, curLevel, newLevel)` — the
  unified seam, since class levels *and* HD both derive from class-type items
  (racial HD is a class item too). Plus two secondary triggers: **parent item
  added** and **parent item removed**. Those are load-bearing for ungated spells,
  which never see a level-up event. Plus an **actor update touching
  `system.attributes.spells`** — caster type, preparation mode, the auto-CL formula
  and `inUse` all move the castable-level gate without touching a class item, so
  `pf1ClassLevelChange` never fires for them. (A caster level moved purely by an
  ItemChange is derived during prep and issues no update, so it isn't covered; the
  next real event picks it up.)
- **Gate quantity per link:** class-feature and spell `mode:"class"` → the
  associated class's level. Spell `mode:"spelllike"` → actor HD total.
- **Full re-scan each event:** evaluate all configured items against current
  state, not just the class that changed — simpler, and it's what makes cascades
  safe.
- **Teardown:** on gate-down or parent removal, read the `granted` ledger, delete
  items whose threshold now exceeds the gate, prune the ledger.
- **Re-entry guard:** a creation-in-progress flag so a prep-adjacent event can't
  loop.

**Cascade policy — fixpoint, not a fixed count.** Run the scan in a loop; repeat
while a pass creates ≥1 item; stop when a pass adds nothing. Cap at ~10 passes and
`console.warn` if hit, to survive a misconfigured circular link. Each pass
re-reads actor items, so an item created in pass N — now carrying its own
`system.class` and flags — is visible to pass N+1. Echoes the system's own
depth/count guards in `_createSupplements`.

## Feature 1 — Class-associated feature associations

The system's class-association mechanic, moved one level out: it lives on a
*feature* that is itself associated with a class. Config is `[{ uuid, level }]`;
always gated — gating *is* the feature, so no checkbox here.

- **On cross:** `fromUuid` → `game.items.fromCompendium` → create embedded **as a
  child of the parent** (write the parent's `system.links.children`), and set the
  created item's `system.class` to the parent's class tag.
- **Record** in the `granted` ledger for down-level teardown.

## Feature 2 — Spell supplements

A spell-only drop tab with a header **mode** dropdown (Class Spellcasting /
Spell-like abilities) and a **Level gating** checkbox. When gating is off, the
level column hides and every entry is treated as an always-true threshold-0 gate —
no separate lifecycle, the same engine handles it. Spells are created as children
with their book *pre-assigned*.

| Mode | Gating | Gate | Appears when… |
|---|---|---|---|
| Class Spellcasting | on | associated class level | the class reaches level N |
| Class Spellcasting | off | — | the parent is on the actor |
| Spell-like abilities | on | actor HD | the actor reaches N HD |
| Spell-like abilities | off | — | the parent is on the actor |

### Castable-level gate (`requireCastable`)

A second, independent condition in **class mode only**: the destination book must be
able to cast the spell's level. It exists so one feature can be shared by a full and
a partial caster — thresholds authored for the full caster (a 4th-level spell at
class level 8) would otherwise hand the partial caster a spell it can't cast, and
would hand it 7th–9th level spells it can *never* cast.

- **Both conditions are ANDed into the same `met`**, so nothing new is needed for
  "arrives once both hold": the reconcile is a full re-scan of live state on every
  event and nothing is latched. A spell that is level-gated but not yet castable is
  simply unmet, and grants on whichever event makes both true. The never-castable
  case needs no special handling either — `met` is just never true.
- **Spell level** is resolved with the same `learnedAt.class[tag]` → own-level
  fallback that `buildSpell` writes (shared as `resolveSpellLevel`), so the gate is
  checked against exactly the level the spell will land at.
- **Max castable level** mirrors the system's `_prepareSpellbook` — which lives in
  the *sheet*, not in actor data, so there is nothing on the actor to read. Auto
  calculation indexes `casterProgression.castsPerDay[prepMode][casterType][cl-1]`
  and takes `length - 1` (CL clamped 1–20, so a buffed CL reads the top row instead
  of falling off the table); manual-slot books have no progression and fall back to
  caster type alone (low 4 / med 6 / high 9), which means they don't pace with level
  — the entry's own threshold does that. `hasCantrips` gates level 0.
- **Progression only — the ability-score ceiling is deliberately excluded.** The
  system's other limit (`maxLevelByAblScore`) moves with ability damage and buffs;
  since an unmet gate *deletes* the grant, including it would flap spells on and off
  the sheet mid-combat.
- **Teardown is symmetric** with the existing gate-down behavior: a grant whose
  level stops being castable is removed and returns on a later reconcile.
- **Not applied in spell-like mode.** That book is HD-driven with no class
  progression to outpace, so the check is meaningless there; the control is hidden
  rather than disabled.
- **Cost:** the check needs each configured spell's source document just to read its
  level, so the desired-set computation is async and memoizes uuid → document for
  the duration of one reconcile (otherwise the fixpoint loop refetches up to
  `MAX_PASSES` times per parent). `build()` stays lazy — sources are only *imported*
  when a gate is actually crossed.

### Book routing
- `mode:"class"` → target the actor book where `book.class === <parent's class
  tag>`; set the spell's `system.spellbook = bookId`.
- `mode:"spelllike"` → `system.spellbook = "spelllike"`, plus a per-spell
  **Times/day**: `perDay > 0` sets `system.preparation.max`/`value` and clears
  `atWill`; `perDay === 0` sets `atWill`. Note the default spell-like book is
  spontaneous, where uses come from a per-level pool — so per-SLA `preparation`
  displays the count but only deducts per-spell in a prepared-style book. The
  engine sets the field and leaves the book's mode to the user.

> **SLA book must be live, or the spell lands inert.** A spell routed to
> `spelllike` computes no CL/uses unless that book is `inUse` with an `_hd`
> config. The engine **ensures** the book is enabled the first time it routes
> there — but fills only empty fields (`inUse`, default `class:"_hd"`, a CL
> formula) and never overwrites a book the user or a class already configured.

## Feature 3 — Archetypes (replaces class features)

An archetype is just a class feature that ① grants its own replacement features
(Feature 1) and ② suppresses specific base-class associations. Only ② is new.

Config lives alongside the classFeatures list on the same feat:

```
flags.pf1-enhanced-links.archetype = {
  replaces:  true,
  baseClass: "<class uuid>",              // config-time enumeration only
  excluded:  ["<associationUuid>", ...]   // association source uuids to replace
}
```

**Base class is picked explicitly, or pre-filled.** The UX (checklist of the
class's associations) needs the class in hand, but `system.class` is empty on the
authored compendium feat — so the "Replaces class features" section takes a
dropped **base class** and enumerates its `system.links.classAssociations` into a
checklist. When the feat *is* tied to a class (on an actor), checking the box
pre-fills the base class from that association (`system.class` → `actor.classes`
→ the class's compendium source); it stays clearable and replaceable by drop. At
runtime the concrete class is still resolved via `system.class`; the picked base
class only exists to author the exclusion list.

**Two enforcement paths:**
- **Level-up (hard prevention, no flash):** a lib-wrapper around the class's
  `_onLevelChange` temporarily hides excluded associations, so the system never
  creates them. Degrades to reactive removal if lib-wrapper is absent.
- **Already present / config edits (reactive):** `enforceArchetypes` in the
  reconcile deletes on-actor items whose `_stats.compendiumSource` matches an
  excluded association uuid. This covers archetypes added after the class already
  leveled.

**On removal:** the base features the archetype suppressed are **restored** when
the archetype item is deleted (`restoreReplacedFeatures`, from the delete hook). A
base association returns only if its class is still present, no other active
archetype still replaces it, and the class level meets the association's level
(higher-level ones reappear on the next normal level-up). Restored items are plain
class associations with no engine flags, so they're indistinguishable from
system-granted features and can be excluded again by a future archetype.

Scoping: only archetypes whose associated class is present on the actor enforce,
and matching is by association source uuid, so unrelated items sharing a uuid are
not affected in practice.

## Applicability by item

Both class-mode paths pivot on `system.class`; the spell-like path is HD-gated and
needs no associated class — which is what makes innate casting on **races and
templates** work, the original motivation.

| Capability | Class-associable type? | Tab shows on |
|---|---|---|
| Class features (F1) | yes (`feat`) | feats |
| Spell supplements · class mode | yes (`feat`) | feats (option enabled) |
| Spell supplements · spell-like mode | no | any linkable item — incl. races / templates |

*"Class-associable type" = the item type can carry `system.class` on an actor
(`canClassAssociate`). It does not mean `system.class` is set at authoring time.*

## Resolved decisions

- **Associated-class source** — read `system.class` directly.
- **Spell supplements are gated**, with a per-tab checkbox; ungated is modeled as
  threshold-0 through the same engine.
- **SLA gate is HD**, not class level.
- **Cascade** — fixpoint loop, ~10-pass safety cap with a warning.
- **SLA spellbook changes are out of scope** — just settings customization;
  Feature 2 is not deferred.

## Open risks & edge cases

- **Non-caster class in `mode:"class"`** — no book matches the tag. Warn and skip.
- **Initial class add (0 → N)** — a mid-campaign drop onto an already-leveled
  actor must grant immediately; confirm parent items exist at that moment
  (ordering vs. the class's own associations) or grants wait for the next reflow.
- **Idempotency across reload** — reconcile the `granted` ledger by source UUID
  before creating, so a refresh doesn't double-grant.
- **Parent deletion** — tear down grants when the parent item itself is removed,
  not only on gate-down.
- **Shared SLA book ownership** — multiple sources may target `spelllike`; only
  ever fill empty config fields.

## Build order

1. **Scaffold & foundation** — module skeleton, the two injected link tabs, flag
   storage, and the `system.class` read. *(done — Phase 1)*
2. **Shared gating engine** — triggers (`pf1ClassLevelChange` + create/update/
   delete of configured items), fixpoint scan, grant/teardown ledger, re-entry
   guard. *(done — `engine.mjs`)*
3. **Feature 1 — class features** — child creation + `system.class` stamping.
   *(done, via the engine)*
4. **Feature 2 — spell supplements** — both modes, gating checkbox, book routing,
   and the ensure-SLA-book step. *(done, via the engine)*
5. **Castable-level gate** — `requireCastable` (class mode, default on), the
   progression-only max-level mirror, the async/memoized desired-set, and the
   spellbook-config trigger. *(done)*

### Engine notes / deviations from the sketch
- **Every grant is child-linked to its parent.** Both class-feature and spell
  grants are written into the parent's `system.links.children` (actor-relative
  uuid, name omitted — the system's own "children" shape). Only the engine's own
  links are added/removed (matched by the grant's item id), so hand-authored
  children are preserved; teardown drops the link symmetrically. Lifecycle is still
  driven by the `granted` ledger + `grantParent` stamp — the child link is
  presentational plus the teardown hook (below), not the source of truth. Spells
  still land in their book via `system.spellbook`; the child link is additional,
  not a relocation.
- **Parent-deletion teardown is the system's job.** Because every grant is
  child-linked, the system's own cascade (`Actor#_onDeleteDescendantDocuments`)
  deletes the whole grant subtree when the parent is removed — on the *triggering*
  client, so it works even with no GM present. The engine's delete hook therefore
  does **not** delete grants itself; doing so would race the system's cascade and
  throw "item does not exist". The hook only restores archetype-replaced base
  features and re-heals a hand-deleted grant whose parent still lives.
- **Provenance is stamped on created items** (`flags[MODULE_ID].grantParent /
  grantSource`) in addition to the parent ledger. The stamp drives grant teardown
  and the "was this hand-deleted while its parent lives?" re-heal check; the ledger
  drives gate-down teardown; together they let a reload reconcile without
  duplicating.
- **Primary-GM-only execution** (`game.users.activeGM.isSelf`) so grants aren't
  created once per connected client. Trade-off: if no GM is present when a player
  levels, grants apply the next time a GM is active and an event fires. *(Open:
  revisit if players need grants applied GM-absent — would need a GM socket relay,
  cf. the GM-socket design principles.)*
- **Manual deletion of a granted child re-heals** (the item returns on the next
  reconcile if its gate is still met), matching how the system's supplements
  behave. Removing the gate or the parent is the way to remove a grant for good.

## System touchpoints (pf1 v11.x)

- `documents/item/item-class.mjs` · `_onLevelChange` — grant/remove template & the
  `pf1ClassLevelChange` hook.
- `documents/item/item-base.mjs` · `_createSupplements` — insertion pipeline +
  depth/count guards to imitate.
- `applications/item/item-sheet.mjs` · `_prepareLinks` — hardcoded tab push-list
  we inject into; `_onLinksDrop` — the drop path we intercept.
- `documents/item/item-spell.mjs` · `_adjustNewItem` / `spellbook` getter — level
  & book binding.
- `applications/actor/actor-sheet.mjs` · `_prepareSpellbook` — the max-castable-level
  computation the `requireCastable` gate mirrors (sheet-side, not actor data).
- `documents/actor/actor-pf.mjs` · `prepareSpellbook` — caster-type/prep-mode
  normalization the gate relies on, and `maxLevelByAblScore`, the ability-score
  ceiling the gate deliberately ignores.
- `documents/actor/actor-pf.mjs` · `_updateSpellBook` — `inUse` gate; why a dead
  book yields inert spells.
- `public/template.json` — fixed books: primary / secondary / tertiary / spelllike.
