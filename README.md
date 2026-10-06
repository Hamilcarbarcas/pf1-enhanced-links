# PF1 Enhanced Links

A module for the Foundry VTT **Pathfinder 1e** system that extends an item's
**Links** tab with two gate-driven sub-tabs. It generalizes the system's built-in
*class associations* and *supplements* so that any class-associated item — feats,
templates, races — can grant nested content and hand its spells to the correct
spellbook automatically.

> **Status:** early development. The configuration UI, the storage, and the engine
> that creates and removes linked items as gates are crossed are all in place. See
> [`DESIGN.md`](DESIGN.md) for the full design.

## The tabs

Both appear inside an item's **Links** tab, alongside the system's own link types.
Each row carries a <i class="fa-solid fa-book"></i> book icon that opens the linked
item's sheet, exactly like the system's built-in link sections.

Wherever a list is **level-gated**, it is sorted by level (ties by name): the Class
Features tab, Spell Supplements with *Level gating* enabled, and the archetype
exclusion checklist. The sort is applied when the tab is drawn, so a level you type
saves right away but the row settles into its new place the next time the panel
renders (reopening the sheet, switching sub-tabs, or adding/removing a row). The
stored link order itself is never rewritten.

### Class Features
Drop items here and give each a **level**. When the item's associated class
(`system.class`) reaches that level on an actor, the dropped item is added as a
child and inherits the same class association — the same behavior as a class's
own associations, but hosted on a class feature instead of the class.

**Replaces class features (archetypes).** Enable "Replaces class features" and
drop the **base class** to see its class associations as a checklist; tick the
ones this feature replaces. On an actor, replaced features are blocked from being
granted on level-up and removed if already present — so a class feature that grants
its own replacements *and* replaces base features expresses an archetype end to
end. (The base-class picker is required because a compendium feature doesn't yet
know which class it belongs to.)

### Spell Supplements
Drop **spells** here and pick a **destination**:

- **Class Spellcasting** — the spells join the spellbook provided by the item's
  associated class.
- **Spell-like Abilities** — the spells join the actor's spell-like abilities book.

A **Level gating** checkbox controls whether entries are gated. When enabled, each
spell appears once the gate is met — the associated class's level (Class
Spellcasting) or the actor's Hit Dice (Spell-like Abilities). When disabled, the
spells are present whenever the item is on the actor.

A **Require castable level** checkbox (Class Spellcasting only, **on by default**)
adds a second condition: the spell also waits until the destination spellbook can
cast that spell level. This is what lets a single feature serve both a full and a
partial caster. Give each spell the level gate the full caster should get it at; the
partial caster then receives it at whichever comes later — that gate or its own
casting progression — and simply never receives spells of a level its progression
never reaches. Because the default is on, Class Spellcasting lists you configured
before this option existed pick up the check too; untick it to go back to gating on
class level alone.

The check reads the book's caster type and casting progression only. It ignores the
casting ability score, so ability damage or a temporary penalty can't make already
granted spells vanish and reappear. (For a spellbook set to manual slots the system
has no progression to consult and allows levels by caster type alone — up to 4th for
low, 6th for medium — so on those books the entry's own level gate does the pacing.)

A **Domain/School spells** checkbox (Class Spellcasting only, off by default) marks
every spell this item grants as a Domain/School spell, the same setting as on the
spell's own sheet. Changing the checkbox later updates spells already on the actor.
A spell you toggle by hand keeps your setting until the checkbox changes again.

In **Spell-like Abilities** mode each spell also gets a **Times/day** value that
sets its uses per day on the actor (0 = at-will). Changing it later updates the
spell already on the actor.

**Pools.** Spell-like spells can share one daily count ("1/day — *enlarge person*
or *reduce person*"): pick the same **Pool** (A, B or C) on each row. A pool has a
single Times/day, so editing it on one row changes the others, and a row joining a
pool takes the pool's value. On the actor, using any spell in the pool spends the
count for all of them. Each pooled spell shows a <i class="fa-solid fa-link"></i>
link icon after its name on the actor sheet; hover it to see the rest of its pool.

**Granted-by icon.** Every spell these tabs put on an actor shows a
<i class="fa-solid fa-gift"></i> gift icon after its name on the actor sheet. Hover
it to see which item granted it and, for spell-like abilities, how many uses each
one gives — e.g. *Race (1/day)*, *Feat (at will)*. A stacked spell lists every item
contributing to it. A pool belongs to its item: two items that both use pool A
don't share. Pools are ignored at 0 Times/day, since an at-will ability has no
count to share.

**Stacking.** When more than one item grants the same spell-like ability, they add
up on one spell instead of creating copies: 1/day from a race and 2/day from a feat
is one spell at 3/day, and any at-will grant makes it at will. The new uses are
available right away. Removing an item, or its level gate dropping, takes back only
that item's share, and the spell goes when its last grant does. A spell granted by
one item is that item's child, as usual; a spell granted by several is nobody's
child, so deleting one of them can't delete it. Pooled spells never stack — each
stays its own copy — because one count can't be both shared and separate.

## Create scripts on links

Every row of **Class Features**, **Spell Supplements** and the system's own
**Supplements** tab can carry scripts that run on the item **when that link creates
it**. Use them to grant a variant without a separate compendium entry: a
cold-themed school's *fireball* that deals cold damage, or *align weapon* that can
only align to good.

The controls sit in the row's name cell, just left of the
<i class="fa-solid fa-book"></i> book icon:

- <i class="fa-solid fa-plus"></i> creates a script stored on this item, for this row
  only, and opens the editor.
- Each script then shows as an icon in the row. Click it to edit. Right-click it to
  remove it.

A script works like an item's own create script call. `item` is the newly created
item, and `actor`, `token` and `shared` are available as usual. The scope also has
`parent` (the item granting it), `source` (the linked uuid) and `link` (which tab).
A typical script just updates the new item:

```js
const actions = item.toObject().system.actions;
actions[0].damage.parts[0].types = ["cold"];
await item.update({ "system.actions": actions });
```

Notes:

- Scripts run **every time** the link creates the item: the first grant, a level
  gate crossed again, or re-adding a granted item that was deleted by hand. Editing a
  script doesn't change items that are already granted.
- Class Features and Spell Supplements scripts run on the GM's client. Supplements
  scripts run on the client of whoever added the parent item.
- A spell-like spell from a row with scripts is always its own copy and never
  stacks with the same spell from another item. Its uses per day still come from
  the row's Times/day.
- Removing a row from Class Features or Spell Supplements also removes its scripts.
  Removing a row from the system's Supplements tab leaves them stored, and they come
  back if you link the same item again.
- On the Supplements and Class Features tabs, when the actor already has the item, a
  newly added parent runs its scripts on that existing item. See below.

## No duplicate linked items

PF1's own **Supplements** create a new copy every time an item linking them is added,
even when the actor already has one. A second copy of a feature produces PF1's
duplicate tag warnings. With **Don't duplicate linked items** on (a world setting,
**on by default**), an actor that already has the item keeps its one copy. The new
item shares it, and runs its create scripts on it. **Class Features** grants work the
same way: a feature the actor already has, for example from a class or another feat,
is shared rather than granted a second time.

- **Counts as already present:** the same source item, or an item of the same type
  with the same identifier (tag). That's the clash PF1 warns about.
- **Always copied:** physical items (two kits that each grant rope give two ropes)
  and spells.
- **Removing one parent**, or one Class Features level gate dropping, leaves a shared
  item in place for the others. It goes when the last item that granted it is
  removed. An item that was already on the actor before a link shared it (added by
  hand, or from a class) is never removed this way.

Turn the setting off to get PF1's normal copies back.

## Where each tab shows up

| Tab | Requires an associated class? | Appears on |
|---|---|---|
| Class Features | yes | class-associated items (feats, etc.) |
| Spell Supplements — Class Spellcasting | yes | class-associated items |
| Spell Supplements — Spell-like Abilities | no | any item that supports links |

## Compatibility

- Foundry VTT **v13**
- Pathfinder 1e system **v11.x**
- **lib-wrapper** (recommended) — enables flash-free blocking of archetype-replaced
  features on level-up. Without it, those features are removed reactively instead.

## License

See [`LICENSE`](LICENSE).
