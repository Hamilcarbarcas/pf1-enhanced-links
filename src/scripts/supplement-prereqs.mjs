/* PF1 Enhanced Links — prerequisites on the system's Supplements (DESIGN.md § Feature 9)
 *
 * A supplement row can carry prerequisites (BAB, Hit Dice, skill ranks). A gated
 * supplement isn't created by the system when its parent arrives; the engine grants it
 * once the prerequisites are met and removes it when they stop being met.
 *
 * Storage, on the parent: flags[MODULE_ID].supplementPrereqs = [{ uuid, bab, hd, skills }].
 * Rules: prereq-rules.mjs.
 */

import { MODULE_ID } from "./enhanced-links.mjs";
import { uniform } from "./dedupe.mjs";
import { PREREQ_FLAG, KNOWLEDGE, prereqFor, withPrereq, normalize, describe, unmet } from "./prereq-rules.mjs";

const CORE_SUPPLEMENTS_TAB = "supplements";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

// ─── Reading ────────────────────────────────────────────────────────────────────

const storedOf = (item) => item?.getFlag?.(MODULE_ID, PREREQ_FLAG) ?? [];

/** One supplement row's prerequisites on a parent, or null when it has none. */
export function prereqOf(parent, uuid) {
  return prereqFor(storedOf(parent), uuid, uniform);
}

/** The values the rules read, off a prepared actor. */
export function statsOf(actor) {
  const attrs = actor?.system?.attributes ?? {};
  return {
    bab: Number(attrs.bab?.total) || 0,
    hd: Number(attrs.hd?.total) || 0,
    skills: actor?.system?.skills ?? {},
  };
}

/** The parent's Supplements rows that carry prerequisites: [{ uuid, prereq }]. */
export function gatedLinks(parent) {
  return (parent?.system?.links?.supplements ?? [])
    .filter((s) => s?.uuid)
    .map((s) => ({ uuid: s.uuid, prereq: prereqOf(parent, s.uuid) }))
    .filter((s) => s.prereq);
}

export const hasGatedSupplements = (item) => gatedLinks(item).length > 0;

/**
 * Whether the system's own supplement creation should skip this source: every item on
 * the actor that links it gates it. A parent linking it ungated still gets it the
 * system's way.
 */
export function heldBack(actor, source) {
  const key = uniform(source);
  const linking = actor.items.filter((it) => (it.system?.links?.supplements ?? []).some((s) => uniform(s.uuid) === key));
  return linking.length > 0 && linking.every((p) => !!prereqOf(p, source));
}

export function skillLabel(key) {
  if (key === KNOWLEDGE) return t("PF1EL.Prereq.AnyKnowledge");
  const label = pf1?.config?.skills?.[key];
  return label ? game.i18n.localize(label) : key;
}

/** Why a supplement isn't granted yet, for tooltips. */
export function unmetText(actor, prereq) {
  return unmet(prereq, statsOf(actor))
    .map((u) =>
      u.kind === "skill"
        ? t("PF1EL.Prereq.UnmetSkill", { skill: skillLabel(u.skill), need: u.need, have: u.have })
        : t(`PF1EL.Prereq.Unmet.${u.kind}`, { need: u.need, have: u.have })
    )
    .join("; ");
}

// ─── Editor ─────────────────────────────────────────────────────────────────────

function skillOptions(selected) {
  const entries = Object.keys(pf1?.config?.skills ?? {}).map((k) => [k, skillLabel(k)]);
  entries.push([KNOWLEDGE, skillLabel(KNOWLEDGE)]);
  // A stored key no config knows (an actor-only skill) stays selectable.
  if (selected && !entries.some(([k]) => k === selected)) entries.push([selected, selected]);
  entries.sort((a, b) => a[1].localeCompare(b[1]));
  return entries
    .map(([k, label]) => `<option value="${esc(k)}"${k === selected ? " selected" : ""}>${esc(label)}</option>`)
    .join("");
}

function skillRow(skill = "", ranks = "") {
  return `<div class="el-prereq-skill">
      <select name="skill">${skillOptions(skill)}</select>
      <input type="number" name="ranks" min="1" step="1" value="${esc(ranks)}" placeholder="${esc(t("PF1EL.Prereq.Ranks"))}">
      <a class="el-prereq-remove" data-tooltip="PF1EL.Prereq.RemoveSkill"><i class="fa-solid fa-trash" inert></i></a>
    </div>`;
}

/** The edited entry, "clear", or null when cancelled. */
async function promptPrereq(current, name) {
  const { DialogV2 } = foundry.applications.api;
  const p = current ?? { bab: null, hd: null, skills: [] };
  const content = `<div class="el-prereq-editor">
      <p class="hint">${esc(t("PF1EL.Prereq.Intro", { name }))}</p>
      <div class="form-group">
        <label>${esc(t("PF1EL.Prereq.Bab"))}</label>
        <input type="number" name="bab" min="1" step="1" value="${esc(p.bab ?? "")}">
      </div>
      <div class="form-group">
        <label>${esc(t("PF1EL.Prereq.Hd"))}</label>
        <input type="number" name="hd" min="1" step="1" value="${esc(p.hd ?? "")}">
      </div>
      <fieldset>
        <legend>${esc(t("PF1EL.Prereq.Skills"))}</legend>
        <div class="el-prereq-skills">${p.skills.map((s) => skillRow(s.skill, s.ranks)).join("")}</div>
        <a class="el-prereq-add"><i class="fa-solid fa-plus" inert></i> ${esc(t("PF1EL.Prereq.AddSkill"))}</a>
      </fieldset>
      <p class="hint">${esc(t("PF1EL.Prereq.Hint"))}</p>
    </div>`;

  const read = (form) => ({
    bab: form.elements.bab.value,
    hd: form.elements.hd.value,
    skills: [...form.querySelectorAll(".el-prereq-skill")].map((row) => ({
      skill: row.querySelector('[name="skill"]').value,
      ranks: row.querySelector('[name="ranks"]').value,
    })),
  });

  const result = await DialogV2.wait({
    window: { title: t("PF1EL.Prereq.Title"), icon: "fa-solid fa-lock" },
    classes: ["el-prereq-dialog"],
    position: { width: 420 },
    content,
    buttons: [
      { action: "save", label: t("PF1EL.Prereq.Save"), icon: "fa-solid fa-check", default: true, callback: (_ev, button) => read(button.form) },
      { action: "clear", label: t("PF1EL.Prereq.Clear"), icon: "fa-solid fa-lock-open", callback: () => "clear" },
      { action: "cancel", label: t("Cancel"), icon: "fa-solid fa-xmark", callback: () => null },
    ],
    render: (_ev, dialog) => {
      const root = dialog.element;
      const list = root.querySelector(".el-prereq-skills");
      const wireRemove = (scope) =>
        scope.querySelectorAll(".el-prereq-remove").forEach((a) =>
          a.addEventListener("click", (ev) => {
            ev.preventDefault();
            a.closest(".el-prereq-skill")?.remove();
          })
        );
      wireRemove(root);
      root.querySelector(".el-prereq-add")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        const holder = document.createElement("div");
        holder.innerHTML = skillRow();
        const row = holder.firstElementChild;
        list.append(row);
        wireRemove(row);
      });
    },
    rejectClose: false,
  });
  return result ?? null;
}

async function setPrereq(parent, uuid, entry) {
  const next = withPrereq(storedOf(parent), { ...entry, uuid }, uniform);
  await parent.update({ [`flags.${MODULE_ID}.${PREREQ_FLAG}`]: next });
}

// ─── Row control ────────────────────────────────────────────────────────────────

/** A lock button on every row of the system's Supplements tab, left of the other row controls. */
export function decoratePrereqRows(panel, { item, editable }) {
  for (const row of panel.querySelectorAll("tr.links-item[data-uuid]")) {
    const uuid = row.dataset.uuid;
    const cell = row.querySelector("td.item-name");
    if (!uuid || !cell) continue;
    cell.querySelector(".el-prereq")?.remove();

    const prereq = prereqOf(item, uuid);
    if (!prereq && !editable) continue;

    const btn = document.createElement("a");
    btn.className = `el-prereq${prereq ? " active" : ""}`;
    let tip = prereq ? t("PF1EL.Prereq.Set", { text: describe(prereq, skillLabel) }) : t("PF1EL.Prereq.Add");
    const why = prereq && item.actor ? unmetText(item.actor, prereq) : "";
    if (why) tip += `<br>${esc(t("PF1EL.Prereq.NotYet", { why }))}`;
    btn.dataset.tooltip = tip;
    btn.innerHTML = `<i class="fa-solid ${prereq ? "fa-lock" : "fa-lock-open"}" inert></i>`;
    const before = cell.querySelector(".el-rename") ?? cell.querySelector(".el-scripts") ?? cell.querySelector("a.source-item");
    if (before) cell.insertBefore(btn, before);
    else cell.append(btn);

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!editable) return;
      const name = cell.querySelector(".name")?.textContent?.trim() ?? "";
      const next = await promptPrereq(prereqOf(item, uuid), name);
      if (next === null) return;
      await setPrereq(item, uuid, next === "clear" ? { bab: null, hd: null, skills: [] } : normalize(next));
    });
  }
}

Hooks.on("renderItemSheetPF", (app, html) => {
  const item = app.item;
  if (!item) return;
  const el = html?.[0] ?? html;
  const panel = el.querySelector(`section.links-body .tab[data-group="links"][data-tab="${CORE_SUPPLEMENTS_TAB}"]`);
  if (panel) decoratePrereqRows(panel, { item, editable: app.isEditable });
});
