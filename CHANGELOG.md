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
