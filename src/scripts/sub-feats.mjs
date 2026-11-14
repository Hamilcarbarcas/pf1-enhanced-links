/* PF1 Enhanced Links: sub-feats out of the Feats browser (DESIGN.md § Feature 11)
 *
 * A feat tagged Sub-Feat is one listing of a feat chosen through its parent
 * (Signature Skill (Acrobatics), Weapon Focus (Axes)). The Feats browser hides
 * those until its "Show sub-feats" box is ticked, or the Sub-Feat tag is chosen in
 * its Tags filter. The Selections picker reads compendium indexes itself and
 * still offers them.
 */

export const SUB_FEAT_TAG = "Sub-Feat";
const SHOW = "show";

Hooks.once("init", () => {
  const browser = pf1.applications?.compendiumBrowser;
  if (!browser?.FeatBrowser || !browser.filters?.CheckboxFilter) {
    console.warn("PF1 Enhanced Links | compendium browser not found; sub-feats stay listed.");
    return;
  }
  const { CheckboxFilter, common } = browser.filters;

  class SubFeatFilter extends CheckboxFilter {
    static label = "PF1EL.Browser.SubFeats";
    static type = "feat";
    static indexField = "system.tags";
    static MIN_SEARCH_CHOICES = false;
    static booleanOperator = false;

    prepareChoices() {
      this.choices = new foundry.utils.Collection([
        [SHOW, { key: SHOW, label: game.i18n.localize("PF1EL.Browser.ShowSubFeats") }],
      ]);
    }

    /** Always applied: an unticked box is what hides sub-feats. */
    get active() {
      return true;
    }

    /** Ticked or not, as the sidebar should show it. */
    getData() {
      const data = super.getData();
      data.active = !!this.choices?.get(SHOW)?.active;
      return data;
    }

    applyFilter(entry) {
      if (this.choices?.get(SHOW)?.active) return true;
      const tags = entry.system?.tags;
      if (!Array.isArray(tags) || !tags.includes(SUB_FEAT_TAG)) return true;
      // Asking for the tag by name shows them too.
      const tagFilter = this.compendiumBrowser?.filters?.find((f) => f instanceof common.TagFilter);
      return !!tagFilter?.choices?.get(SUB_FEAT_TAG)?.active;
    }
  }

  const classes = browser.FeatBrowser.filterClasses;
  if (classes.some((cls) => cls.name === SubFeatFilter.name)) return;
  classes.push(SubFeatFilter);
});
