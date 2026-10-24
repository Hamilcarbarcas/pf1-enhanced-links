/* PF1 Enhanced Links: the Selections section on a feature's Details tab.
 * DESIGN.md § Feature 7. */

import { MODULE_ID } from "./enhanced-links.mjs";
import { makeCollapsible, setBadge } from "../common/sheet/collapse.mjs";
import {
  GRANT_AS,
  KEEP_FLAG,
  OPTION_FLAG,
  ROLE_FLAG,
  ROWS_FLAG,
  getOption,
  getRole,
  getSelections,
  grantedItem,
  grantsPicks,
  grantsSpells,
  hasOptionRules,
  hostsSelections,
  isDormant,
  keepsPlace,
  openSlots,
  pickedFor,
  resetPick,
  resolveSync,
  ruleCount,
  slotsOf,
  vocabulary,
} from "./selections.mjs";
import { openPicker } from "./selections-picker.mjs";

const LOG = "PF1 Enhanced Links |";
const MARKER = "pf1el-sel";
const ICON = "fa-solid fa-list-check";

const t = (key) => game.i18n.localize(key);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** Save keys under the module's flags. The section redraws itself where it needs to. */
function save(item, changes) {
  const update = {};
  for (const [key, value] of Object.entries(changes)) update[`flags.${MODULE_ID}.${key}`] = value;
  return item.update(update, { render: false });
}

const newRow = () => ({ id: foundry.utils.randomID(8), label: "", tags: [], list: [], levelClass: "", count: 1, grantAs: "" });

// Fields saved as numbers, as checkboxes, or as a spell level where blank takes the default.
const NUMBER_FIELDS = { count: 1, perDay: 0 };
const CHECK_FIELDS = ["domain", "bonusKnown"];
const SPELL_LEVEL_FIELDS = { spellMin: 0, spellMax: 9 };

/** A stored uuid as a link to its item, a folder name, or a struck-out uuid when it is gone. */
function entryMarkup(uuid) {
  const doc = resolveSync(uuid);
  if (!doc) return `<span class="${MARKER}-broken" data-tooltip="PF1EL.Warning.SourceMissing">${esc(uuid)}</span>`;
  if (doc.documentName === "Folder") return `<span><i class="fa-solid fa-folder"></i> ${esc(doc.name)}</span>`;
  return `<a class="content-link" data-link data-uuid="${esc(uuid)}" data-type="Item"><i class="fa-solid fa-suitcase"></i>${esc(
    doc.name
  )}</a>`;
}

/** A list of stored uuids with a drop area under it. `kind` names the list for the handlers. */
function dropListMarkup(uuids, kind, dropHint, editable) {
  const remove = editable
    ? `<a class="${MARKER}-unlist" data-tooltip="PF1EL.Sel.Remove"><i class="fa-solid fa-trash"></i></a>`
    : "";
  const items = uuids.map((uuid) => `<li data-uuid="${esc(uuid)}">${entryMarkup(uuid)}${remove}</li>`).join("");
  const drop = editable ? `<div class="${MARKER}-drop">${esc(t(dropHint))}</div>` : "";
  return `<div class="${MARKER}-droplist" data-kind="${kind}"><ul class="${MARKER}-list">${items}</ul>${drop}</div>`;
}

/** A link to an item, by document. */
const itemLink = (doc) =>
  `<a class="content-link" data-link data-uuid="${esc(doc.uuid)}" data-type="Item"><i class="fa-solid fa-suitcase"></i>${esc(doc.name)}</a>`;

/** On an actor: a row's picks, each with a reset, and a Choose control while one is open. */
function picksMarkup(item, row, editable) {
  const slot = slotsOf(item).find((s) => s.row.id === row.id);
  if (!item.actor || !slot) return "";
  const reset = editable
    ? `<a class="${MARKER}-reset" data-tooltip="PF1EL.Sel.Reset"><i class="fa-solid fa-rotate-left"></i></a>`
    : "";
  const picks = slot.picks
    .map((uuid, index) => {
      // The item on the actor once granted; until then, the option it will be made from.
      const granted = grantedItem(item, uuid);
      return `<li data-pick="${index}">${granted ? itemLink(granted) : entryMarkup(uuid)}${reset}</li>`;
    })
    .join("");
  const open =
    slot.open > 0
      ? `<li class="${MARKER}-open"><span>${esc(game.i18n.format("PF1EL.Sel.Open", { n: slot.open }))}</span>${
          item.isOwner ? `<a class="${MARKER}-choose"><i class="fa-solid fa-hand-pointer"></i> ${t("PF1EL.Sel.Choose")}</a>` : ""
        }</li>`
      : "";
  return `<ul class="${MARKER}-list ${MARKER}-picks">${picks}${open}</ul>`;
}

const group = (label, control, tooltip = "") =>
  `<div class="form-group"><label${tooltip ? ` data-tooltip="${tooltip}"` : ""}>${esc(t(label))}</label><div class="form-fields">${control}</div></div>`;

/** How a row grants a picked spell, and the spell controls for that. DESIGN.md § Spell picks. */
function spellMarkup(row, { editable, spellList, cell }) {
  const dis = editable ? "" : " disabled";
  const modes = [
    [GRANT_AS.asIs, "PF1EL.Sel.GrantAs.asIs"],
    [GRANT_AS.spelllike, "PF1EL.Sel.GrantAs.spelllike"],
    [GRANT_AS.class, "PF1EL.Sel.GrantAs.class"],
  ]
    .map(([v, key]) => `<option value="${v}"${v === row.grantAs ? " selected" : ""}>${esc(t(key))}</option>`)
    .join("");
  const grantAs = cell("PF1EL.Sel.GrantAs.Label", `<select data-field="grantAs"${dis}>${modes}</select>`, "PF1EL.Sel.GrantAs.Hint");
  if (!grantsSpells(row)) return `<div class="${MARKER}-line ${MARKER}-spell">${grantAs}</div>`;

  const check = (field, label, hint) =>
    `<label class="checkbox ${MARKER}-check" data-tooltip="${hint}"><input type="checkbox" data-field="${field}"${
      row[field] ? " checked" : ""
    }${dis}/> ${esc(t(label))}</label>`;
  const settings =
    row.grantAs === GRANT_AS.spelllike
      ? cell("PF1EL.Field.PerDay", `<input type="number" data-field="perDay" value="${row.perDay}" min="0" step="1"${dis}>`, "PF1EL.PerDayHint")
      : `<div class="${MARKER}-checks">${check("domain", "PF1EL.Domain.Label", "PF1EL.Domain.Hint")}${check(
          "bonusKnown",
          "PF1EL.BonusKnown.Label",
          "PF1EL.BonusKnown.Hint"
        )}</div>`;

  const unlist = editable
    ? ` <a class="${MARKER}-unspell" data-tooltip="PF1EL.Sel.Remove"><i class="fa-solid fa-xmark"></i></a>`
    : "";
  const chips = row.spellLists
    .map((tag) => `<span class="${MARKER}-chip" data-spell-list="${esc(tag)}">${esc(tag)}${unlist}</span>`)
    .join("");
  const entry = editable
    ? `<input type="text" class="${MARKER}-spell-entry" list="${spellList}" placeholder="${esc(t("PF1EL.Sel.AddSpellList"))}">`
    : "";
  const levels = `<span class="${MARKER}-levels">
      <input type="number" data-field="spellMin" value="${row.spellMin}" min="0" max="9" step="1"${dis}>
      <span>–</span>
      <input type="number" data-field="spellMax" value="${row.spellMax}" min="0" max="9" step="1"${dis}>
    </span>`;

  return `
      <div class="${MARKER}-line ${MARKER}-spell">${grantAs}${settings}</div>
      <div class="${MARKER}-spell-lists" data-tooltip="PF1EL.Sel.SpellListHint">
        <div class="${MARKER}-tags">${chips}${entry}</div>
        ${cell("PF1EL.Sel.SpellLevels", levels)}
      </div>`;
}

function rowMarkup(item, row, { editable, tagList, spellList }) {
  const dis = editable ? "" : " disabled";
  const untag = editable
    ? ` <a class="${MARKER}-untag" data-tooltip="PF1EL.Sel.Remove"><i class="fa-solid fa-xmark"></i></a>`
    : "";
  const chips = row.tags
    .map((tag) => `<span class="${MARKER}-chip" data-tag="${esc(tag)}">${esc(tag)}${untag}</span>`)
    .join("");
  const entry = editable
    ? `<input type="text" class="${MARKER}-tag-entry" list="${tagList}" placeholder="${esc(t("PF1EL.Sel.AddTag"))}">`
    : "";
  const remove = editable
    ? `<a class="${MARKER}-delete" data-tooltip="PF1EL.Sel.RemoveRow"><i class="fa-solid fa-trash"></i></a>`
    : "";
  const cell = (label, control, tooltip = "") =>
    `<label class="${MARKER}-cell"${tooltip ? ` data-tooltip="${tooltip}"` : ""}><span>${esc(t(label))}</span>${control}</label>`;

  return `
    <div class="${MARKER}-row" data-row="${esc(row.id)}">
      <div class="${MARKER}-tagline">
        <div class="${MARKER}-tags">${chips}${entry}</div>
        ${remove}
      </div>
      <div class="${MARKER}-line">
        ${cell("PF1EL.Sel.Picks", `<input type="number" data-field="count" value="${row.count}" min="1" step="1"${dis}>`)}
        ${cell(
          "PF1EL.Sel.Heading",
          `<input type="text" data-field="label" value="${esc(row.label)}" placeholder="${esc(item.name)}"${dis}>`
        )}
        ${cell(
          "PF1EL.Sel.Class",
          `<input type="text" data-field="levelClass" value="${esc(row.levelClass)}" placeholder="${esc(
            t("PF1EL.Sel.ClassBlank")
          )}"${dis}>`,
          "PF1EL.Sel.ClassHint"
        )}
      </div>
      ${spellMarkup(row, { editable, spellList, cell })}
      ${dropListMarkup(row.list, "list", "PF1EL.Sel.DropListed", editable)}
      ${picksMarkup(item, row, editable)}
    </div>`;
}

function grantMarkup(item, { editable, tagList }) {
  const rows = getSelections(item);
  const add = editable ? `<a class="${MARKER}-add"><i class="fa-solid fa-plus"></i> ${t("PF1EL.Sel.AddRow")}</a>` : "";
  const words = vocabulary();
  const asOptions = (values) => values.map((v) => `<option value="${esc(v)}"></option>`).join("");
  const spellList = `${tagList}-spells`;
  const spellOptions = asOptions(words.spellLists);
  const options = asOptions(words.tags);
  return `
    <p class="notes">${t("PF1EL.Sel.GrantHint")}</p>
    ${rows.map((row) => rowMarkup(item, row, { editable, tagList, spellList })).join("")}
    ${add}
    <div class="form-group">
      <label class="checkbox" data-tooltip="PF1EL.Sel.KeepHint"><input type="checkbox" data-keep${
        keepsPlace(item) ? " checked" : ""
      }${editable ? "" : " disabled"}/> ${t("PF1EL.Sel.Keep")}</label>
    </div>
    <datalist id="${tagList}">${options}</datalist>
    <datalist id="${spellList}">${spellOptions}</datalist>`;
}

function optionMarkup(item, { editable, listId }) {
  const dis = editable ? "" : " disabled";
  const option = getOption(item);
  const words = vocabulary();
  const datalist = (id, values) =>
    `<datalist id="${id}">${values.map((v) => `<option value="${esc(v)}"></option>`).join("")}</datalist>`;
  const branch = option.group
    ? group(
        "PF1EL.Sel.Branch",
        `<input type="text" data-opt="branch" value="${esc(option.branch)}" list="${listId}-branches"${dis}>`,
        "PF1EL.Sel.BranchHint"
      )
    : "";

  return `
    <p class="notes">${t("PF1EL.Sel.OptionHint")}</p>
    ${group(
      "PF1EL.Sel.MinLevel",
      `<input type="number" data-opt="minLevel" value="${option.minLevel ?? ""}" min="1" step="1"${dis}>`
    )}
    ${group("PF1EL.Sel.Requires", dropListMarkup(option.requires, "requires", "PF1EL.Sel.DropRequires", editable))}
    ${group(
      "PF1EL.Sel.Group",
      `<input type="text" data-opt="group" value="${esc(option.group)}" list="${listId}-groups"${dis}>`,
      "PF1EL.Sel.GroupHint"
    )}
    ${branch}
    ${group(
      "PF1EL.Sel.Summary",
      `<input type="text" data-opt="summary" value="${esc(option.summary)}" placeholder="${esc(t("PF1EL.Sel.SummaryBlank"))}"${dis}>`
    )}
    <div class="form-group">
      <label class="checkbox"><input type="checkbox" data-opt="repeatable"${option.repeatable ? " checked" : ""}${dis}/> ${t(
        "PF1EL.Sel.Repeatable"
      )}</label>
    </div>
    ${datalist(`${listId}-groups`, words.groups)}
    ${datalist(`${listId}-branches`, words.branches(option.group))}`;
}

function sectionMarkup(item, { editable, listId }) {
  const role = getRole(item);
  const roles = ["", "grant", "option", "both"]
    .map((r) => `<option value="${r}"${r === role ? " selected" : ""}>${esc(t(r ? `PF1EL.Sel.Role.${r}` : "PF1.None"))}</option>`)
    .join("");
  // With both blocks showing, each gets a heading to tell them apart.
  const sub = (key) => (role === "both" ? `<div class="${MARKER}-sub">${t(key)}</div>` : "");
  // On an actor: the feature this item was picked for, and the way to undo that.
  const from = pickedFor(item);
  const picked = from
    ? `<p class="${MARKER}-from">${esc(t("PF1EL.Sel.PickedFor"))} ${itemLink(from.feature)}${
        editable
          ? ` <a class="${MARKER}-unpick" data-tooltip="PF1EL.Sel.Reset"><i class="fa-solid fa-rotate-left"></i></a>`
          : ""
      }</p>`
    : "";

  return `
<div class="${MARKER}">
  <h3 class="form-header ${MARKER}-header"><i class="${ICON}"></i> ${t("PF1EL.Sel.Title")}</h3>
  <div class="${MARKER}-body">
    ${picked}
    <div class="form-group">
      <label>${t("PF1EL.Sel.Role.Label")}</label>
      <div class="form-fields"><select data-role${editable ? "" : " disabled"}>${roles}</select></div>
    </div>
    ${grantsPicks(item) ? sub("PF1EL.Sel.Role.grant") + grantMarkup(item, { editable, tagList: `${listId}-tags` }) : ""}
    ${hasOptionRules(item) ? sub("PF1EL.Sel.Role.option") + optionMarkup(item, { editable, listId }) : ""}
  </div>
</div>`;
}

/** What the section holds, for its header badge. */
function badgeText(item) {
  const parts = [];
  if (pickedFor(item)) parts.push(t("PF1EL.Sel.Badge.Picked"));
  if (grantsPicks(item)) parts.push(t("PF1EL.Sel.Badge.Grants"));
  if (hasOptionRules(item)) {
    const rules = ruleCount(getOption(item));
    parts.push(rules ? game.i18n.format("PF1EL.Sel.Badge.Rules", { n: rules }) : t("PF1EL.Sel.Badge.Option"));
  }
  return parts.join(", ");
}

/** The item or folder a drop names, or null with a warning already shown. */
async function droppedDocument(event, item, kind) {
  let data;
  try {
    data = JSON.parse(event.dataTransfer.getData("text/plain"));
  } catch (err) {
    return null;
  }
  const folderOk = kind === "list" && data?.type === "Folder";
  if (!data?.uuid || (data.type !== "Item" && !folderOk)) {
    ui.notifications.warn(t(kind === "list" ? "PF1EL.Sel.Warn.ListedOnly" : "PF1EL.Sel.Warn.RequiresOnly"));
    return null;
  }
  const doc = await fromUuid(data.uuid).catch(() => null);
  // An item on an actor is one character's copy, not something a catalog can point at.
  const usable = doc && !doc.isEmbedded && (doc.documentName === "Item" || doc.type === "Item") && doc.uuid !== item.uuid;
  if (!usable) {
    ui.notifications.warn(t("PF1EL.Warning.BadDrop"));
    return null;
  }
  return doc;
}

/** Draw the section, replacing `old` in place when given. */
function draw(app, tab, old = null, { focusRow = null, focus = "tag" } = {}) {
  const item = app.item;
  const editable = app.isEditable;
  const configured = !!getRole(item) || !!pickedFor(item);
  // Nothing to show on a sheet that can't be edited.
  if (!editable && !configured) return void old?.remove();

  const holder = document.createElement("div");
  holder.innerHTML = sectionMarkup(item, { editable, listId: `${MARKER}-${app.appId}` });
  const section = holder.firstElementChild;

  if (old) old.replaceWith(section);
  else {
    // Above the tab's closing "Advanced" block.
    const anchor = [...tab.querySelectorAll(":scope > h3.form-header")].at(-1);
    if (anchor) anchor.before(section);
    else tab.append(section);
  }

  const redraw = (options) => section.isConnected && draw(app, tab, section, options);
  const rowOf = (el) => el.closest("[data-row]")?.dataset.row;
  const editRow = async (rowId, change) => {
    const rows = getSelections(item);
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    change(row);
    await save(item, { [ROWS_FLAG]: rows });
  };
  // A stored list: a row's listed options, or the option's requirements.
  const editList = async (el, change) => {
    const kind = el.closest("[data-kind]")?.dataset.kind;
    if (kind === "list") return editRow(rowOf(el), (row) => (row.list = change(row.list)));
    if (kind === "requires") return save(item, { [`${OPTION_FLAG}.requires`]: change(getOption(item).requires) });
  };

  section.querySelector("[data-role]")?.addEventListener("change", async (ev) => {
    ev.stopPropagation();
    const role = ev.currentTarget.value || null;
    const changes = { [ROLE_FLAG]: role };
    // A granting feature with no rows has nothing to edit yet.
    if (["grant", "both"].includes(role) && !getSelections(item).length) changes[ROWS_FLAG] = [newRow()];
    await save(item, changes);
    redraw();
  });

  section.querySelector(`.${MARKER}-add`)?.addEventListener("click", async (ev) => {
    ev.preventDefault();
    await save(item, { [ROWS_FLAG]: [...getSelections(item), newRow()] });
    redraw();
  });

  for (const a of section.querySelectorAll(`.${MARKER}-delete`)) {
    a.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const rowId = rowOf(ev.currentTarget);
      await save(item, { [ROWS_FLAG]: getSelections(item).filter((r) => r.id !== rowId) });
      redraw();
    });
  }

  // The sheet submits on change; these controls save themselves.
  for (const el of section.querySelectorAll("[data-field]")) {
    el.addEventListener("change", async (ev) => {
      ev.stopPropagation();
      const field = el.dataset.field;
      let value;
      if (field in NUMBER_FIELDS) {
        const min = NUMBER_FIELDS[field];
        const n = Math.floor(Number(el.value));
        value = Number.isFinite(n) ? Math.max(min, n) : Math.max(min, 1);
      } else if (field in SPELL_LEVEL_FIELDS) {
        const n = Math.floor(Number(el.value));
        value = el.value === "" || !Number.isFinite(n) ? SPELL_LEVEL_FIELDS[field] : Math.clamp(n, 0, 9);
      } else if (CHECK_FIELDS.includes(field)) value = el.checked;
      else value = el.value.trim();
      await editRow(rowOf(el), (row) => (row[field] = value));
      // Grant as changes which controls show; a level range may have been reordered.
      if (field === "grantAs" || field in SPELL_LEVEL_FIELDS) return void redraw();
      if (!CHECK_FIELDS.includes(field)) el.value = value;
    });
  }

  for (const el of section.querySelectorAll(`.${MARKER}-spell-entry`)) {
    const add = async () => {
      const tag = el.value.trim();
      if (!tag || el.dataset.saving) return;
      el.dataset.saving = "1";
      const rowId = rowOf(el);
      await editRow(rowId, (row) => (row.spellLists = [...new Set([...row.spellLists, tag])]));
      redraw({ focusRow: rowId, focus: "spell" });
    };
    el.addEventListener("change", (ev) => {
      ev.stopPropagation();
      add();
    });
    el.addEventListener("input", (ev) => {
      if (ev.inputType === "insertReplacementText") add();
    });
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      add();
    });
  }

  for (const a of section.querySelectorAll(`.${MARKER}-unspell`)) {
    a.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const tag = ev.currentTarget.closest("[data-spell-list]")?.dataset.spellList;
      await editRow(rowOf(ev.currentTarget), (row) => (row.spellLists = row.spellLists.filter((x) => x !== tag)));
      redraw();
    });
  }

  for (const el of section.querySelectorAll(`.${MARKER}-tag-entry`)) {
    const add = async () => {
      const tag = el.value.trim();
      // Enter and the change it causes both arrive here.
      if (!tag || el.dataset.saving) return;
      el.dataset.saving = "1";
      const rowId = rowOf(el);
      await editRow(rowId, (row) => (row.tags = [...new Set([...row.tags, tag])]));
      redraw({ focusRow: rowId });
    };
    el.addEventListener("change", (ev) => {
      ev.stopPropagation();
      add();
    });
    // Picking a suggestion adds it without a further keypress.
    el.addEventListener("input", (ev) => {
      if (ev.inputType === "insertReplacementText") add();
    });
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      // Enter would submit the sheet's form.
      ev.preventDefault();
      add();
    });
  }

  for (const a of section.querySelectorAll(`.${MARKER}-untag`)) {
    a.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const tag = ev.currentTarget.closest("[data-tag]")?.dataset.tag;
      await editRow(rowOf(ev.currentTarget), (row) => (row.tags = row.tags.filter((x) => x !== tag)));
      redraw();
    });
  }

  for (const zone of section.querySelectorAll(`.${MARKER}-drop`)) {
    zone.addEventListener("dragover", (ev) => ev.preventDefault());
    zone.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      // The sheet's own drop handling would try to link the item.
      ev.stopPropagation();
      const kind = zone.closest("[data-kind]")?.dataset.kind;
      const doc = await droppedDocument(ev, item, kind);
      if (!doc) return;
      await editList(zone, (list) => [...new Set([...list, doc.uuid])]);
      redraw();
    });
  }

  for (const a of section.querySelectorAll(`.${MARKER}-unlist`)) {
    a.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const uuid = ev.currentTarget.closest("[data-uuid]")?.dataset.uuid;
      await editList(ev.currentTarget, (list) => list.filter((x) => x !== uuid));
      redraw();
    });
  }

  for (const el of section.querySelectorAll("[data-opt]")) {
    el.addEventListener("change", async (ev) => {
      ev.stopPropagation();
      const key = el.dataset.opt;
      let value = el.type === "checkbox" ? el.checked : el.value.trim();
      // Blank means no minimum.
      if (key === "minLevel") value = Number(value) > 0 ? Math.floor(Number(value)) : null;
      await save(item, { [`${OPTION_FLAG}.${key}`]: value });
      // Branch only shows beside a group.
      if (key === "group") return void redraw();
      setBadge(section, badgeText(item));
    });
  }

  // Picks are saved with a normal render, so the sheet redraws itself.
  for (const a of section.querySelectorAll(`.${MARKER}-reset`)) {
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      const index = Number(ev.currentTarget.closest("[data-pick]")?.dataset.pick);
      resetPick(item, rowOf(ev.currentTarget), index);
    });
  }

  for (const a of section.querySelectorAll(`.${MARKER}-choose`)) {
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      openPicker(item);
    });
  }

  section.querySelector(`.${MARKER}-unpick`)?.addEventListener("click", (ev) => {
    ev.preventDefault();
    const from = pickedFor(item);
    if (from) resetPick(from.feature, from.rowId, from.index);
  });

  section.querySelector("[data-keep]")?.addEventListener("change", async (ev) => {
    ev.stopPropagation();
    await save(item, { [KEEP_FLAG]: ev.currentTarget.checked });
  });

  makeCollapsible(app, section, {
    key: "selections",
    marker: MARKER,
    configured,
    badge: badgeText(item),
    title: t("PF1EL.Cast.Toggle"),
  });

  if (focusRow) {
    const entry = focus === "spell" ? `${MARKER}-spell-entry` : `${MARKER}-tag-entry`;
    section.querySelector(`[data-row="${focusRow}"] .${entry}`)?.focus();
  }
}

/**
 * Actor sheet rows of granting features: one with a pick to make is colored and gains
 * a Choose tag that opens the picker.
 */
Hooks.on("renderActorSheetPF", (app, html) => {
  const actor = app.actor;
  // Paused for uninstall, a pick would be recorded and never granted.
  if (!actor || isDormant()) return;
  try {
    const root = html?.[0] ?? html;
    for (const item of actor.items) {
      if (!hostsSelections(item)) continue;
      const rows = root.querySelectorAll(`li.item[data-item-id="${item.id}"]`);
      if (!rows.length) continue;
      const open = openSlots(item);
      if (!open) continue;
      for (const row of rows) {
        const name = row.querySelector(".item-name h4");
        if (!name || name.querySelector(`.${MARKER}-tag`)) continue;
        row.classList.add(`${MARKER}-pending`);
        const tag = document.createElement("a");
        tag.className = `${MARKER}-tag`;
        const label = open > 1 ? game.i18n.format("PF1EL.Sel.TagMany", { n: open }) : t("PF1EL.Sel.Choose");
        tag.innerHTML = `<i class="fa-solid fa-hand-pointer"></i> ${esc(label)}`;
        tag.dataset.tooltip = "PF1EL.Sel.TagHint";
        // The name row posts the item to chat on click; the tag only opens the picker.
        tag.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          openPicker(item);
        });
        name.append(tag);
      }
    }
  } catch (err) {
    console.error(LOG, "marking selection rows failed", err);
  }
});

Hooks.on("renderItemSheetPF", (app, html) => {
  const item = app.item;
  if (!item || !hostsSelections(item)) return;
  try {
    const root = html?.[0] ?? html;
    const tab = root.querySelector('.tab[data-tab="details"]');
    if (!tab) return;
    tab.querySelector(`:scope > .${MARKER}`)?.remove();
    draw(app, tab);
  } catch (err) {
    console.error(LOG, "selections section failed", err);
  }
});
