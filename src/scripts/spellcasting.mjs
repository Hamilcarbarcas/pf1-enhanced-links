/* PF1 Enhanced Links: spellcasting on features. DESIGN.md § Feature 6.
 *
 * Grant: an item gives the actor a spellbook of its own while it is on the actor.
 *
 * Advance rows: a class feature adds its class's levels to another spellbook or
 * psionic manifester. Terms are written into the book's own "Class Level
 * Modification" field and recorded in a ledger on the actor, so they can be
 * taken back out.
 */

import { MODULE_ID, getAssociatedClass } from "./enhanced-links.mjs";

const LOG = "PF1 Enhanced Links |";
const PSIONICS = "pf1-psionics";

// On the item: { mode, book: {...}, advance: [{ id, kind, when, levels }] }
export const CAST_FLAG = "spellcasting";
// On the on-actor feature: { [rowId]: { system, book } }
export const CHOICE_FLAG = "spellcastingChoice";
// On the actor: { [featureId]: { [rowId]: { system, book, term, manual? } } }
export const LEDGER_FLAG = "spellcastingLedger";
// On the actor: { [itemId]: { book, stamp } }, the spellbook each Grant item made
export const BOOKS_FLAG = "spellcastingBooks";
// On the actor: the same, for psionic manifesters
export const MANIFESTERS_FLAG = "spellcastingManifesters";
// On the actor: { [itemId]: { book, replaced: { key: { prev, applied } }, terms: { key: term } } },
// what each Modify item changed on its class's book
export const MODS_FLAG = "spellcastingMods";
// On the actor: { [bookId]: "<class tag>" }, a book's spell list when not its class's
export const LISTS_FLAG = "bookLists";

export const KINDS = ["arcane", "divine", "psychic", "alchemy", "any", "psionic"];
export const WHENS = ["all", "except", "only"];
export const BOOK_TYPES = ["prepared", "spontaneous", "hybrid"];
export const PROGRESSIONS = ["high", "med", "low"];
export const SPELL_KINDS = ["arcane", "divine", "psychic", "alchemy"];
// A Grant may also make a psionic manifester.
export const GRANT_KINDS = [...SPELL_KINDS, "psionic"];

// Books a Grant may take. The spell-like book is never one.
const SLOTS = ["primary", "secondary", "tertiary"];

// Action added to a feature while one of its rows has no target. Actions carry no
// flags, so a reserved id marks it.
export const CHOICE_ACTION_ID = "pf1elSpellChoice";
const CHOICE_ACTION_IMG = "icons/svg/book.svg";

export const psionicsActive = () => game.modules.get(PSIONICS)?.active === true;

// ─── Config ─────────────────────────────────────────────────────────────────────

/** Class levels from a list or a "1, 5, 9" string: unique, ascending. */
export function parseLevels(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[\s,;]+/);
  const levels = new Set();
  for (const v of raw) {
    const n = Math.floor(Number(v));
    if (n >= 1 && n <= 40) levels.add(n);
  }
  return [...levels].sort((a, b) => a - b);
}

/** Whether the item type can be tied to a class. Others grant by Hit Dice only. */
export const canClassTie = (item) => item.type === "feat";

/** Whether the item type gets a Spellcasting section. */
export const hostsSpellcasting = (item) => item.type === "feat" || item.type === "race";

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/** Spellcasting config on an item, normalized. */
export function getSpellcasting(item) {
  const raw = item.getFlag(MODULE_ID, CAST_FLAG) ?? {};
  const b = raw.book ?? {};
  const book = {
    name: String(b.name ?? "").trim(),
    levelSource: b.levelSource === "hd" || !canClassTie(item) ? "hd" : "class",
    listTag: String(b.listTag ?? "").trim(),
    type: pick(b.type, BOOK_TYPES, "prepared"),
    progression: pick(b.progression, PROGRESSIONS, "high"),
    ability: typeof b.ability === "string" && b.ability ? b.ability : "int",
    spells: pick(b.spells, GRANT_KINDS, "arcane"),
    cantrips: b.cantrips !== false,
    domain: Math.max(0, Math.floor(Number(b.domain) || 0)),
    clOffset: Math.floor(Number(b.clOffset) || 0),
  };
  // Advance needs a class to take levels from.
  const advance = (canClassTie(item) && Array.isArray(raw.advance) ? raw.advance : [])
    .filter((r) => typeof r?.id === "string" && r.id.length)
    .map((r) => ({
      id: r.id,
      kind: pick(r.kind, KINDS, "arcane"),
      when: pick(r.when, WHENS, "all"),
      levels: parseLevels(r.levels),
    }));
  // Modify: a setting left unset (null, 0 or blank) is not touched.
  const m = raw.modify ?? {};
  const int = (v) => Math.floor(Number(v) || 0);
  const modify = {
    type: pick(m.type, BOOK_TYPES, null),
    progression: pick(m.progression, PROGRESSIONS, null),
    ability: typeof m.ability === "string" && m.ability ? m.ability : null,
    spells: pick(m.spells, SPELL_KINDS, null),
    cantrips: typeof m.cantrips === "boolean" ? m.cantrips : null,
    domain: m.domain === null || m.domain === undefined || m.domain === "" ? null : Math.max(0, int(m.domain)),
    listTag: String(m.listTag ?? "").trim(),
    clOffset: int(m.clOffset),
    castsOffset: int(m.castsOffset),
    preparedOffset: int(m.preparedOffset),
  };

  // Modify changes a class's book, so it needs a class-tied item.
  const mode = raw.mode === "grant" ? "grant" : raw.mode === "modify" && canClassTie(item) ? "modify" : null;
  return { mode, book, modify, advance };
}

const grants = (item) => item.getFlag(MODULE_ID, CAST_FLAG)?.mode === "grant" && hostsSpellcasting(item);
const modifies = (item) => item.getFlag(MODULE_ID, CAST_FLAG)?.mode === "modify" && canClassTie(item);

export function hasSpellcasting(item) {
  if (grants(item) || modifies(item)) return true;
  const advance = item.getFlag(MODULE_ID, CAST_FLAG)?.advance;
  return Array.isArray(advance) && advance.length > 0;
}

/** Whether the actor's ledgers record anything for an item id. */
export function hasSpellcastingLedger(actor, itemId) {
  return [LEDGER_FLAG, BOOKS_FLAG, MANIFESTERS_FLAG, MODS_FLAG].some((flag) => !!actor.getFlag(MODULE_ID, flag)?.[itemId]);
}

/** The book an item's Modify is applied to on this actor, or null. */
export function modifiedBookOf(actor, itemId) {
  return actor?.getFlag?.(MODULE_ID, MODS_FLAG)?.[itemId]?.book ?? null;
}

/** The class tag whose spell list a book reads, when that is not its own class. */
export function listTagOf(actor, bookId) {
  return actor?.getFlag?.(MODULE_ID, LISTS_FLAG)?.[bookId] || null;
}

/** The system a Grant config makes its book in. */
export const grantSystemOf = (book) => (book.spells === "psionic" ? "psionic" : "spell");

/** The book (or manifester) an item's Grant made on this actor, or null. */
export function grantedBookOf(actor, itemId, system = "spell") {
  const flag = system === "psionic" ? MANIFESTERS_FLAG : BOOKS_FLAG;
  return actor?.getFlag?.(MODULE_ID, flag)?.[itemId]?.book ?? null;
}

// ─── Terms ──────────────────────────────────────────────────────────────────────

/** Roll-data reference to a class's level, before negative levels. */
const levelRef = (tag) => `@classes.${tag}.unlevel`;

/** The formula term a row adds, or null when the row never advances. */
export function compileTerm(tag, row) {
  const L = levelRef(tag);
  if (row.when === "only") {
    return row.levels.length ? `(${row.levels.map((n) => `gte(${L}, ${n})`).join(" + ")})` : null;
  }
  if (row.when === "except" && row.levels.length) {
    return `(${L}${row.levels.map((n) => ` - gte(${L}, ${n})`).join("")})`;
  }
  return L;
}

/** Top-level `+` addends of a formula. A lone "0" counts as empty. */
function addends(formula) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of String(formula ?? "")) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "+" && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s && s !== "0");
}

const FORMULA_PATH = {
  spell: (id) => `system.attributes.spells.spellbooks.${id}.cl.autoSpellLevelCalculationFormula`,
  psionic: (id) => `flags.${PSIONICS}.manifesters.${id}.cl.autoLevelCalculationFormula`,
};

// ─── Books ──────────────────────────────────────────────────────────────────────

/** A book's spellcasting kind, inferred the way the system's migration does when unset. */
function kindOf(book) {
  if (book.kind) return book.kind;
  if (book.arcaneSpellFailure) return "arcane";
  if (book.psychic) return "psychic";
  if (book.spellPreparationMode === "prepared" && book.ability === "int") return "alchemy";
  return book.class && book.class !== "_hd" ? "divine" : "arcane";
}

/** Prepared book data of one system, or null. */
function bookData(actor, system, id) {
  const all =
    system === "psionic" ? actor.getFlag(PSIONICS, "manifesters") : actor.system?.attributes?.spells?.spellbooks;
  return all?.[id] ?? null;
}

/** In-use books of one system. The spell-like book is never a target. */
function booksOf(actor, system) {
  if (system === "psionic" && !psionicsActive()) return [];
  const all =
    system === "psionic" ? actor.getFlag(PSIONICS, "manifesters") : actor.system?.attributes?.spells?.spellbooks;
  return Object.entries(all ?? {}).filter(([id, book]) => id !== "spelllike" && book?.inUse);
}

/** Display name of the actor's class with this tag. */
export function className(actor, tag) {
  return actor.items.get(actor.classes?.[tag]?._id)?.name ?? tag ?? "";
}

const systemOf = (row) => (row.kind === "psionic" ? "psionic" : "spell");
const bookKey = (o) => `${o.system}:${o.book}`;

/**
 * Books a row may advance: right kind, in use, and not the feature's own class.
 * `own` returns the excluded own-class books instead, to explain an empty list.
 */
export function candidates(actor, row, tag, { own = false } = {}) {
  const system = systemOf(row);
  return booksOf(actor, system)
    .filter(([, book]) => (book.class === tag) === own)
    .filter(([, book]) => system === "psionic" || row.kind === "any" || kindOf(book) === row.kind)
    .map(([id, book]) => ({ system, book: id, label: book.label || book.name || id }));
}

/**
 * Each row's target on an on-actor feature.
 *
 * A recorded choice holds while its book is still a candidate. A row with no
 * record and exactly one free candidate resolves to it (`auto`). Anything else
 * is open.
 *
 * @returns {{ tag: string|null, live: boolean, rows: object[] }}
 */
export function resolveRows(actor, feature) {
  const tag = getAssociatedClass(feature);
  const live = !!tag && !!actor.classes?.[tag];
  const choices = feature.getFlag(MODULE_ID, CHOICE_FLAG) ?? {};
  const rows = getSpellcasting(feature).advance.map((row) => {
    const options = live ? candidates(actor, row, tag) : [];
    return {
      row,
      options,
      target: null,
      auto: false,
      // The only matching books belong to the feature's own class.
      ownOnly: live && !options.length && candidates(actor, row, tag, { own: true }).length > 0,
    };
  });

  // Recorded choices claim their book first, so no other row of the feature takes it.
  const taken = new Set();
  for (const r of rows) {
    const choice = choices[r.row.id];
    const hit = choice && r.options.find((o) => bookKey(o) === bookKey(choice));
    if (!hit) continue;
    r.target = hit;
    taken.add(bookKey(hit));
  }
  for (const r of rows) {
    if (r.target) continue;
    r.options = r.options.filter((o) => !taken.has(bookKey(o)));
    // A stale record is not replaced silently: its book may come back.
    if (r.options.length === 1 && !choices[r.row.id]) {
      r.target = r.options[0];
      r.auto = true;
      taken.add(bookKey(r.target));
    }
  }
  return { tag, live, rows };
}

// ─── Reconcile ──────────────────────────────────────────────────────────────────

function choiceActionData() {
  return new pf1.components.ItemAction({
    _id: CHOICE_ACTION_ID,
    name: game.i18n.localize("PF1EL.Cast.ChooseAction"),
    img: CHOICE_ACTION_IMG,
    actionType: "other",
    activation: { type: "nonaction", unchained: { type: "nonaction" } },
  }).toObject();
}

// One run at a time per actor: the engine and the choice dialog can both ask.
const queues = new Map();

/**
 * Bring the actor's books in line with its items' spellcasting config.
 * Owner-level writes only. Returns true if anything changed.
 */
export function reconcileSpellcasting(actor) {
  const key = actor.uuid;
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => run(actor));
  queues.set(key, next);
  next
    .catch(() => {})
    .finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    });
  return next;
}

/**
 * Grants first: a granted book can be what another feature modifies or advances.
 * Each step writes before the next reads.
 */
async function run(actor) {
  const granted = await runGrants(actor);
  const modified = await runModify(actor, granted.fresh);
  // A Modify's list wins over the Grant that made the book.
  const listed = await syncLists(actor, { ...granted.lists, ...modified.lists });
  const advanced = await runRows(actor);
  return granted.changed || modified.changed || listed || advanced;
}

/** Bring the per-book spell-list tags in line with what Grant and Modify want. */
async function syncLists(actor, want) {
  const have = actor.getFlag(MODULE_ID, LISTS_FLAG) ?? {};
  const update = {};
  for (const bookId of new Set([...Object.keys(have), ...Object.keys(want)])) {
    if (want[bookId] === have[bookId]) continue;
    if (want[bookId]) update[`flags.${MODULE_ID}.${LISTS_FLAG}.${bookId}`] = want[bookId];
    else update[`flags.${MODULE_ID}.${LISTS_FLAG}.-=${bookId}`] = null;
  }
  if (!Object.keys(update).length) return false;
  await actor.update(update, { render: false });
  return true;
}

const BOOK_BASE = "system.attributes.spells.spellbooks";

// ─── Grant ──────────────────────────────────────────────────────────────────────

/** Where each system keeps its books, and its Grant ledger. */
const GRANT_SYSTEMS = {
  spell: {
    flag: BOOKS_FLAG,
    base: BOOK_BASE,
    books: (actor) => actor.system?.attributes?.spells?.spellbooks ?? {},
    classCasts: (cls) => !!cls.system?.casting?.type,
  },
  psionic: {
    flag: MANIFESTERS_FLAG,
    base: `flags.${PSIONICS}.manifesters`,
    books: (actor) => actor.getFlag(PSIONICS, "manifesters") ?? {},
    classCasts: (cls) => !!cls.system?.manifesting?.progression,
  },
};

/** Book fields a Grant sets: stamp key -> [path under the book, value]. */
function grantFields(cfg, item, levelClass, system) {
  const common = {
    class: ["class", levelClass],
    progression: ["casterType", cfg.progression],
    ability: ["ability", cfg.ability],
    cantrips: ["hasCantrips", cfg.cantrips],
    name: ["name", cfg.name || item.name],
  };
  if (system === "psionic") return common;
  return {
    ...common,
    kind: ["kind", cfg.spells],
    type: ["spellPreparationMode", cfg.type],
    psychic: ["psychic", cfg.spells === "psychic"],
    asf: ["arcaneSpellFailure", cfg.spells === "arcane"],
    domain: ["domainSlotValue", cfg.domain],
  };
}

// "No free spellbook" is said once per item per session, not on every pass.
const warnedFull = new Set();
// So is a Grant whose class still has its own casting set up, and a psionic Grant
// without pf1-psionics.
const warnedClassCasts = new Set();
const warnedNoPsionics = new Set();

/**
 * The `cl.formula` write for a Grant's level offset, or null when none is needed.
 * A fresh book gets the offset alone. After that it is one addend, so terms other
 * items added survive a change of offset.
 */
function offsetFormula(stored, prev, term, fresh) {
  if (fresh) return term;
  if (prev === term) return null;
  const list = addends(stored);
  const index = prev ? list.indexOf(prev) : -1;
  if (index >= 0) list.splice(index, 1);
  if (term) list.push(term);
  return list.join(" + ");
}

/**
 * Spellbook Grants, then psionic ones. Psionic records are left alone while
 * pf1-psionics is off, so turning it back on finds them intact.
 */
async function runGrants(actor) {
  const spell = await grantSystem(actor, "spell");
  if (!psionicsActive()) {
    for (const item of actor.items.filter((it) => grants(it) && grantSystemOf(getSpellcasting(it).book) === "psionic")) {
      const key = `${actor.uuid}:${item.id}`;
      if (warnedNoPsionics.has(key)) continue;
      warnedNoPsionics.add(key);
      ui.notifications.warn(game.i18n.format("PF1EL.Cast.Warn.NoPsionics", { item: item.name }));
    }
    return spell;
  }
  const psionic = await grantSystem(actor, "psionic");
  return { ...spell, changed: spell.changed || psionic.changed };
}

/**
 * Create, update and retire the books one system's Grant items make. DESIGN.md § Feature 6.
 *
 * A field is written when the book is first taken, and afterwards only when the
 * config value changes, so an edit made on the actor sheet stays.
 */
async function grantSystem(actor, system) {
  const sys = GRANT_SYSTEMS[system];
  const ledger = sys.flag;
  const before = actor.getFlag(MODULE_ID, ledger) ?? {};
  const granters = actor.items.filter((it) => grants(it) && grantSystemOf(getSpellcasting(it).book) === system);
  if (!granters.length && !Object.keys(before).length) return { changed: false, lists: {}, fresh: new Set() };

  const books = sys.books(actor);
  const bookBase = sys.base;
  const flagBase = `flags.${MODULE_ID}`;
  const update = {};
  const wantLists = {};
  const kept = new Set();
  // Books taken this pass. Every field was written, so a Modify on one applies again.
  const fresh = new Set();

  const plans = [];
  for (const item of granters) {
    const cfg = getSpellcasting(item).book;
    const tag = getAssociatedClass(item);
    const levelClass = cfg.levelSource === "hd" ? "_hd" : tag;
    // A class-level book needs its class on the actor.
    if (levelClass !== "_hd" && !(tag && actor.classes?.[tag])) continue;
    plans.push({ item, cfg, levelClass });

    const cls = levelClass === "_hd" ? null : actor.itemTypes.class.find((c) => c.system.tag === levelClass);
    const warnKey = `${actor.uuid}:${item.id}`;
    if (cls && sys.classCasts(cls) && !warnedClassCasts.has(warnKey)) {
      warnedClassCasts.add(warnKey);
      ui.notifications.warn(game.i18n.format("PF1EL.Cast.Warn.ClassCasts", { item: item.name, class: cls.name }));
    }
  }

  // Books of records that end this pass are released first, so a Grant replacing
  // another on the same class (an archetype swap) takes the same book.
  const staying = new Set(plans.map((p) => p.item.id));
  const claimed = new Set();
  const released = new Set();
  for (const [itemId, rec] of Object.entries(before)) {
    if (!rec?.book) continue;
    (staying.has(itemId) ? claimed : released).add(rec.book);
  }

  for (const { item, cfg, levelClass } of plans) {
    const rec = before[item.id];
    let bookId = rec?.book;
    const taken = !!bookId && !!books[bookId];
    if (!taken) {
      // An unused book, preferring one this class had before: its spells are still in it.
      // A released book goes only to the same class.
      const free = SLOTS.filter(
        (id) =>
          books[id] &&
          !claimed.has(id) &&
          (!books[id].inUse || (released.has(id) && books[id].class === levelClass))
      );
      bookId = free.find((id) => books[id].class === levelClass) ?? free[0];
      if (!bookId) {
        const key = `${actor.uuid}:${item.id}`;
        if (!warnedFull.has(key)) ui.notifications.warn(`${item.name}: ${game.i18n.localize("PF1.Error.NoFreeSpellbooks")}`);
        warnedFull.add(key);
        continue;
      }
      claimed.add(bookId);
      fresh.add(bookId);
    }
    kept.add(item.id);

    const stamp = taken ? (rec.stamp ?? {}) : {};
    const applied = {};
    let stale = !taken;
    for (const [key, [path, value]] of Object.entries(grantFields(cfg, item, levelClass, system))) {
      applied[key] = value;
      if (taken && stamp[key] === value) continue;
      update[`${bookBase}.${bookId}.${path}`] = value;
      stale = true;
    }
    // Older records stamped the whole formula as `clFormula`.
    const term = cfg.clOffset ? String(cfg.clOffset) : "";
    applied.clTerm = term;
    const clPath = `${bookBase}.${bookId}.cl.formula`;
    const prevTerm = stamp.clTerm ?? stamp.clFormula ?? "";
    const formula = offsetFormula(foundry.utils.getProperty(actor._source, clPath), prevTerm, term, !taken);
    if (formula !== null) {
      update[clPath] = formula;
      stale = true;
    } else if (!("clTerm" in stamp)) stale = true;
    if (!books[bookId].inUse) update[`${bookBase}.${bookId}.inUse`] = true;
    if (stale) update[`${flagBase}.${ledger}.${item.id}`] = { book: bookId, stamp: applied };

    if (system === "spell" && cfg.listTag && cfg.listTag !== levelClass) wantLists[bookId] = cfg.listTag;
  }

  // Retire the book of an item that left, lost its class, or no longer grants.
  for (const [itemId, rec] of Object.entries(before)) {
    if (kept.has(itemId)) continue;
    const stored = foundry.utils.getProperty(actor._source, `${bookBase}.${rec?.book}`);
    // Taken again this pass: the new Grant's writes stand.
    if (stored && !claimed.has(rec.book)) {
      if (stored.inUse) update[`${bookBase}.${rec.book}.inUse`] = false;
      // The name would otherwise label whatever class takes this book next.
      if (rec.stamp?.name && stored.name === rec.stamp.name) update[`${bookBase}.${rec.book}.name`] = "";
    }
    update[`${flagBase}.${ledger}.-=${itemId}`] = null;
  }

  if (!Object.keys(update).length) return { changed: false, lists: wantLists, fresh };
  await actor.update(update, { render: false });
  return { changed: true, lists: wantLists, fresh };
}

// ─── Modify ─────────────────────────────────────────────────────────────────────

// Settings a Modify replaces: config key -> path under the book.
const MOD_FIELDS = {
  type: "spellPreparationMode",
  progression: "casterType",
  ability: "ability",
  kind: "kind",
  psychic: "psychic",
  asf: "arcaneSpellFailure",
  cantrips: "hasCantrips",
  domain: "domainSlotValue",
};

// Formulas a Modify adds an addend to: config key -> path under the book.
const MOD_TERMS = {
  clOffset: "cl.formula",
  castsOffset: "castPerDayAllOffsetFormula",
  preparedOffset: "preparedAllOffsetFormula",
};

/** The settings a Modify config replaces, by MOD_FIELDS key. Unset ones are left out. */
function modifyFields(m) {
  const out = {};
  for (const key of ["type", "progression", "ability", "cantrips", "domain"]) if (m[key] !== null) out[key] = m[key];
  if (m.spells) {
    out.kind = m.spells;
    out.psychic = m.spells === "psychic";
    out.asf = m.spells === "arcane";
  }
  return out;
}

/** The addends a Modify config adds, by MOD_TERMS key. */
function modifyTerms(m) {
  const out = {};
  for (const key of Object.keys(MOD_TERMS)) if (m[key]) out[key] = String(m[key]);
  return out;
}

// A setting two features both replace is warned about once per session.
const warnedClash = new Set();

/**
 * Apply and undo Modify items' changes to their class's spellbook. DESIGN.md § Feature 6.
 *
 * Replaced settings remember what was there. A setting is rewritten only when its
 * config value changes, and put back only if it still holds what was applied, so
 * an edit made on the actor sheet stays.
 *
 * @param {Set<string>} [fresh] - Books a Grant took this pass
 * @returns {Promise<{ changed: boolean, lists: Record<string, string> }>}
 */
async function runModify(actor, fresh = new Set()) {
  const before = actor.getFlag(MODULE_ID, MODS_FLAG) ?? {};
  const modifiers = actor.items.filter(modifies);
  const lists = {};
  if (!modifiers.length && !Object.keys(before).length) return { changed: false, lists };

  const books = actor.system?.attributes?.spells?.spellbooks ?? {};
  const granted = new Set(Object.values(actor.getFlag(MODULE_ID, BOOKS_FLAG) ?? {}).map((rec) => rec?.book));
  const stored = (bookId, path) => foundry.utils.getProperty(actor._source, `${BOOK_BASE}.${bookId}.${path}`);

  // What each item wants, on its class's own book. One a Grant made is second choice.
  const want = new Map();
  for (const item of modifiers) {
    const tag = getAssociatedClass(item);
    if (!tag || !actor.classes?.[tag]) continue;
    const own = Object.entries(books)
      .filter(([id, book]) => id !== "spelllike" && book?.inUse && book.class === tag)
      .map(([id]) => id);
    const bookId = own.find((id) => !granted.has(id)) ?? own[0];
    if (!bookId) continue;
    const m = getSpellcasting(item).modify;
    want.set(item.id, { book: bookId, fields: modifyFields(m), terms: modifyTerms(m), name: item.name });
    if (m.listTag && m.listTag !== tag) lists[bookId] = m.listTag;
  }

  /** Another item's live record of the same setting on the same book. */
  const otherClaim = (itemId, bookId, key) => {
    for (const [id, rec] of Object.entries(before)) {
      if (id === itemId || rec?.book !== bookId || fresh.has(bookId) || !rec.replaced?.[key]) continue;
      const w = want.get(id);
      if (w?.book === bookId && key in w.fields) return rec.replaced[key];
    }
    return null;
  };

  const update = {};
  const formulas = new Map();
  const formula = (bookId, key) => {
    const path = `${BOOK_BASE}.${bookId}.${MOD_TERMS[key]}`;
    if (!formulas.has(path)) {
      formulas.set(path, { list: addends(foundry.utils.getProperty(actor._source, path)), dirty: false });
    }
    return formulas.get(path);
  };
  /** @type {Map<string, Map<string, any>>} item id -> ledger keys to write under it */
  const ops = new Map();
  const op = (itemId) => ops.get(itemId) ?? ops.set(itemId, new Map()).get(itemId);
  const gone = [];

  // Existing records: follow a changed config value, undo what is no longer wanted.
  // On a book a Grant just took, every record starts over: nothing is undone.
  for (const [itemId, rec] of Object.entries(before)) {
    const w = want.get(itemId);
    const reset = fresh.has(rec?.book);
    const sameBook = !reset && !!w && w.book === rec?.book;
    for (const [key, r] of Object.entries(rec?.replaced ?? {})) {
      const path = `${BOOK_BASE}.${rec.book}.${MOD_FIELDS[key]}`;
      if (sameBook && key in w.fields) {
        if (r.applied === w.fields[key]) continue;
        update[path] = w.fields[key];
        op(itemId).set(`replaced.${key}`, { prev: r.prev, applied: w.fields[key] });
        continue;
      }
      if (!reset && stored(rec.book, MOD_FIELDS[key]) === r.applied) {
        // Another item still replaces this setting: its value shows through.
        const other = otherClaim(itemId, rec.book, key);
        update[path] = other ? other.applied : (r.prev ?? "");
      }
      op(itemId).set(`replaced.-=${key}`, null);
    }
    for (const [key, term] of Object.entries(rec?.terms ?? {})) {
      if (sameBook && w.terms[key] === term) continue;
      const f = formula(rec.book, key);
      const index = reset ? -1 : f.list.indexOf(term);
      if (index >= 0) {
        f.list.splice(index, 1);
        f.dirty = true;
      }
      op(itemId).set(`terms.-=${key}`, null);
    }
    if (!w) gone.push(itemId);
  }

  // Newly wanted settings and addends.
  for (const [itemId, w] of want) {
    const rec = before[itemId];
    const sameBook = !fresh.has(w.book) && rec?.book === w.book;
    for (const [key, value] of Object.entries(w.fields)) {
      if (sameBook && rec.replaced?.[key]) continue;
      // Under another item's change, what to put back is what that item found.
      const other = otherClaim(itemId, w.book, key);
      const prev = other ? other.prev : (stored(w.book, MOD_FIELDS[key]) ?? null);
      update[`${BOOK_BASE}.${w.book}.${MOD_FIELDS[key]}`] = value;
      op(itemId).delete(`replaced.-=${key}`);
      op(itemId).set(`replaced.${key}`, { prev, applied: value });
      const clash = `${actor.uuid}:${w.book}:${key}`;
      if (other && !warnedClash.has(clash)) {
        warnedClash.add(clash);
        ui.notifications.warn(game.i18n.format("PF1EL.Cast.Warn.Clash", { item: w.name }));
      }
    }
    for (const [key, term] of Object.entries(w.terms)) {
      if (sameBook && rec.terms?.[key] === term) continue;
      const f = formula(w.book, key);
      f.list.push(term);
      f.dirty = true;
      op(itemId).delete(`terms.-=${key}`);
      op(itemId).set(`terms.${key}`, term);
    }
    if (!sameBook) op(itemId).set("book", w.book);
  }

  for (const [path, f] of formulas) if (f.dirty) update[path] = f.list.join(" + ");

  // A removed item's record goes whole. Its child keys are not written beside that.
  const flagBase = `flags.${MODULE_ID}.${MODS_FLAG}`;
  for (const itemId of gone) {
    ops.delete(itemId);
    update[`${flagBase}.-=${itemId}`] = null;
  }
  for (const [itemId, keys] of ops) for (const [key, value] of keys) update[`${flagBase}.${itemId}.${key}`] = value;

  if (!Object.keys(update).length) return { changed: false, lists };
  await actor.update(update, { render: false });
  return { changed: true, lists };
}

/**
 * Run `fn` with a book's class swapped for its spell-list tag. The system reads
 * `book.class` as the list key; this is in-memory only and restored afterwards.
 */
function withListTag(actor, bookId, fn) {
  const tag = bookId ? listTagOf(actor, bookId) : null;
  const book = tag ? actor.system?.attributes?.spells?.spellbooks?.[bookId] : null;
  if (!book) return fn();
  const original = book.class;
  book.class = tag;
  try {
    return fn();
  } finally {
    book.class = original;
  }
}

Hooks.once("ready", () => {
  if (!game.modules.get("lib-wrapper")?.active) {
    return void console.error(LOG, "lib-wrapper is not active: spell lists set on granted spellbooks are ignored.");
  }
  // The level given to a spell added to the book.
  libWrapper.register(
    MODULE_ID,
    "CONFIG.Item.documentClasses.spell._adjustNewItem",
    function (wrapped, item, ...args) {
      return withListTag(item?.actor, item?.system?.spellbook, () => wrapped(item, ...args));
    },
    "WRAPPER"
  );
  // The class filter the spell browse button pre-selects.
  libWrapper.register(
    MODULE_ID,
    "pf1.applications.actor.ActorSheetPF.prototype._onOpenCompendiumBrowser",
    function (wrapped, event, ...args) {
      const bookId = event?.currentTarget?.closest?.("[data-group][data-tab]")?.dataset.tab;
      return withListTag(this.actor, bookId, () => wrapped(event, ...args));
    },
    "WRAPPER"
  );
});

// ─── Advance ────────────────────────────────────────────────────────────────────

async function runRows(actor) {
  const before = actor.getFlag(MODULE_ID, LEDGER_FLAG) ?? {};
  // Also features whose rows were all removed: their action and choices go too.
  const features = actor.items.filter(
    (it) =>
      hasSpellcasting(it) ||
      it.actions?.has(CHOICE_ACTION_ID) === true ||
      Object.keys(it.getFlag(MODULE_ID, CHOICE_FLAG) ?? {}).length > 0
  );
  if (!features.length && !Object.keys(before).length) return false;

  const ledger = foundry.utils.deepClone(before);
  /** @type {Map<string, object>} "<featureId>.<rowId>" -> wanted ledger record, plus `ref` */
  const desired = new Map();
  /** @type {Map<string, object>} feature id -> item update */
  const itemUpdates = new Map();
  const touch = (id) => itemUpdates.get(id) ?? itemUpdates.set(id, { _id: id }).get(id);

  for (const feature of features) {
    const { tag, live, rows } = resolveRows(actor, feature);
    let open = 0;
    for (const { row, target, auto } of rows) {
      if (!target) {
        if (live) open++;
        continue;
      }
      if (auto) {
        touch(feature.id)[`flags.${MODULE_ID}.${CHOICE_FLAG}.${row.id}`] = { system: target.system, book: target.book };
      }
      const term = compileTerm(tag, row);
      if (!term) continue;
      desired.set(`${feature.id}.${row.id}`, {
        featureId: feature.id,
        rowId: row.id,
        system: target.system,
        book: target.book,
        term,
        ref: levelRef(tag),
      });
    }

    // Choices of rows that no longer exist.
    const rowIds = new Set(rows.map((r) => r.row.id));
    for (const rowId of Object.keys(feature.getFlag(MODULE_ID, CHOICE_FLAG) ?? {})) {
      if (!rowIds.has(rowId)) touch(feature.id)[`flags.${MODULE_ID}.${CHOICE_FLAG}.-=${rowId}`] = null;
    }

    // The choice action is present exactly while a row is open.
    const hasAction = feature.actions?.has(CHOICE_ACTION_ID) === true;
    if (open > 0 !== hasAction) {
      const actions = (feature.toObject().system?.actions ?? []).filter((a) => a._id !== CHOICE_ACTION_ID);
      if (open > 0) actions.push(choiceActionData());
      touch(feature.id)["system.actions"] = actions;
    }
  }

  // Working copy of each touched formula, read from source: prepared data may be derived.
  const formulas = new Map();
  const formula = (system, book) => {
    const path = FORMULA_PATH[system](book);
    if (!formulas.has(path)) {
      formulas.set(path, { list: addends(foundry.utils.getProperty(actor._source, path)), dirty: false });
    }
    return formulas.get(path);
  };

  const same = (a, b) => a.system === b.system && a.book === b.book && a.term === b.term;
  const engineTerms = new Set([...desired.values()].map((d) => d.term));
  for (const rows of Object.values(before)) for (const rec of Object.values(rows ?? {})) engineTerms.add(rec.term);

  const warnings = [];
  const label = (system, book) => {
    const data = bookData(actor, system, book);
    return data?.label || data?.name || book;
  };

  // Take out what is no longer wanted. A term another row still wants stays.
  for (const [featureId, rows] of Object.entries(ledger)) {
    for (const [rowId, rec] of Object.entries(rows ?? {})) {
      const key = `${featureId}.${rowId}`;
      const want = desired.get(key);
      if (want && same(want, rec)) continue;
      const shared = [...desired].some(([k, d]) => k !== key && same(d, rec));
      if (!rec.manual && !shared) {
        const f = formula(rec.system, rec.book);
        const index = f.list.indexOf(rec.term);
        if (index >= 0) {
          f.list.splice(index, 1);
          f.dirty = true;
        }
      }
      delete rows[rowId];
    }
    if (!Object.keys(rows ?? {}).length) delete ledger[featureId];
  }

  // Put in what is newly wanted. A term already there is adopted as is.
  const fresh = [];
  for (const want of desired.values()) {
    if (ledger[want.featureId]?.[want.rowId]) continue;
    // `manual` is always written: flags merge, so an omitted key keeps its old value.
    const rec = { system: want.system, book: want.book, term: want.term, manual: false };
    const f = formula(want.system, want.book);
    if (!f.list.includes(want.term)) {
      // The class is already counted in a hand-written part of the formula.
      if (f.list.some((a) => !engineTerms.has(a) && a.includes(want.ref))) {
        rec.manual = true;
        warnings.push(game.i18n.format("PF1EL.Cast.Warn.Manual", { book: label(want.system, want.book) }));
      } else {
        f.list.push(want.term);
        f.dirty = true;
        fresh.push(want);
      }
    }
    (ledger[want.featureId] ??= {})[want.rowId] = rec;
  }

  const update = {};
  for (const [path, f] of formulas) if (f.dirty) update[path] = f.list.join(" + ");

  // Flags merge on update, so anything dropped needs an explicit deletion key.
  const base = `flags.${MODULE_ID}.${LEDGER_FLAG}`;
  for (const featureId of new Set([...Object.keys(before), ...Object.keys(ledger)])) {
    if (!ledger[featureId]) {
      update[`${base}.-=${featureId}`] = null;
      continue;
    }
    for (const rowId of new Set([...Object.keys(before[featureId] ?? {}), ...Object.keys(ledger[featureId])])) {
      const rec = ledger[featureId][rowId];
      const old = before[featureId]?.[rowId];
      if (!rec) update[`${base}.${featureId}.-=${rowId}`] = null;
      else if (!old || !same(old, rec) || !!old.manual !== !!rec.manual) update[`${base}.${featureId}.${rowId}`] = rec;
    }
  }

  if (!itemUpdates.size && !Object.keys(update).length) return false;

  if (itemUpdates.size) {
    await actor.updateEmbeddedDocuments("Item", [...itemUpdates.values()], { render: false });
    // The feature's own sheet shows its targets.
    for (const id of itemUpdates.keys()) {
      const sheet = actor.items.get(id)?.sheet;
      if (sheet?.rendered) sheet.render(false);
    }
  }
  if (Object.keys(update).length) await actor.update(update, { render: false });

  for (const want of fresh) warnings.push(...checkApplied(actor, want, label(want.system, want.book)));
  for (const message of new Set(warnings)) ui.notifications.warn(message);
  return true;
}

/** Reasons a freshly written term does nothing, as warning text. */
function checkApplied(actor, want, label) {
  const book = bookData(actor, want.system, want.book);
  if (!book) return [];
  if (want.system === "spell") {
    return book.autoSpellLevelCalculation ? [] : [game.i18n.format("PF1EL.Cast.Warn.AutoSlotsOff", { book: label })];
  }

  const out = [];
  if (!book.autoLevelPowerPoints) out.push(game.i18n.format("PF1EL.Cast.Warn.PowerPointsOff", { book: label }));
  // Stock pf1-psionics has no such field and ignores the write. Detected by the
  // level it should have moved.
  const offset = pf1.dice.RollPF.safeRollSync(want.term, actor.getRollData()).total ?? 0;
  const own =
    book.class === "_hd" ? (actor.system?.attributes?.hd?.total ?? 0) : (actor.classes?.[book.class]?.unlevel ?? 0);
  if (offset > 0 && own < 20 && (book.cl?.classLevelTotal ?? 0) <= own) {
    out.push(game.i18n.format("PF1EL.Cast.Warn.PsionicField", { book: label }));
  }
  return out;
}

// ─── Choosing a target ──────────────────────────────────────────────────────────

/** Display name of a row's kind. */
export function kindLabel(kind) {
  const system = pf1.config.spellcasting?.spells?.[kind];
  return system ? game.i18n.localize(system) : game.i18n.localize(`PF1EL.Cast.Kind.${kind}`);
}

const openDialogs = new Set();

/** Prompt for the target of every open row of a feature, then apply. */
export async function chooseTargets(feature) {
  const actor = feature.actor;
  if (!actor || openDialogs.has(feature.uuid)) return;

  const { tag, live, rows } = resolveRows(actor, feature);
  if (!live) return void ui.notifications.warn(game.i18n.format("PF1EL.Cast.Warn.NoClass", { item: feature.name }));
  const open = rows.filter((r) => !r.target);
  if (!open.length) return;
  if (open.every((r) => !r.options.length)) {
    const key = open.some((r) => r.ownOnly) ? "PF1EL.Cast.Warn.OwnClass" : "PF1EL.Cast.Warn.NoBooks";
    return void ui.notifications.warn(game.i18n.format(key, { item: feature.name, class: className(actor, tag) }));
  }

  const esc = foundry.utils.escapeHTML;
  const groups = open
    .map((r, index) => {
      const options = r.options.map((o) => `<option value="${esc(bookKey(o))}">${esc(o.label)}</option>`).join("");
      const empty = `<option value="">${esc(game.i18n.localize("PF1EL.Cast.Dialog.None"))}</option>`;
      return `
        <div class="form-group">
          <label for="pf1el-cast-${index}">${esc(kindLabel(r.row.kind))}</label>
          <div class="form-fields">
            <select id="pf1el-cast-${index}" name="row-${index}">${empty}${options}</select>
          </div>
        </div>`;
    })
    .join("");
  const content = `<p>${esc(game.i18n.format("PF1EL.Cast.Dialog.Intro", { item: feature.name }))}</p>${groups}`;

  openDialogs.add(feature.uuid);
  let picked;
  try {
    picked = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("PF1EL.Cast.Dialog.Title", { item: feature.name }) },
      content,
      ok: {
        label: game.i18n.localize("PF1EL.Cast.Dialog.Confirm"),
        callback: (event, button) => open.map((r, index) => button.form.elements[`row-${index}`].value),
      },
      rejectClose: false,
    });
  } finally {
    openDialogs.delete(feature.uuid);
  }
  if (!picked) return;

  // One book per row.
  const chosen = picked.filter(Boolean);
  if (new Set(chosen).size !== chosen.length) {
    return void ui.notifications.warn(game.i18n.localize("PF1EL.Cast.Warn.SameBook"));
  }
  if (!chosen.length || !actor.items.has(feature.id)) return;

  const update = {};
  open.forEach((r, index) => {
    const hit = r.options.find((o) => bookKey(o) === picked[index]);
    if (hit) update[`flags.${MODULE_ID}.${CHOICE_FLAG}.${r.row.id}`] = { system: hit.system, book: hit.book };
  });
  await feature.update(update);
  // Applied here, on the chooser's client, so no GM has to be connected.
  await reconcileSpellcasting(actor);
}

/** Clear one row's target. Its term comes out and the row is open again. */
export async function resetTarget(feature, rowId) {
  const actor = feature.actor;
  if (!actor) return;
  await feature.update({ [`flags.${MODULE_ID}.${CHOICE_FLAG}.-=${rowId}`]: null }, { render: false });
  await reconcileSpellcasting(actor);
}

const isChoiceUse = (actionUse) => actionUse?.action?.id === CHOICE_ACTION_ID;

const failed = (err) => console.error(LOG, "choosing a spellcasting target failed", err);

// pf1-new-script-hooks: cancel before the attack dialog opens.
Hooks.on("pf1PreAttackDialog", (actionUse) => {
  if (!isChoiceUse(actionUse)) return;
  actionUse.shared.reject = true;
  chooseTargets(actionUse.item).catch(failed);
});

// Without it the use gets this far, past the dialog. Cancel here instead.
Hooks.on("pf1PreActionUse", (actionUse) => {
  if (!isChoiceUse(actionUse)) return;
  chooseTargets(actionUse.item).catch(failed);
  return false;
});

globalThis.pf1EnhancedLinks = { ...(globalThis.pf1EnhancedLinks ?? {}), reconcileSpellcasting, chooseTargets };
