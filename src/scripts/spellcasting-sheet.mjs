/* PF1 Enhanced Links: the Spellcasting section on a feature's Details tab.
 * DESIGN.md § Feature 6. */

import { MODULE_ID, getAssociatedClass } from "./enhanced-links.mjs";
import { makeCollapsible } from "../common/sheet/collapse.mjs";
import {
  BOOK_TYPES,
  CAST_FLAG,
  KINDS,
  PROGRESSIONS,
  SPELL_KINDS,
  WHENS,
  canClassTie,
  className,
  getSpellcasting,
  grantSystemOf,
  grantedBookOf,
  hostsSpellcasting,
  kindLabel,
  modifiedBookOf,
  parseLevels,
  psionicsActive,
  reconcileSpellcasting,
  resetTarget,
  resolveRows,
} from "./spellcasting.mjs";

const LOG = "PF1 Enhanced Links |";
const MARKER = "pf1el-cast";
const ICON = "fa-solid fa-hat-wizard";

/** PF1 Enhanced Spellbooks, which owns slot rules. This section only opens its editor. */
const SPELLBOOKS = "pf1-enhanced-spellbooks";
const spellbooksApi = () => (game.modules.get(SPELLBOOKS)?.active ? game.modules.get(SPELLBOOKS).api ?? null : null);

/** How many slot rules an item carries, or 0 when the other module is absent. */
const slotRuleCount = (item) => spellbooksApi()?.getItemRules?.(item)?.length ?? 0;

const t = (key) => game.i18n.localize(key);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** Save the rows. On an actor, apply them on this client so no GM has to be connected. */
async function saveRows(item, rows) {
  await item.update({ [`flags.${MODULE_ID}.${CAST_FLAG}.advance`]: rows }, { render: false });
  if (item.actor) await reconcileSpellcasting(item.actor);
}

/** Save config keys under the spellcasting flag, then apply as saveRows does. */
async function saveConfig(item, changes) {
  const update = {};
  for (const [key, value] of Object.entries(changes)) update[`flags.${MODULE_ID}.${CAST_FLAG}.${key}`] = value;
  await item.update(update, { render: false });
  if (item.actor) await reconcileSpellcasting(item.actor);
}

const PROGRESSION_LABELS = { high: "PF1.High", med: "PF1.Medium", low: "PF1.Low" };

/** The Modify block: each setting can be left unchanged. */
function modifyMarkup(item, m, editable) {
  const dis = editable ? "" : " disabled";
  const keep = ["", t("PF1EL.Cast.Mod.Keep")];
  const option = ([value, label], current) =>
    `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label)}</option>`;
  const select = (key, entries, current) =>
    `<select data-mod="${key}"${dis}>${[keep, ...entries].map((e) => option(e, current ?? "")).join("")}</select>`;
  const group = (label, control) =>
    `<div class="form-group"><label>${esc(label)}</label><div class="form-fields">${control}</div></div>`;
  const number = (key, value, extra = "") =>
    `<input type="number" data-mod="${key}" value="${value}" step="1"${extra}${dis}>`;

  const actor = item.actor;
  let status = "";
  if (actor) {
    const bookId = modifiedBookOf(actor, item.id);
    const label = bookId ? actor.system?.attributes?.spells?.spellbooks?.[bookId]?.label || bookId : null;
    const line = label ? game.i18n.format("PF1EL.Cast.Mod.Applied", { book: label }) : t("PF1EL.Cast.Mod.NotApplied");
    status = `<p class="notes">${esc(line)}</p>`;
  }

  const types = BOOK_TYPES.map((k) => [k, t(pf1.config.spellcasting.type[k] ?? k)]);
  const progressions = PROGRESSIONS.map((k) => [k, t(PROGRESSION_LABELS[k])]);
  const abilities = Object.entries(pf1.config.abilities).map(([k, label]) => [k, t(label)]);
  const spells = SPELL_KINDS.map((k) => [k, kindLabel(k)]);
  const yesNo = [
    ["true", t("PF1.Yes")],
    ["false", t("PF1.No")],
  ];
  const offset = (key) => number(key, m[key] || "", ' placeholder="0"');

  return `
    <p class="notes">${t("PF1EL.Cast.ModifyHint")}</p>
    ${status}
    ${group(t("PF1.SpellcastingAbility"), select("ability", abilities, m.ability))}
    ${group(t("PF1.Type"), select("type", types, m.type))}
    ${group(t("PF1.Spellcasting.Progression.Label"), select("progression", progressions, m.progression))}
    ${group(t("PF1.Spellcasting.Type.Label"), select("spells", spells, m.spells))}
    ${group(t("PF1.HasCantrips"), select("cantrips", yesNo, m.cantrips === null ? "" : String(m.cantrips)))}
    ${group(t("PF1.DomainSlotValue"), number("domain", m.domain ?? "", ` min="0" placeholder="${esc(keep[1])}"`))}
    ${group(
      t("PF1EL.Cast.Book.List"),
      `<input type="text" data-mod="listTag" value="${esc(m.listTag)}" placeholder="${esc(keep[1])}"${dis}>`
    )}
    <div class="${MARKER}-sub">${t("PF1EL.Cast.Mod.OffsetsTitle")}</div>
    <p class="notes">${t("PF1EL.Cast.Mod.OffsetsHint")}</p>
    ${group(t("PF1.LevelOffset"), offset("clOffset"))}
    ${group(t("PF1.CastPerDay"), offset("castsOffset"))}
    ${group(t("PF1EL.Cast.Mod.Prepared"), offset("preparedOffset"))}`;
}

/** The Grant block: the mode switch, and the book's settings while it is on. */
function grantMarkup(item, cfg, editable) {
  const dis = editable ? "" : " disabled";
  const book = cfg.book;
  const option = ([value, label], current) =>
    `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label)}</option>`;
  const select = (key, entries, current) =>
    `<select data-book="${key}"${dis}>${entries.map((e) => option(e, current)).join("")}</select>`;
  const group = (label, control) =>
    `<div class="form-group"><label>${esc(label)}</label><div class="form-fields">${control}</div></div>`;
  const text = (key, value, placeholder) =>
    `<input type="text" data-book="${key}" value="${esc(value)}" placeholder="${esc(placeholder)}"${dis}>`;
  const number = (key, value, min = "") =>
    `<input type="number" data-book="${key}" value="${value}" step="1" placeholder="0"${min}${dis}>`;

  // Modify changes a class's book, so only class-tied items offer it.
  const modifyOption = canClassTie(item)
    ? `<option value="modify"${cfg.mode === "modify" ? " selected" : ""}>${t("PF1EL.Cast.Mode.modify")}</option>`
    : "";
  const mode = `
    <div class="form-group">
      <label>${t("PF1EL.Cast.Mode.Label")}</label>
      <div class="form-fields">
        <select data-mode${dis}>
          <option value="">${t("PF1.None")}</option>
          <option value="grant"${cfg.mode === "grant" ? " selected" : ""}>${t("PF1EL.Cast.Mode.grant")}</option>
          ${modifyOption}
        </select>
      </div>
    </div>`;
  if (cfg.mode === "modify") return mode + modifyMarkup(item, cfg.modify, editable);
  if (cfg.mode !== "grant") return mode;

  const actor = item.actor;
  const psionic = grantSystemOf(book) === "psionic";
  let status = "";
  if (actor) {
    const bookId = grantedBookOf(actor, item.id, psionic ? "psionic" : "spell");
    const data = psionic
      ? actor.getFlag("pf1-psionics", "manifesters")?.[bookId]
      : actor.system?.attributes?.spells?.spellbooks?.[bookId];
    const label = bookId ? data?.label || data?.name || bookId : null;
    const line = label ? game.i18n.format("PF1EL.Cast.Book.Granted", { book: label }) : t("PF1EL.Cast.Book.NotGranted");
    status = `<p class="notes">${esc(line)}</p>`;
  }

  // A class-tied item may count its class's levels or Hit Dice; others only Hit Dice.
  const sources = [
    ["class", t("PF1EL.Cast.Book.LevelClass")],
    ["hd", t("PF1.HitDie")],
  ];
  const levelSource = canClassTie(item)
    ? group(t("PF1EL.Cast.Book.LevelSource"), select("levelSource", sources, book.levelSource))
    : "";
  const types = BOOK_TYPES.map((k) => [k, t(pf1.config.spellcasting.type[k] ?? k)]);
  const progressions = PROGRESSIONS.map((k) => [k, t(PROGRESSION_LABELS[k])]);
  const abilities = Object.entries(pf1.config.abilities).map(([k, label]) => [k, t(label)]);
  // Psionic is offered while pf1-psionics is on, or already chosen.
  const kinds = psionicsActive() || psionic ? [...SPELL_KINDS, "psionic"] : SPELL_KINDS;
  const spells = kinds.map((k) => [k, kindLabel(k)]);
  // A manifester has no spell list, preparation type, or domain slots.
  const spellOnly = (html) => (psionic ? "" : html);

  return `
    ${mode}
    <p class="notes">${t("PF1EL.Cast.GrantHint")}</p>
    ${status}
    ${group(t("PF1EL.Cast.Book.Name"), text("name", book.name, item.name))}
    ${levelSource}
    ${group(t("PF1.Spellcasting.Type.Label"), select("spells", spells, book.spells))}
    ${spellOnly(`${group(t("PF1EL.Cast.Book.List"), text("listTag", book.listTag, "wizard"))}
    <p class="notes">${t("PF1EL.Cast.Book.ListHint")}</p>
    ${group(t("PF1.Type"), select("type", types, book.type))}`)}
    ${group(t("PF1.Spellcasting.Progression.Label"), select("progression", progressions, book.progression))}
    ${group(t("PF1.SpellcastingAbility"), select("ability", abilities, book.ability))}
    ${spellOnly(group(t("PF1.DomainSlotValue"), number("domain", book.domain, ' min="0"')))}
    ${group(t("PF1.LevelOffset"), number("clOffset", book.clOffset))}
    <div class="form-group">
      <label class="checkbox"><input type="checkbox" data-book="cantrips"${book.cantrips ? " checked" : ""}${dis}/> ${t(
        "PF1.HasCantrips"
      )}</label>
    </div>
    ${spellOnly(spellbooksApi()?.renderBookSettings ? `<div class="${MARKER}-book-settings"></div>` : "")}`;
}

/** The Special slots block: a way into the other module's rule editor. Class-tied items only. */
function slotsMarkup(item) {
  if (!spellbooksApi()?.openRules || !canClassTie(item)) return "";
  const label = game.i18n.format("PF1EL.Cast.Slots.Edit", { count: slotRuleCount(item) });
  // Just the names: the other module's editor has the rest.
  const names = spellbooksApi()?.getItemRuleNames?.(item) ?? [];
  const list = names.length
    ? `<ul class="${MARKER}-rule-names">${names.map((name) => `<li>${esc(name)}</li>`).join("")}</ul>`
    : "";
  return `
    <div class="${MARKER}-sub">${t("PF1EL.Cast.Slots.Title")}</div>
    <p class="notes">${t("PF1EL.Cast.Slots.Hint")}</p>
    ${list}
    <div class="form-group">
      <label>${t("PF1EL.Cast.Slots.Label")}</label>
      <div class="form-fields">
        <button type="button" class="${MARKER}-slots"><i class="fa-solid fa-layer-group"></i> ${esc(label)}</button>
      </div>
    </div>`;
}

function rowMarkup(row, target, { editable, onActor }) {
  const dis = editable ? "" : " disabled";
  const kinds = KINDS.filter((k) => k !== "psionic" || psionicsActive() || row.kind === "psionic")
    .map((k) => `<option value="${k}"${k === row.kind ? " selected" : ""}>${esc(kindLabel(k))}</option>`)
    .join("");
  const whens = WHENS.map(
    (w) => `<option value="${w}"${w === row.when ? " selected" : ""}>${esc(t(`PF1EL.Cast.When.${w}`))}</option>`
  ).join("");

  let targetCell = "";
  if (onActor) {
    const reset =
      target && editable
        ? ` <a class="${MARKER}-reset" data-tooltip="PF1EL.Cast.Reset"><i class="fa-solid fa-rotate-left"></i></a>`
        : "";
    targetCell = target
      ? `<td class="${MARKER}-target">${esc(target.label)}${reset}</td>`
      : `<td class="${MARKER}-target ${MARKER}-open">${esc(t("PF1EL.Cast.Open"))}</td>`;
  }

  const remove = editable
    ? `<a class="${MARKER}-delete" data-tooltip="PF1EL.Cast.Remove"><i class="fa-solid fa-trash"></i></a>`
    : "";

  return `
    <tr data-row="${esc(row.id)}">
      <td><select data-field="kind"${dis}>${kinds}</select></td>
      <td><select data-field="when"${dis}>${whens}</select></td>
      <td><input type="text" class="${MARKER}-levels" data-field="levels" value="${esc(row.levels.join(", "))}"
            placeholder="1, 5, 9"${editable && row.when !== "all" ? "" : " disabled"}></td>
      ${targetCell}
      <td class="${MARKER}-controls">${remove}</td>
    </tr>`;
}

function sectionMarkup(item, editable) {
  const actor = item.actor;
  const resolved = actor ? resolveRows(actor, item) : null;
  const targets = new Map((resolved?.rows ?? []).map((r) => [r.row.id, r.target]));
  const cfg = getSpellcasting(item);
  const rows = cfg.advance;

  const table = rows.length
    ? `
    <table class="${MARKER}-rows">
      <tr>
        <th>${t("PF1EL.Cast.Col.Kind")}</th>
        <th>${t("PF1EL.Cast.Col.When")}</th>
        <th>${t("PF1EL.Cast.Col.Levels")}</th>
        ${actor ? `<th>${t("PF1EL.Cast.Col.Target")}</th>` : ""}
        <th class="${MARKER}-controls"></th>
      </tr>
      ${rows.map((row) => rowMarkup(row, targets.get(row.id), { editable, onActor: !!actor })).join("")}
    </table>`
    : "";

  let noClass = "";
  if (resolved && rows.length && !resolved.live) noClass = `<p class="notes">${t("PF1EL.Cast.NoClassNote")}</p>`;
  else if (resolved?.rows.some((r) => r.ownOnly)) {
    const note = game.i18n.format("PF1EL.Cast.OwnClassNote", { class: className(actor, resolved.tag) });
    noClass = `<p class="notes">${esc(note)}</p>`;
  }
  const add = editable
    ? `<a class="${MARKER}-add"><i class="fa-solid fa-plus"></i> ${t("PF1EL.Cast.Add")}</a>`
    : "";

  // Advance takes levels from a class, so only class-tied items offer it.
  const advance = canClassTie(item)
    ? `
    <div class="${MARKER}-sub">${t("PF1EL.Cast.AdvanceTitle")}</div>
    <p class="notes">${t("PF1EL.Cast.Hint")}</p>
    ${noClass}
    ${table}
    ${add}`
    : "";

  return `
<div class="${MARKER}">
  <h3 class="form-header ${MARKER}-header"><i class="${ICON}"></i> ${t("PF1EL.Cast.Title")}</h3>
  <div class="${MARKER}-body">
    ${grantMarkup(item, cfg, editable)}
    ${slotsMarkup(item)}
    ${advance}
  </div>
</div>`;
}

/** What the section holds, for its header badge. */
function badgeText(cfg, slotRules = 0) {
  const parts = [];
  if (cfg.mode === "grant") parts.push(t("PF1EL.Cast.Badge.Book"));
  if (cfg.mode === "modify") parts.push(t("PF1EL.Cast.Badge.Modify"));
  if (slotRules) parts.push(t("PF1EL.Cast.Badge.Slots"));
  if (cfg.advance.length) parts.push(cfg.advance.length);
  return parts.join(", ");
}

/** Draw the section, replacing `old` in place when given. */
function draw(app, tab, old = null) {
  const item = app.item;
  const editable = app.isEditable;
  const cfg = getSpellcasting(item);
  const slotRules = slotRuleCount(item);
  const configured = !!cfg.mode || cfg.advance.length > 0 || slotRules > 0;
  // Nothing to show on a sheet that can't be edited.
  if (!editable && !configured) return void old?.remove();

  const holder = document.createElement("div");
  holder.innerHTML = sectionMarkup(item, editable);
  const section = holder.firstElementChild;

  if (old) old.replaceWith(section);
  else {
    // Above the tab's closing "Advanced" block.
    const anchor = [...tab.querySelectorAll(":scope > h3.form-header")].at(-1);
    if (anchor) anchor.before(section);
    else tab.append(section);
  }

  const redraw = () => draw(app, tab, section);
  const rowOf = (el) => el.closest("tr[data-row]")?.dataset.row;
  const edit = async (rowId, change) => {
    const rows = getSpellcasting(item).advance;
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    change(row);
    await saveRows(item, rows);
  };

  // The Spellbook settings are the other module's: it draws and saves them. Its DESIGN § 26.
  const bookSettings = section.querySelector(`.${MARKER}-book-settings`);
  if (bookSettings) {
    const book = getSpellcasting(item).book;
    const tag = book.levelSource === "hd" ? "_hd" : getAssociatedClass(item) ?? "";
    spellbooksApi()?.renderBookSettings(item, bookSettings, { editable, tag });
  }

  section.querySelector(`.${MARKER}-slots`)?.addEventListener("click", (ev) => {
    ev.preventDefault();
    spellbooksApi()?.openRules(item);
  });

  section.querySelector(`.${MARKER}-add`)?.addEventListener("click", async (ev) => {
    ev.preventDefault();
    const rows = getSpellcasting(item).advance;
    rows.push({ id: foundry.utils.randomID(8), kind: "arcane", when: "all", levels: [] });
    await saveRows(item, rows);
    redraw();
  });

  for (const a of section.querySelectorAll(`.${MARKER}-delete`)) {
    a.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const rowId = rowOf(ev.currentTarget);
      await saveRows(
        item,
        getSpellcasting(item).advance.filter((r) => r.id !== rowId)
      );
      redraw();
    });
  }

  for (const a of section.querySelectorAll(`.${MARKER}-reset`)) {
    a.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await resetTarget(item, rowOf(ev.currentTarget));
      // A reset that changed nothing on the item leaves the sheet as it was.
      if (section.isConnected) redraw();
    });
  }

  section.querySelector("[data-mode]")?.addEventListener("change", async (ev) => {
    ev.stopPropagation();
    await saveConfig(item, { mode: ev.currentTarget.value || null });
    if (section.isConnected) redraw();
  });

  for (const el of section.querySelectorAll("[data-mod]")) {
    el.addEventListener("change", async (ev) => {
      ev.stopPropagation();
      const key = el.dataset.mod;
      // Blank means "leave this setting alone".
      let value = el.value.trim();
      if (key === "cantrips") value = value === "" ? null : value === "true";
      else if (key === "domain") value = value === "" ? null : Math.max(0, Math.floor(Number(value) || 0));
      else if (el.type === "number") value = Math.floor(Number(value) || 0);
      else if (el.tagName === "SELECT") value = value || null;
      await saveConfig(item, { [`modify.${key}`]: value });
    });
  }

  for (const el of section.querySelectorAll("[data-book]")) {
    el.addEventListener("change", async (ev) => {
      ev.stopPropagation();
      const value = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) || 0 : el.value.trim();
      await saveConfig(item, { [`book.${el.dataset.book}`]: value });
      // Psionic shows a different set of fields.
      if (el.dataset.book === "spells" && section.isConnected) redraw();
    });
  }

  // The sheet submits on change; these controls save themselves.
  for (const el of section.querySelectorAll("[data-field]")) {
    el.addEventListener("change", async (ev) => {
      ev.stopPropagation();
      const field = el.dataset.field;
      const tr = el.closest("tr[data-row]");
      await edit(tr.dataset.row, (row) => (row[field] = field === "levels" ? parseLevels(el.value) : el.value));
      // Show the stored form: the level list is normalized, and "every level" has none to edit.
      const stored = getSpellcasting(item).advance.find((r) => r.id === tr.dataset.row);
      const levels = tr.querySelector('[data-field="levels"]');
      if (!stored || !levels) return;
      levels.value = stored.levels.join(", ");
      levels.disabled = !editable || stored.when === "all";
    });
  }

  makeCollapsible(app, section, {
    key: "spellcasting",
    marker: MARKER,
    configured,
    badge: badgeText(cfg, slotRules),
    title: t("PF1EL.Cast.Toggle"),
  });
}

Hooks.on("renderItemSheetPF", (app, html) => {
  const item = app.item;
  if (!item || !hostsSpellcasting(item)) return;
  try {
    const root = html?.[0] ?? html;
    const tab = root.querySelector('.tab[data-tab="details"]');
    if (!tab) return;
    tab.querySelector(`:scope > .${MARKER}`)?.remove();
    draw(app, tab);
  } catch (err) {
    console.error(LOG, "spellcasting section failed", err);
  }
});

// Class sheets. Spellcasting is set on a class feature, so a class without its own
// keeps PF1's and pf1-psionics' casting sections hidden (CSS, since pf1-psionics
// draws its section after this hook). DESIGN.md § Feature 6 › Class spellcasting.
Hooks.on("renderItemSheetPF", (app, html) => {
  const item = app.item;
  if (item?.type !== "class") return;
  try {
    const root = html?.[0] ?? html;
    const casts = !!item.system?.casting?.type;
    root.classList.toggle(`${MARKER}-nocast`, !casts);
    root.classList.toggle(`${MARKER}-nomanifest`, !item.system?.manifesting?.progression);
    if (casts && !root.querySelector(`.${MARKER}-class-note`)) {
      root
        .querySelector(".spellcasting-type")
        ?.insertAdjacentHTML("afterend", `<p class="notes ${MARKER}-class-note">${esc(t("PF1EL.Cast.ClassNotice"))}</p>`);
    }
  } catch (err) {
    console.error(LOG, "class sheet spellcasting failed", err);
  }
});
