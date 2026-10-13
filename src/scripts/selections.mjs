/* PF1 Enhanced Links: selections. Storage and catalog resolution.
 * DESIGN.md § Feature 7. */

import { MODULE_ID, getAssociatedClass } from "./enhanced-links.mjs";
import { dedupable, sourceKeys, uniform } from "./dedupe.mjs";

// Flag keys under flags[MODULE_ID].
export const ROLE_FLAG = "selectionRole"; // which of the two blocks is live
export const ROWS_FLAG = "selections"; // granting feature: its rows
export const KEEP_FLAG = "selectionKeep"; // granting feature: stay in place when filled
export const OPTION_FLAG = "option"; // option: its pick rules
export const PICKS_FLAG = "selectionPicks"; // on-actor granting feature: { [rowId]: [uuid] }
// Beside it, pick for pick: the class tag chosen for each, "" where none was. { [rowId]: [tag] }
export const PICK_CLASS_FLAG = "selectionPickClass";
const GRANTED = "granted"; // the engine's ledger on a parent
const GRANT_PARENT = "grantParent"; // the engine's stamp on a granted item
const COUNT_FLAG = "picks"; // on a picked item: how many slots hold it
const NOTE_FLAG = "selectionNote"; // on a granting feature: the description line last written
export const HOME_FLAG = "selectionHome"; // on a moved granting feature: { from, to } subtypes

// Action added to a feature while it has a pick to make. Actions carry no flags,
// so a reserved id marks it.
export const SELECT_ACTION_ID = "pf1elSelect";
const SELECT_ACTION_IMG = "icons/svg/item-bag.svg";

export const ROLES = ["grant", "option", "both"];

// Held in the pack indexes, so a catalog is listed without loading documents.
const INDEX_FIELDS = [
  "system.tags",
  "system.subType",
  `flags.${MODULE_ID}.${ROLE_FLAG}`,
  `flags.${MODULE_ID}.${OPTION_FLAG}`,
];

// Same-name options collapse to the lowest rank. DESIGN.md § Catalogs.
const RANK = { worldItem: 0, world: 1, module: 2, system: 3 };

// The feat subtype filled features move to unless another module names one. The key
// is the one astora-mod uses, so a world's items are at home under either.
const OWN_CATEGORY = "hidden";
// World setting: leave that category off players' sheets. Only while it is this module's.
const HIDE_SETTING = "hideFilledFromPlayers";
// The sheet section this module registered, to tell it from another module's under the same key.
let ownSection = null;

// World setting: the engine is paused, by the Prepare for Uninstall menu.
const DORMANT_SETTING = "dormant";

// World setting: where a row's tags are looked up. Edited through its own menu.
export const SOURCES_SETTING = "selectionSources";
export const CORE_MODES = ["all", "none", "exclude", "include"];
export const PACK_MODES = ["all", "exclude", "include"];

Hooks.once("init", () => {
  const fields = (CONFIG.Item.compendiumIndexFields ??= []);
  for (const field of INDEX_FIELDS) if (!fields.includes(field)) fields.push(field);

  game.settings.register(MODULE_ID, SOURCES_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: { core: { mode: "all", tags: [] }, packs: { mode: "all", ids: [] } },
  });

  game.settings.register(MODULE_ID, DORMANT_SETTING, { scope: "world", config: false, type: Boolean, default: false });

  // A category of our own for filled features, unless one is already under the key.
  // Added now so the system's own setup loop stamps and labels it; the labels are
  // keys because nothing can be localized this early.
  const sections = pf1.config.sheetSections.features;
  if (!sections[OWN_CATEGORY]) {
    pf1.config.featTypes[OWN_CATEGORY] = "PF1EL.Sel.Category";
    pf1.config.featTypesPlurals[OWN_CATEGORY] = "PF1EL.Sel.Category";
    ownSection = sections[OWN_CATEGORY] = {
      label: "PF1EL.Sel.Category",
      filters: [{ type: "feat", subTypes: [OWN_CATEGORY] }],
      interface: { create: true, actions: true, types: true },
      browse: { category: "feats", featType: [OWN_CATEGORY] },
      create: { type: "feat", system: { subType: OWN_CATEGORY } },
      // After Misc (15_000), at the bottom of the Features tab.
      sort: 20_000,
    };
  }
});

Hooks.once("setup", () => {
  const sections = pf1.config.sheetSections.features;
  // Another module may have put its own section under the key after ours.
  const ours = !!ownSection && sections[OWN_CATEGORY] === ownSection;

  // Another module named a category: that one is used, and ours is not needed.
  if (filledCategory) {
    if (ours && filledCategory !== OWN_CATEGORY) {
      delete sections[OWN_CATEGORY];
      delete pf1.config.featTypes[OWN_CATEGORY];
      delete pf1.config.featTypesPlurals[OWN_CATEGORY];
    }
    return;
  }
  if (!ours) return;

  // The category is this module's, so hiding it from players is this module's setting.
  game.settings.register(MODULE_ID, HIDE_SETTING, {
    name: "PF1EL.Setting.HideFilled.Name",
    hint: "PF1EL.Setting.HideFilled.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
  });
  // A client is one user. With no section, that user's sheet lists none of its items.
  if (!game.user.isGM && game.settings.get(MODULE_ID, HIDE_SETTING)) delete sections[OWN_CATEGORY];
});

/**
 * Whether the module is paused for uninstall: the engine then grants and moves
 * nothing, so what the Prepare for Uninstall menu took out stays out.
 */
export const isDormant = () => game.settings.get(MODULE_ID, DORMANT_SETTING) === true;
export const setDormant = (on) => game.settings.set(MODULE_ID, DORMANT_SETTING, on === true);

// ─── Storage ────────────────────────────────────────────────────────────────────

/** Selections live on feats: class features, general feats, and the like. */
export const hostsSelections = (item) => item.type === "feat";

// An Item and a compendium index entry both carry `flags` and `system` this way.
const flagsOf = (source) => source?.flags?.[MODULE_ID] ?? {};
const text = (value) => (typeof value === "string" ? value.trim() : "");
const textList = (value) => (Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : []);

export const tagsOf = (source) => textList(source?.system?.tags);

/** A document or index entry by uuid, without loading anything. Null when it is gone. */
export function resolveSync(uuid) {
  try {
    return fromUuidSync(uuid, { strict: false });
  } catch (err) {
    return null;
  }
}

export function getRole(source) {
  const role = flagsOf(source)[ROLE_FLAG];
  return ROLES.includes(role) ? role : "";
}

export const grantsPicks = (source) => ["grant", "both"].includes(getRole(source));
export const hasOptionRules = (source) => ["option", "both"].includes(getRole(source));

/** The granting rows on an item, normalized. Always a fresh array. */
export function getSelections(item) {
  const raw = flagsOf(item)[ROWS_FLAG];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => typeof row?.id === "string")
    .map((row) => ({
      id: row.id,
      label: text(row.label),
      tags: textList(row.tags),
      list: textList(row.list),
      levelClass: text(row.levelClass),
      count: Math.max(1, Math.floor(Number(row.count) || 1)),
    }));
}

export const keepsPlace = (item) => flagsOf(item)[KEEP_FLAG] === true;

/** An option's pick rules, normalized. All blank while its role doesn't cover them. */
export function getOption(source) {
  const raw = hasOptionRules(source) ? flagsOf(source)[OPTION_FLAG] ?? {} : {};
  const minLevel = Math.floor(Number(raw.minLevel));
  return {
    minLevel: minLevel > 0 ? minLevel : null,
    requires: textList(raw.requires),
    group: text(raw.group),
    branch: text(raw.branch),
    repeatable: raw.repeatable === true,
    summary: text(raw.summary),
  };
}

/** How many of an option's rules are set, for the section badge. */
export function ruleCount(option) {
  return [option.minLevel !== null, option.requires.length > 0, !!option.group, option.repeatable].filter(Boolean).length;
}

// ─── Picks ──────────────────────────────────────────────────────────────────────

/**
 * Each granting row with the picks made for it and the number still open. Empty
 * while the item's role doesn't grant. Picks past a lowered count are ignored.
 */
export function slotsOf(item) {
  if (!grantsPicks(item)) return [];
  const stored = flagsOf(item)[PICKS_FLAG] ?? {};
  return getSelections(item).map((row) => {
    const made = Array.isArray(stored[row.id]) ? stored[row.id].map(text).filter(Boolean) : [];
    const picks = made.slice(0, row.count);
    const chosen = flagsOf(item)[PICK_CLASS_FLAG]?.[row.id];
    const classes = picks.map((_, i) => (Array.isArray(chosen) ? text(chosen[i]) : ""));
    return { row, picks, classes, open: row.count - picks.length };
  });
}

/** Whether a row leaves its picks' class open: neither it nor its feature names one. */
export const classIsOpen = (item, row) => !(row?.levelClass || getAssociatedClass(item));

export const openSlots = (item) => slotsOf(item).reduce((n, slot) => n + slot.open, 0);

/** What a granting feature wants on the actor: one entry per distinct pick, with its class tag. */
export function pickedGrants(item) {
  const out = new Map();
  for (const { row, picks, classes } of slotsOf(item)) {
    const tag = row.levelClass || getAssociatedClass(item) || "";
    // With no class from the row or the feature, the one chosen with the pick.
    picks.forEach((uuid, i) => {
      if (!out.has(uuid)) out.set(uuid, { uuid, tag: tag || classes[i] });
    });
  }
  return [...out.values()];
}

/**
 * The actor's classes a picked item could belong to when neither its row nor its
 * granting feature names one: the classes the item itself lists (Extra Rogue Talent
 * is a general feat, but the talent it picks says Rogue). The item lists class
 * names, so they are matched to the actor's class items by name, ignoring case.
 * Highest level first, then the item's own order.
 */
export function eligibleClasses(actor, data) {
  const names = (data?.system?.associations?.classes ?? []).map((name) => text(name).toLowerCase()).filter(Boolean);
  if (!names.length) return [];
  const place = (cls) => names.indexOf(text(cls.name).toLowerCase());
  const held = (actor.itemTypes?.class ?? []).filter((cls) => place(cls) >= 0);
  return held.sort((a, b) => (b.system?.level ?? 0) - (a.system?.level ?? 0) || place(a) - place(b));
}

/** The first of those, as a class tag. For a pick recorded with no class chosen. Null if none. */
export const classTagFor = (actor, data) => eligibleClasses(actor, data)[0]?.system?.tag || null;

/** The item on the actor that a pick became, once the engine has granted it. */
export function grantedItem(feature, uuid) {
  const ledger = flagsOf(feature)[GRANTED] ?? {};
  const hit = Object.entries(ledger).find(([, rec]) => rec?.kind === "selection" && [rec.source, ...(rec.also ?? [])].includes(uuid));
  return hit ? feature.actor?.items.get(hit[0]) ?? null : null;
}

/** The feature an on-actor item was picked for, and which of its picks it is. */
export function pickedFor(item) {
  const actor = item.actor;
  if (!actor) return null;
  for (const feature of actor.items) {
    const rec = flagsOf(feature)[GRANTED]?.[item.id];
    if (rec?.kind !== "selection") continue;
    for (const { row, picks } of slotsOf(feature)) {
      const index = picks.findIndex((uuid) => [rec.source, ...(rec.also ?? [])].includes(uuid));
      if (index >= 0) return { feature, rowId: row.id, index };
    }
  }
  return null;
}

/** Record a pick. The engine grants it from the item update this causes. */
export function addPick(feature, rowId, uuid, classTag = "") {
  const slot = slotsOf(feature).find((s) => s.row.id === rowId);
  if (!slot || slot.open < 1) return null;
  return feature.update({
    [`flags.${MODULE_ID}.${PICKS_FLAG}.${rowId}`]: [...slot.picks, uuid],
    [`flags.${MODULE_ID}.${PICK_CLASS_FLAG}.${rowId}`]: [...slot.classes, text(classTag)],
  });
}

/** Clear one pick. Its item is removed and the slot is open again. */
export function resetPick(feature, rowId, index) {
  const slot = slotsOf(feature).find((s) => s.row.id === rowId);
  if (!slot || !(index in slot.picks)) return null;
  const without = (list) => list.filter((_, i) => i !== index);
  return feature.update({
    [`flags.${MODULE_ID}.${PICKS_FLAG}.${rowId}`]: without(slot.picks),
    [`flags.${MODULE_ID}.${PICK_CLASS_FLAG}.${rowId}`]: without(slot.classes),
  });
}

// ─── Judging a pick ─────────────────────────────────────────────────────────────

/** The identifier the system gives an item of this type and name, or null for a type without one. */
function identifierOf(type, name) {
  if (!CONFIG.Item.documentClasses[type]?.system?.hasIdentifier) return null;
  return pf1.utils.createTag(name ?? "") || null;
}

/**
 * The level a pick is judged at: the level the feature was gained at, else the
 * current level of its class, else Hit Dice. DESIGN.md § Slot level.
 */
export function slotLevel(feature, row, depth = 0) {
  const actor = feature.actor;
  for (const cls of actor.itemTypes?.class ?? []) {
    const level = Number(cls.getFlag("pf1", "links.classAssociations")?.[feature.id]);
    if (level > 0) return level;
  }
  // Picked itself: judged as the slot that picked it.
  const from = depth < 5 ? pickedFor(feature) : null;
  if (from) {
    const fromRow = getSelections(from.feature).find((r) => r.id === from.rowId);
    return slotLevel(from.feature, fromRow, depth + 1);
  }
  // Made by a Class Features row: the level on that row.
  const parent = actor.items.get(flagsOf(feature)[GRANT_PARENT]);
  const threshold = Number(flagsOf(parent)[GRANTED]?.[feature.id]?.threshold);
  if (threshold > 0) return threshold;

  const tag = row?.levelClass || getAssociatedClass(feature);
  if (tag) return actor.classes?.[tag]?.level ?? 0;
  return actor.system?.attributes?.hd?.total ?? 0;
}

/**
 * What the actor has, for judging a pick: its items, and picks recorded but not
 * granted yet, so a second pick is judged with the first already counted.
 */
function holdings(actor) {
  const held = [];
  for (const item of actor.items) {
    if (!dedupable(item.type)) continue;
    held.push({
      name: item.name,
      type: item.type,
      keys: new Set(sourceKeys(item)),
      tag: item.system?.tag || null,
      option: getOption(item),
    });
  }
  for (const feature of actor.items) {
    for (const { picks } of slotsOf(feature)) {
      for (const uuid of picks) {
        if (grantedItem(feature, uuid)) continue;
        const source = resolveSync(uuid);
        if (!source) continue;
        held.push({
          name: source.name,
          type: source.type,
          keys: new Set([uniform(uuid)]),
          tag: identifierOf(source.type, source.name),
          option: getOption(source),
        });
      }
    }
  }
  return held;
}

/** The held thing matching an option, by source or by identifier, as de-duplication matches. */
function holds(held, type, name, uuids) {
  const keys = uuids.map(uniform);
  const tag = identifierOf(type, name);
  return held.find((h) => keys.some((k) => h.keys.has(k)) || (!!tag && h.type === type && h.tag === tag)) ?? null;
}

/**
 * Why each catalog entry can't be picked for a row, as display notes. An entry with
 * no notes passes. DESIGN.md § Prerequisites.
 *
 * @returns {Map<string, string[]>} entry uuid -> notes
 */
export function judgeOptions(feature, row, entries) {
  const held = holdings(feature.actor);
  const level = slotLevel(feature, row);
  const out = new Map();
  for (const entry of entries) {
    const { option } = entry;
    const notes = [];
    if (!option.repeatable && holds(held, entry.type, entry.name, [entry.uuid, ...entry.hides])) {
      notes.push(game.i18n.localize("PF1EL.Sel.Note.Known"));
    }
    if (option.minLevel !== null && option.minLevel > level) {
      notes.push(game.i18n.format("PF1EL.Sel.Note.Level", { n: option.minLevel }));
    }
    const missing = [];
    for (const uuid of option.requires) {
      const source = resolveSync(uuid);
      if (!source) missing.push(uuid);
      else if (!holds(held, source.type, source.name, [uuid])) missing.push(source.name);
    }
    if (missing.length) notes.push(game.i18n.format("PF1EL.Sel.Note.Requires", { items: missing.join(", ") }));
    if (option.group) {
      const clash = held.find((h) => h.option.group === option.group && h.option.branch !== option.branch);
      if (clash) notes.push(game.i18n.format("PF1EL.Sel.Note.Conflict", { item: clash.name }));
    }
    out.set(entry.uuid, notes);
  }
  return out;
}

export const SORTS = ["default", "az", "za"];

/**
 * Order picker entries, each of { name, level, failed }.
 *   default: available first, then lowest level, then name
 *   az / za: by name alone
 * Returns a new array.
 */
export function orderOptions(entries, sort = "default") {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const list = [...entries];
  if (sort === "az") return list.sort(byName);
  if (sort === "za") return list.sort((a, b) => byName(b, a));
  return list.sort((a, b) => Number(a.failed) - Number(b.failed) || a.level - b.level || byName(a, b));
}

// ─── When a feature is filled ───────────────────────────────────────────────────

// A feat subtype another module names for filled features, in place of this module's
// own. DESIGN.md § When a feature is filled.
let filledCategory = null;

/** Name the feat subtype filled granting features move to. Call it at init. Pass nothing to clear it. */
export function setFilledCategory(subType) {
  filledCategory = typeof subType === "string" && subType ? subType : null;
}

/** The subtype filled features move to, or null if it isn't a registered feat subtype. */
function category() {
  const key = filledCategory ?? OWN_CATEGORY;
  return pf1.config.featTypes?.[key] ? key : null;
}

/** Whether every slot a feature has holds a pick. */
export function isFilled(item) {
  const slots = slotsOf(item);
  return slots.length > 0 && slots.every((slot) => slot.open === 0);
}

// The subtype the system counts against an actor's feats.
const FEAT = "feat";

/** The subtype an item has when it isn't set aside. */
const homeSubType = (item) => flagsOf(item)[HOME_FLAG]?.from ?? item.system?.subType;

/** Whether one of a feature's picks is a general feat, which then holds the feat slot. */
function pickedAFeat(item) {
  return slotsOf(item).some(({ picks }) =>
    picks.some((uuid) => {
      const granted = grantedItem(item, uuid);
      return (granted ? homeSubType(granted) : resolveSync(uuid)?.system?.subType) === FEAT;
    })
  );
}

/**
 * Whether a filled feature may be set aside. One marked Keep in place may not. A
 * general feat may only when a general feat was picked in its place: the system
 * counts feats by subtype, so exactly one of the two should count.
 */
const maySetAside = (item) => !keepsPlace(item) && (homeSubType(item) !== FEAT || pickedAFeat(item));

/** The subtype a filled feature moves to. Null leaves it where it is. */
const asideSubType = (item) => (isFilled(item) && maySetAside(item) ? category() : null);

/**
 * The closing line of a granting feature's description, naming each pick as a link
 * to the item it was taken from. That link is the same on every copy of the actor;
 * one to the actor's own item would have to be a full uuid and go stale on a copy.
 */
function noteFor(slots) {
  const links = [];
  for (const { picks } of slots) {
    for (const uuid of picks) {
      const source = resolveSync(uuid);
      if (source) links.push(`@UUID[${uuid}]{${String(source.name).replace(/[{}<>]/g, "")}}`);
    }
  }
  if (!links.length) return "";
  return `<p><strong>${game.i18n.localize("PF1EL.Sel.Chosen")}:</strong> ${[...new Set(links)].join(", ")}</p>`;
}

function selectActionData() {
  return new pf1.components.ItemAction({
    _id: SELECT_ACTION_ID,
    name: game.i18n.localize("PF1EL.Sel.ChooseAction"),
    img: SELECT_ACTION_IMG,
    actionType: "other",
    activation: { type: "nonaction", unchained: { type: "nonaction" } },
  }).toObject();
}

/**
 * Bring everything that follows from the picks in line, once the engine has granted
 * them: the Choose action, each picked item's count, each granting feature's
 * description line, and where a filled feature sits. Every value is stamped, so a
 * second pass writes nothing. Owner-level writes. Returns true if anything changed.
 *
 * `skip` holds ids of items the system is already deleting with their parent. An
 * update naming one fails on the server and takes the rest of the batch with it.
 *
 * `dormant` is the module paused for uninstall: nothing is added or moved aside,
 * while what the picks no longer support is still taken back out.
 */
export async function settleSelections(actor, { skip = new Set(), dormant = false } = {}) {
  const updates = new Map();
  const touch = (item) => {
    if (!updates.has(item.id)) updates.set(item.id, { _id: item.id });
    return updates.get(item.id);
  };
  const flag = (key) => `flags.${MODULE_ID}.${key}`;

  // How many slots hold each picked item. A repeatable option is one item, picked more than once.
  const counts = new Map();
  for (const feature of actor.items) {
    for (const { picks } of slotsOf(feature)) {
      for (const uuid of picks) {
        const granted = grantedItem(feature, uuid);
        if (granted) counts.set(granted.id, (counts.get(granted.id) ?? 0) + 1);
      }
    }
  }

  for (const item of actor.items) {
    if (skip.has(item.id)) continue;
    const count = counts.get(item.id) ?? null;
    if (count !== (flagsOf(item)[COUNT_FLAG] ?? null)) {
      if (count === null) touch(item)[flag(`-=${COUNT_FLAG}`)] = null;
      else touch(item)[flag(COUNT_FLAG)] = count;
    }
    if (!hostsSelections(item)) continue;
    const slots = slotsOf(item);

    // The Choose action is present exactly while a slot is open.
    const hasAction = item.actions?.has(SELECT_ACTION_ID) === true;
    const wantAction = !dormant && slots.some((slot) => slot.open > 0);
    if (hasAction !== wantAction) {
      const actions = (item._source.system?.actions ?? []).filter((a) => a._id !== SELECT_ACTION_ID);
      if (wantAction) actions.push(selectActionData());
      touch(item)["system.actions"] = actions;
    }

    // The description line. Only text this wrote is taken out; an edited line stays.
    const note = noteFor(slots);
    const stamp = flagsOf(item)[NOTE_FLAG] ?? "";
    if (note !== stamp) {
      let description = String(item._source.system?.description?.value ?? "");
      if (stamp && description.includes(stamp)) description = description.replace(stamp, "");
      touch(item)["system.description.value"] = description + note;
      if (note) touch(item)[flag(NOTE_FLAG)] = note;
      else touch(item)[flag(`-=${NOTE_FLAG}`)] = null;
    }

    // A filled feature is set aside, and comes back when a slot reopens.
    const home = flagsOf(item)[HOME_FLAG];
    const subType = item.system?.subType;
    const moveTo = dormant ? null : asideSubType(item);
    const move = !!moveTo && homeSubType(item) !== moveTo;
    if (move && !home) {
      touch(item)["system.subType"] = moveTo;
      touch(item)[flag(HOME_FLAG)] = { from: subType, to: moveTo };
    } else if (move && home.to !== moveTo) {
      // Set aside already, and the place for that has changed since.
      if (subType === home.to) touch(item)["system.subType"] = moveTo;
      touch(item)[flag(HOME_FLAG)] = { from: home.from, to: moveTo };
    } else if (!move && home) {
      // Only if it is still where this put it.
      if (subType === home.to) touch(item)["system.subType"] = home.from;
      touch(item)[flag(`-=${HOME_FLAG}`)] = null;
    }
  }

  if (!updates.size) return false;
  await actor.updateEmbeddedDocuments("Item", [...updates.values()], { render: false });
  return true;
}

// ─── Sources ────────────────────────────────────────────────────────────────────

/** The sources setting, normalized. */
export function getSources() {
  const raw = game.settings.get(MODULE_ID, SOURCES_SETTING) ?? {};
  return {
    core: { mode: CORE_MODES.includes(raw.core?.mode) ? raw.core.mode : "all", tags: textList(raw.core?.tags) },
    packs: { mode: PACK_MODES.includes(raw.packs?.mode) ? raw.packs.mode : "all", ids: textList(raw.packs?.ids) },
  };
}

const isCore = (pack) => pack?.metadata?.packageType === "system";

/**
 * Which tags a tag search may look up in a pack. Only tag searches are limited:
 * an item dropped on a row is listed wherever it lives.
 *
 * @returns {(pack: object, tags: string[]) => string[]} the tags still searched there
 */
function searchScope() {
  const { core, packs } = getSources();
  const ids = new Set(packs.ids);
  const coreTags = new Set(core.tags);
  const packOk = (pack) => packs.mode === "all" || (packs.mode === "include") === ids.has(pack.collection);
  const coreOk = (tag) => core.mode === "all" || (core.mode !== "none" && (core.mode === "include") === coreTags.has(tag));
  return (pack, tags) => (!packOk(pack) ? [] : isCore(pack) ? tags.filter(coreOk) : tags);
}

// ─── Catalogs ───────────────────────────────────────────────────────────────────

const itemPacks = () => game.packs.filter((pack) => pack.documentName === "Item" && pack.visible);

/** A no-op for a pack whose index already holds the fields. */
const indexed = (packs) => Promise.all(packs.map((pack) => pack.getIndex({ fields: INDEX_FIELDS })));

function packRank(pack) {
  if (isCore(pack)) return RANK.system;
  return pack?.metadata?.packageType === "world" ? RANK.world : RANK.module;
}

const worldItems = () => game.items.filter((item) => item.testUserPermission(game.user, "LIMITED"));

function entryOf(source, rank) {
  return {
    uuid: source.uuid,
    name: source.name,
    img: source.img,
    type: source.type,
    tags: tagsOf(source),
    option: getOption(source),
    rank,
    hides: [], // same-name options this one stands in for
  };
}

/** Every [source, rank] a listed uuid stands for: one item, or a folder's items. */
function listed(uuid) {
  const doc = fromUuidSync(uuid, { strict: false });
  if (!doc) return [];
  const pack = doc.pack ? game.packs.get(doc.pack) : null;
  if (pack && (pack.documentName !== "Item" || !pack.visible)) return [];
  const rank = pack ? packRank(pack) : RANK.worldItem;

  // An index entry has no documentName; a document must be an Item or a Folder.
  if (doc.documentName !== "Folder") {
    if (doc.documentName && doc.documentName !== "Item") return [];
    if (!pack && !doc.testUserPermission(game.user, "LIMITED")) return [];
    return doc.uuid ? [[doc, rank]] : [];
  }
  if (doc.type !== "Item") return [];
  const folders = [doc, ...doc.getSubfolders(true)];
  if (!pack) {
    const items = folders.flatMap((folder) => folder.contents);
    return items.filter((item) => item.testUserPermission(game.user, "LIMITED")).map((item) => [item, rank]);
  }
  const ids = new Set(folders.map((folder) => folder.id));
  return pack.index.filter((entry) => ids.has(entry.folder)).map((entry) => [entry, rank]);
}

/** One entry per name and type, the lowest rank winning. */
function collapse(entries) {
  const byName = new Map();
  for (const entry of entries) {
    const key = `${entry.type}\u0000${entry.name}`;
    const held = byName.get(key);
    if (!held) byName.set(key, entry);
    else if (entry.rank < held.rank) {
      entry.hides.push(held.uuid, ...held.hides);
      byName.set(key, entry);
    } else held.hides.push(entry.uuid);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The options a row draws from: everything carrying one of its tags, plus what was
 * dropped on it. Only what the current user can see.
 *
 * @returns {Promise<object[]>} entries of { uuid, name, img, type, tags, option, rank, hides }
 */
export async function resolveCatalog(row) {
  const packs = itemPacks();
  await indexed(packs);

  const found = new Map();
  const add = (source, rank) => {
    if (source?.uuid && !found.has(source.uuid)) found.set(source.uuid, entryOf(source, rank));
  };

  const tags = textList(row?.tags);
  const carries = (source, want) => tagsOf(source).some((tag) => want.has(tag));
  if (tags.length) {
    const all = new Set(tags);
    for (const item of worldItems()) if (carries(item, all)) add(item, RANK.worldItem);
    const scope = searchScope();
    for (const pack of packs) {
      const want = new Set(scope(pack, tags));
      if (!want.size) continue;
      const rank = packRank(pack);
      for (const entry of pack.index) if (carries(entry, want)) add(entry, rank);
    }
  }
  for (const uuid of textList(row?.list)) for (const [source, rank] of listed(uuid)) add(source, rank);

  return collapse([...found.values()]);
}

// Suggestions for the sheet's text entries. Rebuilt at most this often.
const VOCAB_MS = 10_000;
let vocab = null;

/**
 * Tags, exclusive groups, and each group's branches in use across the visible items.
 * Tags follow the sources setting, so a tag that would find nothing isn't suggested.
 */
export function vocabulary() {
  if (vocab && Date.now() - vocab.at < VOCAB_MS) return vocab;
  const tags = new Set();
  const groups = new Map();
  const read = (source, searched = tagsOf(source)) => {
    for (const tag of searched) tags.add(tag);
    const { group, branch } = getOption(source);
    if (!group) return;
    if (!groups.has(group)) groups.set(group, new Set());
    if (branch) groups.get(group).add(branch);
  };
  for (const item of worldItems()) read(item);
  const scope = searchScope();
  for (const pack of itemPacks()) for (const entry of pack.index) read(entry, scope(pack, tagsOf(entry)));

  const sorted = (set) => [...set].sort((a, b) => a.localeCompare(b));
  vocab = {
    at: Date.now(),
    tags: sorted(tags),
    groups: sorted(groups.keys()),
    branches: (group) => sorted(groups.get(group) ?? []),
  };
  return vocab;
}

/** Drop the cached suggestions, after the sources setting changes. */
export const forgetVocabulary = () => void (vocab = null);

globalThis.pf1EnhancedLinks = { ...(globalThis.pf1EnhancedLinks ?? {}), resolveCatalog, vocabulary, setFilledCategory };
