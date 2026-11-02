/* PF1 Enhanced Links: actions the engine adds to on-actor items. Actions carry no
 * flags, so a reserved id marks each. DESIGN.md § Reserved actions. */

const LOG = "PF1 Enhanced Links |";

export const SELECT_ACTION_ID = "pf1elSelect";
export const CHOICE_ACTION_ID = "pf1elSpellChoice";
export const BOOK_ACTION_ID = "pf1elBookChoice";

// Listing order: always after the item's own actions, in this order.
const DEFS = [
  { id: SELECT_ACTION_ID, name: "PF1EL.Sel.ChooseAction", img: "icons/svg/item-bag.svg" },
  { id: CHOICE_ACTION_ID, name: "PF1EL.Cast.ChooseAction", img: "icons/svg/book.svg" },
  { id: BOOK_ACTION_ID, name: "PF1EL.Book.ChooseAction", img: "icons/svg/book.svg" },
];

export const RESERVED_IDS = new Set(DEFS.map((d) => d.id));

/** id -> handler that opens the action's chooser for an item. */
const openers = new Map();

/** Register what using a reserved action opens. */
export function onReservedUse(id, open) {
  openers.set(id, open);
}

function actionData(def) {
  return new pf1.components.ItemAction({
    _id: def.id,
    name: game.i18n.localize(def.name),
    img: def.img,
    actionType: "other",
    activation: { type: "nonaction", unchained: { type: "nonaction" } },
  }).toObject();
}

/**
 * The item's `system.actions` with one reserved action present or absent, and every
 * reserved action grouped at the end in fixed order. Null when nothing would change.
 * Reads `_source`, so a writer earlier in the same pass must have finished its update.
 */
export function reservedActions(item, id, present) {
  const source = item._source.system?.actions ?? [];
  const own = source.filter((a) => !RESERVED_IDS.has(a._id));
  const have = new Map(source.filter((a) => RESERVED_IDS.has(a._id)).map((a) => [a._id, a]));
  if (present && !have.has(id)) have.set(id, actionData(DEFS.find((d) => d.id === id)));
  else if (!present) have.delete(id);
  const next = [...own, ...DEFS.filter((d) => have.has(d.id)).map((d) => have.get(d.id))];
  const same = next.length === source.length && next.every((a, i) => a === source[i]);
  return same ? null : next;
}

const reservedOf = (actionUse) => {
  const id = actionUse?.action?.id;
  return RESERVED_IDS.has(id) ? openers.get(id) : null;
};

const failed = (err) => console.error(LOG, "a reserved action failed", err);

// pf1-new-script-hooks: cancel before the attack dialog opens.
Hooks.on("pf1PreAttackDialog", (actionUse) => {
  const open = reservedOf(actionUse);
  if (!open) return;
  actionUse.shared.reject = true;
  Promise.resolve(open(actionUse.item)).catch(failed);
});

// Without it the use gets this far, past the dialog. Cancel here instead.
Hooks.on("pf1PreActionUse", (actionUse) => {
  if (!RESERVED_IDS.has(actionUse?.action?.id)) return;
  const open = reservedOf(actionUse);
  if (open) Promise.resolve(open(actionUse.item)).catch(failed);
  return false;
});
