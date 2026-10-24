/* PF1 Enhanced Links: the picker a granting feature opens.
 * DESIGN.md § Feature 7, Picking. */

import { MODULE_ID } from "./enhanced-links.mjs";
import {
  GRANT_AS,
  PICKS_FLAG,
  SELECT_ACTION_ID,
  addPick,
  classIsOpen,
  eligibleClasses,
  isDormant,
  judgeOptions,
  openSlots,
  orderOptions,
  resolveCatalog,
  slotsOf,
} from "./selections.mjs";

const LOG = "PF1 Enhanced Links |";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// One picker per feature, by uuid.
const pickers = new Map();

class SelectionPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pf1el-picker"],
    window: { icon: "fa-solid fa-list-check", resizable: true },
    position: { width: 480, height: 600 },
    actions: {
      choose: SelectionPicker.#choose,
      view: SelectionPicker.#view,
      confirm: SelectionPicker.#confirm,
      sortDefault: SelectionPicker.#sortDefault,
      sortAlpha: SelectionPicker.#sortAlpha,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/src/templates/selection-picker.hbs`, scrollable: [".pf1el-picker-list"] },
  };

  #feature;
  #rowId = null; // the row whose slot is being filled
  #chosen = null;
  #filter = "";
  #sort = "default"; // "default" | "az" | "za"
  #hideFailed = false;
  #saving = false;

  constructor(feature, options = {}) {
    super({
      ...options,
      // The uuid tells apart two tokens of one actor, which share item ids.
      id: `pf1el-picker-${feature.uuid.replaceAll(".", "-")}`,
      window: { title: game.i18n.format("PF1EL.Sel.Picker.Title", { item: feature.name }) },
    });
    this.#feature = feature;
  }

  async _prepareContext() {
    const feature = this.#feature;
    const slots = slotsOf(feature);
    // One slot per confirm: the first row that still has one open.
    const slot = slots.find((s) => s.open > 0);
    this.#rowId = slot?.row.id ?? null;
    if (!slot) return { entries: [], empty: true };

    const catalog = await resolveCatalog(slot.row);
    const judged = judgeOptions(feature, slot.row, catalog);
    // A GM may pick an option that fails its rules; anyone else can't select it.
    const override = game.user.isGM;
    const listed = catalog.map((entry) => {
      const notes = judged.get(entry.uuid) ?? [];
      // A spell in a spell mode shows its spell level in place of a minimum level.
      const spell = entry.spellLevel !== null && entry.spellLevel !== undefined;
      const level = spell ? entry.spellLevel : entry.option.minLevel ?? 0;
      let levelLabel = "";
      if (spell) levelLabel = game.i18n.format("PF1EL.Sel.Picker.SpellLevel", { n: level });
      else if (level) levelLabel = game.i18n.format("PF1EL.Sel.Picker.Level", { n: level });
      return {
        uuid: entry.uuid,
        name: entry.name,
        img: entry.img,
        summary: entry.option.summary,
        level,
        levelLabel,
        note: notes.join("; "),
        failed: notes.length > 0,
        blocked: notes.length > 0 && !override,
        chosen: entry.uuid === this.#chosen,
      };
    });
    if (!listed.some((entry) => entry.chosen && !entry.blocked)) this.#chosen = null;
    const entries = orderOptions(listed, this.#sort);

    return {
      heading: slot.row.label || feature.name,
      remaining: game.i18n.format("PF1EL.Sel.Picker.Remaining", { n: openSlots(feature) }),
      entries,
      empty: !entries.length,
      filter: this.#filter,
      hideFailed: this.#hideFailed,
      sortDefault: this.#sort === "default",
      sortAlpha: this.#sort !== "default",
      // The arrow shows the order in use, A to Z until the list is reversed.
      alphaIcon: this.#sort === "za" ? "fa-arrow-up-z-a" : "fa-arrow-down-a-z",
      canConfirm: !!this.#chosen,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const input = this.element.querySelector(".pf1el-picker-filter");
    if (!input) return;
    input.addEventListener("input", () => {
      this.#filter = input.value;
      this.#applyFilter();
    });
    this.element.querySelector(".pf1el-picker-hide")?.addEventListener("change", (ev) => {
      this.#hideFailed = ev.currentTarget.checked;
      this.#applyFilter();
    });
    this.#applyFilter();
    if (options.isFirstRender) input.focus();
  }

  /** Show the entries that pass the name filter and, when asked, only the available ones. */
  #applyFilter() {
    const needle = this.#filter.trim().toLowerCase();
    for (const li of this.element.querySelectorAll(".pf1el-picker-option")) {
      const unnamed = !!needle && !li.dataset.name.toLowerCase().includes(needle);
      li.hidden = unnamed || (this.#hideFailed && li.classList.contains("failed"));
      // A hidden entry can't stay selected: Confirm would pick something out of sight.
      if (li.hidden && li.classList.contains("chosen")) {
        li.classList.remove("chosen");
        this.#chosen = null;
        const confirm = this.element.querySelector('[data-action="confirm"]');
        if (confirm) confirm.disabled = true;
      }
    }
  }

  static #sortDefault() {
    if (this.#sort === "default") return;
    this.#sort = "default";
    this.render();
  }

  /** Alphabetical; pressed again, it flips between A to Z and Z to A. */
  static #sortAlpha() {
    this.#sort = this.#sort === "az" ? "za" : "az";
    this.render();
  }

  static #choose(event, target) {
    if (target.classList.contains("blocked")) return;
    this.#chosen = target.dataset.uuid;
    for (const li of this.element.querySelectorAll(".pf1el-picker-option")) li.classList.toggle("chosen", li === target);
    const confirm = this.element.querySelector('[data-action="confirm"]');
    if (confirm) confirm.disabled = false;
  }

  static async #view(event, target) {
    const doc = await fromUuid(target.closest("[data-uuid]").dataset.uuid).catch(() => null);
    doc?.sheet?.render(true);
  }

  /**
   * The class a pick is for, when its row and feature leave that open. One eligible
   * class is taken as it is; with several the user is asked, as the system asks when
   * a class feature is dropped on an actor with more than one class.
   *
   * @returns {Promise<string|null>} a class tag, "" for none, or null if the user backed out
   */
  async #classFor(uuid) {
    const feature = this.#feature;
    const row = slotsOf(feature).find((s) => s.row.id === this.#rowId)?.row;
    if (!classIsOpen(feature, row)) return "";
    const source = await fromUuid(uuid).catch(() => null);
    // The spell-like book has no class.
    if (source?.type === "spell" && row?.grantAs === GRANT_AS.spelllike) return "";
    const eligible = source ? eligibleClasses(feature.actor, source) : [];
    if (eligible.length < 2) return eligible[0]?.system?.tag ?? "";

    const specifier = game.i18n.localize("TYPES.Item.class");
    const chosen = await pf1.utils.dialog.getItem({
      window: { title: `${game.i18n.format("PF1.SelectSpecific", { specifier })} - ${source.name} - ${feature.actor.name}` },
      actor: feature.actor,
      items: eligible,
      selected: eligible[0].id,
    });
    return chosen ? chosen.system.tag : null;
  }

  static async #confirm() {
    const uuid = this.#chosen;
    if (!uuid || !this.#rowId || this.#saving) return;
    this.#saving = true;
    try {
      const classTag = await this.#classFor(uuid);
      // Backed out of the class prompt: nothing is recorded and the selection stands.
      if (classTag === null) return;
      // Cleared first: the update's own hook redraws this window, or closes it.
      this.#chosen = null;
      // The engine grants the item from this update. DESIGN.md § Who writes.
      await addPick(this.#feature, this.#rowId, uuid, classTag);
    } catch (err) {
      console.error(LOG, "recording a pick failed", err);
      ui.notifications.warn(game.i18n.localize("PF1EL.Sel.Warn.PickFailed"));
    } finally {
      this.#saving = false;
    }
  }

  _onClose(options) {
    super._onClose(options);
    pickers.delete(this.#feature.uuid);
  }
}

/** Open the picker for a granting feature on an actor, or bring it forward. */
export function openPicker(feature) {
  if (!feature?.actor?.isOwner) return;
  // Paused for uninstall, a pick would be recorded and never granted.
  if (isDormant()) return void ui.notifications.warn(game.i18n.localize("PF1EL.Uninstall.Notice"));
  if (openSlots(feature) < 1) {
    return void ui.notifications.warn(game.i18n.format("PF1EL.Sel.Warn.NoSlots", { item: feature.name }));
  }
  let app = pickers.get(feature.uuid);
  if (!app) {
    app = new SelectionPicker(feature);
    pickers.set(feature.uuid, app);
  }
  app.render({ force: true }).catch((err) => console.error(LOG, "the picker failed to open", err));
}

const isSelectUse = (actionUse) => actionUse?.action?.id === SELECT_ACTION_ID;

// pf1-new-script-hooks: cancel before the attack dialog opens.
Hooks.on("pf1PreAttackDialog", (actionUse) => {
  if (!isSelectUse(actionUse)) return;
  actionUse.shared.reject = true;
  openPicker(actionUse.item);
});

// Without it the use gets this far, past the dialog. Cancel here instead.
Hooks.on("pf1PreActionUse", (actionUse) => {
  if (!isSelectUse(actionUse)) return;
  openPicker(actionUse.item);
  return false;
});

// A pick reset from the sheet while the picker is open changes what it offers.
Hooks.on("updateItem", (item, changed) => {
  const app = pickers.get(item.uuid);
  if (!app?.rendered || !foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${PICKS_FLAG}`)) return;
  if (openSlots(item) > 0) app.render();
  else app.close();
});

Hooks.on("deleteItem", (item) => pickers.get(item.uuid)?.close());

// What the actor has decides what can be picked, so its open pickers follow its items.
function refreshFor(item) {
  const actor = item.actor;
  if (!actor) return;
  for (const feature of actor.items) {
    const app = pickers.get(feature.uuid);
    if (app?.rendered) app.render();
  }
}
Hooks.on("createItem", refreshFor);
Hooks.on("deleteItem", refreshFor);

globalThis.pf1EnhancedLinks = { ...(globalThis.pf1EnhancedLinks ?? {}), openPicker };
