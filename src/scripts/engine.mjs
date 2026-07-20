/* PF1 Enhanced Links — gating engine (Phase 2)
 *
 * Turns the configuration authored in Phase 1 into real actor items. One
 * primitive drives both features:
 *
 *     evaluate a gate → create-as-grant on cross → remove on gate-down
 *
 * Triggers: pf1ClassLevelChange (class level / HD changes), plus create/update/
 * delete of the configured parent items. Each event runs a full reconcile of the
 * actor: a fixpoint loop that keeps re-scanning until a pass makes no change, so
 * nested grants (a granted feat that itself grants more) are all caught.
 *
 * Grants are tracked two ways:
 *   • a `granted` ledger flag on each PARENT: { [createdItemId]: {source, ...} }
 *   • `flags[MODULE_ID].grantParent / grantSource` stamped on each CREATED item
 * The ledger drives gate-down teardown; the stamps drive parent-deletion cleanup
 * and let a reload reconcile without duplicating.
 *
 * Only the primary GM client runs the engine, so grants aren't created N times
 * across connected clients. If no GM is present, changes are simply reconciled
 * the next time a GM is active and an event fires.
 */

import {
  MODULE_ID,
  MODE,
  getClassFeatures,
  getSpellSupplements,
  getAssociatedClass,
} from "./enhanced-links.mjs";

const LOG = "PF1 Enhanced Links |";
const MAX_PASSES = 10;

// Grant-tracking flag keys.
const GRANTED = "granted"; // on parent: ledger of what it has produced
const GRANT_PARENT = "grantParent"; // on child: id of the parent that made it
const GRANT_SOURCE = "grantSource"; // on child: source uuid it was built from

// Actors currently mid-reconcile. Held across awaits so the item CRUD hooks fired
// by our own create/delete calls are ignored (re-entry guard).
const busy = new Set();

// ─── Guards ─────────────────────────────────────────────────────────────────────

/** Only the primary GM client mutates, to avoid duplicate grants across clients. */
function isPrimaryGM() {
  return game.users?.activeGM?.isSelf === true;
}

// ─── Gate quantities ────────────────────────────────────────────────────────────

/** Level of the class with the given tag on this actor, or 0. */
function classLevel(actor, tag) {
  if (!tag) return 0;
  return actor.classes?.[tag]?.level ?? 0;
}

/** Actor total Hit Dice. */
function hdTotal(actor) {
  return actor.system?.attributes?.hd?.total ?? 0;
}

/** Book key whose class is the given tag, or null (non-caster / no match). */
function findSpellbookByClass(actor, tag) {
  const books = actor.system?.attributes?.spells?.spellbooks ?? {};
  for (const [key, book] of Object.entries(books)) {
    if (book?.class === tag) return key;
  }
  return null;
}

// ─── Build creation data ────────────────────────────────────────────────────────

/** Resolve a source uuid and prepare a fresh import-ready data object. */
async function buildFromSource(uuid) {
  const source = await fromUuid(uuid).catch(() => null);
  if (!source) {
    console.warn(LOG, "grant source not found:", uuid);
    return null;
  }
  return { source, data: game.items.fromCompendium(source, { clearFolder: true }) };
}

/** Stamp our provenance flags onto a to-be-created item's data. */
function stampGrant(data, source, parentId) {
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.${GRANT_SOURCE}`, source);
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.${GRANT_PARENT}`, parentId);
}

async function buildClassFeature(uuid, tag, parentId) {
  const built = await buildFromSource(uuid);
  if (!built) return null;
  const { data } = built;
  foundry.utils.setProperty(data, "system.class", tag); // bind to the parent's class
  stampGrant(data, uuid, parentId);
  return data;
}

async function buildSpell(uuid, bookId, tag, mode, parentId) {
  const built = await buildFromSource(uuid);
  if (!built) return null;
  const { source, data } = built;
  if (source.type !== "spell") {
    console.warn(LOG, "spell supplement source is not a spell:", uuid);
    return null;
  }
  foundry.utils.setProperty(data, "system.spellbook", bookId);

  // Prefer the spell's learned level for the associated class; otherwise keep its own.
  let level = data.system?.level ?? 0;
  if (mode === MODE.class && tag) {
    const learned = source.system?.learnedAt?.class?.[tag];
    if (Number.isFinite(learned)) level = Math.clamp(learned, 0, 9);
  }
  foundry.utils.setProperty(data, "system.level", level);

  stampGrant(data, uuid, parentId);
  return data;
}

/**
 * Ensure the spell-like abilities book is live enough to compute for a routed
 * spell — but only fill fields that are empty, never overwrite existing config.
 */
async function ensureSpelllikeBook(actor) {
  const base = "system.attributes.spells.spellbooks.spelllike";
  const book = actor.system?.attributes?.spells?.spellbooks?.spelllike ?? {};
  const update = {};
  if (!book.inUse) update[`${base}.inUse`] = true;
  if (!book.class) update[`${base}.class`] = "_hd"; // HD-driven, like innate casting
  if (!book.cl?.formula) update[`${base}.cl.formula`] = "@attributes.hd.total";
  if (Object.keys(update).length) await actor.update(update, { render: false });
}

// ─── Desired-grant computation ──────────────────────────────────────────────────

/**
 * The full set of grants a parent wants right now. Each entry carries whether its
 * gate is currently `met` and a `build()` that produces creation data on demand.
 */
function buildDesired(actor, parent) {
  const out = [];
  const tag = getAssociatedClass(parent);
  const clvl = classLevel(actor, tag);

  // Feature 1 — class-associated features (always gated by class level).
  for (const { uuid, level } of getClassFeatures(parent)) {
    const threshold = Number.isFinite(level) ? level : 1;
    out.push({
      source: uuid,
      threshold,
      kind: "classFeature",
      met: !!tag && clvl >= threshold,
      build: () => buildClassFeature(uuid, tag, parent.id),
    });
  }

  // Feature 2 — spell supplements. Ungated ⇒ threshold 0 (always met once a book
  // resolves), which is how the same engine serves both gated and ungated.
  const cfg = getSpellSupplements(parent);
  for (const { uuid, level } of cfg.items) {
    const threshold = cfg.gated ? (Number.isFinite(level) ? level : 1) : 0;
    let gateQty;
    let bookId;
    let needsSpelllikeBook = false;
    if (cfg.mode === MODE.class) {
      gateQty = clvl;
      bookId = tag ? findSpellbookByClass(actor, tag) : null;
    } else {
      gateQty = hdTotal(actor);
      bookId = "spelllike";
      needsSpelllikeBook = true;
    }
    out.push({
      source: uuid,
      threshold,
      kind: "spell",
      met: bookId != null && gateQty >= threshold,
      needsSpelllikeBook,
      build: () => buildSpell(uuid, bookId, tag, cfg.mode, parent.id),
    });
  }

  return out;
}

// ─── Reconcile ──────────────────────────────────────────────────────────────────

/** Whether an item hosts any Enhanced Links configuration. */
function isConfiguredParent(item) {
  const cf = item.getFlag(MODULE_ID, "classFeatures");
  if (Array.isArray(cf) && cf.length) return true;
  const ss = item.getFlag(MODULE_ID, "spellSupplements");
  return Array.isArray(ss?.items) && ss.items.length > 0;
}

/**
 * Bring a single parent's grants in line with its desired set: delete grants that
 * are no longer met (or whose source was removed), create grants newly met.
 * Returns true if anything changed.
 */
async function reconcileParent(actor, parent) {
  const ledger = foundry.utils.deepClone(parent.getFlag(MODULE_ID, GRANTED) ?? {});
  const desired = buildDesired(actor, parent);
  const bySource = new Map(desired.map((d) => [d.source, d]));

  let changed = false;

  // Teardown: ledger entries no longer wanted, or whose item was removed by hand.
  const toDelete = [];
  for (const [itemId, rec] of Object.entries(ledger)) {
    if (!actor.items.get(itemId)) {
      delete ledger[itemId];
      changed = true;
      continue;
    }
    const d = bySource.get(rec.source);
    if (!d || !d.met) {
      toDelete.push(itemId);
      delete ledger[itemId];
      changed = true;
    }
  }
  if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete, { render: false });

  // Create: newly-met sources not already granted.
  const already = new Set(Object.values(ledger).map((r) => r.source));
  const toCreate = desired.filter((d) => d.met && !already.has(d.source));
  if (toCreate.length) {
    if (toCreate.some((d) => d.needsSpelllikeBook)) await ensureSpelllikeBook(actor);

    const data = [];
    const meta = [];
    for (const d of toCreate) {
      const built = await d.build();
      if (built) {
        data.push(built);
        meta.push(d);
      }
    }
    if (data.length) {
      const created = await actor.createEmbeddedDocuments("Item", data, { render: false });
      for (let i = 0; i < created.length; i++) {
        ledger[created[i].id] = { source: meta[i].source, threshold: meta[i].threshold, kind: meta[i].kind };
      }
      changed = true;
    }
  }

  if (changed) await parent.setFlag(MODULE_ID, GRANTED, ledger);
  return changed;
}

/**
 * Reconcile every configured parent on the actor, looping to a fixpoint so that
 * cascading grants (a grant that is itself a parent) settle within one event.
 */
async function reconcileActor(actor) {
  if (!(actor instanceof Actor) || !game.ready || !isPrimaryGM()) return;
  if (busy.has(actor.id)) return;

  busy.add(actor.id);
  try {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let changed = false;
      for (const parent of actor.items.filter(isConfiguredParent)) {
        if (await reconcileParent(actor, parent)) changed = true;
      }
      if (!changed) return;
      if (pass === MAX_PASSES - 1) {
        console.warn(LOG, "reconcile hit the pass cap on", actor.name, "— check for a link cycle.");
      }
    }
  } catch (err) {
    console.error(LOG, "reconcile failed for", actor?.name, err);
  } finally {
    busy.delete(actor.id);
  }
}

/** Transitive set of grants descending from a (being-deleted) parent id. */
function collectGrantDescendants(actor, rootId) {
  const doomed = new Set();
  let frontier = [rootId];
  while (frontier.length) {
    const next = [];
    for (const pid of frontier) {
      for (const it of actor.items) {
        if (it.getFlag(MODULE_ID, GRANT_PARENT) === pid && !doomed.has(it.id)) {
          doomed.add(it.id);
          next.push(it.id);
        }
      }
    }
    frontier = next;
  }
  return [...doomed];
}

// ─── Triggers ───────────────────────────────────────────────────────────────────

Hooks.once("ready", () => {
  console.log(LOG, "engine ready");
});

// Class level or HD changed (racial HD is a class item too, so HD gates ride this).
Hooks.on("pf1ClassLevelChange", (actor) => {
  reconcileActor(actor);
});

// A configured parent was added (mid-campaign drop, or ungated grants on arrival).
Hooks.on("createItem", (item) => {
  const actor = item.actor;
  if (!(actor instanceof Actor) || busy.has(actor.id)) return;
  if (isConfiguredParent(item)) reconcileActor(actor);
});

// Config edited on an item already on the actor (levels, mode, gating, entries).
Hooks.on("updateItem", (item, changed) => {
  const actor = item.actor;
  if (!(actor instanceof Actor) || busy.has(actor.id)) return;
  if (foundry.utils.hasProperty(changed, `flags.${MODULE_ID}`)) reconcileActor(actor);
});

// A parent was removed → tear down its (transitive) grants. A granted child was
// removed by hand → re-heal via a reconcile.
Hooks.on("deleteItem", async (item) => {
  const actor = item.actor;
  if (!(actor instanceof Actor) || !game.ready || !isPrimaryGM() || busy.has(actor.id)) return;

  const orphans = collectGrantDescendants(actor, item.id);
  if (orphans.length) {
    busy.add(actor.id);
    try {
      await actor.deleteEmbeddedDocuments("Item", orphans, { render: false });
    } finally {
      busy.delete(actor.id);
    }
    return;
  }

  if (item.getFlag(MODULE_ID, GRANT_SOURCE)) reconcileActor(actor);
});

// Expose for console debugging alongside the Phase 1 accessors.
globalThis.pf1EnhancedLinks = { ...(globalThis.pf1EnhancedLinks ?? {}), reconcileActor };
