/* PF1 Enhanced Links: child items (DESIGN.md § Feature 10)
 *
 * A child is an item another item on the actor brought: a Selections pick, a system
 * Supplement, an engine grant, a class's level association, or a hand-made child link.
 *
 *   • Cost: a child that is a general feat adds 1 to the actor's feat maximum, named
 *     after its parent, so it never uses up a feat. Replaces the picks-only rule of
 *     § Bonus feats.
 *   • Nesting: on the Features tab, a child listed in the same section as its parent
 *     is moved under the parent and indented. A granting feature's Nest under adds a
 *     display-only host for it and its picks (Rage Power (lvl 2) under Rage Powers).
 *
 * Parents are read from four places, first match wins:
 *   1. the parent's `system.links.children` (system Supplements, engine grants, picks)
 *   2. the parent's `granted` ledger (engine grants, shared ones included)
 *   3. the child's `claims` (de-duplicated Supplements, Feature 5)
 *   4. a class's `flags.pf1.links.classAssociations` (PF1's level-up grants)
 */

import { MODULE_ID } from "./enhanced-links.mjs";
import { CLAIMS, childIds, sourceKeys, uniform } from "./dedupe.mjs";
import { HOME_FLAG, nestUnderOf } from "./selections.mjs";

const GRANTED = "granted";
const FEAT = "feat";
const CHILD_CLASS = "pf1el-child";

/**
 * Map of child id -> parent item, for every child on the actor.
 * @param {Actor} actor
 * @returns {Map<string, Item>}
 */
export function parentMap(actor) {
  const parents = new Map();
  const items = actor?.items;
  if (!items) return parents;
  const set = (childId, parent) => {
    if (!childId || childId === parent.id || parents.has(childId) || !items.has(childId)) return;
    parents.set(childId, parent);
  };

  for (const p of items) for (const id of childIds(p)) set(id, p);
  for (const p of items) for (const id of Object.keys(p.flags?.[MODULE_ID]?.[GRANTED] ?? {})) set(id, p);
  for (const c of items) {
    for (const pid of c.flags?.[MODULE_ID]?.[CLAIMS] ?? []) {
      const p = items.get(pid);
      if (p) set(c.id, p);
    }
  }
  for (const cls of actor.itemTypes?.class ?? []) {
    for (const id of Object.keys(cls.flags?.pf1?.links?.classAssociations ?? {})) set(id, cls);
  }
  return parents;
}

/**
 * The item on the actor that brought this one, or null. Public API.
 * @param {Item} item
 * @returns {Item|null}
 */
export function parentOf(item) {
  return (item?.actor && parentMap(item.actor).get(item.id)) ?? null;
}

// ─── Cost ───────────────────────────────────────────────────────────────────────

/**
 * Feat-maximum bonuses for an actor's child feats, one per parent:
 * [{ parent, count }]. Counts exactly what the system's feat count counts
 * (subtype `feat`, active), so each child cancels itself out, except the one
 * standing in for a general feat that stepped aside for it.
 */
export function childFeatBonuses(actor) {
  const parents = parentMap(actor);
  const byParent = new Map();
  for (const item of actor.itemTypes?.feat ?? []) {
    if (item.subType !== FEAT || !item.isActive) continue;
    const parent = parents.get(item.id);
    if (!parent) continue;
    byParent.set(parent, (byParent.get(parent) ?? 0) + 1);
  }
  // A general feat set aside for its pick no longer counts, so one of its child
  // feats stands in for it and only the rest are free.
  const setAside = (parent) =>
    parent.flags?.[MODULE_ID]?.[HOME_FLAG]?.from === FEAT && parent.system?.subType !== FEAT;
  return [...byParent]
    .map(([parent, count]) => ({ parent, count: setAside(parent) ? count - 1 : count }))
    .filter(({ count }) => count > 0);
}

Hooks.on("pf1AddDefaultChanges", (actor, changes) => {
  let bonuses;
  try {
    bonuses = childFeatBonuses(actor);
  } catch (err) {
    console.error("PF1 Enhanced Links | child feat count failed on", actor?.name, err);
    return;
  }
  for (const { parent, count } of bonuses) {
    changes.push(
      new pf1.components.ItemChange({ formula: String(count), target: "bonusFeats", type: "untyped", flavor: parent.name })
    );
  }
});

// ─── Nesting on the Features tab ────────────────────────────────────────────────

/**
 * Map of item id -> the actor's copy of the item its Nest under names, for every
 * granting feature that has one. Display only: never a parent for cost or Granted by.
 */
export function nestMap(actor) {
  const targets = new Map();
  const items = actor?.items;
  if (!items) return targets;
  let bySource = null;
  for (const item of items) {
    const uuid = nestUnderOf(item);
    if (!uuid) continue;
    if (!bySource) {
      bySource = new Map();
      for (const it of items) for (const key of sourceKeys(it)) if (!bySource.has(key)) bySource.set(key, it);
    }
    const target = bySource.get(uniform(uuid));
    if (target && target.id !== item.id) targets.set(item.id, target);
  }
  return targets;
}

/**
 * The row a row goes under, by id, or null. First that is in this section: its
 * parent; the item its own Nest under names; the item its parent's names (a pick
 * whose slot moved to Hidden Features).
 */
function hostId(id, parents, nests, rowById) {
  const parent = parents.get(id);
  const candidates = [parent, nests.get(id), parent && nests.get(parent.id)];
  return candidates.find((c) => c && c.id !== id && rowById.has(c.id))?.id ?? null;
}

/** Reorder one section's rows so each child follows its parent, indented by depth. */
function nestList(list, parents, nests) {
  const rows = [...list.querySelectorAll(":scope > li.item[data-item-id]")];
  if (rows.length < 2) return;
  const rowById = new Map(rows.map((li) => [li.dataset.itemId, li]));

  // Only a parent in this same section adopts; anything else stays a root.
  const kids = new Map();
  const roots = [];
  for (const li of rows) {
    const pid = hostId(li.dataset.itemId, parents, nests, rowById);
    if (pid) {
      if (!kids.has(pid)) kids.set(pid, []);
      kids.get(pid).push(li);
    } else roots.push(li);
  }
  if (!kids.size) return;

  const ordered = [];
  const seen = new Set();
  const visit = (li, depth) => {
    if (seen.has(li)) return;
    seen.add(li);
    ordered.push([li, depth]);
    for (const k of kids.get(li.dataset.itemId) ?? []) visit(k, depth + 1);
  };
  for (const li of roots) visit(li, 0);
  // A link loop leaves rows no root reaches; keep them, unnested.
  for (const li of rows) visit(li, 0);

  const anchor = rows.at(-1).nextSibling;
  for (const [li, depth] of ordered) {
    list.insertBefore(li, anchor);
    li.classList.toggle(CHILD_CLASS, depth > 0);
    if (depth > 0) li.style.setProperty("--pf1el-depth", String(depth));
    else li.style.removeProperty("--pf1el-depth");
  }
}

// ─── "Granted by" on the child's own sheet ──────────────────────────────────────

const escape = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

// Drawn on every render, never written, so it can't go stale or survive the parent.
Hooks.on("renderItemSheet", (app, html) => {
  const item = app.item ?? app.document;
  if (!item?.actor) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const header = root?.querySelector("header.sheet-header");
  if (!header || header.querySelector(".pf1el-granted-by")) return;
  let parent;
  try {
    parent = parentOf(item);
  } catch (err) {
    console.error("PF1 Enhanced Links | finding the parent of", item.name, "failed", err);
    return;
  }
  if (!parent) return;

  const entry = document.createElement("li");
  entry.className = "pf1el-granted-by";
  entry.innerHTML =
    `${escape(game.i18n.localize("PF1EL.Children.GrantedBy"))}: ` +
    `<a class="pf1el-granted-by-link" data-tooltip="PF1EL.Children.OpenParent">${escape(parent.name)}</a>`;
  entry.querySelector("a").addEventListener("click", (event) => {
    event.preventDefault();
    parent.sheet?.render(true);
  });

  let summary = header.querySelector("ul.summary");
  if (!summary) {
    summary = document.createElement("ul");
    summary.className = "summary pf1el-summary";
    (header.querySelector(".header-details") ?? header).append(summary);
  }
  summary.append(entry);
});

Hooks.on("renderActorSheet", (app, html) => {
  const actor = app.actor;
  if (!actor?.items?.size) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const lists = root?.querySelectorAll(".feats-body ol.item-list");
  if (!lists?.length) return;
  try {
    const parents = parentMap(actor);
    const nests = nestMap(actor);
    if (!parents.size && !nests.size) return;
    for (const list of lists) nestList(list, parents, nests);
  } catch (err) {
    console.error("PF1 Enhanced Links | nesting child features failed on", actor.name, err);
  }
});

// Public: astora-mod's trait limit asks which traits are children.
globalThis.pf1EnhancedLinks = { ...(globalThis.pf1EnhancedLinks ?? {}), parentOf, parentMap, nestMap };
