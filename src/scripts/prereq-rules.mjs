/* PF1 Enhanced Links — supplement prerequisites: the rules (DESIGN.md § Feature 9)
 *
 * Pure: no Foundry globals, so it tests in Node. supplement-prereqs.mjs reads the
 * actor and the parent's flag and hands the plain values in.
 */

/** Parent flag: [{ uuid, bab, hd, skills: [{ skill, ranks }] }]. */
export const PREREQ_FLAG = "supplementPrereqs";

/** Pseudo skill key: the highest rank among the Knowledge skills. */
export const KNOWLEDGE = "knowledge";

/** PF1's Knowledge skills and any module's (kps, kma) share this key shape. */
const KNOWLEDGE_KEY = /^k[a-z]{2}$/;

const count = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

/** One entry in a shape the rest can rely on. Blank fields are dropped. */
export function normalize(raw) {
  const skills = (Array.isArray(raw?.skills) ? raw.skills : [])
    .map((s) => ({ skill: typeof s?.skill === "string" ? s.skill.trim() : "", ranks: count(s?.ranks) }))
    .filter((s) => s.skill && s.ranks);
  return { uuid: typeof raw?.uuid === "string" ? raw.uuid : "", bab: count(raw?.bab), hd: count(raw?.hd), skills };
}

/** Nothing to check. */
export const isEmpty = (p) => !p || (!p.bab && !p.hd && !(p.skills?.length > 0));

/**
 * The entry for one supplement in a parent's stored list, normalized, or null.
 * `key` makes uuids comparable (the system's uniformUuid in Foundry).
 */
export function prereqFor(stored, uuid, key = (u) => u) {
  if (!Array.isArray(stored) || !uuid) return null;
  const want = key(uuid);
  const found = stored.find((e) => e?.uuid && key(e.uuid) === want);
  const entry = found ? normalize(found) : null;
  return entry && !isEmpty(entry) ? entry : null;
}

/** Replace (or, when empty, remove) one supplement's entry. Returns the new list. */
export function withPrereq(stored, entry, key = (u) => u) {
  const list = Array.isArray(stored) ? stored.filter((e) => e?.uuid && key(e.uuid) !== key(entry.uuid)) : [];
  const clean = normalize(entry);
  return isEmpty(clean) ? list : [...list, clean];
}

/** A skill's rank: its own, or the highest of its subskills; the highest Knowledge for the pseudo-key. */
export function skillRank(skills, key) {
  if (!skills) return 0;
  if (key === KNOWLEDGE) {
    return Math.max(0, ...Object.entries(skills).filter(([k]) => KNOWLEDGE_KEY.test(k)).map(([k]) => skillRank(skills, k)));
  }
  const skill = skills[key];
  if (!skill) return 0;
  const subs = Object.values(skill.subSkills ?? {}).map((s) => Number(s?.rank) || 0);
  return Math.max(Number(skill.rank) || 0, ...subs);
}

/**
 * What isn't met, one row per failed rule.
 * @param {object} prereq        A normalized entry.
 * @param {object} stats         { bab, hd, skills } read off the actor.
 * @returns {{kind: string, need: number, have: number, skill?: string}[]}
 */
export function unmet(prereq, { bab = 0, hd = 0, skills = {} } = {}) {
  if (isEmpty(prereq)) return [];
  const out = [];
  if (prereq.bab && bab < prereq.bab) out.push({ kind: "bab", need: prereq.bab, have: bab });
  if (prereq.hd && hd < prereq.hd) out.push({ kind: "hd", need: prereq.hd, have: hd });
  for (const { skill, ranks } of prereq.skills ?? []) {
    const have = skillRank(skills, skill);
    if (have < ranks) out.push({ kind: "skill", skill, need: ranks, have });
  }
  return out;
}

export const meets = (prereq, stats) => unmet(prereq, stats).length === 0;

/** "BAB +6 · 5 HD · Acrobatics 15", with skill labels from `label(key)`. */
export function describe(prereq, label = (k) => k) {
  if (isEmpty(prereq)) return "";
  const parts = [];
  if (prereq.bab) parts.push(`BAB +${prereq.bab}`);
  if (prereq.hd) parts.push(`${prereq.hd} HD`);
  for (const { skill, ranks } of prereq.skills) parts.push(`${label(skill)} ${ranks}`);
  return parts.join(" · ");
}
