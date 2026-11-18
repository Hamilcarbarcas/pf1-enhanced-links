/* PF1 Enhanced Links: roll data for granted items (DESIGN.md § Roll data)
 *
 * Values on an on-actor item's own roll data, for its Changes and for formulas
 * other modules evaluate with it (roll-bonuses):
 *
 *   @item.slotLevel       the level the item was gained at: its class association,
 *                         the level of the slot that picked it, or the level on the
 *                         Class Features row that made it. 0 when nothing records one.
 *   @item.pickCount       how many slots hold a repeatable pick (1 for anything else).
 *   @item.countSince.<t>  how many of the actor's active items carry tag <t>
 *                         (pf1.utils.createTag: "Weapon Training" -> weaponTraining)
 *                         and were gained at or after this item's slotLevel. A
 *                         repeatable pick counts once per slot. A fighter's weapon
 *                         training group: @item.countSince.weaponTraining, so a
 *                         level an archetype takes away doesn't raise it.
 *
 * PF1 builds roll data once per Change in every prepare, so all of it is cached
 * per actor and the cache is dropped when the actor starts preparing again.
 */

import { MODULE_ID } from "./enhanced-links.mjs";
import { COUNT_FLAG, gainedLevel } from "./selections.mjs";

/** actor -> { tagLevels: Map(tag key -> [level, ...]), items: Map(item id -> values) } */
const cache = new WeakMap();

const pickCount = (item) => {
  const count = Number(item.flags?.[MODULE_ID]?.[COUNT_FLAG]);
  return count > 0 ? count : 1;
};

/** Every tag on the actor's active items, with the level each holder was gained at. */
function tagLevels(actor) {
  const out = new Map();
  for (const item of actor.items) {
    if (!item.isActive) continue;
    const keys = new Set((item.system?.tags ?? []).map((t) => pf1.utils.createTag(String(t))).filter(Boolean));
    if (!keys.size) continue;
    const level = gainedLevel(item) ?? 0;
    const weight = pickCount(item);
    for (const key of keys) {
      const list = out.get(key) ?? [];
      for (let i = 0; i < weight; i++) list.push(level);
      out.set(key, list);
    }
  }
  return out;
}

function valuesFor(item) {
  const actor = item.actor;
  let entry = cache.get(actor);
  if (!entry) cache.set(actor, (entry = { tagLevels: null, items: new Map() }));
  let values = entry.items.get(item.id);
  if (!values) {
    entry.tagLevels ??= tagLevels(actor);
    const slotLevel = gainedLevel(item) ?? 0;
    const countSince = {};
    for (const [key, levels] of entry.tagLevels) countSince[key] = levels.filter((l) => l >= slotLevel).length;
    values = { slotLevel, pickCount: pickCount(item), countSince };
    entry.items.set(item.id, values);
  }
  return values;
}

Hooks.on("pf1PrepareBaseActorData", (actor) => cache.delete(actor));

Hooks.on("pf1GetRollData", (doc, result) => {
  // Item roll data only; an action's roll data starts from its item's, so it has these already.
  if (!(doc instanceof Item) || !doc.actor || !doc.id || !result?.item) return;
  try {
    const { slotLevel, pickCount: count, countSince } = valuesFor(doc);
    Object.assign(result.item, { slotLevel, pickCount: count, countSince: { ...countSince } });
  } catch (err) {
    console.error("PF1 Enhanced Links | roll data for", doc.name, err);
  }
});
