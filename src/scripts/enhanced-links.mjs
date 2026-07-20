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
  archetype: "archetype",
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

// Per-tab metadata, keyed by kind.
const TAB_META = {
  classFeatures: { id: TAB.classFeatures, label: "PF1EL.Tab.ClassFeatures", template: TEMPLATES.classFeatures },
  spellSupplements: { id: TAB.spellSupplements, label: "PF1EL.Tab.SpellSupplements", template: TEMPLATES.spellSupplements },
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

/**
 * Archetype config on a class feature, normalized. When `replaces` is set, the
 * feature suppresses the listed base-class associations (`excluded`, association
 * source uuids). `baseClass` is the class uuid used only to enumerate that list
 * at authoring time; at runtime the actual class is resolved via system.class.
 */
export function getArchetype(item) {
  const raw = item.getFlag(MODULE_ID, FLAG.archetype) ?? {};
  return {
    replaces: raw.replaces === true,
    baseClass: typeof raw.baseClass === "string" && raw.baseClass.length ? raw.baseClass : null,
    excluded: Array.isArray(raw.excluded) ? [...raw.excluded] : [],
  };
}

// Persist with render:false and refresh our own panel in place — a full sheet
// re-render would momentarily flash the links view back to its first tab.
function setClassFeatures(item, list) {
  return item.update({ [`flags.${MODULE_ID}.${FLAG.classFeatures}`]: list }, { render: false });
}

function setSpellSupplements(item, data) {
  return item.update({ [`flags.${MODULE_ID}.${FLAG.spellSupplements}`]: data }, { render: false });
}

function setArchetype(item, data) {
  return item.update({ [`flags.${MODULE_ID}.${FLAG.archetype}`]: data }, { render: false });
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

// Spell Supplements apply anywhere links do — the spell-like mode needs no class,
// which is what lets races / templates carry innate casting — except spells
// themselves, which make no sense as a host and would only add clutter.
function appliesSpellSupplements(item) {
  return hasLinks(item) && item.type !== "spell";
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
      perDay: Number.isFinite(entry.perDay) ? entry.perDay : 0, // 0 = at will (spell-like only)
      index,
      name: doc?.name ?? entry.uuid,
      img: doc?.img ?? "icons/svg/item-bag.svg",
      broken: !doc,
    });
  }
  return rows;
}

/**
 * Best-effort base class for an archetype, derived from the feat's own class
 * association. system.class is a tag, so resolve it through the owning actor to
 * the actual class item and return its compendium source (what the exclusion
 * checklist enumerates from). Returns null off-actor or when no class is tied —
 * the author then drops a base class explicitly.
 */
function deriveBaseClassUuid(item) {
  const tag = getAssociatedClass(item);
  const actor = item.actor;
  if (!tag || !actor) return null;
  const clsId = actor.classes?.[tag]?._id;
  const cls = clsId ? actor.items.get(clsId) : null;
  if (!cls) return null;
  return cls._stats?.compendiumSource ?? cls.uuid;
}

/**
 * Build the archetype template context: the "replaces" toggle, the chosen base
 * class, and its class associations rendered as an exclusion checklist. The base
 * class must be picked explicitly (or pre-filled from the feat's own class
 * association) because system.class is empty at authoring time.
 */
async function resolveArchetype(item) {
  const arch = getArchetype(item);
  const ctx = { replaces: arch.replaces, hasBaseClass: false, baseClassName: null, associations: [] };
  if (!arch.replaces || !arch.baseClass) return ctx;

  const baseClass = await fromUuid(arch.baseClass).catch(() => null);
  if (!baseClass) return ctx;

  ctx.hasBaseClass = true;
  ctx.baseClassName = baseClass.name;

  const assoc = baseClass.system?.links?.classAssociations ?? [];
  ctx.associations = await Promise.all(
    assoc.map(async (a) => {
      const doc = await fromUuid(a.uuid).catch(() => null);
      return {
        uuid: a.uuid,
        level: a.level ?? 1,
        name: doc?.name ?? a.uuid,
        img: doc?.img ?? "icons/svg/item-bag.svg",
        broken: !doc,
        excluded: arch.excluded.includes(a.uuid),
      };
    })
  );
  return ctx;
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
    await injectTab({ item, nav, body, editable, kind: "classFeatures" });
  }
  if (appliesSpellSupplements(item)) {
    await injectTab({ item, nav, body, editable, kind: "spellSupplements" });
  }

  restoreLinksTab(app, nav);
});

/**
 * Keep the active links sub-tab across the re-renders our own edits trigger.
 *
 * The system binds its links tabs during render, before this hook injects our
 * panels — so on a change (which re-renders the whole sheet) it re-activates
 * with our tab still absent and drops the view back to the first tab (charges).
 * We record the last-clicked links tab on the app and, once our panels are in
 * the DOM, re-activate it through the system's own Tabs instance.
 */
function restoreLinksTab(app, nav) {
  nav.addEventListener("click", (ev) => {
    const a = ev.target.closest("a[data-tab][data-group='links']");
    if (a) app._elLinksActive = a.dataset.tab;
  });

  if (app._elLinksActive) {
    const linksTabs = app._tabs?.find((t) => t.group === "links");
    linksTabs?.activate(app._elLinksActive);
  }
}

/** Build the template context for a tab. */
async function buildContext(item, editable, kind) {
  if (kind === "classFeatures") {
    return {
      tabId: TAB.classFeatures,
      help: game.i18n.localize("PF1EL.Help.ClassFeatures"),
      editable,
      items: await resolveEntries(getClassFeatures(item)),
      ...(await resolveArchetype(item)),
    };
  }

  const cfg = getSpellSupplements(item);
  const canClass = canClassAssociate(item);
  // Class Spellcasting is only selectable where the item can be class-tied;
  // otherwise fall back to displaying spell-like regardless of the stored value.
  const effectiveMode = canClass ? cfg.mode : MODE.spelllike;
  return {
    tabId: TAB.spellSupplements,
    help: game.i18n.localize("PF1EL.Help.SpellSupplements"),
    editable,
    canClass,
    gated: cfg.gated,
    isClassMode: effectiveMode === MODE.class,
    isSpelllikeMode: effectiveMode === MODE.spelllike,
    items: await resolveEntries(cfg.items),
  };
}

/** Inject a fresh tab (nav entry + panel) into the links section. */
async function injectTab({ item, nav, body, editable, kind }) {
  const meta = TAB_META[kind];
  // Idempotent: clear any prior injection before re-adding.
  nav.querySelector(`a[data-tab="${meta.id}"]`)?.remove();
  body.querySelector(`.tab[data-tab="${meta.id}"]`)?.remove();

  addNavTab(nav, meta.id, game.i18n.localize(meta.label));

  const panel = htmlToElement(await renderTpl(meta.template, await buildContext(item, editable, kind)));
  body.appendChild(panel);

  if (editable) wirePanelDrop(panel, { item, kind });
  wireControls(panel, { item, editable, kind });
}

/**
 * Re-render a tab's contents in place, without re-rendering the whole sheet. The
 * panel element (and its drop listeners) is kept; only its inner content and the
 * inner control listeners are rebuilt.
 */
async function refreshTab(panel, { item, editable, kind }) {
  const meta = TAB_META[kind];
  const fresh = htmlToElement(await renderTpl(meta.template, await buildContext(item, editable, kind)));
  panel.replaceChildren(...fresh.childNodes);
  wireControls(panel, { item, editable, kind });
}

// ─── Event wiring ───────────────────────────────────────────────────────────────

/** Drop handling, bound once to the panel (survives in-place refreshes). */
function wirePanelDrop(panel, { item, kind }) {
  // Intercept drops before the system's own link-drop handler (which is bound
  // higher up and would try to createItemLink() with our unknown tab id).
  panel.addEventListener("dragover", (ev) => ev.preventDefault(), true);
  panel.addEventListener(
    "drop",
    async (ev) => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      // A drop on the base-class picker sets the archetype's base class;
      // anything else adds a link entry to the current tab.
      const changed =
        kind === "classFeatures" && ev.target.closest(".el-baseclass-drop")
          ? await onBaseClassDrop({ item, event: ev })
          : await onDrop({ item, kind, event: ev });
      if (changed) await refreshTab(panel, { item, editable: true, kind });
    },
    true
  );
}

/** Inner control handlers, re-bound after each in-place refresh. */
function wireControls(panel, ctx) {
  const { item, kind } = ctx;
  const refresh = () => refreshTab(panel, ctx);

  panel.querySelectorAll("a.delete-link").forEach((a) =>
    a.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await removeEntry({ item, kind, index: Number(ev.currentTarget.dataset.index) });
      await refresh(); // a row was removed — structure changed
    })
  );

  // Level edits don't change structure and the input already shows the value, so
  // we persist without refreshing (which would steal focus mid-edit).
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
      await refresh(); // toggles the level column
    });
    // Times/day edits don't change structure — persist without refreshing.
    panel.querySelectorAll("input.el-perday").forEach((input) =>
      input.addEventListener("change", async (ev) => {
        const index = Number(ev.currentTarget.dataset.index);
        const perDay = Math.max(0, Math.floor(Number(ev.currentTarget.value) || 0));
        const cfg = getSpellSupplements(item);
        if (!cfg.items[index]) return;
        cfg.items[index].perDay = perDay;
        await setSpellSupplements(item, cfg);
      })
    );
  }

  if (kind === "classFeatures") {
    panel.querySelector("input.el-replaces")?.addEventListener("change", async (ev) => {
      const arch = getArchetype(item);
      arch.replaces = ev.currentTarget.checked;
      // Pre-fill the base class from the feat's own class association if none is
      // set yet. Still clearable and replaceable via drag-and-drop.
      if (arch.replaces && !arch.baseClass) {
        const derived = deriveBaseClassUuid(item);
        if (derived) arch.baseClass = derived;
      }
      await setArchetype(item, arch);
      await refresh(); // reveals/hides the archetype body
    });
    panel.querySelector("a.el-baseclass-clear")?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const arch = getArchetype(item);
      arch.baseClass = null;
      arch.excluded = [];
      await setArchetype(item, arch);
      await refresh(); // back to the drop prompt
    });
    // Exclusion checkboxes don't change structure — the box already reflects the
    // new state — so persist without a refresh.
    panel.querySelectorAll("input.el-exclude").forEach((chk) =>
      chk.addEventListener("change", async (ev) => {
        const uuid = ev.currentTarget.dataset.uuid;
        const arch = getArchetype(item);
        const set = new Set(arch.excluded);
        if (ev.currentTarget.checked) set.add(uuid);
        else set.delete(uuid);
        arch.excluded = [...set];
        await setArchetype(item, arch);
      })
    );
  }
}

/** @returns {Promise<boolean>} Whether the base class was set. */
async function onBaseClassDrop({ item, event }) {
  const data = getDropData(event);
  if (!data || data.type !== "Item" || !data.uuid) return false;

  const doc = await fromUuid(data.uuid).catch(() => null);
  if (!doc || doc.type !== "class") {
    ui.notifications.warn(game.i18n.localize("PF1EL.Warning.ClassOnly"));
    return false;
  }

  const arch = getArchetype(item);
  arch.baseClass = data.uuid;
  arch.excluded = []; // reset — exclusions are specific to the chosen base class
  await setArchetype(item, arch);
  return true;
}

/** @returns {Promise<boolean>} Whether an entry was added. */
async function onDrop({ item, kind, event }) {
  const data = getDropData(event);
  if (!data || data.type !== "Item" || !data.uuid) return false;

  const doc = await fromUuid(data.uuid).catch(() => null);
  if (!doc) {
    ui.notifications.warn(game.i18n.localize("PF1EL.Warning.BadDrop"));
    return false;
  }
  if (doc.uuid === item.uuid) return false; // No self-links.

  if (kind === "classFeatures") {
    const list = getClassFeatures(item);
    if (list.some((e) => e.uuid === data.uuid)) return false; // No duplicates.
    list.push({ uuid: data.uuid, level: 1 });
    await setClassFeatures(item, list);
  } else {
    if (doc.type !== "spell") {
      ui.notifications.warn(game.i18n.localize("PF1EL.Warning.SpellOnly"));
      return false;
    }
    const cfg = getSpellSupplements(item);
    if (cfg.items.some((e) => e.uuid === data.uuid)) return false;
    cfg.items.push({ uuid: data.uuid, level: 1, perDay: 0 });
    await setSpellSupplements(item, cfg);
  }
  return true;
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
