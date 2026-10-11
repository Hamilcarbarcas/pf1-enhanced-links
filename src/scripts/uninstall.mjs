/* PF1 Enhanced Links: the Prepare for Uninstall settings menu.
 * DESIGN.md § Feature 7, Preparing for uninstall. */

import { MODULE_ID } from "./enhanced-links.mjs";
import { reconcileForced } from "./engine.mjs";
import {
  HOME_FLAG,
  PICKS_FLAG,
  PICK_CLASS_FLAG,
  SELECT_ACTION_ID,
  isDormant,
  setDormant,
  slotsOf,
} from "./selections.mjs";
import { CHOICE_ACTION_ID } from "./spellcasting.mjs";

const LOG = "PF1 Enhanced Links |";
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

// Where a feature taken out of the module's category waits. The system's own subtype,
// so it is listed whether or not this module is on.
const PARKED = "misc";
// Actions the engine adds to items. Without the module they would be dead buttons.
const RESERVED = new Set([SELECT_ACTION_ID, CHOICE_ACTION_ID]);

const flag = (key) => `flags.${MODULE_ID}.${key}`;
const homeOf = (item) => item.flags?.[MODULE_ID]?.[HOME_FLAG];

/** How many picks an item has recorded, whatever its role says now. */
function storedPicks(item) {
  const stored = item.flags?.[MODULE_ID]?.[PICKS_FLAG] ?? {};
  return Object.values(stored).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
}

/** In the category this module moved it to. */
const isMoved = (item) => {
  const home = homeOf(item);
  return !!home && !home.parked && item.system?.subType === home.to;
};
/** Taken out of that category by this menu, and still where it was put. */
const isParked = (item) => homeOf(item)?.parked === true && item.system?.subType === PARKED;
const hasReserved = (item) => [...RESERVED].some((id) => item.actions?.has(id));
const withoutReserved = (item) => (item._source.system?.actions ?? []).filter((a) => !RESERVED.has(a._id));

/** Every actor that can hold something of ours: world actors, and unlinked tokens with items of their own. */
function* actors() {
  yield* game.actors;
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      // A token with no items of its own holds nothing its base actor doesn't. Skipping
      // it also avoids building an actor for every token in the world.
      if (!token.actorLink && token.delta?.items?.size && token.actor) yield token.actor;
    }
  }
}

/** What there is to act on. */
function survey() {
  const found = { actors: 0, picks: 0, moved: 0, parked: 0 };
  for (const actor of actors()) {
    let picks = 0;
    for (const item of actor.items) {
      picks += storedPicks(item);
      if (isMoved(item)) found.moved++;
      if (isParked(item)) found.parked++;
    }
    found.picks += picks;
    if (picks) found.actors++;
  }
  return found;
}

/** Run the work on every actor. One actor failing doesn't stop the rest. Returns how many failed. */
async function eachActor(work) {
  let failed = 0;
  for (const actor of actors()) {
    try {
      await work(actor);
    } catch (err) {
      failed++;
      console.error(LOG, "uninstall preparation failed for", actor.name, err);
    }
  }
  return failed;
}

async function stripActions(actor) {
  const updates = actor.items.filter(hasReserved).map((item) => ({ _id: item.id, "system.actions": withoutReserved(item) }));
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
}

/** Clear every pick, and let the engine take the picked items out and put the features back. */
async function undoPicks(actor) {
  const cleared = actor.items
    .filter((item) => storedPicks(item) > 0)
    .map((item) => ({ _id: item.id, [flag(`-=${PICKS_FLAG}`)]: null, [flag(`-=${PICK_CLASS_FLAG}`)]: null }));
  if (cleared.length) {
    await actor.updateEmbeddedDocuments("Item", cleared);
    await reconcileForced(actor);
  }
  await stripActions(actor);
}

/** Move what the module put in its category to Misc. The stamp stays, marked, so it can be moved back. */
async function park(actor) {
  const updates = [];
  for (const item of actor.items) {
    const update = {};
    if (isMoved(item)) {
      update["system.subType"] = PARKED;
      update[flag(`${HOME_FLAG}.parked`)] = true;
    }
    if (hasReserved(item)) update["system.actions"] = withoutReserved(item);
    if (Object.keys(update).length) updates.push({ _id: item.id, ...update });
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
}

/** Move parked features back to the category they were in. */
async function unpark(actor) {
  const updates = [];
  for (const item of actor.items) {
    if (!isParked(item)) continue;
    const update = { _id: item.id, [flag(`${HOME_FLAG}.-=parked`)]: null };
    // Left in Misc if the category it came from is no longer a subtype.
    if (pf1.config.featTypes?.[homeOf(item).to]) update["system.subType"] = homeOf(item).to;
    updates.push(update);
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
}

/** Ask before acting. Resolves true only on an explicit yes. */
async function confirmed(key, data) {
  const text = foundry.utils.escapeHTML(game.i18n.format(key, data));
  const answer = await DialogV2.confirm({
    window: { title: game.i18n.localize("PF1EL.Uninstall.Title") },
    content: `<p>${text}</p>`,
    modal: true,
    rejectClose: false,
  });
  return answer === true;
}

class UninstallPrep extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pf1el-uninstall",
    classes: ["pf1el-uninstall"],
    window: { title: "PF1EL.Uninstall.Title", icon: "fa-solid fa-box-archive", contentClasses: ["standard-form"] },
    position: { width: 520, height: "auto" },
    actions: {
      undo: UninstallPrep.#undo,
      park: UninstallPrep.#park,
      restore: UninstallPrep.#restore,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/src/templates/uninstall-prep.hbs` },
  };

  #working = false;

  async _prepareContext() {
    const found = survey();
    return {
      dormant: isDormant(),
      found: game.i18n.format("PF1EL.Uninstall.Found", found),
      // Something to undo: the module is paused, or features are still parked.
      canRestore: isDormant() || found.parked > 0,
      working: this.#working,
    };
  }

  /** Do the work with the buttons off, then report. */
  async #run(work, doneKey, data) {
    if (this.#working) return;
    this.#working = true;
    await this.render();
    let failed = 0;
    try {
      failed = await work();
    } catch (err) {
      failed = -1;
      console.error(LOG, "uninstall preparation failed", err);
    } finally {
      this.#working = false;
    }
    if (failed) ui.notifications.warn(game.i18n.localize("PF1EL.Uninstall.Failed"));
    else ui.notifications.info(game.i18n.format(doneKey, data));
    if (this.rendered) this.render();
  }

  static async #undo() {
    const found = survey();
    if (!(await confirmed("PF1EL.Uninstall.Confirm.Undo", found))) return;
    // Deleted items don't come back, so this one is asked twice.
    if (!(await confirmed("PF1EL.Uninstall.Confirm.Final", found))) return;
    await this.#run(
      async () => {
        // Paused first: the engine then takes things out without putting any back.
        await setDormant(true);
        return eachActor(undoPicks);
      },
      "PF1EL.Uninstall.Done.Undo",
      found
    );
  }

  static async #park() {
    const found = survey();
    if (!(await confirmed("PF1EL.Uninstall.Confirm.Park", found))) return;
    await this.#run(
      async () => {
        await setDormant(true);
        return eachActor(park);
      },
      "PF1EL.Uninstall.Done.Park",
      found
    );
  }

  static async #restore() {
    const found = survey();
    if (!(await confirmed("PF1EL.Uninstall.Confirm.Restore", found))) return;
    await this.#run(
      async () => {
        const failed = await eachActor(unpark);
        await setDormant(false);
        // Awake again: the Choose actions return to features with a pick to make.
        const holders = [...actors()].filter((actor) => actor.items.some((item) => slotsOf(item).length));
        for (const actor of holders) await reconcileForced(actor);
        return failed;
      },
      "PF1EL.Uninstall.Done.Restore",
      found
    );
  }
}

Hooks.once("init", () => {
  game.settings.registerMenu(MODULE_ID, "uninstallPrep", {
    name: "PF1EL.Uninstall.Menu.Name",
    label: "PF1EL.Uninstall.Menu.Label",
    hint: "PF1EL.Uninstall.Menu.Hint",
    icon: "fa-solid fa-box-archive",
    type: UninstallPrep,
    restricted: true,
  });
});

// A paused module looks broken unless someone says why.
Hooks.once("ready", () => {
  if (game.user.isGM && isDormant()) ui.notifications.warn(game.i18n.localize("PF1EL.Uninstall.Notice"));
});
