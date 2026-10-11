/* PF1 Enhanced Links: the Selection Sources settings menu.
 * DESIGN.md § Feature 7, Sources. */

import { MODULE_ID } from "./enhanced-links.mjs";
import { CORE_MODES, PACK_MODES, SOURCES_SETTING, forgetVocabulary, getSources } from "./selections.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const lines = (value) => [...new Set(String(value ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];

class SelectionSources extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pf1el-selection-sources",
    tag: "form",
    classes: ["pf1el-sources"],
    window: { title: "PF1EL.Sources.Title", icon: "fa-solid fa-filter", contentClasses: ["standard-form"] },
    position: { width: 480, height: "auto" },
    form: { handler: SelectionSources.#save, closeOnSubmit: true },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/src/templates/selection-sources.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" },
  };

  async _prepareContext() {
    const { core, packs } = getSources();
    const chosen = new Set(packs.ids);
    const modes = (list, prefix) => Object.fromEntries(list.map((mode) => [mode, `${prefix}.${mode}`]));
    return {
      core,
      coreTags: core.tags.join("\n"),
      coreModes: modes(CORE_MODES, "PF1EL.Sources.Core.Modes"),
      packMode: packs.mode,
      packModes: modes(PACK_MODES, "PF1EL.Sources.Packs.Modes"),
      packs: game.packs
        .filter((pack) => pack.documentName === "Item")
        .map((pack) => ({ id: pack.collection, label: pack.metadata.label, on: chosen.has(pack.collection) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "SETTINGS.Save" }],
    };
  }

  static async #save(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    // One checked box arrives as a string, several as an array, unchecked ones as null.
    const ids = [data.packs?.ids ?? []].flat().filter((id) => typeof id === "string" && id);
    await game.settings.set(MODULE_ID, SOURCES_SETTING, {
      core: { mode: data.core?.mode ?? "all", tags: lines(data.core?.tags) },
      packs: { mode: data.packs?.mode ?? "all", ids },
    });
    forgetVocabulary();
  }
}

Hooks.once("init", () => {
  game.settings.registerMenu(MODULE_ID, SOURCES_SETTING, {
    name: "PF1EL.Sources.Menu.Name",
    label: "PF1EL.Sources.Menu.Label",
    hint: "PF1EL.Sources.Menu.Hint",
    icon: "fa-solid fa-filter",
    type: SelectionSources,
    restricted: true,
  });
});
