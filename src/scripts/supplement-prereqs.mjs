/* PF1 Enhanced Links – prerequisites on the system's Supplements (DESIGN.md § Feature 9)
 *
 * A supplement row can carry prerequisites (BAB, Hit Dice, skill and subskill ranks,
 * features held). A gated supplement isn't created by the system when its parent
 * arrives; the engine grants it once the prerequisites are met and removes it when
 * they stop being met.
 *
 * Storage, on the parent: flags[MODULE_ID].supplementPrereqs (shape in prereq-rules.mjs).
 */

import { MODULE_ID } from "./enhanced-links.mjs";
import { sourceKeys, uniform } from "./dedupe.mjs";
import { PREREQ_FLAG, KNOWLEDGE, prereqFor, withPrereq, normalize, describe, unmet, findSubskill } from "./prereq-rules.mjs";

const CORE_SUPPLEMENTS_TAB = "supplements";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** Skills that hold subskills when the actor model can't say. */
const SUBSKILL_FAMILIES = ["art", "crf", "lor", "prf", "pro"];

const subskillsApi = () => game.astoraMod?.subskills ?? null;

// ─── Reading ────────────────────────────────────────────────────────────────────

const storedOf = (item) => item?.getFlag?.(MODULE_ID, PREREQ_FLAG) ?? [];

/** One supplement row's prerequisites on a parent, or null when it has none. */
export function prereqOf(parent, uuid) {
  return prereqFor(storedOf(parent), uuid, uniform);
}

/** The items an actor holds for feature prerequisites: active ones only (§ Feature 9). */
function heldOf(actor) {
  const held = [];
  for (const item of actor?.items ?? []) {
    if (!item.isActive) continue;
    held.push({ keys: sourceKeys(item), type: item.type, tag: item.system?.tag || null });
  }
  return held;
}

/** The values the rules read, off a prepared actor. */
export function statsOf(actor) {
  const attrs = actor?.system?.attributes ?? {};
  const api = subskillsApi();
  return {
    bab: Number(attrs.bab?.total) || 0,
    hd: Number(attrs.hd?.total) || 0,
    skills: actor?.system?.skills ?? {},
    held: heldOf(actor),
    key: uniform,
    // A named subskill: astora-mod's catalog resolution when present, else by key or name.
    find: (family, sub, subSkills) => {
      const known = api?.resolve?.(family, sub, actor);
      return known && subSkills?.[known] ? known : findSubskill(subSkills, sub);
    },
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

/** Whether any of the item's gated rows names a feature, so item changes on the actor matter. */
export const hasFeatureGates = (item) => gatedLinks(item).some(({ prereq }) => prereq.features.length > 0);

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

/** Whether a skill key holds subskills. */
function isFamily(key) {
  const skills = game.model?.Actor?.character?.skills;
  const subs = skills?.[key]?.subSkills;
  return subs !== undefined ? foundry.utils.getType(subs) === "Object" : SUBSKILL_FAMILIES.includes(key);
}

export function skillLabel(key, sub = null) {
  if (key === KNOWLEDGE) return t("PF1EL.Prereq.AnyKnowledge");
  const label = pf1?.config?.skills?.[key];
  const base = label ? game.i18n.localize(label) : key;
  return sub ? `${base} (${sub})` : base;
}

const orWord = () => t("PF1EL.Prereq.Or");

/** "Requires …" text. */
export const describePrereq = (prereq) => describe(prereq, skillLabel, orWord());

/** Why a supplement isn't granted yet, for tooltips. */
export function unmetText(actor, prereq) {
  const skillPart = (r) => t("PF1EL.Prereq.UnmetSkill", { skill: skillLabel(r.skill, r.sub), need: r.need, have: r.have });
  const anyOf = (parts) => t("PF1EL.Prereq.UnmetAny", { list: parts.join(` ${orWord()} `) });
  return unmet(prereq, statsOf(actor))
    .map((u) => {
      if (u.kind === "skill") return skillPart(u);
      if (u.kind === "skillAny") return anyOf(u.options.map(skillPart));
      if (u.kind === "feature") return t("PF1EL.Prereq.UnmetFeature", { name: u.name });
      if (u.kind === "featureAny") return anyOf(u.names);
      return t(`PF1EL.Prereq.Unmet.${u.kind}`, { need: u.need, have: u.have });
    })
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

/** One datalist per subskill family, filled from astora-mod's catalog when present. */
function subskillLists(listId) {
  const api = subskillsApi();
  return Object.keys(pf1?.config?.skills ?? {})
    .filter(isFamily)
    .map((fam) => {
      const names = (api?.list?.(fam) ?? []).map((e) => e?.name).filter(Boolean);
      const opts = names.map((n) => `<option value="${esc(n)}"></option>`).join("");
      return `<datalist id="${listId}-${esc(fam)}">${opts}</datalist>`;
    })
    .join("");
}

function skillRow(listId, { skill = "", sub = "", ranks = "" } = {}) {
  const key = skill || Object.keys(pf1?.config?.skills ?? {}).sort((a, b) => skillLabel(a).localeCompare(skillLabel(b)))[0] || "";
  const family = isFamily(key);
  return `<div class="el-prereq-skill">
      <select name="skill">${skillOptions(skill)}</select>
      <input type="text" name="sub" value="${esc(sub ?? "")}" list="${listId}-${esc(key)}"
        placeholder="${esc(t("PF1EL.Prereq.SubAny"))}"${family ? "" : " hidden"}>
      <input type="number" name="ranks" min="1" step="1" value="${esc(ranks ?? "")}" placeholder="${esc(t("PF1EL.Prereq.Ranks"))}">
      <a class="el-prereq-remove" data-tooltip="PF1EL.Prereq.RemoveSkill"><i class="fa-solid fa-trash" inert></i></a>
    </div>`;
}

function featureRow(f) {
  return `<li class="el-prereq-feature" data-uuid="${esc(f.uuid)}" data-name="${esc(f.name)}" data-type="${esc(
    f.type
  )}" data-tag="${esc(f.tag ?? "")}">
      <a class="content-link" data-link data-uuid="${esc(f.uuid)}" data-type="Item"><i class="fa-solid fa-suitcase" inert></i>${esc(
    f.name
  )}</a>
      <a class="el-prereq-remove" data-tooltip="PF1EL.Prereq.RemoveFeature"><i class="fa-solid fa-trash" inert></i></a>
    </li>`;
}

const anyToggle = (name, checked) =>
  `<label class="el-prereq-any"><input type="checkbox" name="${name}"${checked ? " checked" : ""}> ${esc(
    t("PF1EL.Prereq.AnyOne")
  )}</label>`;

/** A dropped item as a feature prerequisite, or null with a warning shown. */
async function droppedFeature(event) {
  let data;
  try {
    data = JSON.parse(event.dataTransfer.getData("text/plain"));
  } catch (err) {
    return null;
  }
  const doc = data?.type === "Item" && data.uuid ? await fromUuid(data.uuid).catch(() => null) : null;
  if (!(doc instanceof Item)) {
    ui.notifications.warn(t("PF1EL.Prereq.ItemsOnly"));
    return null;
  }
  // A character's copy stands for its source; the identifier matches either way.
  const uuid = doc.isEmbedded ? doc._stats?.compendiumSource || doc.getFlag("pf1", "source") || doc.uuid : doc.uuid;
  const hasId = !!CONFIG.Item.documentClasses[doc.type]?.system?.hasIdentifier;
  const tag = hasId ? doc.system?.tag || pf1.utils.createTag(doc.name ?? "") || null : null;
  return { uuid, name: doc.name, type: doc.type, tag };
}

/** The edited entry, "clear", or null when cancelled. */
async function promptPrereq(current, name) {
  const { DialogV2 } = foundry.applications.api;
  const p = current ?? normalize({});
  const listId = `el-prereq-sub-${foundry.utils.randomID()}`;
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
        <div class="el-prereq-skills">${p.skills.map((s) => skillRow(listId, s)).join("")}</div>
        <div class="el-prereq-foot">
          <a class="el-prereq-add"><i class="fa-solid fa-plus" inert></i> ${esc(t("PF1EL.Prereq.AddSkill"))}</a>
          ${anyToggle("skillsAny", p.skillsAny)}
        </div>
      </fieldset>
      <fieldset>
        <legend>${esc(t("PF1EL.Prereq.Features"))}</legend>
        <ul class="el-prereq-features">${p.features.map(featureRow).join("")}</ul>
        <div class="el-prereq-drop">${esc(t("PF1EL.Prereq.DropFeature"))}</div>
        <div class="el-prereq-foot">${anyToggle("featuresAny", p.featuresAny)}</div>
      </fieldset>
      <p class="hint">${esc(t("PF1EL.Prereq.Hint"))}</p>
      ${subskillLists(listId)}
    </div>`;

  const read = (form) => ({
    bab: form.elements.bab.value,
    hd: form.elements.hd.value,
    skills: [...form.querySelectorAll(".el-prereq-skill")].map((row) => {
      const sub = row.querySelector('[name="sub"]');
      return {
        skill: row.querySelector('[name="skill"]').value,
        sub: sub && !sub.hidden ? sub.value : "",
        ranks: row.querySelector('[name="ranks"]').value,
      };
    }),
    skillsAny: form.elements.skillsAny.checked,
    features: [...form.querySelectorAll(".el-prereq-feature")].map((li) => ({ ...li.dataset })),
    featuresAny: form.elements.featuresAny.checked,
  });

  const result = await DialogV2.wait({
    window: { title: t("PF1EL.Prereq.Title"), icon: "fa-solid fa-lock" },
    classes: ["el-prereq-dialog"],
    position: { width: 460 },
    content,
    buttons: [
      { action: "save", label: t("PF1EL.Prereq.Save"), icon: "fa-solid fa-check", default: true, callback: (_ev, button) => read(button.form) },
      { action: "clear", label: t("PF1EL.Prereq.Clear"), icon: "fa-solid fa-lock-open", callback: () => "clear" },
      { action: "cancel", label: t("Cancel"), icon: "fa-solid fa-xmark", callback: () => null },
    ],
    render: (_ev, dialog) => {
      const root = dialog.element;
      const skills = root.querySelector(".el-prereq-skills");
      const features = root.querySelector(".el-prereq-features");
      const wire = (scope) => {
        scope.querySelectorAll(".el-prereq-remove").forEach((a) =>
          a.addEventListener("click", (ev) => {
            ev.preventDefault();
            a.closest(".el-prereq-skill, .el-prereq-feature")?.remove();
          })
        );
        scope.querySelectorAll('.el-prereq-skill select[name="skill"]').forEach((sel) =>
          sel.addEventListener("change", () => {
            const sub = sel.closest(".el-prereq-skill").querySelector('[name="sub"]');
            sub.hidden = !isFamily(sel.value);
            sub.setAttribute("list", `${listId}-${sel.value}`);
            sub.value = "";
          })
        );
      };
      wire(root);
      const append = (list, html) => {
        const holder = document.createElement("div");
        holder.innerHTML = html;
        const row = holder.firstElementChild;
        list.append(row);
        wire(row);
      };
      root.querySelector(".el-prereq-add")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        append(skills, skillRow(listId));
      });
      const zone = root.querySelector(".el-prereq-drop");
      zone?.addEventListener("dragover", (ev) => ev.preventDefault());
      zone?.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const f = await droppedFeature(ev);
        if (!f || [...features.children].some((li) => li.dataset.uuid === f.uuid)) return;
        // Held in a <ul>, so the row markup goes through a list holder.
        const holder = document.createElement("ul");
        holder.innerHTML = featureRow(f);
        const row = holder.firstElementChild;
        features.append(row);
        wire(row);
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
    let tip = prereq ? esc(t("PF1EL.Prereq.Set", { text: describePrereq(prereq) })) : esc(t("PF1EL.Prereq.Add"));
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
      await setPrereq(item, uuid, next === "clear" ? {} : normalize(next));
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
