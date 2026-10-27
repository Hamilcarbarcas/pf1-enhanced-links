/* PF1 Enhanced Links — system Supplements: de-duplication and create scripts
 *
 * The system's _createSupplements never checks the actor, so a second item linking
 * the same supplement makes a second copy, which trips the duplicate-tag warnings.
 * With the setting on, a supplement the actor already has is not created again:
 * the new parent CLAIMS the existing item and runs its create scripts on it.
 * See DESIGN.md § Feature 5.
 *
 * Each supplement-made item records the parents that claim it:
 *   flags[MODULE_ID].claims  = [parentId, ...]
 *   flags[MODULE_ID].aliases = [uuid, ...]   // other sources it stands in for
 * A shared item (2+ referencers, counting engine ledgers) is nobody's child, so no
 * single parent's delete cascade takes it; it is deleted when its last referencer
 * goes.
 */

import { MODULE_ID } from "./enhanced-links.mjs";
import { SCRIPT_TAB, runCreateScripts } from "./create-scripts.mjs";
import { renameFor, renameFields } from "./renames.mjs";
import { inTeardown } from "./engine.mjs";
import {
  CLAIMS,
  ALIASES,
  dedupeEnabled,
  uniform,
  dedupable,
  sourceKeys,
  dataKeys,
  findExisting,
  isManaged,
  referencers,
  childIds,
} from "./dedupe.mjs";

const LOG = "PF1 Enhanced Links |";

// ─── Per-actor serialization ────────────────────────────────────────────────────

// Claim and link writes touch shared parents; run them one at a time per actor so
// two writes to one parent's children can't lose an update.
const queues = new Map();
function enqueue(actor, fn) {
  const next = (queues.get(actor.id) ?? Promise.resolve())
    .then(fn)
    .catch((err) => console.error(LOG, "supplement claim failed on", actor.name, err));
  queues.set(actor.id, next);
  return next;
}

// Tag collisions inside one batch: the first item leads, later ones become its
// aliases. preCreate hooks for one batch run synchronously, so a macrotask clears it.
const batches = new Map(); // actorId -> Map(key -> leader source)
const pendingAliases = new Map(); // `${actorId}|${leader source}` -> [uuid]

function batchFor(actorId) {
  let batch = batches.get(actorId);
  if (!batch) {
    batch = new Map();
    batches.set(actorId, batch);
    setTimeout(() => batches.delete(actorId), 0);
  }
  return batch;
}

// ─── Claiming ───────────────────────────────────────────────────────────────────

/**
 * Record every parent linking this item that hasn't claimed it yet, and run their
 * create scripts on it.
 *
 * `fresh` marks a just-created copy (setting off, or a type that isn't
 * de-duplicated): a parent already claiming another copy of the same source made
 * that one, not this one. `created` marks any just-created item: only that one
 * takes a parent's new name (§ Feature 8).
 */
async function claim(actor, itemId, newAliases = [], { fresh = false, created = false } = {}) {
  const item = actor.items.get(itemId);
  if (!item) return;

  const aliases = [...new Set([...(item.getFlag(MODULE_ID, ALIASES) ?? []), ...newAliases.map(uniform)])];
  const keys = new Set([...sourceKeys(item), ...aliases]);
  const matchOf = (p) => (p.system?.links?.supplements ?? []).find((s) => keys.has(uniform(s.uuid)));
  const linking = actor.items.filter((p) => p !== item && matchOf(p));

  // No record yet: an item from before this feature. Whoever has it as a child
  // made it, and has had its turn.
  const stored = item.getFlag(MODULE_ID, CLAIMS);
  const claims = new Set(
    Array.isArray(stored) ? stored : fresh ? [] : linking.filter((p) => childIds(p).has(item.id)).map((p) => p.id)
  );

  const elsewhere = new Set();
  if (fresh) {
    for (const other of actor.items) {
      if (other === item || !sourceKeys(other).some((k) => keys.has(k))) continue;
      for (const id of other.getFlag(MODULE_ID, CLAIMS) ?? []) elsewhere.add(id);
    }
  }

  const added = linking.filter((p) => !claims.has(p.id) && !elsewhere.has(p.id));
  added.forEach((p) => claims.add(p.id));

  const update = {};
  if (!Array.isArray(stored) || added.length) update[`flags.${MODULE_ID}.${CLAIMS}`] = [...claims];
  if (aliases.length !== (item.getFlag(MODULE_ID, ALIASES) ?? []).length) update[`flags.${MODULE_ID}.${ALIASES}`] = aliases;
  // The first maker with a new name renames it, before any create script runs.
  let renamed = false;
  if (created) {
    const makers = fresh ? added : linking;
    const name = makers.map((p) => renameFor(p, SCRIPT_TAB.supplements, matchOf(p).uuid)).find(Boolean);
    if (name && name !== item.name) {
      Object.assign(update, renameFields(item.toObject(), name));
      renamed = true;
    }
  }
  if (Object.keys(update).length) await item.update(update, renamed ? {} : { render: false });

  for (const parent of added) {
    await runCreateScripts({ parent, child: item, kind: SCRIPT_TAB.supplements, source: matchOf(parent).uuid });
  }

  await unlinkShared(actor, [item]);
}

/**
 * Take shared items (2+ referencers) off every parent's child list, so deleting
 * one parent can't cascade them away.
 */
async function unlinkShared(actor, items) {
  const shared = new Set(items.filter((it) => isManaged(it) && referencers(actor, it).size >= 2).map((it) => it.id));
  if (!shared.size) return;

  const updates = [];
  for (const parent of actor.items) {
    const children = parent.toObject().system?.links?.children;
    if (!Array.isArray(children)) continue;
    const kept = children.filter((l) => !shared.has(l?.uuid?.split(".").pop()));
    if (kept.length !== children.length) updates.push({ _id: parent.id, "system.links.children": kept });
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates, { render: false });
}

// ─── Hooks ──────────────────────────────────────────────────────────────────────

// A supplement about to be created: skip it when the actor already has it, and let
// the new parent claim the existing item instead.
Hooks.on("preCreateItem", (doc, _data, options, userId) => {
  if (userId !== game.user.id || options?._pf1NoSupplements !== true) return;
  const actor = doc.parent;
  const source = doc.getFlag("pf1", "source");
  if (!(actor instanceof Actor) || !source) return;
  if (!dedupable(doc.type) || !dedupeEnabled()) return;

  const data = doc.toObject();
  const existing = findExisting(actor, data);
  if (existing) {
    enqueue(actor, () => claim(actor, existing.id, [source]));
    return false;
  }

  const batch = batchFor(actor.id);
  const keys = dataKeys(data);
  const leader = keys.map((k) => batch.get(k)).find(Boolean);
  if (leader) {
    const key = `${actor.id}|${leader}`;
    pendingAliases.set(key, [...(pendingAliases.get(key) ?? []), source]);
    return false;
  }
  keys.forEach((k) => batch.set(k, uniform(source)));
});

// A supplement was created: its parents claim it and run their scripts.
Hooks.on("createItem", (item, options, userId) => {
  if (userId !== game.user.id || options?._pf1NoSupplements !== true) return;
  const actor = item.actor;
  const source = item.getFlag("pf1", "source");
  if (!actor || !source) return;

  const key = `${actor.id}|${uniform(source)}`;
  const aliases = pendingAliases.get(key) ?? [];
  pendingAliases.delete(key);
  // A de-duplicated type reaching here is the only copy; otherwise copies are per parent.
  const fresh = !(dedupable(item.type) && dedupeEnabled());
  enqueue(actor, () => claim(actor, item.id, aliases, { fresh, created: true }));
});

// The system links a new supplement to a parent after creating it, which can land
// after the claim above has unlinked it. Undo that for shared items.
Hooks.on("updateItem", (item, changed, _options, userId) => {
  if (userId !== game.user.id || !foundry.utils.hasProperty(changed, "system.links.children")) return;
  const actor = item.actor;
  if (!actor) return;
  const linked = [...childIds(item)].map((id) => actor.items.get(id)).filter(Boolean);
  if (linked.some((it) => isManaged(it) && referencers(actor, it).size >= 2)) {
    enqueue(actor, () => unlinkShared(actor, linked));
  }
});

// A claimant left: drop its claim. An item nothing references any more goes with
// it; a single remaining referencer becomes its parent again.
Hooks.on("deleteItem", (item, _options, userId) => {
  if (userId !== game.user.id) return;
  const actor = item.actor;
  if (!(actor instanceof Actor)) return;
  // The system's cascade already deletes the removed item's own children.
  const cascaded = childIds(item);

  enqueue(actor, async () => {
    const toDelete = [];
    const updates = [];
    const relinks = new Map(); // parent id -> children array, one write per parent
    for (const it of actor.items) {
      const claims = it.getFlag(MODULE_ID, CLAIMS);
      if (!Array.isArray(claims) || !claims.includes(item.id) || cascaded.has(it.id)) continue;
      // A class deletion is removing it; writing to it would fail the whole batch.
      if (inTeardown(actor, it.id)) continue;

      const remaining = referencers(actor, it, item.id);
      if (!remaining.size && isManaged(it)) {
        toDelete.push(it.id);
        continue;
      }
      updates.push({ _id: it.id, [`flags.${MODULE_ID}.${CLAIMS}`]: claims.filter((id) => remaining.has(id)) });

      if (remaining.size === 1 && isManaged(it)) {
        const parent = actor.items.get([...remaining][0]);
        if (!childIds(parent).has(it.id)) {
          const children = relinks.get(parent.id) ?? parent.toObject().system?.links?.children ?? [];
          relinks.set(parent.id, [...children, { uuid: it.getRelativeUUID(actor) }]);
        }
      }
    }
    for (const [_id, children] of relinks) updates.push({ _id, "system.links.children": children });
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates, { render: false });
    const gone = toDelete.filter((id) => actor.items.has(id));
    if (gone.length) await actor.deleteEmbeddedDocuments("Item", gone);
  });
});
