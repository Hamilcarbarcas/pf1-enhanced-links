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

In **Spell-like Abilities** mode each spell also gets a **Times/day** value that
sets its uses per day on the actor (0 = at-will).

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
