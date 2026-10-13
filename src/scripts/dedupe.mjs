/* PF1 Enhanced Links — shared duplicate matching and reference counting
 *
 * Used by system Supplements (supplements.mjs) and Class Features grants
 * (engine.mjs). Both skip creating an item the actor already has and share the
 * existing one instead. See DESIGN.md § Feature 5.
 *
 * An item can be referenced from two places:
 *   • a parent's `granted` ledger (engine grants)
 *   • its own `claims` list (system Supplements)
 * Either side deletes a shared item only when neither still references it.
 */

import { MODULE_ID } from "./enhanced-links.mjs";

const SETTING = "dedupeSupplements";
export const CLAIMS = "claims";
export const ALIASES = "aliases";
const GRANTED = "granted";
const GRANT_SOURCE = "grantSource";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTING, {
    name: "PF1EL.Setting.Dedupe.Name",
    hint: "PF1EL.Setting.Dedupe.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
});

export const dedupeEnabled = () => game.settings.get(MODULE_ID, SETTING) !== false;
export const uniform = (u) => (u ? pf1?.utils?.internal?.uniformUuid?.(u) ?? u : "");

/**
 * Types that are de-duplicated. Physical items legitimately stack as copies, and
 * the same spell in two books is legitimate too (spells carry no tag, so they
 * never trip the warning).
 */
export function dedupable(type) {
  const cls = CONFIG.Item.documentClasses[type];
  return !!cls && !cls.isPhysical && type !== "spell";
}

/** The tag the system will give this data (system.tag, else derived from the name). */
function dataTag(data) {
  if (!CONFIG.Item.documentClasses[data.type]?.system?.hasIdentifier) return null;
  return data.system?.tag || pf1.utils.createTag(data.name ?? "");
}

/** Every source uuid an existing item stands for. */
export function sourceKeys(item) {
  return [
    item.getFlag("pf1", "source"),
    item.getFlag(MODULE_ID, GRANT_SOURCE),
    item._stats?.compendiumSource,
    ...(item.getFlag(MODULE_ID, ALIASES) ?? []),
  ]
    .filter(Boolean)
    .map(uniform);
}

/** Source uuids of to-be-created data. */
function dataSources(data) {
  return [data.flags?.pf1?.source, data.flags?.[MODULE_ID]?.[GRANT_SOURCE], data._stats?.compendiumSource]
    .filter(Boolean)
    .map(uniform);
}

/** Match keys of to-be-created data: its source uuids, plus its type-scoped tag. */
export function dataKeys(data) {
  const keys = dataSources(data).map((u) => `src:${u}`);
  const tag = dataTag(data);
  if (tag) keys.push(`tag:${data.type}:${tag}`);
  return keys;
}

/** An item already on the actor that this data would duplicate, or null. */
export function findExisting(actor, data) {
  if (!dedupable(data.type)) return null;
  const srcs = new Set(dataSources(data));
  const tag = dataTag(data);
  const subType = data.system?.subType ?? null;
  return (
    actor.items.find((it) => {
      if (!dedupable(it.type)) return false;
      // An item never stands in for its own supplement.
      if ((it.system?.links?.supplements ?? []).some((s) => srcs.has(uniform(s.uuid)))) return false;
      if (sourceKeys(it).some((s) => srcs.has(s))) return true;
      // A class feature and a feat can share a name, and so a tag.
      return !!tag && it.type === data.type && (it.system?.subType ?? null) === subType && it.system?.tag === tag;
    }) ?? null
  );
}

/** Made by a link (Supplements or the engine), so ours to delete once unreferenced. */
export const isManaged = (item) => !!(item.getFlag("pf1", "source") || item.getFlag(MODULE_ID, GRANT_SOURCE));

/**
 * Ids of the parents on the actor that reference an item: ledgers recording it
 * plus its claims. `except` leaves one parent out (one being torn down or deleted).
 */
export function referencers(actor, item, except = null) {
  const ids = new Set();
  for (const p of actor.items) {
    if (p.id !== except && p.getFlag(MODULE_ID, GRANTED)?.[item.id]) ids.add(p.id);
  }
  for (const id of item.getFlag(MODULE_ID, CLAIMS) ?? []) {
    if (id !== except && actor.items.has(id)) ids.add(id);
  }
  return ids;
}

export const childIds = (item) =>
  new Set((item.system?.links?.children ?? []).map((l) => l?.uuid?.split(".").pop()).filter(Boolean));
