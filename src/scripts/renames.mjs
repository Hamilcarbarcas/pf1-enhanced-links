/* PF1 Enhanced Links — rename on link
 *
 * A link row can carry a new name; the item that row creates takes it in place of
 * its source's. Class Features, Spell Supplements, and the system's Supplements
 * tab. See DESIGN.md § Feature 8.
 *
 * Storage, on the parent: flags[MODULE_ID].renames = [{ tab, uuid, name }].
 * An array, since a uuid's dots would expand as keys in an update. `tab` is a
 * SCRIPT_TAB key, so (tab, uuid) names a row the way a script category does.
 */

import { MODULE_ID } from "./enhanced-links.mjs";
import { SCRIPT_TAB } from "./create-scripts.mjs";

const RENAMES = "renames";
export const RENAMED_FROM = "renamedFrom"; // on the created item: its name before the rename
const CORE_SUPPLEMENTS_TAB = "supplements";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

function stored(item) {
  const list = item?.getFlag(MODULE_ID, RENAMES);
  return Array.isArray(list) ? list : [];
}

/** The row's new name, or "" when it has none. */
export function renameFor(item, tab, uuid) {
  return stored(item).find((r) => r?.tab === tab && r?.uuid === uuid)?.name?.trim() ?? "";
}

/** Set (or, with an empty name, clear) one row's new name. */
export async function setRename(item, tab, uuid, name) {
  const kept = stored(item).filter((r) => !(r?.tab === tab && r?.uuid === uuid));
  const clean = String(name ?? "").trim();
  if (clean) kept.push({ tab, uuid, name: clean });
  await item.setFlag(MODULE_ID, RENAMES, kept);
}

/** Drop one row's new name, e.g. when the row itself is removed. */
export async function deleteRenameFor(item, tab, uuid) {
  const list = stored(item);
  const kept = list.filter((r) => !(r?.tab === tab && r?.uuid === uuid));
  if (kept.length !== list.length) await item.setFlag(MODULE_ID, RENAMES, kept);
}

/**
 * The fields a rename writes: the name; the original name, for anything that finds
 * items by name (`renamedFrom`); and the tag pinned to the old name's when the type
 * derives an empty tag from its name (`_prepareIdentifier`), so the item's
 * @resources key, dictionary flags and tag matches don't move.
 *
 * @param {object} data - Item source data (or `toObject()`), before the rename.
 * @param {string} name
 * @returns {object} Flat update keys.
 */
export function renameFields(data, name) {
  const out = { name };
  const original = data?.flags?.[MODULE_ID]?.[RENAMED_FROM] || data?.name;
  if (original) out[`flags.${MODULE_ID}.${RENAMED_FROM}`] = original;
  const cls = CONFIG.Item.documentClasses?.[data?.type];
  if (cls?.system?.hasIdentifier && !data?.system?.tag && data?.name) {
    out["system.tag"] = pf1.utils.createTag(data.name);
  }
  return out;
}

/** Apply a row's rename to creation data in place. True when renamed. */
export function applyRename(data, parent, tab, uuid) {
  const name = renameFor(parent, tab, uuid);
  if (!name || name === data?.name) return false;
  for (const [path, value] of Object.entries(renameFields(data, name))) {
    foundry.utils.setProperty(data, path, value);
  }
  return true;
}

// ─── Row control ────────────────────────────────────────────────────────────────

/** A rename button on every row of a links panel, left of the script controls. */
export function decorateRenameRows(panel, { item, kind, editable }) {
  for (const row of panel.querySelectorAll("tr.links-item[data-uuid]")) {
    const uuid = row.dataset.uuid;
    const cell = row.querySelector("td.item-name");
    if (!uuid || !cell) continue;
    cell.querySelector(".el-rename")?.remove();

    const name = renameFor(item, kind, uuid);
    if (!name && !editable) continue;

    const btn = document.createElement("a");
    btn.className = `el-rename${name ? " active" : ""}`;
    btn.dataset.tooltip = name
      ? game.i18n.format("PF1EL.Rename.Set", { name: esc(name) })
      : game.i18n.localize("PF1EL.Rename.Add");
    btn.innerHTML = `<i class="fa-solid fa-i-cursor" inert></i>`;
    const before = cell.querySelector(".el-scripts") ?? cell.querySelector("a.source-item");
    if (before) cell.insertBefore(btn, before);
    else cell.append(btn);

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!editable) return;
      const source = cell.querySelector(".name")?.textContent?.trim() ?? "";
      const next = await promptName(renameFor(item, kind, uuid), source);
      if (next === null) return;
      await setRename(item, kind, uuid, next);
    });
  }
}

/** The new name, "" to clear, or null when cancelled. */
async function promptName(current, source) {
  const { DialogV2 } = foundry.applications.api;
  const value = await DialogV2.prompt({
    window: { title: game.i18n.localize("PF1EL.Rename.Title") },
    content: `<div class="form-group">
        <label>${esc(game.i18n.localize("PF1EL.Rename.Label"))}</label>
        <input type="text" name="newName" value="${esc(current)}" placeholder="${esc(source)}" autofocus>
      </div>
      <p class="hint">${esc(game.i18n.localize("PF1EL.Rename.Hint"))}</p>`,
    ok: {
      label: game.i18n.localize("PF1EL.Rename.Save"),
      callback: (_ev, button) => button.form.elements.newName.value,
    },
    rejectClose: false,
  });
  return typeof value === "string" ? value.trim() : null;
}

// ─── System Supplements tab ─────────────────────────────────────────────────────

Hooks.on("renderItemSheetPF", (app, html) => {
  const item = app.item;
  if (!item) return;
  const el = html?.[0] ?? html;
  const panel = el.querySelector(`section.links-body .tab[data-group="links"][data-tab="${CORE_SUPPLEMENTS_TAB}"]`);
  if (panel) decorateRenameRows(panel, { item, kind: SCRIPT_TAB.supplements, editable: app.isEditable });
});
