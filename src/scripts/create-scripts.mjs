/* PF1 Enhanced Links — create scripts on links
 *
 * A per-row script that runs on an item when a link creates it: Class Features,
 * Spell Supplements, and the system's own Supplements tab. See DESIGN.md
 * § Feature 4.
 *
 * Storage: ordinary ItemScriptCalls in the PARENT's system.scriptCalls, under a
 * synthetic category `pf1el:create:<tab>:<entry uuid>`. The category is never
 * registered, so the item sheet's own Script Calls section ignores them, while the
 * system's script editor and macro handling work unchanged.
 *
 * Execution: a transient ItemScriptCall whose parent is the CREATED item, so the
 * script's `item` is the new item, as in a normal create script.
 */

const LOG = "PF1 Enhanced Links |";
const PREFIX = "pf1el:create:";

/** Tab keys; also the middle segment of the stored category. */
export const SCRIPT_TAB = {
  classFeatures: "classFeatures",
  spellSupplements: "spellSupplements",
  supplements: "supplements",
};

const CORE_SUPPLEMENTS_TAB = "supplements";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

function categoryFor(kind, uuid) {
  return `${PREFIX}${kind}:${uuid}`;
}

/** The create scripts of one link row, in stored order. */
export function scriptsFor(item, kind, uuid) {
  const category = categoryFor(kind, uuid);
  return item.scriptCalls?.filter((sc) => sc.category === category) ?? [];
}

/** Delete one row's scripts, e.g. when the row itself is removed. */
export async function deleteScriptsFor(item, kind, uuid) {
  const category = categoryFor(kind, uuid);
  const raw = item.toObject().system.scriptCalls ?? [];
  const kept = raw.filter((sc) => sc.category !== category);
  if (kept.length !== raw.length) await item.update({ "system.scriptCalls": kept }, { render: false });
}

// ─── Execution ──────────────────────────────────────────────────────────────────

/**
 * Run a row's create scripts against the item it just created. Never throws: a
 * failing script is logged and the rest still run.
 */
export async function runCreateScripts({ parent, child, kind, source, extra = {} }) {
  const scripts = scriptsFor(parent, kind, source);
  if (!scripts.length || !child) return;

  const ScriptCall = pf1.components.ItemScriptCall;
  const shared = { category: "create" };
  for (const sc of scripts) {
    try {
      const call = new ScriptCall(sc.toObject(), { parent: child });
      await call.execute(shared, { parent, source, link: kind, ...extra });
    } catch (err) {
      console.error(LOG, `create script "${sc.name}" from "${parent.name}" failed on "${child.name}":`, err);
    }
  }
}

// System Supplements scripts are run from supplements.mjs, which tracks which
// parent claims which supplement.

// ─── Row controls ───────────────────────────────────────────────────────────────

/**
 * Add the script controls to every row of a links panel, just left of the book
 * icon: a chip per script, then (when editable) a +.
 */
export function decorateScriptRows(panel, { item, kind, editable }) {
  for (const row of panel.querySelectorAll("tr.links-item[data-uuid]")) {
    const uuid = row.dataset.uuid;
    const cell = row.querySelector("td.item-name");
    if (!uuid || !cell) continue;
    cell.querySelector(".el-scripts")?.remove();

    const box = document.createElement("span");
    box.className = "el-scripts";
    box.innerHTML = rowHtml(scriptsFor(item, kind, uuid), editable);
    const book = cell.querySelector("a.source-item");
    if (book) cell.insertBefore(box, book);
    else cell.append(box);

    wireRow(box, { item, kind, uuid, editable });
  }
}

function rowHtml(scripts, editable) {
  const removeHint = editable ? ` (${game.i18n.localize("PF1EL.Script.RemoveHint")})` : "";
  const chips = scripts
    .filter((sc) => !sc.hide)
    .map((sc) => {
      const icon = sc.img ? `<img src="${esc(sc.img)}" alt="">` : `<i class="fa-solid fa-code" inert></i>`;
      return `<a class="el-script-chip" data-script-id="${esc(sc.id)}" data-tooltip="${esc(sc.name + removeHint)}">${icon}</a>`;
    })
    .join("");
  if (!editable) return chips;
  return `${chips}
    <a class="el-script-add" data-tooltip="PF1EL.Script.Add"><i class="fa-solid fa-plus" inert></i></a>`;
}

function wireRow(box, { item, kind, uuid, editable }) {
  const category = categoryFor(kind, uuid);

  box.querySelectorAll("a.el-script-chip").forEach((chip) => {
    const script = () => item.scriptCalls?.get(chip.dataset.scriptId);
    chip.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      script()?.edit({ editable });
    });
    if (!editable) return;
    chip.addEventListener("contextmenu", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const sc = script();
      if (!sc) return;
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("PF1EL.Script.RemoveTitle") },
        content: `<p>${esc(game.i18n.format("PF1EL.Script.RemoveConfirm", { name: sc.name }))}</p>`,
      });
      if (!ok) return;
      const kept = (item.toObject().system.scriptCalls ?? []).filter((s) => s._id !== sc.id);
      await item.update({ "system.scriptCalls": kept });
    });
  });

  if (!editable) return;

  box.querySelector("a.el-script-add")?.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const created = await pf1.components.ItemScriptCall.create([{ category, type: "script" }], { parent: item });
    created?.forEach((sc) => sc?.edit());
  });
}

// ─── System Supplements tab ─────────────────────────────────────────────────────

Hooks.on("renderItemSheetPF", (app, html) => {
  const item = app.item;
  if (!item) return;
  const el = html?.[0] ?? html;
  const panel = el.querySelector(`section.links-body .tab[data-group="links"][data-tab="${CORE_SUPPLEMENTS_TAB}"]`);
  if (panel) decorateScriptRows(panel, { item, kind: SCRIPT_TAB.supplements, editable: app.isEditable });
});
