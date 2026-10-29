# Changelog

## Unreleased

### Added
- **Pick-named tags** in Selections: a selection's tag can name an earlier pick in braces, such as
  `{Sorcerer Bloodline} Feat`, which reads as `Aberrant Bloodline Feat` for a character with that
  bloodline, so one shared feature offers only the chosen bloodline's feats.
- **Rename on links**: a row on Class Features, Spell Supplements, or the system's
  Supplements tab can give the item it adds a new name. The item keeps its original tag,
  and records its original name in `flags.pf1-enhanced-links.renamedFrom`.
- **Picking spells** in Selections: a selection's **Grant spells as** setting adds a
  picked spell as a spell-like ability (with Times/day, stacking with other copies) or
  as a class spell (in the class's spellbook, with Domain/School and Bonus spells
  known). A selection can also offer every spell on chosen class spell lists within
  a spell level range.
- **Archetypes are children of their class**: deleting a class removes its archetypes, and
  what they granted, through the system's delete cascade.
- **Bonus spells known** checkbox on Spell Supplements: granted spells don't count against the
  spells known of a class that has a set number, such as a sorcerer's bloodline spells.
- **Spell rules** in the Spellcasting section of class features and feats, shown while PF1
  Enhanced Spellbooks is active: a button that opens that module's rule editor for the item.
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
  gate level (ties by name). Sorting is display-only, so the stored link order is
  untouched. Editing a level saves immediately, and the row moves to its new place
  when you leave the field.
- **Create scripts on links**: each row of Class Features, Spell Supplements and the
  system's Supplements tab can carry scripts (+ adds one) that run on the item when
  that link creates it. Useful for granting a
  variant, such as a cold *fireball*, without a separate compendium entry.
  Spell-like spells from a scripted row never stack with other copies.
- **Domain/School spells** checkbox on Spell Supplements (Class Spellcasting mode):
  spells the item grants are marked as Domain/School spells. Toggling it updates
  spells already granted.
- **No duplicate linked items** (world setting, on by default): PF1's Supplements
  and the Class Features tab no longer create a second copy of something the actor
  already has (same source, or same type and tag). The new parent shares the existing
  item and runs its create scripts on it. A shared item stays until the last parent
  that granted it is removed. Physical items and spells are still copied as before.
- **Spellcasting on features**: a new Spellcasting section on the Details tab of
  feats, class features, and races.
  - **Grant a spellbook**: the item gives the actor a spellbook while it is on the
    actor, with the same settings a class has, plus its own book name, a choice of
    class level or Hit Dice, and a spell list that can differ from the class whose
    levels it counts (a rogue archetype casting from the wizard list).
  - **Modify the class's spellbook**: a class feature changes its own class's
    spellbook while it is on the actor: casting ability, type, progression,
    cantrips, domain slots, spell list, and offsets to caster level and spells per
    day (diminished spellcasting). Everything is put back when the feature leaves.
  - **Advance other spellcasting**: each row adds the feature's class levels to
    another spellbook, as a prestige class does. Pick the kind of spellbook and
    which class levels count (every level, every level except, or only at). On an
    actor a single matching spellbook is advanced automatically. With several, the
    feature gains a Choose Spellcasting action to pick one. The levels are removed
    again with the feature. Psionic manifesters can be advanced when PF1 Psionics
    supports it.
- **Selections** (in progress): a new Selections section on a feat's Details tab,
  for features that give a pick from a list, such as a rage power or a rogue
  talent. A Role choice sets whether the item grants picks, can be picked, or
  both. A granting item names the tags it draws from and can list extra items or
  folders. An item that can be picked can carry a minimum level, required items,
  an exclusive group, and a summary.
  - On an actor's sheet, a feature with a pick to make is colored and gains a
    Choose tag, and a Choose Selection action. Either opens a list that can be
    filtered by name, sorted (available first by level, or alphabetical), and
    trimmed to what can be picked. The picked item is added as a child of the
    feature, and a pick can be undone from either item's Selections section.
  - When two listed items share a name, the one in the world, then a world
    compendium, then a module's compendium is offered ahead of the system's.
  - A **Selection Sources** settings menu limits which tags the system
    compendiums are searched for, and which compendiums are searched at all.
  - An item that fails a rule is listed dimmed with the reason. A GM can still
    pick it. The minimum level is judged against the level the granting feature
    was gained at.
  - A feature's description gains a Chosen line linking each pick to the item it
    was taken from.
  - A feature with every pick made moves to a new **Hidden Features** category
    at the bottom of the Features tab, or to one another module names. A new
    setting leaves that category off players' sheets. A feature marked Keep in
    place stays put. A general feat steps
    aside only when a general feat was picked in its place, so the feat count
    stays right.
- **Prepare for Uninstall** settings menu: undo every pick, or move the features
  the module hid to Misc, before turning the module off. Either pauses the
  module, and Undo preparation resumes it.
- With no GM connected, the engine now runs on the client of the player who made
  the change, so linked items and picks arrive without waiting for a GM.

### Changed
- A feature that grants a spellbook warns when its class still has spellcasting of its own.
- **Grant a spellbook** can make a **psionic manifester** (Spellcasting Type *Psionic
  manifesting*, with pf1-psionics active).
- A class with no spellcasting of its own no longer shows the Spell Casting section (or
  pf1-psionics' Manifesting section) on its sheet; a class that has it shows a line pointing to
  class features.
- With PF1 Enhanced Spellbooks active, a granted book's **Spellbook** setting is set in the
  Grant block.
- **lib-wrapper is now required** (it was recommended).
- Changing an on-actor feature's associated class now re-runs its links.
- **Spellcasting** and **Selections** moved from the Details tab to the Advanced tab, sorted among the other modules' sections, and are hidden until used. A **Show N more sections** line at the foot of the tab reveals them (shared sheet kit 1.7.0).

### Fixed
- Replacing a feature that grants a spellbook with another for the same class, in one step
  (an archetype swap), gave the new feature a second book and split the spells. It now takes
  over the same book, and changes other features make to that book are applied again.
- Changing a granted book's Level Offset wiped other offsets in the caster level formula. It
  is now one term beside the others.
- A player leveling up their own character often got none of the level's linked items, most
  visibly an archetype's replacement feature at a level where it replaces the base one. The
  system announces a level change only on the leveling player's client, so the GM's client
  never heard of it. The player's client now passes it to the GM.
- A supplement sharing its parent's name (the Scribe Scroll class feature supplying the Scribe
  Scroll feat) was taken for a duplicate of the parent and never created. Matching by tag now
  also requires the same subtype, and an item never counts as a copy of its own supplement.
- Deleting a class could leave its archetype's items behind or re-create them unlinked: the
  system's cascades and the engine's own reactions raced, and one failed delete kept a whole
  batch. The engine now stands down until the class, its archetypes, and everything they
  granted are gone, deletes what the system's cascade doesn't reach, then settles once.
- Base features restored when an archetype was removed weren't recorded as the class's
  associations, so a later level-down or class deletion left them on the actor.
- The Browse button on the module's own filled-features section threw `Could not find
  "features" browser`. The section had no `browse` entry; it now opens the Feats browser
  filtered to that type.
- A grant pass that created several items paired them with their rows by position,
  so when the created items came back in another order a row's create scripts ran on
  a different row's item (Align Weapon's script renaming Forbid Action), and the
  ledger and child link recorded the wrong item. Items are now paired by the source
  uuid stamped on each one.
- Torn-down grants stayed in the parent's grant ledger, because flag updates merge
  rather than replace. Every later reconcile found them again and ran to the
  10-pass cap, logging "reconcile hit the pass cap".
- An item that can't be tied to a class (a race, a template) whose Destination
  dropdown was never touched granted nothing: the tab showed Spell-like Abilities
  but the engine read the missing setting as Class Spellcasting.
- Removing every entry from an item's configuration left its existing grants on
  the actor; they are now torn down.
