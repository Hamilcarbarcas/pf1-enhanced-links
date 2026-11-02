/* PF1 Enhanced Links: Spell Supplements routed by spellbook kind, and spells usable
 * only while their item is worn. DESIGN.md § Spellbook by kind. */

import { MODULE_ID, MODE, getSpellSupplements } from "./enhanced-links.mjs";
import { candidates } from "./spellcasting.mjs";
import { BOOK_ACTION_ID, onReservedUse, reservedActions } from "./reserved.mjs";

// On the on-actor copy: the book its kind-mode spells go to.
export const BOOK_FLAG = "supplementBook";
const GRANTED = "granted";
const GRANT_PARENT = "grantParent";

const flagsOf = (item) => item.flags?.[MODULE_ID] ?? {};

/** Whether an item routes Spell Supplements by kind and lists any spells. */
function routesByKind(item) {
  if (flagsOf(item).spellSupplements?.mode !== MODE.kind) return false;
  const cfg = getSpellSupplements(item);
  return cfg.mode === MODE.kind && cfg.items.length > 0;
}

/** In-use core books of the item's kind: [{ system, book, label }]. */
export function bookCandidates(actor, item) {
  return candidates(actor, { kind: getSpellSupplements(item).kind }, null);
}

/**
 * The book an item's kind-mode spells go to, or null. A recorded choice holds while
 * it is still a candidate; with none recorded, a lone candidate is the book.
 */
export function resolveBook(actor, item) {
  const list = bookCandidates(actor, item);
  const recorded = flagsOf(item)[BOOK_FLAG];
  if (recorded) return list.some((c) => c.book === recorded) ? recorded : null;
  return list.length === 1 ? list[0].book : null;
}

/** Sheet status of an on-actor copy's book: { label, chosen }, or null outside kind mode. */
export function bookStatus(item) {
  const actor = item.actor;
  if (!actor || !routesByKind(item)) return null;
  const recorded = flagsOf(item)[BOOK_FLAG];
  const books = actor.system?.attributes?.spells?.spellbooks ?? {};
  if (recorded) {
    const book = books[recorded];
    return { label: book?.label || book?.name || recorded, chosen: true, live: !!resolveBook(actor, item) };
  }
  return { label: "", chosen: false, live: false };
}

/**
 * Record a lone candidate as the choice, and keep the Choose Spellbook action present
 * exactly while a choice is needed. Owner-level writes. Returns true if anything changed.
 */
export async function settleBookChoices(actor, { skip = new Set(), dormant = false } = {}) {
  const updates = [];
  for (const item of actor.items) {
    if (skip.has(item.id) || item.hasActions !== true) continue;
    const kind = routesByKind(item);
    if (!kind && !item.actions?.has(BOOK_ACTION_ID)) continue;
    const update = { _id: item.id };
    let want = false;
    if (kind && !dormant && !flagsOf(item)[BOOK_FLAG]) {
      const list = bookCandidates(actor, item);
      if (list.length === 1) update[`flags.${MODULE_ID}.${BOOK_FLAG}`] = list[0].book;
      else want = list.length > 1;
    }
    const actions = reservedActions(item, BOOK_ACTION_ID, want);
    if (actions) update["system.actions"] = actions;
    if (Object.keys(update).length > 1) updates.push(update);
  }
  if (!updates.length) return false;
  await actor.updateEmbeddedDocuments("Item", updates, { render: false });
  return true;
}

const openDialogs = new Set();

/** Prompt for the book an item's spells go to. The engine grants on the flag write. */
export async function chooseBook(item) {
  const actor = item.actor;
  if (!actor || openDialogs.has(item.uuid)) return;
  const list = bookCandidates(actor, item);
  if (!list.length) return void ui.notifications.warn(game.i18n.format("PF1EL.Book.Warn.NoBooks", { item: item.name }));

  const esc = foundry.utils.escapeHTML;
  const options = list.map((c) => `<option value="${esc(c.book)}">${esc(c.label)}</option>`).join("");
  const content = `
    <p>${esc(game.i18n.format("PF1EL.Book.Dialog.Intro", { item: item.name }))}</p>
    <div class="form-group">
      <label for="pf1el-book">${esc(game.i18n.localize("PF1EL.Book.Label"))}</label>
      <div class="form-fields"><select id="pf1el-book" name="book">${options}</select></div>
    </div>`;

  openDialogs.add(item.uuid);
  let picked;
  try {
    picked = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("PF1EL.Book.Dialog.Title", { item: item.name }) },
      content,
      ok: {
        label: game.i18n.localize("PF1EL.Cast.Dialog.Confirm"),
        callback: (event, button) => button.form.elements.book.value,
      },
      rejectClose: false,
    });
  } finally {
    openDialogs.delete(item.uuid);
  }
  if (!picked || !actor.items.has(item.id) || !list.some((c) => c.book === picked)) return;
  await item.update({ [`flags.${MODULE_ID}.${BOOK_FLAG}`]: picked });
}

/** Clear the recorded book. Its grants go, and the action returns if a choice is needed. */
export function resetBook(item) {
  return item.update({ [`flags.${MODULE_ID}.-=${BOOK_FLAG}`]: null });
}

onReservedUse(BOOK_ACTION_ID, chooseBook);

// ─── Worn-only use ──────────────────────────────────────────────────────────────

const requiresWorn = (parent) => parent.isPhysical === true && getSpellSupplements(parent).requireWorn;

/**
 * The unworn item that keeps a granted spell from being used, or null. Every Spell
 * Supplements contributor must require being worn and be unequipped for the use to
 * be refused.
 */
function blockedBy(spell) {
  const actor = spell?.actor;
  if (!actor || spell.type !== "spell") return null;
  const contributors = actor.items.filter((p) => flagsOf(p)[GRANTED]?.[spell.id]?.kind === "spell");
  // A copy of a grant is in no ledger; its stamp still names the parent.
  if (!contributors.length) {
    const parent = actor.items.get(flagsOf(spell)[GRANT_PARENT]);
    if (parent) contributors.push(parent);
  }
  if (!contributors.length) return null;
  if (contributors.some((p) => !requiresWorn(p) || p.system?.equipped === true)) return null;
  return contributors[0];
}

const refuse = (parent, spell) =>
  ui.notifications.warn(game.i18n.format("PF1EL.Worn.Refused", { spell: spell.name, item: parent.name }));

// pf1-new-script-hooks: refuse before the attack dialog opens.
Hooks.on("pf1PreAttackDialog", (actionUse) => {
  const parent = blockedBy(actionUse?.item);
  if (!parent) return;
  actionUse.shared.reject = true;
  refuse(parent, actionUse.item);
});

// Without it the use gets this far, past the dialog.
Hooks.on("pf1PreActionUse", (actionUse) => {
  const parent = blockedBy(actionUse?.item);
  if (!parent) return;
  refuse(parent, actionUse.item);
  return false;
});

globalThis.pf1EnhancedLinks = { ...(globalThis.pf1EnhancedLinks ?? {}), chooseBook, resolveBook };
