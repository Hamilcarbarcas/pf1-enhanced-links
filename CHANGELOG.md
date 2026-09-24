# Changelog

## Unreleased

### Added
- New **Class Features** sub-tab on the item Links tab: drop items and give each a
  level to grant them as class-associated children when the associated class
  reaches that level.
- New **Spell Supplements** sub-tab: drop spells and route them into either the
  associated class's spellbook or the spell-like abilities book, with an optional
  level-gating toggle (class level for Class Spellcasting, Hit Dice for Spell-like
  Abilities).
- Configuration UI and per-item flag storage for both features.
- Gating engine that creates and removes the linked items as gates are crossed:
  triggered by class level / Hit Dice changes and by adding, editing, or removing
  a configured item. Grants cascade (a granted item can grant further), tear down
  when their gate drops or their parent is removed, and route spells into the
  associated class's book or the spell-like abilities book (enabling the latter if
  it isn't already). Runs on the primary GM client.
- Granted items (class features and spells alike) are child-linked to the parent
  that produced them, so they group under it on the sheet and are removed together
  with the parent by the system's own delete cascade.
- **Times/day** on spell-like spell supplements: a per-spell uses-per-day field
  (shown in Spell-like Abilities mode) that stamps the created spell's prepared
  uses; 0 means at-will. Spells routed to spell-like also have their components
  cleared, since spell-like abilities have none.
- **Archetype support** on the Class Features tab: a "Replaces class features"
  option lets a class feature pick a base class and check which of its class
  associations to replace. Replaced features are blocked from being granted on
  level-up (flash-free with lib-wrapper) and removed if already present. Deleting
  the archetype restores the base features it had suppressed (those the character
  has earned and that no other archetype still replaces). Combined with the tab's
  own grants, this expresses an archetype end-to-end.
- **Require castable level** on Spell Supplements (Class Spellcasting mode only,
  **on by default**): a spell is also held back until the destination spellbook can
  actually cast that spell level, so one feature can serve a full and a partial
  caster. The partial caster receives each spell at whichever comes later — the
  entry's level gate or its own casting progression — and never receives spells of a
  level its progression doesn't reach. The check reads the book's caster type and
  progression only, deliberately not the casting ability score, so ability damage
  can't make granted spells flicker. Because the default is on, existing
  Class Spellcasting configurations gain the check as well.
- **Compendium link icon** on every row in both sub-tabs (and in the archetype
  exclusion checklist), matching the system's own link sections: click the book to
  open the linked item's sheet. Hidden on broken links, which have nothing to open.
- **Spell-like pools**: a Pool column (A/B/C) in Spell-like Abilities mode. Spells
  in the same pool share one Times/day count on the actor ("1/day — enlarge person
  or reduce person"); using one spends it for all. Pools are scoped to their item.
  On the actor sheet, pooled spells carry a link icon whose tooltip lists the pool.
- **Granted-by icon** on the actor sheet: every spell granted through Spell
  Supplements carries a gift icon whose tooltip lists the granting item(s) and, for
  spell-like abilities, the uses each gives (e.g. "Race (1/day)").
- **Spell-like stacking**: several items granting the same spell-like ability add
  their uses together on one spell instead of creating copies (any at-will grant
  makes it at will). Removing an item or dropping below its gate takes back only
  its share; the spell is removed with its last grant. A spell granted by more than
  one item is not child-linked, so deleting one of them can't cascade it away.
- **Times/day edits now reach existing spells**: changing an entry's Times/day
  updates the spell already on the actor instead of only affecting new grants.
- **Auto-sort by level** for level-gated lists: Class Features, Spell Supplements
  with level gating enabled, and the archetype exclusion checklist are ordered by
  gate level (ties by name). Sorting is display-only — the stored link order is
  untouched — and applies whenever the panel renders, so editing a level saves
  immediately but doesn't move the row out from under the cursor mid-edit.

### Fixed
- Torn-down grants stayed in the parent's grant ledger, because flag updates merge
  rather than replace. Every later reconcile found them again and ran to the
  10-pass cap, logging "reconcile hit the pass cap".
- An item that can't be tied to a class (a race, a template) whose Destination
  dropdown was never touched granted nothing: the tab showed Spell-like Abilities
  but the engine read the missing setting as Class Spellcasting.
- Removing every entry from an item's configuration left its existing grants on
  the actor; they are now torn down.
