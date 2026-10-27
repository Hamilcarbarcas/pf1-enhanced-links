/* PF1 Enhanced Links — gating engine (Phase 2)
 *
 * Turns the configuration authored in Phase 1 into real actor items. One
 * primitive drives both features:
 *
 *     evaluate a gate → create-as-grant on cross → remove on gate-down
 *
 * Triggers: pf1ClassLevelChange (class level / HD changes), plus create/update/
 * delete of the configured parent items. Each event runs a full reconcile of the
 * actor: a fixpoint loop that keeps re-scanning until a pass makes no change, so
 * nested grants (a granted feat that itself grants more) are all caught.
 *
 * Grants are tracked two ways:
 *   • a `granted` ledger flag on each PARENT: { [createdItemId]: {source, ...} }
 *   • `flags[MODULE_ID].grantParent / grantSource` stamped on each CREATED item
 * The ledger drives gate-down teardown; the stamps drive parent-deletion cleanup
 * and let a reload reconcile without duplicating.
 *
 * Only the primary GM client runs the engine, so grants aren't created N times
 * across connected clients. With no GM connected, the client of the user who made
 * the change runs it for that actor instead: every write here is owner-level, and
 * no other client is running the engine to race it. A class level change with no
 * GM connected still waits, since its hook carries no user.
 */

import {
  MODULE_ID,
  MODE,
  POOL_IDS,
  POOL_FLAG,
  getClassFeatures,
  getSpellSupplements,
  getAssociatedClass,
  getArchetype,
} from "./enhanced-links.mjs";
import { SCRIPT_TAB, scriptsFor, runCreateScripts } from "./create-scripts.mjs";
import { applyRename, renameFor } from "./renames.mjs";
import { dedupeEnabled, dataKeys, findExisting, isManaged, referencers } from "./dedupe.mjs";
import { hasSpellcasting, hasSpellcastingLedger, listTagOf, reconcileSpellcasting } from "./spellcasting.mjs";
import {
  GRANT_AS,
  PICKS_FLAG,
  classTagFor,
  isDormant,
  pickPerDay,
  pickedGrants,
  settleSelections,
  slotsOf,
} from "./selections.mjs";

const LOG = "PF1 Enhanced Links |";
const MAX_PASSES = 10;

// Grant-tracking flag keys.
const GRANTED = "granted"; // on parent: ledger of what it has produced
const GRANT_PARENT = "grantParent"; // on child: id of the parent that made it
const GRANT_SOURCE = "grantSource"; // on child: source uuid it was built from
const POOL = POOL_FLAG;
const SCRIPTED = "scripted"; // on child: its row has create scripts, so it never stacks
const DOMAIN_STAMP = "domain"; // on child: the Domain/School setting last applied to it
const KNOWN_STAMP = "bonusKnown"; // on child: it doesn't count against its book's spells known
// The addend this module keeps in a spell level's known offset, one per bonus spell there.
const KNOWN_TERM = "Bonus spells known";
const KNOWN_TERM_RE = /^\d+\[Bonus spells known\]$/;

// Update option marking the pool sync's own writes.
const POOL_SYNC = "pf1elPoolSync";

// Actors currently mid-reconcile. Held across awaits so the item CRUD hooks fired
// by our own create/delete calls are ignored (re-entry guard).
const busy = new Set();

// Actors whose picks or class levels changed while their reconcile was running, with
// the user who changed them. The engine writes neither, so such a change is always a
// user's, and it is reconciled once the run in progress ends.
const rerun = new Map();

// Ids of items the system is cascade-deleting with a removed parent. Settle leaves
// them alone rather than racing that delete.
const cascading = new Set();
const CASCADE_MS = 5_000;

// Class deletions in progress: actor id -> { ids: items still to go, userId, timer }.
// The engine stands down for the actor until they are all gone. DESIGN.md § Feature 3.
const teardowns = new Map();

// ─── Guards ─────────────────────────────────────────────────────────────────────

/** Only the primary GM client mutates, to avoid duplicate grants across clients. */
function isPrimaryGM() {
  return game.users?.activeGM?.isSelf === true;
}

/**
 * Whether this client runs the engine for an actor: the primary GM, or with no GM
 * connected, the user whose own change started it.
 */
function mayReconcile(actor, userId) {
  if (isPrimaryGM()) return true;
  return !game.users?.activeGM && !!userId && userId === game.user?.id && actor.isOwner === true;
}

/** Normalize a uuid for comparison (relative vs absolute forms). */
function uniformUuid(uuid) {
  return pf1?.utils?.internal?.uniformUuid?.(uuid) ?? uuid ?? "";
}

// ─── Gate quantities ────────────────────────────────────────────────────────────

/** Level of the class with the given tag on this actor, or 0. */
function classLevel(actor, tag) {
  if (!tag) return 0;
  return actor.classes?.[tag]?.level ?? 0;
}

/** Actor total Hit Dice. */
function hdTotal(actor) {
  return actor.system?.attributes?.hd?.total ?? 0;
}

/** Book key whose class is the given tag, or null (non-caster / no match). */
function findSpellbookByClass(actor, tag) {
  const books = actor.system?.attributes?.spells?.spellbooks ?? {};
  for (const [key, book] of Object.entries(books)) {
    if (book?.class === tag) return key;
  }
  return null;
}

/**
 * Whether a book can currently cast the given spell level.
 *
 * Mirrors the system's own "which spell levels does this book show" computation in
 * ActorSheetPF#_prepareSpellbook — which lives in the sheet, not in actor data, so
 * there is nothing on the actor to read this off of.
 *
 * Deliberately progression-only. The system has a SECOND ceiling — the casting
 * ability score (actor-pf's `maxLevelByAblScore`, surfaced as `lowAbilityScore`) —
 * that is NOT consulted here: it moves with ability damage and buffs, and since a
 * gate going false tears the grant down, folding it in would make spells flap on
 * and off the sheet mid-combat.
 *
 * `casterType` and `spellPreparationMode` are read after actor prep, which has
 * already normalized invalid values (see actor-pf's caster-type auto-correct).
 */
function canCastLevel(actor, bookId, spellLevel) {
  const book = actor.system?.attributes?.spells?.spellbooks?.[bookId];
  if (!book) return false;
  if (spellLevel <= 0 && !book.hasCantrips) return false;

  let max;
  if (book.autoSpellLevelCalculation) {
    const cl = book.cl?.autoSpellLevelTotal ?? 0;
    if (cl < 1) return false; // no caster levels yet — nothing is castable
    const table = pf1.config.casterProgression?.castsPerDay?.[book.spellPreparationMode]?.[book.casterType];
    // Clamp like the system does elsewhere for this table, so a CL pushed past 20
    // by a buff reads the level-20 row instead of falling off the end.
    const casts = table?.[Math.clamp(cl, 1, 20) - 1];
    if (!casts) return false;
    max = casts.length - 1;
  } else {
    // Manual slots: the system has no progression to consult and falls back to
    // caster type alone, so this ceiling does not move with level. The entry's own
    // level threshold is what paces a manual book.
    max = book.casterType === "low" ? 4 : book.casterType === "med" ? 6 : 9;
  }
  return spellLevel <= max;
}

/**
 * The level a supplement spell will land at: its level on the associated class's
 * list when there is one, else its own. Shared so the gate is checked against
 * exactly the level buildSpell will write.
 */
function resolveSpellLevel(source, tag, mode) {
  if (mode === MODE.class && tag) {
    const learned = source.system?.learnedAt?.class?.[tag];
    if (Number.isFinite(learned)) return Math.clamp(learned, 0, 9);
  }
  return source.system?.level ?? 0;
}

/**
 * Resolve source uuids once per reconcile. The fixpoint loop re-runs the desired-set
 * computation on every pass, and the castable check needs each spell's document just
 * to read its level — without memoizing, one configured spell would be fetched up to
 * MAX_PASSES times per parent. Promises are cached, so concurrent asks dedupe too.
 */
function makeSourceCache() {
  const cache = new Map();
  return (uuid) => {
    if (!cache.has(uuid)) cache.set(uuid, fromUuid(uuid).catch(() => null));
    return cache.get(uuid);
  };
}

// ─── Build creation data ────────────────────────────────────────────────────────

/** Resolve a source uuid and prepare a fresh import-ready data object. */
async function buildFromSource(uuid) {
  const source = await fromUuid(uuid).catch(() => null);
  if (!source) {
    console.warn(LOG, "grant source not found:", uuid);
    return null;
  }
  return { source, data: game.items.fromCompendium(source, { clearFolder: true }) };
}

/** Stamp our provenance flags onto a to-be-created item's data. */
function stampGrant(data, source, parentId) {
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.${GRANT_SOURCE}`, source);
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.${GRANT_PARENT}`, parentId);
}

async function buildClassFeature(uuid, tag, parentId) {
  const built = await buildFromSource(uuid);
  if (!built) return null;
  const { data } = built;
  foundry.utils.setProperty(data, "system.class", tag); // bind to the parent's class
  stampGrant(data, uuid, parentId);
  return data;
}

/** Top-level `+` addends of a formula. A lone "0" counts as empty. */
function formulaAddends(formula) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of String(formula ?? "")) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "+" && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s && s !== "0");
}

/**
 * Keep each spell level's known offset in step with the bonus spells granted there.
 * DESIGN.md § Bonus spells known.
 *
 * On a spontaneous book the system counts every spell against the level's spells
 * known. A granted spell stamped as a bonus adds one to that level's own
 * `preparedOffsetFormula`, as a labeled addend this module owns and nothing else in
 * the formula. The addend is the whole record: it is rewritten from the spells on the
 * actor each pass, so there is no ledger to drift.
 */
async function settleKnownBonus(actor) {
  const books = actor.system?.attributes?.spells?.spellbooks ?? {};
  const want = new Map();
  for (const spell of actor.itemTypes?.spell ?? []) {
    if (spell.getFlag(MODULE_ID, KNOWN_STAMP) !== true || !spell.getFlag(MODULE_ID, GRANT_PARENT)) continue;
    // A Domain/School spell is counted in the book's own pool for those.
    if (spell.system?.domain === true) continue;
    const bookId = spell.system?.spellbook;
    if (books[bookId]?.spellPreparationMode !== "spontaneous") continue;
    const key = `${bookId}.spell${spell.system.level}`;
    want.set(key, (want.get(key) ?? 0) + 1);
  }

  const update = {};
  for (const [bookId, book] of Object.entries(books)) {
    for (let level = 0; level < 10; level++) {
      const stored = actor._source.system?.attributes?.spells?.spellbooks?.[bookId]?.spells?.[`spell${level}`]?.preparedOffsetFormula ?? "";
      const terms = formulaAddends(stored);
      const others = terms.filter((term) => !KNOWN_TERM_RE.test(term));
      const n = want.get(`${bookId}.spell${level}`) ?? 0;
      // Untouched unless this module has, or needs, an addend here.
      if (!n && others.length === terms.length) continue;
      const next = [...others, ...(n ? [`${n}[${KNOWN_TERM}]`] : [])].join(" + ");
      if (next !== terms.join(" + ")) {
        update[`system.attributes.spells.spellbooks.${bookId}.spells.spell${level}.preparedOffsetFormula`] = next;
      }
    }
  }
  if (!Object.keys(update).length) return false;
  await actor.update(update, { render: false });
  return true;
}

async function buildSpell(
  uuid,
  bookId,
  tag,
  mode,
  parentId,
  perDay = 0,
  poolKey = null,
  scripted = false,
  domain = false,
  bonusKnown = false
) {
  const built = await buildFromSource(uuid);
  if (!built) return null;
  const { source, data } = built;
  if (source.type !== "spell") {
    console.warn(LOG, "spell supplement source is not a spell:", uuid);
    return null;
  }
  foundry.utils.setProperty(data, "system.spellbook", bookId);
  foundry.utils.setProperty(data, "system.level", resolveSpellLevel(source, tag, mode));
  if (domain) {
    foundry.utils.setProperty(data, "system.domain", true);
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.${DOMAIN_STAMP}`, true);
  }
  if (bonusKnown) foundry.utils.setProperty(data, `flags.${MODULE_ID}.${KNOWN_STAMP}`, true);

  // Spell-like uses per day: a positive count sets prepared uses; 0 means at-will.
  if (mode === MODE.spelllike) {
    const n = Math.max(0, Math.floor(Number(perDay) || 0));
    if (n > 0) {
      foundry.utils.setProperty(data, "system.atWill", false);
      foundry.utils.setProperty(data, "system.preparation.max", n);
      foundry.utils.setProperty(data, "system.preparation.value", n);
    } else {
      foundry.utils.setProperty(data, "system.atWill", true);
    }

    // Spell-like abilities have no components — clear them all.
    foundry.utils.setProperty(data, "system.components", {
      value: "",
      verbal: false,
      somatic: false,
      thought: false,
      emotion: false,
      material: false,
      focus: false,
      divineFocus: 0,
    });
    foundry.utils.setProperty(data, "system.materials", { value: "", focus: "", gpValue: 0 });
    if (poolKey) foundry.utils.setProperty(data, `flags.${MODULE_ID}.${POOL}`, poolKey);
    if (scripted) foundry.utils.setProperty(data, `flags.${MODULE_ID}.${SCRIPTED}`, true);
  }

  stampGrant(data, uuid, parentId);
  return data;
}

/**
 * Ensure the spell-like abilities book is live enough to compute for a routed
 * spell — but only fill fields that are empty, never overwrite existing config.
 */
async function ensureSpelllikeBook(actor) {
  const base = "system.attributes.spells.spellbooks.spelllike";
  const book = actor.system?.attributes?.spells?.spellbooks?.spelllike ?? {};
  const update = {};
  if (!book.inUse) update[`${base}.inUse`] = true;
  // class "_hd" already drives caster level off Hit Dice (see the system's
  // actor-pf prepareSpellbook: the _hd branch adds HD to cl.total). Do NOT also
  // set a cl.formula of "@attributes.hd.total" — that adds HD a second time and
  // doubles the caster level.
  if (!book.class) update[`${base}.class`] = "_hd"; // HD-driven, like innate casting
  if (Object.keys(update).length) await actor.update(update, { render: false });
}

// ─── Desired-grant computation ──────────────────────────────────────────────────

/**
 * The full set of grants a parent wants right now. Each entry carries whether its
 * gate is currently `met` and a `build()` that produces creation data on demand.
 *
 * Async only because the castable check has to read the spell's level off its source
 * document; `resolve` memoizes that per reconcile. `build()` stays lazy either way —
 * a source is only imported when its gate is actually crossed.
 */
async function buildDesired(actor, parent, resolve) {
  const out = [];
  const tag = getAssociatedClass(parent);
  const clvl = classLevel(actor, tag);

  // Feature 1 — class-associated features (always gated by class level).
  for (const { uuid, level } of getClassFeatures(parent)) {
    const threshold = Number.isFinite(level) ? level : 1;
    out.push({
      source: uuid,
      threshold,
      kind: "classFeature",
      met: !!tag && clvl >= threshold,
      build: () => buildClassFeature(uuid, tag, parent.id),
    });
  }

  // Feature 2 — spell supplements. Ungated ⇒ threshold 0 (always met once a book
  // resolves), which is how the same engine serves both gated and ungated.
  const cfg = getSpellSupplements(parent);
  for (const { uuid, level, perDay, pool } of cfg.items) {
    const threshold = cfg.gated ? (Number.isFinite(level) ? level : 1) : 0;
    // A pool only means something for a counted spell-like ability; unpooled
    // spell-like grants stack onto an existing copy instead.
    const spelllike = cfg.mode === MODE.spelllike;
    const poolId = spelllike && Number(perDay) > 0 && POOL_IDS.includes(pool) ? pool : "";
    // A row with create scripts or a rename makes its own variant (cold fireball), so
    // merging it with another parent's copy would lose one version or the other.
    const scripted =
      spelllike &&
      (scriptsFor(parent, SCRIPT_TAB.spellSupplements, uuid).length > 0 ||
        !!renameFor(parent, SCRIPT_TAB.spellSupplements, uuid));
    let gateQty;
    let bookId;
    let needsSpelllikeBook = false;
    // The class whose list sets the spell's level: the book's own, unless a
    // granted book reads another class's list. DESIGN.md § Feature 6.
    let listTag = tag;
    if (cfg.mode === MODE.class) {
      gateQty = clvl;
      bookId = tag ? findSpellbookByClass(actor, tag) : null;
      if (bookId) listTag = listTagOf(actor, bookId) ?? tag;
    } else {
      gateQty = hdTotal(actor);
      bookId = "spelllike";
      needsSpelllikeBook = true;
    }

    // Second gate: the destination book must actually be able to cast this spell's
    // level. Class mode only — the spell-like book is HD-driven and has no class
    // progression to outpace, which is the whole point of the check. This is what
    // lets one feature serve a full and a partial caster: the partial caster's
    // higher-level spells simply stay unmet until its own progression catches up,
    // and never arrive at all if it never reaches that level.
    let castable = true;
    if (cfg.mode === MODE.class && cfg.requireCastable && bookId != null) {
      const source = await resolve(uuid);
      castable = !!source && canCastLevel(actor, bookId, resolveSpellLevel(source, listTag, cfg.mode));
    }

    out.push({
      source: uuid,
      threshold,
      kind: "spell",
      met: bookId != null && gateQty >= threshold && castable,
      needsSpelllikeBook,
      pool: poolId,
      stackable: spelllike && !poolId && !scripted,
      domain: cfg.mode === MODE.class && cfg.domain,
      bonusKnown: cfg.mode === MODE.class && cfg.bonusKnown,
      build: () =>
        buildSpell(
          uuid,
          bookId,
          listTag,
          cfg.mode,
          parent.id,
          perDay,
          poolId ? `${parent.id}:${poolId}` : null,
          scripted,
          cfg.mode === MODE.class && cfg.domain,
          cfg.mode === MODE.class && cfg.bonusKnown
        ),
    });
  }

  // Feature 7: picks. Wanted while the feature is on the actor; a level-down takes
  // the feature itself, and the system's cascade its picks. DESIGN.md § Feature 7.
  const picks = pickedGrants(parent);
  for (const [index, pick] of picks.entries()) {
    const { row } = pick;
    // A spell picked in a spell mode lands as Spell Supplements would land it.
    // DESIGN.md § Spell picks.
    const spellMode = row.grantAs && (await resolve(pick.uuid))?.type === "spell" ? row.grantAs : "";
    if (spellMode === GRANT_AS.spelllike) {
      out.push({
        source: pick.uuid,
        threshold: 0,
        kind: "selection",
        row: row.id,
        grantAs: spellMode,
        met: true,
        needsSpelllikeBook: true,
        stackable: true,
        build: () =>
          buildSpell(pick.uuid, "spelllike", "", MODE.spelllike, parent.id, pickPerDay(parent, row.id, pick.uuid) ?? 0),
      });
      continue;
    }
    if (spellMode === GRANT_AS.class) {
      const classTag = pick.tag || classTagFor(actor, await resolve(pick.uuid)) || "";
      const bookId = classTag ? findSpellbookByClass(actor, classTag) : null;
      const listTag = bookId ? listTagOf(actor, bookId) ?? classTag : classTag;
      out.push({
        source: pick.uuid,
        threshold: 0,
        kind: "selection",
        row: row.id,
        grantAs: spellMode,
        met: bookId != null,
        domain: row.domain,
        bonusKnown: row.bonusKnown,
        build: () => buildSpell(pick.uuid, bookId, listTag, MODE.class, parent.id, 0, null, false, row.domain, row.bonusKnown),
      });
      continue;
    }
    out.push({
      source: pick.uuid,
      threshold: 0,
      kind: "selection",
      met: true,
      build: async () => {
        const data = await buildClassFeature(pick.uuid, pick.tag, parent.id);
        if (!data) return data;
        // A feat with no class of its own: the picked item says which class it is for.
        if (!pick.tag) data.system.class = classTagFor(actor, data) ?? "";
        // Listed where the granting feature is, just after it and in pick order. `sort`
        // survives the feature moving to another category, so this needs no timing.
        data.sort = (parent.sort ?? 0) + 1 + index;
        return data;
      },
    });
  }

  return out;
}

// ─── Archetypes ─────────────────────────────────────────────────────────────────

/**
 * Excluded association source-uuids from every active archetype on the actor that
 * targets the given class tag. Only archetypes whose associated class is actually
 * present on the actor count.
 */
function collectExcludedForClass(actor, tag) {
  const set = new Set();
  if (!actor || !tag || !actor.classes?.[tag]) return set;
  for (const it of actor.items) {
    const arch = getArchetype(it);
    if (!arch.replaces || !arch.excluded.length) continue;
    if (getAssociatedClass(it) !== tag) continue;
    for (const u of arch.excluded) set.add(uniformUuid(u));
  }
  return set;
}

/** All association uuids excluded by any active archetype, across all classes. */
function collectAllExcluded(actor) {
  const set = new Set();
  for (const it of actor.items) {
    const arch = getArchetype(it);
    if (!arch.replaces || !arch.excluded.length) continue;
    const tag = getAssociatedClass(it);
    if (!tag || !actor.classes?.[tag]) continue;
    for (const u of arch.excluded) set.add(uniformUuid(u));
  }
  return set;
}

/**
 * Remove base-class features already on the actor that an active archetype
 * excludes — the "removed if present" half. Level-up prevention (the flash-free
 * half) is handled by the class-level-change wrapper below. Matches items by the
 * compendium source the system stamps on class-association grants.
 */
async function enforceArchetypes(actor) {
  const excluded = collectAllExcluded(actor);
  if (!excluded.size) return false;

  const toDelete = actor.items
    .filter((it) => {
      // Never delete our own grants — they're owned by reconcileParent's ledger.
      // A replacement feature (e.g. duplicated from the base it supersedes) can
      // share the base's compendiumSource, so without this guard enforcement and
      // the grant would fight each other every pass (create → delete → recreate).
      if (it.getFlag(MODULE_ID, GRANT_PARENT)) return false;
      const src = it._stats?.compendiumSource;
      return src && excluded.has(uniformUuid(src));
    })
    .map((it) => it.id);

  if (!toDelete.length) return false;
  await actor.deleteEmbeddedDocuments("Item", toDelete, { render: false });
  return true;
}

/** Whether an item is an archetype: a feature with "Replaces class features" on. */
function isArchetype(item) {
  return getArchetype(item).replaces;
}

/**
 * Child-link each archetype to the class it modifies, so deleting the class takes
 * the archetype (and, through it, its grants) with it. An archetype some other item
 * already parents is left alone, so one delete never decides it two ways. Only links
 * to archetype-flagged items are removed, so hand-authored children survive.
 * DESIGN.md § Feature 3.
 */
async function settleArchetypeLinks(actor) {
  const classes = actor.itemTypes?.class ?? [];
  if (!classes.length) return false;
  const classIds = new Set(classes.map((c) => c.id));

  // Children claimed by any non-class item.
  const parentedElsewhere = new Set();
  for (const p of actor.items) {
    if (classIds.has(p.id)) continue;
    for (const l of p.system?.links?.children ?? []) parentedElsewhere.add(linkTargetId(l));
  }

  const wanted = new Map(); // class id -> Set of archetype ids
  for (const it of actor.items) {
    if (!isArchetype(it) || cascading.has(it.id) || parentedElsewhere.has(it.id)) continue;
    if (referencers(actor, it).size) continue;
    const clsId = actor.classes?.[getAssociatedClass(it)]?._id;
    if (!clsId || !classIds.has(clsId)) continue;
    if (!wanted.has(clsId)) wanted.set(clsId, new Set());
    wanted.get(clsId).add(it.id);
  }

  const updates = [];
  for (const cls of classes) {
    const want = wanted.get(cls.id) ?? new Set();
    const links = cls.toObject().system?.links?.children ?? [];
    const kept = links.filter((l) => {
      const id = linkTargetId(l);
      const target = actor.items.get(id);
      return !target?.getFlag(MODULE_ID, "archetype") || want.has(id);
    });
    const have = new Set(kept.map(linkTargetId));
    const added = [...want].filter((id) => !have.has(id));
    if (!added.length && kept.length === links.length) continue;
    for (const id of added) kept.push({ uuid: actor.items.get(id).getRelativeUUID(actor) });
    updates.push({ _id: cls.id, "system.links.children": kept });
  }

  if (!updates.length) return false;
  await actor.updateEmbeddedDocuments("Item", updates, { render: false });
  return true;
}

// ─── Class teardown ─────────────────────────────────────────────────────────────

/** Ids reachable from `ids` through child links, as the system's delete cascade walks them. */
function childClosure(actor, ids) {
  const out = new Set();
  const queue = [...ids];
  while (queue.length) {
    const id = queue.pop();
    const it = id && !out.has(id) ? actor.items.get(id) : null;
    if (!it) continue;
    out.add(id);
    for (const l of it.system?.links?.children ?? []) queue.push(linkTargetId(l));
  }
  return out;
}

/**
 * What a deleted class takes with it. `expected` is every item that should go:
 * what the system deletes itself (the class's children and class associations,
 * with their children) plus `sweep`, the rest, which this module deletes: the
 * class's archetypes and the engine and Supplements items that hang off any of
 * them without a child link. An item another surviving item still references
 * stays. Called after the class has left `actor.items`.
 */
function classTeardown(actor, cls) {
  const tag = cls.system?.tag;
  const children = (cls.system?.links?.children ?? []).map(linkTargetId);
  const assoc = Object.entries(cls.getFlag("pf1", "links.classAssociations") ?? {})
    .filter(([, level]) => level > 0)
    .map(([id]) => id);
  const archetypes = tag
    ? actor.items.filter((it) => isArchetype(it) && getAssociatedClass(it) === tag).map((it) => it.id)
    : [];
  const bySystem = childClosure(actor, [...children, ...assoc]);

  // Everything related: through child links and ledgers.
  const seeds = new Set([...children, ...assoc, ...archetypes]);
  const related = new Set();
  const queue = [...seeds];
  while (queue.length) {
    const id = queue.pop();
    const it = id && !related.has(id) ? actor.items.get(id) : null;
    if (!it) continue;
    related.add(id);
    for (const l of it.system?.links?.children ?? []) queue.push(linkTargetId(l));
    queue.push(...Object.keys(it.getFlag(MODULE_ID, GRANTED) ?? {}));
  }
  const systemSeeds = new Set([...children, ...assoc]);
  for (const id of [...related]) {
    if (systemSeeds.has(id)) continue;
    const refs = referencers(actor, actor.items.get(id));
    if ([...refs].some((r) => !related.has(r))) related.delete(id);
  }

  const isArch = new Set(archetypes);
  const sweep = [...related].filter((id) => {
    if (bySystem.has(id)) return false;
    const it = actor.items.get(id);
    return isArch.has(id) || isManaged(it) || !!it.getFlag(MODULE_ID, GRANT_PARENT);
  });
  return { expected: new Set([...bySystem, ...sweep]), sweep };
}

/** Whether a class deletion is still clearing this actor (or, with an id, that item). */
export function inTeardown(actor, itemId = null) {
  const t = actor && teardowns.get(actor.id);
  return !!t && (itemId === null || t.ids.has(itemId));
}

function endTeardown(actor) {
  const t = teardowns.get(actor.id);
  if (!t) return;
  clearTimeout(t.timer);
  teardowns.delete(actor.id);
  // A run that stood down mid-pass picks this up from its own finally.
  if (busy.has(actor.id)) rerun.set(actor.id, t.userId);
  else reconcileActor(actor, { userId: t.userId });
}

/**
 * A class was deleted. Every client stands its engine down for the actor until
 * the class's related items are gone, so nothing is re-granted or relinked
 * mid-delete. The deleting client also removes what the system's cascade won't.
 */
async function beginTeardown(actor, cls, userId) {
  const { expected, sweep } = classTeardown(actor, cls);
  if (!expected.size) return;
  const prior = teardowns.get(actor.id);
  if (prior) {
    clearTimeout(prior.timer);
    expected.forEach((id) => prior.ids.add(id));
  }
  const t = prior ?? { ids: expected, userId };
  t.timer = setTimeout(() => endTeardown(actor), CASCADE_MS);
  teardowns.set(actor.id, t);
  for (const id of expected) cascading.add(id);
  setTimeout(() => expected.forEach((id) => cascading.delete(id)), CASCADE_MS);

  if (userId !== game.user.id) return;
  const ids = sweep.filter((id) => actor.items.has(id));
  if (!ids.length) return;
  try {
    await actor.deleteEmbeddedDocuments("Item", ids, { render: false });
  } catch (err) {
    console.error(LOG, "class teardown sweep failed on", actor.name, err);
  }
}

// ─── Reconcile ──────────────────────────────────────────────────────────────────

/** Whether an item hosts any Enhanced Links configuration. */
function isConfiguredParent(item) {
  if (hasSpellcasting(item)) return true;
  if (slotsOf(item).length) return true;
  const cf = item.getFlag(MODULE_ID, "classFeatures");
  if (Array.isArray(cf) && cf.length) return true;
  const ss = item.getFlag(MODULE_ID, "spellSupplements");
  if (Array.isArray(ss?.items) && ss.items.length > 0) return true;
  const arch = item.getFlag(MODULE_ID, "archetype");
  return arch?.replaces === true && Array.isArray(arch?.excluded) && arch.excluded.length > 0;
}

/** Whether an item's ledger still records grants (possibly with its config emptied). */
function hasLedger(item) {
  return Object.keys(item.getFlag(MODULE_ID, GRANTED) ?? {}).length > 0;
}

/** The tail id of a link's (possibly relative) target uuid, e.g. ".Item.abc" → "abc". */
function linkTargetId(link) {
  return typeof link?.uuid === "string" ? link.uuid.split(".").pop() : null;
}

/** Whether any parent other than `parent` references the item (ledgers or Supplements claims). */
function referencedElsewhere(actor, itemId, parent) {
  const item = actor.items.get(itemId);
  return !!item && referencers(actor, item, parent.id).size > 0;
}

/** Every source a ledger record stands for: one row, plus rows that resolved to the same item. */
const recSources = (rec) => [rec.source, ...(rec.also ?? [])];

/** Whether an item is an engine-made spell-like spell. */
function isEngineSpelllike(item) {
  return item.type === "spell" && !!item.getFlag(MODULE_ID, GRANT_SOURCE) && item.system?.spellbook === "spelllike";
}

/** An existing unpooled engine spell-like spell from this source, for a stacking grant. */
function findStack(actor, source) {
  const target = uniformUuid(source);
  return (
    actor.items.find(
      (it) =>
        isEngineSpelllike(it) &&
        !it.getFlag(MODULE_ID, POOL) &&
        !it.getFlag(MODULE_ID, SCRIPTED) &&
        !cascading.has(it.id) &&
        uniformUuid(it.getFlag(MODULE_ID, GRANT_SOURCE)) === target
    ) ?? null
  );
}

/** Ledger record for a desired grant. */
function ledgerRecord(d) {
  const rec = { source: d.source, threshold: d.threshold, kind: d.kind };
  if (d.pool) rec.pool = d.pool;
  if (d.row) rec.row = d.row;
  if (d.grantAs) rec.grantAs = d.grantAs;
  return rec;
}

/**
 * Bring a single parent's grants in line with its desired set: delete grants that
 * are no longer met (or whose source was removed), create grants newly met.
 * Returns true if anything changed.
 *
 * Every grant is also linked as the parent's `children` (mirroring the system's own
 * child links) so it groups under the parent on the sheet and the system's delete
 * cascade owns teardown on parent deletion. The child-link list is lazily
 * materialized and only OUR entries are added/removed, so hand-authored children on
 * the parent are preserved.
 */
async function reconcileParent(actor, parent, resolve) {
  const ledger = foundry.utils.deepClone(parent.getFlag(MODULE_ID, GRANTED) ?? {});
  const desired = await buildDesired(actor, parent, resolve);
  const bySource = new Map(desired.map((d) => [d.source, d]));

  let changed = false;

  // Child links are only touched when a class-feature grant is added or removed.
  let childLinks = null; // null until first mutation; then the array we write back
  const editChildLinks = () => (childLinks ??= foundry.utils.deepClone(parent.toObject().system?.links?.children ?? []));

  // Teardown: ledger entries no longer wanted, or whose item was removed by hand.
  // A spell-like spell other parents still contribute to loses only this
  // parent's reference; a changed pool assignment re-grants with the new sharing.
  const toDelete = [];
  const domainSync = [];
  for (const [itemId, rec] of Object.entries(ledger)) {
    const stillPresent = actor.items.get(itemId);
    if (!stillPresent) {
      delete ledger[itemId];
      changed = true;
    } else {
      const keep = recSources(rec).filter((s) => {
        const d = bySource.get(s);
        return d && d.met && (rec.pool ?? "") === (d.pool ?? "") && (rec.grantAs ?? "") === (d.grantAs ?? "");
      });
      if (keep.length) {
        // Domain/School follows the checkbox, but only when the checkbox changed, so
        // a spell toggled by hand stays as it is.
        const d = bySource.get(keep[0]);
        // Class-spell picks carry both settings too. DESIGN.md § Spell picks.
        if (d.domain !== undefined) {
          const stamp = stillPresent.getFlag(MODULE_ID, DOMAIN_STAMP) ?? false;
          if (stamp !== d.domain) {
            domainSync.push({ _id: itemId, "system.domain": d.domain, [`flags.${MODULE_ID}.${DOMAIN_STAMP}`]: d.domain });
          }
        }
        // The bonus-known stamp simply follows the checkbox. settleKnownBonus reads it.
        if (d.bonusKnown !== undefined) {
          const stamp = stillPresent.getFlag(MODULE_ID, KNOWN_STAMP) ?? false;
          if (stamp !== d.bonusKnown) domainSync.push({ _id: itemId, [`flags.${MODULE_ID}.${KNOWN_STAMP}`]: d.bonusKnown });
        }
        // Some of the rows sharing this item still want it.
        if (keep.length !== recSources(rec).length) {
          ledger[itemId] = { ...ledgerRecord(bySource.get(keep[0])), ...(keep.length > 1 ? { also: keep.slice(1) } : {}) };
          changed = true;
        }
        continue;
      }
      // Only items a link made are ever deleted; one that was already on the actor
      // (added by hand, a class association) just loses this reference.
      if (!referencedElsewhere(actor, itemId, parent) && isManaged(stillPresent)) toDelete.push(itemId);
      delete ledger[itemId];
      changed = true;
    }
    // Drop our child link to this now-gone grant (stale or intentionally removed).
    const links = editChildLinks();
    const linkIdx = links.findIndex((l) => linkTargetId(l) === itemId);
    if (linkIdx >= 0) links.splice(linkIdx, 1);
  }
  if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete, { render: false });
  if (domainSync.length) {
    await actor.updateEmbeddedDocuments("Item", domainSync, { render: false });
    changed = true;
  }

  // Create: newly-met sources not already granted.
  const fresh = []; // [item, desired] pairs, for the create scripts
  const already = new Set(Object.values(ledger).flatMap(recSources));
  const toCreate = desired.filter((d) => d.met && !already.has(d.source));
  if (toCreate.length) {
    if (toCreate.some((d) => d.needsSpelllikeBook)) await ensureSpelllikeBook(actor);

    // Reference an item instead of creating it; a second row of this parent that
    // resolves to the same item joins the first record.
    const reference = (item, d) => {
      const rec = ledger[item.id];
      if (rec) rec.also = [...(rec.also ?? []), d.source];
      else ledger[item.id] = ledgerRecord(d);
      // A pick belongs to its slot even when the item was already on the actor.
      if (d.kind === "selection") {
        const links = editChildLinks();
        if (!links.some((l) => linkTargetId(l) === item.id)) links.push({ uuid: item.getRelativeUUID(actor) });
      }
      fresh.push([item, d]);
      changed = true;
    };

    const dedupe = dedupeEnabled();
    const data = [];
    const meta = [];
    const joiners = []; // per data index: rows that resolved to the same new item
    const pendingKeys = new Map(); // match key -> data index, for duplicates within this pass
    for (const d of toCreate) {
      // Stack onto an existing copy: record it, settle derives its uses.
      const stack = d.stackable ? findStack(actor, d.source) : null;
      if (stack) {
        ledger[stack.id] = ledgerRecord(d);
        changed = true;
        continue;
      }
      const built = await d.build();
      if (!built) continue;
      // A row's new name (§ Feature 8); a pick has none.
      if (d.kind !== "selection") {
        const tab = d.kind === "classFeature" ? SCRIPT_TAB.classFeatures : SCRIPT_TAB.spellSupplements;
        applyRename(built, parent, tab, d.source);
      }

      // Class features and picks: one the actor already has is shared, not copied.
      if (dedupe && (d.kind === "classFeature" || d.kind === "selection")) {
        const existing = findExisting(actor, built);
        if (existing && !cascading.has(existing.id)) {
          reference(existing, d);
          continue;
        }
        const keys = dataKeys(built);
        const index = keys.map((k) => pendingKeys.get(k)).find((i) => i !== undefined);
        if (index !== undefined) {
          joiners[index].push(d);
          continue;
        }
        keys.forEach((k) => pendingKeys.set(k, data.length));
      }
      data.push(built);
      meta.push(d);
      joiners.push([]);
    }
    if (data.length) {
      const created = await actor.createEmbeddedDocuments("Item", data, { render: false });
      // Pair by the grantSource stamped in build, never by position: the result can
      // come back in another order, or short if a preCreate hook vetoed one, and a
      // positional pairing then runs one row's create scripts on another row's item.
      const bySource = new Map();
      for (const item of created) {
        const key = uniformUuid(item.getFlag(MODULE_ID, GRANT_SOURCE));
        bySource.set(key, [...(bySource.get(key) ?? []), item]);
      }
      for (let i = 0; i < meta.length; i++) {
        const item = bySource.get(uniformUuid(meta[i].source))?.shift();
        if (!item) {
          console.warn(LOG, "grant was not created (vetoed?):", meta[i].source);
          continue;
        }
        ledger[item.id] = ledgerRecord(meta[i]);
        fresh.push([item, meta[i]]);
        for (const d of joiners[i]) reference(item, d);
        // Link every grant as a child of the parent (actor-relative uuid, name
        // omitted — same shape the system writes for a "children" link) so the
        // system's delete cascade owns teardown on parent removal.
        editChildLinks().push({ uuid: item.getRelativeUUID(actor) });
      }
      changed = true;
    }
  }

  if (changed) {
    // Flags merge on update, so a dropped entry needs an explicit deletion key or
    // it survives in the database and is found again on every later pass.
    const written = { ...ledger };
    for (const itemId of Object.keys(parent.getFlag(MODULE_ID, GRANTED) ?? {})) {
      if (!(itemId in ledger)) written[`-=${itemId}`] = null;
    }
    const update = { [`flags.${MODULE_ID}.${GRANTED}`]: written };
    if (childLinks !== null) update["system.links.children"] = childLinks;
    await parent.update(update, { render: false });
  }

  // Create scripts run once the ledger is written, still inside the re-entry guard.
  for (const [child, d] of fresh) {
    // A selection row carries no create scripts.
    if (d.kind === "selection") continue;
    const kind = d.kind === "classFeature" ? SCRIPT_TAB.classFeatures : SCRIPT_TAB.spellSupplements;
    await runCreateScripts({ parent, child, kind, source: d.source });
  }
  return changed;
}

/**
 * A contributor's current Times/day for a spell-like spell, from its Spell
 * Supplements entry or, for a pick, its selection row. Null when the entry is gone.
 */
function contributedPerDay(parent, rec) {
  if (rec.kind === "selection") return pickPerDay(parent, rec.row, rec.source);
  const target = uniformUuid(rec.source);
  const entry = getSpellSupplements(parent).items.find((e) => uniformUuid(e.uuid) === target);
  return entry ? entry.perDay ?? 0 : null;
}

/**
 * Derive every engine spell-like spell from the parents whose ledgers record it
 * (its contributors), reading their current config: uses, at will, the pool key,
 * and the child link. A spell nobody contributes to any more is deleted, unless
 * the system is already cascade-deleting it. Returns true if anything changed.
 */
async function settleSpelllike(actor) {
  /** @type {Map<string, {parent: Item, rec: object}[]>} */
  const refs = new Map();
  for (const parent of actor.items) {
    for (const [itemId, rec] of Object.entries(parent.getFlag(MODULE_ID, GRANTED) ?? {})) {
      if (!refs.has(itemId)) refs.set(itemId, []);
      refs.get(itemId).push({ parent, rec });
    }
  }

  const toDelete = [];
  const updates = [];
  const linkEdits = new Map(); // parent id -> edited children array
  const childLinksOf = (p) =>
    linkEdits.get(p.id) ?? foundry.utils.deepClone(p.toObject().system?.links?.children ?? []);

  for (const spell of actor.items) {
    if (!isEngineSpelllike(spell)) continue;
    const contributors = refs.get(spell.id) ?? [];
    if (!contributors.length) {
      if (!cascading.has(spell.id)) toDelete.push(spell.id);
      continue;
    }

    // Each contributor's current Times/day; a contributor whose entry is gone is
    // left for its own teardown on the next pass.
    let atWill = false;
    let max = 0;
    let counted = 0;
    for (const { parent, rec } of contributors) {
      const perDay = contributedPerDay(parent, rec);
      if (perDay === null) continue;
      counted++;
      const n = Math.max(0, Math.floor(Number(perDay) || 0));
      if (n > 0) max += n;
      else atWill = true;
    }
    if (!counted) continue;

    const update = {};
    const wasAtWill = !!spell.system.atWill;
    const oldMax = spell.system.preparation?.max ?? 0;
    const oldValue = spell.system.preparation?.value ?? 0;
    let value = oldValue;
    if (wasAtWill && !atWill) value = max;
    else if (max > oldMax) value = oldValue + (max - oldMax);
    value = Math.clamp(value, 0, max);
    if (wasAtWill !== atWill) update["system.atWill"] = atWill;
    // max and value together: the system raises max to match a lone value update.
    if (max !== oldMax || value !== oldValue) {
      update["system.preparation.max"] = max;
      update["system.preparation.value"] = value;
    }

    const only = contributors.length === 1 ? contributors[0] : null;
    const poolKey = only?.rec.pool ? `${only.parent.id}:${only.rec.pool}` : null;
    if ((spell.getFlag(MODULE_ID, POOL) ?? null) !== poolKey) {
      if (poolKey) update[`flags.${MODULE_ID}.${POOL}`] = poolKey;
      else update[`flags.${MODULE_ID}.-=${POOL}`] = null;
    }
    if (Object.keys(update).length) updates.push({ _id: spell.id, ...update });

    // One contributor: its child. Shared: nobody's, so no parent's delete cascade
    // takes it.
    for (const { parent } of contributors) {
      const links = childLinksOf(parent);
      const linked = links.some((l) => linkTargetId(l) === spell.id);
      if (parent === only?.parent && !linked) {
        links.push({ uuid: spell.getRelativeUUID(actor) });
        linkEdits.set(parent.id, links);
      } else if (parent !== only?.parent && linked) {
        linkEdits.set(
          parent.id,
          links.filter((l) => linkTargetId(l) !== spell.id)
        );
      }
    }
  }

  for (const [_id, children] of linkEdits) updates.push({ _id, "system.links.children": children });

  let changed = false;
  const deletions = toDelete.filter((id) => actor.items.has(id));
  if (deletions.length) {
    await actor.deleteEmbeddedDocuments("Item", deletions, { render: false });
    changed = true;
  }
  if (updates.length) {
    await actor.updateEmbeddedDocuments("Item", updates, { render: false });
    changed = true;
  }
  return changed;
}

/**
 * Child links of shared items other than spell-like spells (which settleSpelllike
 * owns). An item a link made (Class Features grant, or Supplements copy referenced
 * by a ledger) is the child of its one referencer, nobody's child when shared, and
 * deleted when nothing references it. Items that were already on the actor are
 * never linked or deleted here. Returns true if anything changed.
 */
async function settleShared(actor) {
  const toDelete = [];
  const linkEdits = new Map(); // parent id -> edited children array
  const childLinksOf = (p) =>
    linkEdits.get(p.id) ?? foundry.utils.deepClone(p.toObject().system?.links?.children ?? []);

  const inLedger = new Set();
  for (const p of actor.items) Object.keys(p.getFlag(MODULE_ID, GRANTED) ?? {}).forEach((id) => inLedger.add(id));

  for (const item of actor.items) {
    if (isEngineSpelllike(item) || !isManaged(item) || cascading.has(item.id)) continue;
    // Supplements-only items are managed by supplements.mjs on the adding client.
    if (!inLedger.has(item.id) && !item.getFlag(MODULE_ID, GRANT_SOURCE)) continue;

    const refs = referencers(actor, item);
    if (!refs.size) {
      toDelete.push(item.id);
      continue;
    }
    const only = refs.size === 1 ? [...refs][0] : null;
    for (const p of actor.items) {
      const links = childLinksOf(p);
      const linked = links.some((l) => linkTargetId(l) === item.id);
      if (p.id === only && !linked) {
        links.push({ uuid: item.getRelativeUUID(actor) });
        linkEdits.set(p.id, links);
      } else if (!only && linked) {
        // Shared: nobody's child, so no one parent's delete cascade takes it.
        linkEdits.set(
          p.id,
          links.filter((l) => linkTargetId(l) !== item.id)
        );
      }
    }
  }

  let changed = false;
  const deletions = toDelete.filter((id) => actor.items.has(id));
  if (deletions.length) {
    await actor.deleteEmbeddedDocuments("Item", deletions, { render: false });
    changed = true;
  }
  const updates = [...linkEdits].map(([_id, children]) => ({ _id, "system.links.children": children }));
  if (updates.length) {
    await actor.updateEmbeddedDocuments("Item", updates, { render: false });
    changed = true;
  }
  return changed;
}

/**
 * Reconcile every configured parent on the actor, looping to a fixpoint so that
 * cascading grants (a grant that is itself a parent) settle within one event.
 */
async function reconcileActor(actor, { userId = null, force = false } = {}) {
  if (!(actor instanceof Actor) || !game.ready) return;
  // Paused for uninstall, the engine runs only when the uninstall menu asks it to.
  if (!force && (isDormant() || !mayReconcile(actor, userId))) return;
  if (busy.has(actor.id) || teardowns.has(actor.id)) return;

  busy.add(actor.id);
  let dirty = false;
  // One source cache for the whole reconcile, shared across passes and parents.
  const resolve = makeSourceCache();
  try {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      // A class deletion began mid-run; its own end reconciles.
      if (teardowns.has(actor.id)) return;
      let changed = false;
      // Remove archetype-excluded base features first, so a replacement grant is
      // never created while the base it supersedes is still on the actor — that
      // overlap is what trips the system's duplicate-identifier check during prep.
      if (await enforceArchetypes(actor)) changed = true;
      if (await settleArchetypeLinks(actor)) changed = true;
      // A ledger with no config left still has grants to tear down.
      for (const parent of actor.items.filter((it) => isConfiguredParent(it) || hasLedger(it))) {
        if (teardowns.has(actor.id)) return;
        if (cascading.has(parent.id) || !actor.items.has(parent.id)) continue;
        if (await reconcileParent(actor, parent, resolve)) changed = true;
      }
      if (await settleSpelllike(actor)) changed = true;
      if (await settleShared(actor)) changed = true;
      if (await settleKnownBonus(actor)) changed = true;
      // Spellcasting terms, targets and the choice action. DESIGN.md § Feature 6.
      if (await reconcileSpellcasting(actor)) changed = true;
      // What follows from the picks: the Choose action, counts, the description
      // line, and where a filled feature sits. DESIGN.md § Feature 7.
      if (await settleSelections(actor, { skip: cascading, dormant: isDormant() })) changed = true;
      if (changed) dirty = true;
      if (!changed) return;
      if (pass === MAX_PASSES - 1) {
        console.warn(LOG, "reconcile hit the pass cap on", actor.name, "— check for a link cycle.");
      }
    }
  } catch (err) {
    console.error(LOG, "reconcile failed for", actor?.name, err);
  } finally {
    busy.delete(actor.id);
    // All engine CRUD runs render:false to avoid flashing mid-churn; re-render the
    // actor's open sheets once at the end so grants appear without a reopen.
    if (dirty) actor.render(false);
    if (rerun.has(actor.id)) {
      const by = rerun.get(actor.id);
      rerun.delete(actor.id);
      reconcileActor(actor, { userId: by });
    }
  }
}

/**
 * Re-create the base-class features a just-removed archetype was suppressing.
 * Called from the delete hook, where the archetype item is already off the actor —
 * so its own exclusions no longer count. A base feature returns only if (a) its
 * class is still on the actor, (b) no OTHER active archetype still replaces it,
 * (c) the class level meets the association's level (higher ones return on the next
 * normal level-up), and (d) it isn't somehow already present. Restored features are
 * plain class associations — no engine flags — so they behave exactly like the ones
 * the system grants on level-up, and a future archetype can exclude them again.
 */
async function restoreReplacedFeatures(actor, item) {
  const arch = getArchetype(item);
  if (!arch.replaces || !arch.excluded.length) return;

  const tag = getAssociatedClass(item);
  const clsId = tag ? actor.classes?.[tag]?._id : null;
  const cls = clsId ? actor.items.get(clsId) : null;
  if (!cls) return; // class gone — nothing to restore onto

  const clvl = classLevel(actor, tag);
  const stillExcluded = collectExcludedForClass(actor, tag); // other active archetypes
  const assoc = new Map((cls.system?.links?.classAssociations ?? []).map((a) => [uniformUuid(a.uuid), a]));

  const data = [];
  const levels = [];
  for (const rawUuid of arch.excluded) {
    const u = uniformUuid(rawUuid);
    if (stillExcluded.has(u)) continue; // still replaced by another archetype
    const a = assoc.get(u);
    if (!a) continue; // not a current association of this class (config drift)
    const level = Number.isFinite(a.level) ? a.level : 1;
    if (clvl < level) continue; // not yet earned; level-up will grant it
    if (actor.items.some((it) => uniformUuid(it._stats?.compendiumSource) === u)) continue; // already present
    const built = await buildFromSource(a.uuid);
    if (!built) continue;
    foundry.utils.setProperty(built.data, "system.class", tag);
    data.push(built.data);
    levels.push(level);
  }

  // The class can go while sources load; restoring then would leave orphans.
  if (!data.length || !actor.items.has(cls.id) || inTeardown(actor)) return;
  busy.add(actor.id);
  try {
    const created = await actor.createEmbeddedDocuments("Item", data, { render: false });
    // Recorded as the system records its own grants, so a class level-down or
    // deletion removes them too.
    const update = {};
    created.forEach((it, i) => (update[`flags.pf1.links.classAssociations.${it.id}`] = levels[i]));
    if (actor.items.has(cls.id)) await cls.update(update, { render: false });
  } finally {
    busy.delete(actor.id);
  }
  actor.render(false);
}

// ─── Triggers ───────────────────────────────────────────────────────────────────

const SOCKET = `module.${MODULE_ID}`;

/** Reconcile now, or once the run in progress for the actor ends. */
function requestReconcile(actor, userId) {
  if (busy.has(actor.id)) rerun.set(actor.id, userId);
  else reconcileActor(actor, { userId });
}

/** A player's client asking the primary GM to reconcile an actor. */
function onSocket(msg) {
  if (msg?.action !== "reconcile" || !isPrimaryGM()) return;
  const actor = fromUuidSync(msg.actorUuid);
  if (actor instanceof Actor) requestReconcile(actor, msg.userId);
}

Hooks.once("ready", () => {
  registerLevelUpFilter();
  game.socket.on(SOCKET, onSocket);
  console.log(LOG, "engine ready");
});

/**
 * Hard prevention of archetype-replaced features on level-up: wrap the class's
 * _onLevelChange so excluded associations are hidden for the duration of the
 * grant, meaning the system never creates them (no flash). Requires lib-wrapper;
 * without it we degrade to the reconcile sweep, which removes them just after.
 */
function registerLevelUpFilter() {
  if (!game.modules.get("lib-wrapper")?.active) {
    console.warn(LOG, "lib-wrapper inactive — replaced features are removed reactively instead of blocked.");
    return;
  }

  libWrapper.register(
    MODULE_ID,
    "CONFIG.Item.documentClasses.class.prototype._onLevelChange",
    async function (wrapped, ...args) {
      const excluded = collectExcludedForClass(this.actor, this.system?.tag);
      const original = this.system?.links?.classAssociations;
      if (!excluded.size || !Array.isArray(original)) return wrapped(...args);

      // Temporarily hide excluded associations so the system won't grant them.
      this.system.links.classAssociations = original.filter((a) => !excluded.has(uniformUuid(a.uuid)));
      try {
        return await wrapped(...args);
      } finally {
        this.system.links.classAssociations = original;
      }
    },
    "WRAPPER"
  );
  console.log(LOG, "level-up filter registered");
}

// Class level or HD changed (racial HD is a class item too, so HD gates ride this).
// The system fires this only on the client that changed the level, after its
// associations are added or removed; a player's client hands the run to the GM.
Hooks.on("pf1ClassLevelChange", (actor) => {
  if (!(actor instanceof Actor)) return;
  const userId = game.user.id;
  if (mayReconcile(actor, userId)) requestReconcile(actor, userId);
  else if (game.users.activeGM) game.socket.emit(SOCKET, { action: "reconcile", actorUuid: actor.uuid, userId });
});

// A configured parent was added (mid-campaign drop, or ungated grants on arrival),
// or an archetype or a class it can be linked under.
Hooks.on("createItem", (item, options, userId) => {
  const actor = item.actor;
  if (!(actor instanceof Actor) || busy.has(actor.id)) return;
  const linksArchetype =
    isArchetype(item) || (item.type === "class" && actor.items.some((it) => isArchetype(it)));
  if (isConfiguredParent(item) || linksArchetype) reconcileActor(actor, { userId });
});

// Config edited on an item already on the actor (levels, mode, gating, entries).
Hooks.on("updateItem", (item, changed, options, userId) => {
  const actor = item.actor;
  if (!(actor instanceof Actor)) return;
  if (busy.has(actor.id)) {
    if (foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${PICKS_FLAG}`)) rerun.set(actor.id, userId);
    return;
  }
  // The associated class is what every class-tied link and Advance row keys on.
  if (foundry.utils.hasProperty(changed, `flags.${MODULE_ID}`) || foundry.utils.hasProperty(changed, "system.class")) {
    reconcileActor(actor, { userId });
  }
});

// A spellbook was reconfigured. Caster type, preparation mode, the auto-CL formula
// and `inUse` all move which spell levels a book can cast, and none of them touch a
// class item — so pf1ClassLevelChange never fires for them. Filtered tightly to the
// spells block; reconcile is idempotent, so a redundant pass costs only a scan.
// (A caster level changed purely by an ItemChange is derived during prep and issues
// no actor update, so it is not covered here — the next real event catches it.)
Hooks.on("updateActor", (actor, changed, options, userId) => {
  if (busy.has(actor.id)) return;
  if (foundry.utils.hasProperty(changed, "system.attributes.spells")) reconcileActor(actor, { userId });
});

// An item was removed. An archetype restores what it replaced; a grant
// hand-deleted while its parent survives re-heals. Parent-deletion teardown of
// grants needs nothing here: every grant is child-linked, so the system's own
// cascade (Actor#_onDeleteDescendantDocuments) removes them all with the parent.
Hooks.on("deleteItem", async (item, options, userId) => {
  const actor = item.actor;
  if (!(actor instanceof Actor) || !game.ready) return;

  // A class takes its archetypes and everything hanging off either with it. Until
  // that has all gone, nothing is restored, re-healed, or reconciled.
  const t = teardowns.get(actor.id);
  if (t?.ids.delete(item.id) && !t.ids.size) endTeardown(actor);
  if (item.type === "class" && !isDormant()) beginTeardown(actor, item, userId);
  if (teardowns.has(actor.id)) return;

  // A removed parent's children are the system cascade's to delete. Noted first, on
  // every path: a reconcile already running must leave them alone too, or it writes
  // to an item whose delete is in flight and the server rejects the whole update.
  const removedParent = hasLedger(item);
  if (removedParent) {
    const ids = (item.system?.links?.children ?? []).map(linkTargetId).filter(Boolean);
    for (const id of ids) cascading.add(id);
    setTimeout(() => ids.forEach((id) => cascading.delete(id)), CASCADE_MS);
  }
  if (isDormant() || !mayReconcile(actor, userId) || busy.has(actor.id)) return;

  // Restore base features a removed archetype was suppressing.
  await restoreReplacedFeatures(actor, item);

  // The cascade takes the removed parent's own children, but a spell-like spell it
  // shared with other parents must lose its contribution.
  if (removedParent) {
    reconcileActor(actor, { userId });
    return;
  }

  // A removed feature's spellcasting terms come back out of the books it advanced.
  if (hasSpellcastingLedger(actor, item.id)) return void reconcileActor(actor, { userId });

  // A grant hand-deleted while its parent still lives → re-heal (the gate may still
  // be met). If the parent is gone this was cascade teardown — nothing to do.
  const parentId = item.getFlag(MODULE_ID, GRANT_PARENT);
  if (parentId && actor.items.get(parentId)) reconcileActor(actor, { userId });
});

// Pooled spell-like spells share one count: a change to one's uses left (a cast,
// a rest, a hand edit) is mirrored to the rest of its pool. Runs on the client
// that made the change, which owns the actor, so no GM is needed.
Hooks.on("updateItem", (item, changed, options, userId) => {
  if (game.user.id !== userId || options?.[POOL_SYNC]) return;
  const value = foundry.utils.getProperty(changed, "system.preparation.value");
  if (value === undefined || item.type !== "spell") return;
  const key = item.getFlag(MODULE_ID, POOL);
  const actor = item.actor;
  if (!key || !actor) return;

  const updates = [];
  for (const other of actor.items) {
    if (other === item || other.type !== "spell" || other.getFlag(MODULE_ID, POOL) !== key) continue;
    const target = Math.min(value, other.system.preparation?.max ?? value);
    if ((other.system.preparation?.value ?? null) === target) continue;
    updates.push({ _id: other.id, "system.preparation.value": target });
  }
  if (!updates.length) return;
  actor
    .updateEmbeddedDocuments("Item", updates, { [POOL_SYNC]: true })
    .catch((err) => console.error(LOG, "pool sync failed on", actor.name, err));
});

// Expose for console debugging alongside the Phase 1 accessors.
/**
 * Reconcile an actor on this client now, whoever the primary GM is and whether or
 * not the module is paused, and resolve once it has settled. For the uninstall menu.
 */
export async function reconcileForced(actor) {
  const idle = async () => {
    while (busy.has(actor.id)) await new Promise((resolve) => setTimeout(resolve, 50));
  };
  // A run already under way would make this one return at once.
  await idle();
  await reconcileActor(actor, { userId: game.user.id, force: true });
  await idle();
}

globalThis.pf1EnhancedLinks = { ...(globalThis.pf1EnhancedLinks ?? {}), reconcileActor };
