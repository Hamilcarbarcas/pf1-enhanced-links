/* PF1 Enhanced Links – starting level and HP on class supplements (DESIGN.md § Feature 12)
 *
 * A Supplements row that links a class can carry a level and an HP formula; the
 * class that row adds arrives at that level, with that HP, instead of the source's
 * own. Use case: racial Hit Dice, where a race supplies its racial class at the
 * number of HD the race has.
 *
 * The level goes into the creation data, so PF1's own create handling grants the
 * class's associations up to it (`_onLevelChange(0, level)`), as for any class
 * created at a level. The HP formula is worked out once, at creation, with
 * @level (the class's level as created) and @hd (its hit die size), and written to
 * the class's plain-number `system.hp`.
 *
 * Storage, on the parent: flags[MODULE_ID].supplementLevels = [{ uuid, level, hp }].
 * An array, since a uuid's dots would expand as keys in an update.
 */

import { MODULE_ID } from "./enhanced-links.mjs";
import { uniform } from "./dedupe.mjs";

const LEVELS = "supplementLevels";
const CORE_SUPPLEMENTS_TAB = "supplements";
const LOG = "PF1 Enhanced Links |";
/** Prefilled on a row with no entry yet: the hit die's average per level (4.5 on a d8). */
const DEFAULT_HP = "@level * (@hd + 1) / 2";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

function stored(item) {
  const list = item?.getFlag?.(MODULE_ID, LEVELS);
  return Array.isArray(list) ? list : [];
}

/** One row's entry on a parent, cleaned: { level, hp } (0 and "" when unset), or null. */
export function entryOf(parent, uuid) {
  const key = uniform(uuid);
  const raw = stored(parent).find((e) => uniform(e?.uuid) === key);
  if (!raw) return null;
  const level = Number(raw.level);
  const entry = {
    level: Number.isInteger(level) && level > 0 ? level : 0,
    hp: typeof raw.hp === "string" ? raw.hp.trim() : raw.hp != null ? String(raw.hp) : "",
  };
  return entry.level || entry.hp ? entry : null;
}

/** Set (or, with nothing in it, clear) one row's entry. */
async function setEntry(parent, uuid, { level, hp }) {
  const key = uniform(uuid);
  const kept = stored(parent).filter((e) => uniform(e?.uuid) !== key);
  if (level > 0 || hp) kept.push({ uuid, level: level > 0 ? level : null, hp: hp || "" });
  await parent.setFlag(MODULE_ID, LEVELS, kept);
}

/**
 * Write the rows' level and HP into class creation data, in place. With several
 * parents linking the same class, the highest level wins, and the HP formula comes
 * from the parent that set it (the highest-level one first).
 *
 * @param {object} data - Class creation data (plain object).
 * @param {Item[]} parents - Items whose Supplements rows link this source.
 * @param {string} uuid - The row's source uuid.
 * @returns {object|null} The fields written, as flat update keys, or null.
 */
export function classSetup(data, parents, uuid) {
  if (data?.type !== "class") return null;
  const entries = parents
    .map((p) => entryOf(p, uuid))
    .filter(Boolean)
    .sort((a, b) => b.level - a.level);
  if (!entries.length) return null;

  const out = {};
  const level = entries[0].level;
  if (level > 0) out["system.level"] = level;

  const formula = entries.find((e) => e.hp)?.hp;
  if (formula) {
    const rollData = { level: level || Number(data.system?.level) || 0, hd: Number(data.system?.hd) || 0 };
    try {
      const hp = pf1.dice.RollPF.safeRollSync(formula, rollData).total;
      if (Number.isFinite(hp)) out["system.hp"] = Math.max(0, Math.floor(hp));
      else console.warn(LOG, "class HP formula gave no number:", formula, rollData);
    } catch (err) {
      console.error(LOG, "class HP formula failed:", formula, err);
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Items on the actor whose Supplements rows link this source. */
export function linkingParents(actor, source) {
  const key = uniform(source);
  return actor.items.filter((p) => (p.system?.links?.supplements ?? []).some((s) => uniform(s.uuid) === key));
}

/** Whether a link row points at a class. Compendium index entries carry `type`. */
function isClassLink(uuid) {
  try {
    return fromUuidSync(uuid, { strict: false })?.type === "class";
  } catch (err) {
    return false;
  }
}

// ─── Arrival through the system ─────────────────────────────────────────────────

// The system's _createSupplements builds the class from its source; set the level
// and HP before it lands, so PF1's own create handling grants associations up to
// that level. Gated rows go through the engine instead (buildSupplement).
Hooks.on("preCreateItem", (doc, _data, options, userId) => {
  if (userId !== game.user.id || options?._pf1NoSupplements !== true || doc.type !== "class") return;
  const actor = doc.parent;
  const source = doc.getFlag("pf1", "source");
  if (!(actor instanceof Actor) || !source) return;
  const setup = classSetup(doc.toObject(), linkingParents(actor, source), source);
  if (setup) doc.updateSource(setup);
});

// ─── Row control ────────────────────────────────────────────────────────────────

/** A level button on every class row of the system's Supplements tab, leftmost of our controls. */
export function decorateLevelRows(panel, { item, editable }) {
  for (const row of panel.querySelectorAll("tr.links-item[data-uuid]")) {
    const uuid = row.dataset.uuid;
    const cell = row.querySelector("td.item-name");
    if (!uuid || !cell) continue;
    cell.querySelector(".el-level")?.remove();

    const entry = entryOf(item, uuid);
    if (!entry && (!editable || !isClassLink(uuid))) continue;

    const btn = document.createElement("a");
    btn.className = `el-level${entry ? " active" : ""}`;
    const parts = [];
    if (entry?.level) parts.push(esc(t("PF1EL.SupplementLevel.SetLevel", { level: entry.level })));
    if (entry?.hp) parts.push(esc(t("PF1EL.SupplementLevel.SetHp", { hp: entry.hp })));
    btn.dataset.tooltip = parts.length ? parts.join("<br>") : esc(t("PF1EL.SupplementLevel.Add"));
    btn.innerHTML = `<i class="fa-solid fa-layer-group" inert></i>${
      entry?.level ? `<span class="el-level-value">${entry.level}</span>` : ""
    }`;
    const before =
      cell.querySelector(".el-prereq") ??
      cell.querySelector(".el-rename") ??
      cell.querySelector(".el-scripts") ??
      cell.querySelector("a.source-item");
    if (before) cell.insertBefore(btn, before);
    else cell.append(btn);

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!editable) return;
      const name = cell.querySelector(".name")?.textContent?.trim() ?? "";
      const next = await promptEntry(entryOf(item, uuid), name);
      if (next === null) return;
      await setEntry(item, uuid, next);
    });
  }
}

/** The edited { level, hp } (empty to clear), or null when cancelled. */
async function promptEntry(current, name) {
  const { DialogV2 } = foundry.applications.api;
  const value = await DialogV2.prompt({
    window: { title: t("PF1EL.SupplementLevel.Title"), icon: "fa-solid fa-layer-group" },
    content: `<p class="hint">${esc(t("PF1EL.SupplementLevel.Intro", { name }))}</p>
      <div class="form-group">
        <label>${esc(t("PF1EL.SupplementLevel.Level"))}</label>
        <input type="number" name="level" min="1" step="1" value="${current?.level || ""}" autofocus>
      </div>
      <div class="form-group">
        <label>${esc(t("PF1EL.SupplementLevel.Hp"))}</label>
        <input type="text" name="hp" value="${esc(current ? current.hp : DEFAULT_HP)}" placeholder="${DEFAULT_HP}">
      </div>
      <p class="hint">${esc(t("PF1EL.SupplementLevel.Hint"))}</p>`,
    ok: {
      label: t("PF1EL.SupplementLevel.Save"),
      callback: (_ev, button) => ({ level: button.form.elements.level.value, hp: button.form.elements.hp.value }),
    },
    rejectClose: false,
  });
  if (!value || typeof value !== "object") return null;
  const level = Math.floor(Number(value.level));
  return { level: Number.isFinite(level) && level > 0 ? level : 0, hp: String(value.hp ?? "").trim() };
}

Hooks.on("renderItemSheetPF", (app, html) => {
  const item = app.item;
  if (!item) return;
  const el = html?.[0] ?? html;
  const panel = el.querySelector(`section.links-body .tab[data-group="links"][data-tab="${CORE_SUPPLEMENTS_TAB}"]`);
  if (panel) decorateLevelRows(panel, { item, editable: app.isEditable });
});
