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
exclusion checklist. A level you type saves right away, and the row moves to its new
place when you leave the field. The stored link order itself is never rewritten.

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

On an actor, a feature with "Replaces class features" on becomes a child of its
class, so deleting the class removes the archetype too, along with everything the
archetype granted.

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

A **Bonus spells known** checkbox (Class Spellcasting only, off by default) is for a
class that knows a set number of spells, such as a sorcerer or oracle. Spells this item
grants then don't count against that number: each one adds one to the spells known of
its own spell level, shown in the spellbook's settings as `1[Bonus spells known]` in
that level's offset. It is added when the spell arrives and removed with it. Leave the
book's **Domain/School Slots** at 0 for these. It has no effect on a class that
prepares spells, or on spells also marked Domain/School.

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
  and subtype with the same identifier (tag). A class feature never counts as a copy
  of the feat it supplies, even when both have the same name.
- **Always copied:** physical items (two kits that each grant rope give two ropes)
  and spells.
- **Removing one parent**, or one Class Features level gate dropping, leaves a shared
  item in place for the others. It goes when the last item that granted it is
  removed. An item that was already on the actor before a link shared it (added by
  hand, or from a class) is never removed this way.

Turn the setting off to get PF1's normal copies back.

## Spellcasting on features

The **Spellcasting** section on an item's **Details** tab does three things: it can
give the actor a spellbook of its own, change the spellbook of the item's class, and
advance another class's spellcasting the way a prestige class does. It appears on
feats and class features, and on races.

### Granting a spellbook

Set **Own spellbook** to **Grant a spellbook**. The actor then has that spellbook
for as long as the item is on it. When the item leaves, the book is switched off
and its spells stay in it, the same as when a class is removed.

- **Book name** is what the book is called on the actor's Spells tab. Blank uses the
  item's name.
- **Level from** is what the book counts for caster level and spells per day: the
  item's **Associated class**, or **Hit Dice**. A race always uses Hit Dice.
- **Spell list** is a class tag, such as `wizard`. It decides the level a spell gets
  when you add it to the book, and the class the spell browser pre-selects. Blank
  uses the book's own class.
- **Type**, **Progression**, **Spellcasting Ability**, **Spellcasting Type**,
  **Domain/School Slots**, **Level Offset**, and **Has Cantrips/Orisons** are the
  same settings a class has.
- **Spellcasting Type** *Psionic manifesting* (with pf1-psionics active) makes a
  psionic manifester instead of a spellbook. It has no Spell list, Type, or
  Domain/School Slots.
- With PF1 Enhanced Spellbooks active, the book's **Spellbook** setting is here too.

For example, a rogue archetype that casts from the wizard list: Level from
*Associated class*, Spell list `wizard`, Type *Prepared*, Progression *Medium*,
Ability *Intelligence*, Spellcasting Type *Arcane*. The book counts rogue levels,
adds spells at their wizard level, and is separate from a Wizard book the character
might gain later.

Notes:

- A setting you change on the actor's book stays until you change that same setting
  on the item.
- **Level Offset** is added to the book's caster level formula beside anything
  already there, so other offsets stay when you change it.
- When an archetype replaces the class feature that grants a class's book with one
  of its own, the new feature takes over the same book and the spells in it.
- If the class itself still has spellcasting set up, you get a warning: the class
  makes a book of its own too.
- A class sheet hides its Spell Casting section (and pf1-psionics' Manifesting
  section) when that class has none of its own: set it on a class feature instead.
- PF1 has three spellbooks besides spell-like abilities. If none is free you get a
  warning and no book is granted.
- With Level from *Associated class*, that class has to be on the actor.
- **Spell Supplements** in Class Spellcasting mode route into a granted book of the
  same class, and use its Spell list for spell levels.

### Modifying the class's spellbook

Set **Own spellbook** to **Modify the class's spellbook** on a class feature. While
the feature is on the actor, it changes the spellbook of its associated class. This
is for archetypes and bloodlines that alter how their own class casts.

Every setting starts at **No change**. Only the ones you set are touched:

- **Spellcasting Ability**, **Type**, **Progression**, **Spellcasting Type**,
  **Has Cantrips/Orisons**, and **Domain/School Slots** replace the book's value.
- **Spell list** makes the book read another class's spell list, as described
  above.
- The **Offsets** are added to the book's own formulas, beside anything already
  there: **Level Offset** to caster level, **Cast Per Day** and **Prepared / Known**
  to every spell level.

| Example | Settings |
|---|---|
| A sorcerer bloodline that casts with Intelligence | Spellcasting Ability *Intelligence* |
| Diminished spellcasting, spontaneous caster | Cast Per Day `-1` |
| Diminished spellcasting, prepared caster | Prepared / Known `-1` |
| An arcanist archetype using the witch list | Spell list `witch` |
| Cantrips as their own class feature, beside a granted book with them off | Has Cantrips/Orisons *Yes* |

Removing the feature puts every setting back the way it was and takes its offsets
out again.

Notes:

- A setting you then change by hand on the actor's book is left alone, both while
  the feature is there and when it is removed.
- If two features change the same setting, the later one wins and you get a warning.
  Removing the later one brings the earlier one's value back.
- The class has to be on the actor and have a spellbook in use.

### Spell rules

With **PF1 Enhanced Spellbooks** active, the Spellcasting section of a class feature or feat has
a **Spell rules** block. It lists the item's rules by name, and **Edit rules** opens that
module's rule editor for the item. A slot
rule names a group of domain or school slots and says which spells fill it, or makes matching
spells cost extra slots. A substitution rule says which spells can be cast by giving up a
different prepared spell. Both apply to the item's associated class while the item is on the
actor. On a metamagic feat, the same editor holds what the metamagic does to a spell. See that
module's README for what each holds.

A slot rule does not change how many special slots the book has. Set **Domain/School Slots** above
to the number the rules add up to.

### Advancing other spellcasting

A class feature can add its class's levels to another class's spellcasting. Each row
under **Advance other spellcasting** is one advancement:

- **Advances** is the kind of spellbook: Arcane, Divine, Psychic, Alchemy, Any
  spellcasting, or Psionic manifesting (shown when PF1 Psionics is active).
- **At** is when the class advances it: Every level, Every level except, or Only at
  levels.
- **Levels** lists the class levels for the last two, for example `1, 5, 9`.

| Class | Rows |
|---|---|
| Mystic Theurge | Arcane, Every level. Divine, Every level. |
| Eldritch Knight | Arcane, Every level except `1`. |
| Dragon Disciple | Arcane, Every level except `1, 5, 9`. |

**On an actor.** The feature uses its associated class, so that class has to be on
the actor.

- If exactly one spellbook matches a row, it is advanced right away.
- Otherwise the feature gains a **Choose Spellcasting** action. Use it to pick a
  spellbook for each row. The action goes away once every row has one.
- The feature's Spellcasting section shows each row's **Target**. The
  <i class="fa-solid fa-rotate-left"></i> icon next to it resets that choice.

**What it changes.** The levels are added to the chosen book's **Class Level
Modification** field, in the book's settings on the actor's Spells tab. That raises
spells per day, spells known, and caster level. Removing the feature or its class
takes the levels back out. Anything you typed into that field yourself is kept.

Notes:

- The book needs **Auto Calculate Spell Slots** on, or the field is ignored. You get
  a warning when it is off.
- The spell-like abilities book is never offered, and a feature never advances its
  own class's book.
- Two rows of one feature can't pick the same book.
- If the field already counts the class in a formula you wrote by hand, it is left
  alone and you get a warning.
- Psionic rows need a PF1 Psionics version whose manifesters have a Class Level
  Modification field. On a version without it you get a warning and nothing changes.
- With **PF1 New Script Hooks** active, the Choose Spellcasting action opens its
  prompt directly. Without it, PF1's use dialog appears first.

## Selections

The **Selections** section on a feat's **Details** tab is for features that give a
pick from a list: a rage power, a rogue talent, a mercy. The module ships no lists
of its own. A list is every item that carries a tag, read from the compendiums and
world items you have installed.

**Role** at the top of the section sets what the item does:

| Role | Meaning |
|---|---|
| None | The item takes no part. |
| Grants picks | The item gives its owner one or more picks. |
| Can be picked | The item has rules for when it can be picked. |
| Both | An item that is picked and also gives a pick of its own. |

### An item that grants picks

Each selection on the item has:

- **Tags**: the item tags it draws from, such as `Rage Power`. The Pathfinder 1e
  class abilities compendium is already tagged, and the entry suggests the tags in
  use. One selection can take several tags, so a 10th-level rogue feature can accept
  both `Rogue Talent` and `Rogue Talent, Advanced`.
- **Picks**: how many picks it gives.
- **Heading**: the title shown when picking. Blank uses the item's name.
- **Class**: the class tag whose level counts, for an item with no associated class
  such as a general feat. Blank uses the associated class. With neither, a picked
  item is still tied to a class on its own: it takes whichever of the classes it
  lists the character has. If the character has several of them, you are asked
  which one when you confirm the pick.
- **Listed items**: drop items or folders to add them to the list directly. Use
  this for items that carry no tag. A folder brings in everything inside it.

**Keep in place when filled** is for an item that should stay where it is on the
sheet after its picks are made.

One item gives its picks at one level. A class that grants a rage power at 2nd, 4th,
and 6th level needs three granting features, one at each level.

### Picking spells

For a feature that has you pick a spell, such as the Minor Magic rogue talent,
set the selection's **Grant spells as**:

| Grant spells as | A picked spell |
|---|---|
| As is | is added as it is in the compendium. This is the default. |
| Spell-like ability | goes to the spell-like abilities book with the selection's **Times/day** (0 = at will) and no components, as a Spell Supplements spell-like ability does. |
| Class spell | goes to the spellbook of the selection's class, at its level on that class's list. **Domain/School spells** and **Bonus spells known** work as they do on Spell Supplements. |

Only spells are affected. Anything else picked from the same selection is added
as it is.

In either spell mode the selection can also list spells by **spell list**: add
class tags such as `wizard`, and set the **Spell levels** range. Every spell on
one of those lists within the range is offered, and the picker shows each one's
spell level. Minor Magic is the list `wizard` (or `sorcerer`) at levels 0 to 0,
granted as a spell-like ability at 3 Times/day. Of the Selection Sources
settings, only **Compendiums** limits spell-list searches.

- A spell-like ability picked this way stacks with the same spell-like ability
  from anywhere else, such as a racial one: one spell, with the uses added up.
- Changing Times/day later updates the spell already on the actor.
- A class spell is added once the class has a spellbook. With no class on the
  selection or the feature, it goes to a spellcasting class whose list has the
  spell. If the character has several, you are asked which one.
- A spell already picked for any selection on the character is shown as *known*.
- Changing **Grant spells as** after a pick is made replaces the spell on the
  actor with one made the new way.
- A picked spell-like ability's caster level comes from Hit Dice, as all
  spell-like abilities' do. A feature that sets it from a class level needs that
  set on the spell by hand.

### An item that can be picked

An item is in a list as soon as it carries the tag. Set its role only to add rules:

- **Minimum level**: the level the granting feature must have been gained at.
- **Requires**: drop the items that must already be on the actor.
- **Exclusive group** and **Branch**: items in one group must share a branch. Give
  every beast totem power the group `totem` and the branch `beast`, and a character
  with one can't then pick a power from another totem branch.
- **Summary**: one line shown beside the item when picking.
- **Can be picked more than once**. Each pick uses a slot, but the actor still has
  one item. The number of times it was picked is stored on that item as
  `flags.pf1-enhanced-links.picks`.

An item that fails a rule is still listed when picking, dimmed, with the reason
after its name: *known*, *requires level 6*, *requires Beast Totem, Lesser*, or
*conflicts with Dragon Totem*. A player can't select it. A GM can, for the cases
the rules don't cover.

The minimum level is compared with the level the granting feature was gained at,
not the character's current level. A pick left open from 3rd level is still a
3rd-level pick when it is made at 9th.

An item counts as already on the actor whether it was picked, granted another
way, or added by hand.

### Picking

On an actor's sheet, a feature with a pick to make has its name colored and a
**Choose** tag after it. Click the tag to open a list of everything the selection
draws from, with a name filter. The feature also gains a **Choose Selection**
action that opens the same list.
Click an entry to select it and press **Confirm**. The book icon on an entry opens
that item's sheet, and an entry with a minimum level shows it beside that icon.

The list starts with the entries you can pick, lowest level first and then by
name, with the ones you can't pick dimmed at the bottom. **Alphabetical** sorts by
name alone, and pressing it again reverses the order. **Default** puts the list
back. **Hide unavailable** removes the dimmed entries.

A feature that gives several picks asks for them one at a time. The same list opens from the **Choose** link in the feature's Selections section.

The picked item is added to the actor as a child of the feature, and is removed
with it. It is listed in the feature's place on the sheet, so it stays there when
the feature steps aside. To change a pick, use the undo arrow beside it in the feature's Selections
section, or the one in the picked item's own Selections section. Deleting a picked
item by hand only brings it back.

Picking works with no GM connected: the item is then added by the player's own
client.

### Once a feature's picks are made

The feature's description gains a closing **Chosen:** line that links each pick to
the compendium or world item it was taken from. The line is rewritten when the
picks change. If you edit it by hand, your
version is left in place and a new line is added after it.

A feature with every pick made is usually just clutter, so it steps aside: it
moves to a **Hidden Features** category at the bottom of the sheet's Features
tab, and moves back if a pick is undone. The feature itself always stays on the
actor. A feature with **Keep in place when filled** checked never moves.

The **Hide Hidden Features from players** setting leaves that category off
players' sheets. A GM always sees it. It is off by default and needs a reload.
This keeps the category out of sight, not secret: a player's own character data
is still sent to that player.

A feature left in the Hidden Features category is listed nowhere on the sheet
once the module is off. See [Before turning the module off](#before-turning-the-module-off).

### Feats that grant a pick

A general feat can grant picks too, and needs no associated class. What happens
once its pick is made depends on what was picked, so that the character's feat
count stays right:

| The pick is | The granting feat | Example |
|---|---|---|
| a general feat | steps aside, and the picked feat is the one that counts | Signature Skill, with one feat per skill to pick from |
| anything else | stays, and still counts as a feat | Extra Rogue Talent, which picks a class feature |

Use the first shape for a feat whose choice needs its own item for each option.

### Using another module's category

A module with a category of its own can have filled features moved there. It
calls `pf1EnhancedLinks.setFilledCategory("<feat subtype>")` in its `init` hook,
and this module then leaves its own category and its hide setting out.

### Your own version of a listed item

When two items in one list have the same name, only one is offered: a world item
first, then a world compendium, then a module's compendium, then the system's. A
copy you have changed therefore replaces the original with no further setup.

### Selection Sources

**Configure Settings → PF1 Enhanced Links → Selection Sources** limits where tags
are looked up.

- **System compendiums**: search them for all tags, for none, for all except the
  tags you list, or only for the tags you list. Enter one tag per line.
- **Compendiums**: search all of them, all except the ones you check, or only the
  ones you check.

Use this when the system's list is not the one you want. Keep your own rage powers
in your own compendium, add `Rage Power` to the tags the system compendiums are
not searched for, and only yours are offered.

These settings limit tag searches only. An item or folder dropped on a selection
is always listed.

## Before turning the module off

**Configure Settings → PF1 Enhanced Links → Prepare for Uninstall** cleans up what
the Selections feature leaves on actors. It is for GMs only, and every action asks
you to confirm first.

| Action | What it does |
|---|---|
| **Undo every pick** | Deletes each picked item and puts its feature back where it was. This cannot be undone, and you are asked twice. |
| **Move hidden features to Misc** | Keeps every pick. Features the module moved to Hidden Features go to **Misc**, which the sheet shows with or without the module. |
| **Undo preparation** | Moves those features back from Misc and starts the module again. Picks that were undone stay undone. |

Either preparation also **pauses the module**: it stops granting and moving things,
so nothing is put back while you go and turn it off. The Choose tags and actions
are removed. If you change your mind, **Undo preparation** starts it again. A GM
is reminded at login while the module is paused.

It covers actors in the world and unlinked tokens. Actors in compendiums are not
touched.

## Where each tab shows up

| Tab | Requires an associated class? | Appears on |
|---|---|---|
| Class Features | yes | class-associated items (feats, etc.) |
| Spell Supplements — Class Spellcasting | yes | class-associated items |
| Spell Supplements — Spell-like Abilities | no | any item that supports links |
| Spellcasting (Details tab) – grant by class level, modify, advance | yes | class-associated items |
| Spellcasting (Details tab) – grant by Hit Dice | no | feats and races |
| Selections (Details tab) | no | feats |

## Compatibility

- Foundry VTT **v13**
- Pathfinder 1e system **v11.x**
- **lib-wrapper** (required)
- **PF1 New Script Hooks** (recommended): lets the Choose Spellcasting and Choose
  Selection actions open their prompts without PF1's use dialog appearing first.

## License

See [`LICENSE`](LICENSE).
