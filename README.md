# PF1 Enhanced Links

A module for the Foundry VTT **Pathfinder 1e** system that extends an item's
**Links** tab with two gate-driven sub-tabs. It generalizes the system's built-in
*class associations* and *supplements* so that any class-associated item — feats,
templates, races — can grant nested content and hand its spells to the correct
spellbook automatically.

> **Status:** early development. Phase 1 (the configuration UI and storage) is in
> place; the engine that creates and removes the linked items on level change is
> being built next. See [`DESIGN.md`](DESIGN.md) for the full plan.

## The tabs

Both appear inside an item's **Links** tab, alongside the system's own link types.

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
