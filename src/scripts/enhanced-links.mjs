/* PF1 Enhanced Links
 *
 * Extends the PF1 system's class-association and supplement mechanics into a
 * single gate-driven engine. Adds two sub-tabs to the item sheet's "Links" tab:
 *
 *   • Class Features    — grant a child item when the item's associated class
 *                         reaches a chosen level. Like the system's class
 *                         associations, but hosted on any class-associated item
 *                         instead of the class itself.
 *   • Spell Supplements — route dropped spells into a spellbook (the associated
 *                         class's, or the spell-like abilities book), optionally
 *                         gated behind a class level / Hit Dice total.
 *
 * PHASE 1 (this file): the item-sheet UI and flag storage only. The engine that
 * actually creates and removes the linked items on level change lives in
 * engine.mjs and is wired up in a later phase. See DESIGN.md.
 */

export const MODULE_ID = "pf1-enhanced-links";
const LOG = "PF1 Enhanced Links |";

// Flag keys, stored under flags[MODULE_ID] on the configured item.
//   classFeatures    → [{ uuid, level }]
//   spellSupplements → { mode, gated, items: [{ uuid, level }] }
// (`granted` — the teardown ledger — is owned by the Phase 2 engine.)
const FLAG = {
  classFeatures: "classFeatures",
  spellSupplements: "spellSupplements",
};

// Injected sub-tab identifiers. Prefixed so they can never collide with the
// system's own link types (children / supplements / charges / classAssociations).
const TAB = {
  classFeatures: "enhanced-links-class-features",
  spellSupplements: "enhanced-links-spell-supplements",
};

const TEMPLATES = {
  classFeatures: `modules/${MODULE_ID}/src/templates/link-tab-class-features.hbs`,
  spellSupplements: `modules/${MODULE_ID}/src/templates/link-tab-spell-supplements.hbs`,
};

// Spell-supplement routing modes.
export const MODE = { class: "class", spelllike: "spelllike" };

// v13 relocated these behind foundry.applications.handlebars; fall back to the
// (deprecated) globals so this keeps working if the namespace shifts again.
const renderTpl = foundry.applications?.handlebars?.renderTemplate ?? renderTemplate;
const loadTpls = foundry.applications?.handlebars?.loadTemplates ?? loadTemplates;

// ─── Init ─────────────────────────────────────────────────────────────────────

Hooks.once("init", () => {
  loadTpls(Object.values(TEMPLATES));
  console.log(LOG, "initialized");
});

// ─── Flag accessors ─────────────────────────────────────────────────────────────

/** Class-feature links configured on an item. Always a fresh array. */
export function getClassFeatures(item) {
  const raw = item.getFlag(MODULE_ID, FLAG.classFeatures);
  return Array.isArray(raw) ? foundry.utils.deepClone(raw) : [];
}

/** Spell-supplement config on an item, normalized with sane defaults. */
export function getSpellSupplements(item) {
  const raw = item.getFlag(MODULE_ID, FLAG.spellSupplements) ?? {};
  return {
    mode: raw.mode === MODE.spelllike ? MODE.spelllike : MODE.class,
    gated: raw.gated === true,
    items: Array.isArray(raw.items) ? foundry.utils.deepClone(raw.items) : [],
  };
}

function setClassFeatures(item, list) {
  return item.setFlag(MODULE_ID, FLAG.classFeatures, list);
}

function setSpellSupplements(item, data) {
  return item.setFlag(MODULE_ID, FLAG.spellSupplements, data);
}

// ─── Associated class & applicability ───────────────────────────────────────────

/**
 * The item's associated class tag, or null. Read straight from system.class —
 * the same field the system uses to bind class features and spells to a class.
 */
export function getAssociatedClass(item) {
  const tag = item.system?.class;
  return typeof tag === "string" && tag.length ? tag : null;
}

/**
 * Whether this item type's on-actor copy can carry an associated class.
 *
 * IMPORTANT: system.class is populated at grant/drop time on the ACTOR (see the
 * system's item-class._onLevelChange and actor-sheet drop handling) — it is NOT
 * present on a bare compendium/world definition, which is exactly where these
 * tabs are authored. So tab visibility and the class-mode option key on item
 * TYPE; the actual class tag is resolved later by the engine from the on-actor
 * copy via getAssociatedClass(). Feats are the class-feature case.
 */
function canClassAssociate(item) {
  return item.type === "feat";
}

/** Whether this item type can host links (has the system's links template). */
function hasLinks(item) {
  return foundry.utils.hasProperty(item.system ?? {}, "links");
}

// Class Features apply to items that can be tied to a class (feats). Class items
// themselves already have the system's native class associations.
function appliesClassFeatures(item) {
  return canClassAssociate(item);
}

// Spell Supplements apply anywhere links do; the spell-like mode needs no class,
// which is what lets races / templates carry innate casting.
function appliesSpellSupplements(item) {
  return hasLinks(item);
}

// ─── DOM helpers ────────────────────────────────────────────────────────────────

/** Parse the first element out of a rendered template string. */
function htmlToElement(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Extract drop payload from a drag event. Returns null on malformed data. */
function getDropData(event) {
  try {
    return JSON.parse(event.dataTransfer.getData("text/plain"));
  } catch (err) {
    return null;
  }
}

/**
 * Resolve stored link entries into display rows (name, image, broken flag) and
 * stamp each with its source index for edit/remove wiring.
 */
async function resolveEntries(list) {
  const rows = [];
  for (let index = 0; index < list.length; index++) {
    const entry = list[index];
    const doc = await fromUuid(entry.uuid).catch(() => null);
    rows.push({
      uuid: entry.uuid,
      level: Number.isFinite(entry.level) ? entry.level : 1,
      index,
      name: doc?.name ?? entry.uuid,
      img: doc?.img ?? "icons/svg/item-bag.svg",
      broken: !doc,
    });
  }
  return rows;
}

/** Add a nav entry to the links tab bar and return it. */
function addNavTab(nav, tabId, label) {
  const a = document.createElement("a");
  a.className = "item enhanced-links-nav";
  a.dataset.tab = tabId;
  a.dataset.group = "links";
  a.textContent = label;
  nav.appendChild(a);
  return a;
}

// ─── Sheet injection ────────────────────────────────────────────────────────────

Hooks.on("renderItemSheetPF", async (app, html, data) => {
  const item = app.item;
  if (!item) return;

  const el = html?.[0] ?? html; // V1 hands us jQuery; be tolerant either way.
  const nav = el.querySelector("nav.tabs[data-group='links']");
  const body = el.querySelector("section.links-body");
  if (!nav || !body) return; // Item type without a links tab.

  const editable = app.isEditable;

  if (appliesClassFeatures(item)) {
    await injectClassFeaturesTab({ item, nav, body, editable });
  }
  if (appliesSpellSupplements(item)) {
    await injectSpellSupplementsTab({ item, nav, body, editable });
  }
});

async function injectClassFeaturesTab({ item, nav, body, editable }) {
  // Idempotent: clear any prior injection before re-adding.
  nav.querySelector(`a[data-tab="${TAB.classFeatures}"]`)?.remove();
  body.querySelector(`.tab[data-tab="${TAB.classFeatures}"]`)?.remove();

  addNavTab(nav, TAB.classFeatures, game.i18n.localize("PF1EL.Tab.ClassFeatures"));

  const content = await renderTpl(TEMPLATES.classFeatures, {
    tabId: TAB.classFeatures,
    help: game.i18n.localize("PF1EL.Help.ClassFeatures"),
    editable,
    items: await resolveEntries(getClassFeatures(item)),
  });

  const panel = htmlToElement(content);
  body.appendChild(panel);
  wireTab({ item, panel, editable, kind: "classFeatures" });
}

async function injectSpellSupplementsTab({ item, nav, body, editable }) {
  nav.querySelector(`a[data-tab="${TAB.spellSupplements}"]`)?.remove();
  body.querySelector(`.tab[data-tab="${TAB.spellSupplements}"]`)?.remove();

  addNavTab(nav, TAB.spellSupplements, game.i18n.localize("PF1EL.Tab.SpellSupplements"));

  const cfg = getSpellSupplements(item);
  const canClass = canClassAssociate(item);
  // Class Spellcasting is only selectable where the item can be class-tied;
  // otherwise fall back to displaying spell-like regardless of the stored value.
  const effectiveMode = canClass ? cfg.mode : MODE.spelllike;
  const content = await renderTpl(TEMPLATES.spellSupplements, {
    tabId: TAB.spellSupplements,
    help: game.i18n.localize("PF1EL.Help.SpellSupplements"),
    editable,
    canClass,
    gated: cfg.gated,
    isClassMode: effectiveMode === MODE.class,
    isSpelllikeMode: effectiveMode === MODE.spelllike,
    items: await resolveEntries(cfg.items),
  });

  const panel = htmlToElement(content);
  body.appendChild(panel);
  wireTab({ item, panel, editable, kind: "spellSupplements" });
}

// ─── Event wiring ───────────────────────────────────────────────────────────────

function wireTab({ item, panel, editable, kind }) {
  if (editable) {
    // Intercept drops before the system's own link-drop handler (which is bound
    // higher up and would try to createItemLink() with our unknown tab id).
    panel.addEventListener("dragover", (ev) => ev.preventDefault(), true);
    panel.addEventListener(
      "drop",
      async (ev) => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        await onDrop({ item, kind, event: ev });
      },
      true
    );
  }

  panel.querySelectorAll("a.delete-link").forEach((a) =>
    a.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await removeEntry({ item, kind, index: Number(ev.currentTarget.dataset.index) });
    })
  );

  panel.querySelectorAll("input.el-level").forEach((input) =>
    input.addEventListener("change", async (ev) => {
      const index = Number(ev.currentTarget.dataset.index);
      const level = Math.max(0, Math.floor(Number(ev.currentTarget.value) || 0));
      await updateEntryLevel({ item, kind, index, level });
    })
  );

  if (kind === "spellSupplements") {
    panel.querySelector("select.el-mode")?.addEventListener("change", async (ev) => {
      const cfg = getSpellSupplements(item);
      cfg.mode = ev.currentTarget.value === MODE.spelllike ? MODE.spelllike : MODE.class;
      await setSpellSupplements(item, cfg);
    });
    panel.querySelector("input.el-gated")?.addEventListener("change", async (ev) => {
      const cfg = getSpellSupplements(item);
      cfg.gated = ev.currentTarget.checked;
      await setSpellSupplements(item, cfg);
    });
  }
}

async function onDrop({ item, kind, event }) {
  const data = getDropData(event);
  if (!data || data.type !== "Item" || !data.uuid) return;

  const doc = await fromUuid(data.uuid).catch(() => null);
  if (!doc) {
    ui.notifications.warn(game.i18n.localize("PF1EL.Warning.BadDrop"));
    return;
  }
  if (doc.uuid === item.uuid) return; // No self-links.

  if (kind === "classFeatures") {
    const list = getClassFeatures(item);
    if (list.some((e) => e.uuid === data.uuid)) return; // No duplicates.
    list.push({ uuid: data.uuid, level: 1 });
    await setClassFeatures(item, list);
  } else {
    if (doc.type !== "spell") {
      ui.notifications.warn(game.i18n.localize("PF1EL.Warning.SpellOnly"));
      return;
    }
    const cfg = getSpellSupplements(item);
    if (cfg.items.some((e) => e.uuid === data.uuid)) return;
    cfg.items.push({ uuid: data.uuid, level: 1 });
    await setSpellSupplements(item, cfg);
  }
}

async function removeEntry({ item, kind, index }) {
  if (!Number.isInteger(index)) return;
  if (kind === "classFeatures") {
    const list = getClassFeatures(item);
    list.splice(index, 1);
    await setClassFeatures(item, list);
  } else {
    const cfg = getSpellSupplements(item);
    cfg.items.splice(index, 1);
    await setSpellSupplements(item, cfg);
  }
}

async function updateEntryLevel({ item, kind, index, level }) {
  if (!Number.isInteger(index)) return;
  if (kind === "classFeatures") {
    const list = getClassFeatures(item);
    if (!list[index]) return;
    list[index].level = level;
    await setClassFeatures(item, list);
  } else {
    const cfg = getSpellSupplements(item);
    if (!cfg.items[index]) return;
    cfg.items[index].level = level;
    await setSpellSupplements(item, cfg);
  }
}

// Exposed for the Phase 2 engine and for console debugging.
globalThis.pf1EnhancedLinks = {
  MODULE_ID,
  getClassFeatures,
  getSpellSupplements,
  getAssociatedClass,
};
