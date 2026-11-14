// Supplement prerequisites (src/scripts/prereq-rules.mjs, DESIGN.md § Feature 9): normalizing
// entries, finding one by uuid, replacing and clearing it, skill rank reading (subskills, named
// subskills, any Knowledge), features held, any-of lists, what's unmet, and the summary text.
//
// Run from the module root:  node tests/supplement-prereqs.test.mjs

import assert from "node:assert/strict";

const R = await import(new URL("../src/scripts/prereq-rules.mjs", import.meta.url));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const A = "Compendium.astora-mod.feats.Item.aaa";
const B = "Compendium.astora-mod.feats.Item.bbb";

test("normalize: numbers floored, blanks and zeros dropped, empty skill rows removed", () => {
  const p = R.normalize({ uuid: A, bab: "6.7", hd: "", skills: [{ skill: "acr", ranks: "15" }, { skill: "", ranks: 5 }, { skill: "clm", ranks: 0 }] });
  assert.deepEqual(p, {
    uuid: A,
    bab: 6,
    hd: null,
    skills: [{ skill: "acr", sub: null, ranks: 15 }],
    skillsAny: false,
    features: [],
    featuresAny: false,
  });
  assert.equal(R.isEmpty(R.normalize({ uuid: A })), true);
});

test("prereqFor: by uuid through the key function; an empty entry reads as none", () => {
  const stored = [{ uuid: A, skills: [{ skill: "acr", ranks: 15 }] }, { uuid: B }];
  const key = (u) => u.toLowerCase();
  assert.equal(R.prereqFor(stored, A.toUpperCase(), key).skills[0].ranks, 15);
  assert.equal(R.prereqFor(stored, B, key), null);
  assert.equal(R.prereqFor(null, A), null);
});

test("withPrereq: replaces the old entry, and clearing removes it", () => {
  let list = R.withPrereq([], { uuid: A, bab: 3 });
  list = R.withPrereq(list, { uuid: B, hd: 5 });
  list = R.withPrereq(list, { uuid: A, bab: 6 });
  assert.deepEqual(list.map((e) => [e.uuid, e.bab, e.hd]), [[B, null, 5], [A, 6, null]]);
  list = R.withPrereq(list, { uuid: B, hd: null, skills: [] });
  assert.deepEqual(list.map((e) => e.uuid), [A]);
});

const skills = {
  acr: { rank: 15 },
  crf: { rank: 0, subSkills: { crf1: { rank: 4 }, crf2: { rank: 9 } } },
  kar: { rank: 3 },
  kps: { rank: 11 },
  kma: { rank: 2 },
  per: { rank: 0 },
};

test("skill rank: own rank, highest subskill, highest Knowledge, missing is 0", () => {
  assert.equal(R.skillRank(skills, "acr"), 15);
  assert.equal(R.skillRank(skills, "crf"), 9);
  assert.equal(R.skillRank(skills, R.KNOWLEDGE), 11);
  assert.equal(R.skillRank(skills, "upd"), 0);
  assert.equal(R.skillRank(null, "acr"), 0);
});

test("unmet: each failed rule once; all met is empty", () => {
  const p = R.normalize({ bab: 6, hd: 5, skills: [{ skill: "acr", ranks: 15 }, { skill: "crf", ranks: 10 }] });
  assert.deepEqual(R.unmet(p, { bab: 4, hd: 5, skills }), [
    { kind: "bab", need: 6, have: 4 },
    { kind: "skill", skill: "crf", sub: null, need: 10, have: 9 },
  ]);
  assert.equal(R.meets(p, { bab: 6, hd: 7, skills: { ...skills, crf: { rank: 10 } } }), true);
  assert.equal(R.meets(R.normalize({}), {}), true);
});

test("Signature Skill tiers: 5 / 10 / 15 / 20 against 12 ranks", () => {
  const tiers = [5, 10, 15, 20].map((n) => R.normalize({ skills: [{ skill: "acr", ranks: n }] }));
  assert.deepEqual(tiers.map((p) => R.meets(p, { skills: { acr: { rank: 12 } } })), [true, true, false, false]);
});

test("describe", () => {
  const p = R.normalize({ bab: 6, hd: 5, skills: [{ skill: "acr", ranks: 15 }, { skill: R.KNOWLEDGE, ranks: 5 }] });
  const label = (k) => ({ acr: "Acrobatics", knowledge: "Knowledge (any)" })[k] ?? k;
  assert.equal(R.describe(p, label), "BAB +6 · 5 HD · Acrobatics 15 · Knowledge (any) 5");
  assert.equal(R.describe(R.normalize({})), "");
});

// ─── Named subskills ───────────────────────────────────────────────────────────

const named = {
  crf: { rank: 0, subSkills: { alchemy: { name: "Alchemy", rank: 7 }, crf1: { name: "Bows", rank: 12 } } },
  prf: { rank: 0, subSkills: { stringInstruments: { name: "String Instruments", rank: 5 } } },
  art: { rank: 0, subSkills: {} },
};

test("normalize: sub kept trimmed, blank sub is null, Knowledge drops it", () => {
  const p = R.normalize({
    skills: [
      { skill: "crf", sub: " Alchemy ", ranks: 5 },
      { skill: "prf", sub: "", ranks: 2 },
      { skill: R.KNOWLEDGE, sub: "x", ranks: 3 },
    ],
  });
  assert.deepEqual(p.skills.map((s) => s.sub), ["Alchemy", null, null]);
});

test("findSubskill: by key, by name, ignoring case and spacing", () => {
  assert.equal(R.findSubskill(named.crf.subSkills, "alchemy"), "alchemy");
  assert.equal(R.findSubskill(named.crf.subSkills, "Bows"), "crf1");
  assert.equal(R.findSubskill(named.prf.subSkills, "string instruments"), "stringInstruments");
  assert.equal(R.findSubskill(named.crf.subSkills, "Weapons"), null);
  assert.equal(R.findSubskill(null, "Bows"), null);
});

test("skill rank with a subskill: that one's rank, 0 when missing; without, the highest", () => {
  assert.equal(R.skillRank(named, "crf", "Alchemy"), 7);
  assert.equal(R.skillRank(named, "crf", "bows"), 12);
  assert.equal(R.skillRank(named, "crf", "Weapons"), 0);
  assert.equal(R.skillRank(named, "art", "Painting"), 0);
  assert.equal(R.skillRank(named, "crf"), 12);
});

test("skill rank: a custom finder wins (astora-mod catalog resolution)", () => {
  const find = (_fam, sub, subs) => (sub === "Brewing" ? "alchemy" : R.findSubskill(subs, sub));
  assert.equal(R.skillRank(named, "crf", "Brewing", find), 7);
});

test("unmet: a named subskill is judged on its own rank, not the family's best", () => {
  const p = R.normalize({ skills: [{ skill: "crf", sub: "Alchemy", ranks: 10 }] });
  assert.deepEqual(R.unmet(p, { skills: named }), [{ kind: "skill", skill: "crf", sub: "Alchemy", need: 10, have: 7 }]);
});

// ─── Features ──────────────────────────────────────────────────────────────────

const DODGE = { uuid: "Compendium.pf1.feats.Item.dodge", name: "Dodge", type: "feat", tag: "dodge" };
const MOBILITY = { uuid: "Compendium.pf1.feats.Item.mobility", name: "Mobility", type: "feat", tag: "mobility" };
const RAGE = { uuid: "Compendium.pf1.class-abilities.Item.rage", name: "Rage", type: "feat", tag: "rage" };

test("normalize: features cleaned, blank uuids and repeats dropped", () => {
  const p = R.normalize({ features: [DODGE, { name: "x" }, { ...DODGE, name: "again" }, { ...MOBILITY, tag: "" }] });
  assert.deepEqual(p.features, [DODGE, { ...MOBILITY, tag: null }]);
  assert.equal(R.isEmpty(R.normalize({ features: [DODGE] })), false);
});

test("holds: by source key through the key function, or same type and tag", () => {
  const key = (u) => u.toLowerCase();
  assert.equal(R.holds([{ keys: [DODGE.uuid.toLowerCase()], type: "feat", tag: "other" }], DODGE, key), true);
  assert.equal(R.holds([{ keys: [], type: "feat", tag: "dodge" }], DODGE), true);
  assert.equal(R.holds([{ keys: [], type: "buff", tag: "dodge" }], DODGE), false);
  assert.equal(R.holds([{ keys: [], type: "loot", tag: null }], { ...DODGE, tag: null }), false);
  assert.equal(R.holds(null, DODGE), false);
});

test("unmet: every feature required by default", () => {
  const p = R.normalize({ features: [DODGE, MOBILITY] });
  const held = [{ keys: [DODGE.uuid], type: "feat", tag: "dodge" }];
  assert.deepEqual(R.unmet(p, { held }), [{ kind: "feature", name: "Mobility" }]);
  assert.equal(R.meets(p, { held: [...held, { keys: [], type: "feat", tag: "mobility" }] }), true);
});

// ─── Any of ────────────────────────────────────────────────────────────────────

test("featuresAny: one held is enough; none held is one row naming all", () => {
  const p = R.normalize({ features: [DODGE, MOBILITY, RAGE], featuresAny: true });
  assert.equal(R.meets(p, { held: [{ keys: [], type: "feat", tag: "rage" }] }), true);
  assert.deepEqual(R.unmet(p, { held: [] }), [{ kind: "featureAny", names: ["Dodge", "Mobility", "Rage"] }]);
});

test("skillsAny: one row met is enough; none met is one row with every option", () => {
  const p = R.normalize({ skills: [{ skill: "acr", ranks: 5 }, { skill: "clm", ranks: 5 }], skillsAny: true });
  assert.equal(R.meets(p, { skills: { acr: { rank: 1 }, clm: { rank: 6 } } }), true);
  assert.deepEqual(R.unmet(p, { skills: { acr: { rank: 1 } } }), [
    {
      kind: "skillAny",
      options: [
        { skill: "acr", sub: null, need: 5, have: 1 },
        { skill: "clm", sub: null, need: 5, have: 0 },
      ],
    },
  ]);
});

test("any-of with a single member acts as required", () => {
  const p = R.normalize({ features: [DODGE], featuresAny: true, skills: [{ skill: "acr", ranks: 5 }], skillsAny: true });
  assert.deepEqual(R.unmet(p, {}), [
    { kind: "skill", skill: "acr", sub: null, need: 5, have: 0 },
    { kind: "feature", name: "Dodge" },
  ]);
});

test("any-of lists don't loosen BAB or HD", () => {
  const p = R.normalize({ bab: 6, features: [DODGE, MOBILITY], featuresAny: true });
  const held = [{ keys: [], type: "feat", tag: "dodge" }];
  assert.deepEqual(R.unmet(p, { bab: 3, held }), [{ kind: "bab", need: 6, have: 3 }]);
});

test("describe: subskills, features, and the or joiner", () => {
  const label = (k, sub) => ({ crf: "Craft", acr: "Acrobatics", clm: "Climb" })[k] + (sub ? ` (${sub})` : "");
  const all = R.normalize({ skills: [{ skill: "crf", sub: "Alchemy", ranks: 5 }], features: [DODGE, MOBILITY] });
  assert.equal(R.describe(all, label), "Craft (Alchemy) 5 · Dodge · Mobility");
  const any = R.normalize({
    hd: 3,
    skills: [{ skill: "acr", ranks: 5 }, { skill: "clm", ranks: 5 }],
    skillsAny: true,
    features: [DODGE, MOBILITY],
    featuresAny: true,
  });
  assert.equal(R.describe(any, label, "oder"), "3 HD · Acrobatics 5 oder Climb 5 · Dodge oder Mobility");
});

console.log(`\n${passed} passed`);
