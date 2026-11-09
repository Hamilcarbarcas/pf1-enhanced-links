// Supplement prerequisites (src/scripts/prereq-rules.mjs, DESIGN.md § Feature 9): normalizing
// entries, finding one by uuid, replacing and clearing it, skill rank reading (subskills, any
// Knowledge), what's unmet, and the summary text.
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
  assert.deepEqual(p, { uuid: A, bab: 6, hd: null, skills: [{ skill: "acr", ranks: 15 }] });
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
    { kind: "skill", skill: "crf", need: 10, have: 9 },
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

console.log(`\n${passed} passed`);
