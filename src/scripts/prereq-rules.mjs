/* PF1 Enhanced Links – supplement prerequisites: the rules (DESIGN.md § Feature 9)
 *
 * Pure: no Foundry globals, so it tests in Node. supplement-prereqs.mjs reads the
 * actor and the parent's flag and hands the plain values in.
 */

/**
 * Parent flag: [{ uuid, bab, hd, skills: [{ skill, sub, ranks }], skillsAny,
 * features: [{ uuid, name, type, tag }], featuresAny }].
 */
export const PREREQ_FLAG = "supplementPrereqs";

/** Pseudo skill key: the highest rank among the Knowledge skills. */
export const KNOWLEDGE = "knowledge";

/** PF1's Knowledge skills and any module's (kps, kma) share this key shape. */
const KNOWLEDGE_KEY = /^k[a-z]{2}$/;

const count = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

const text = (v) => (typeof v === "string" ? v.trim() : "");

/** Case and punctuation dropped: "String Instruments", "stringInstruments" and "string-instruments" agree. */
export const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function normalizeSkill(s) {
  const skill = text(s?.skill);
  const sub = skill === KNOWLEDGE ? "" : text(s?.sub);
  return { skill, sub: sub || null, ranks: count(s?.ranks) };
}

function normalizeFeature(f) {
  return { uuid: text(f?.uuid), name: text(f?.name), type: text(f?.type), tag: text(f?.tag) || null };
}

/** One entry in a shape the rest can rely on. Blank fields are dropped. */
export function normalize(raw) {
  const skills = (Array.isArray(raw?.skills) ? raw.skills : []).map(normalizeSkill).filter((s) => s.skill && s.ranks);
  const seen = new Set();
  const features = (Array.isArray(raw?.features) ? raw.features : [])
    .map(normalizeFeature)
    .filter((f) => f.uuid && !seen.has(f.uuid) && seen.add(f.uuid));
  return {
    uuid: text(raw?.uuid),
    bab: count(raw?.bab),
    hd: count(raw?.hd),
    skills,
    skillsAny: raw?.skillsAny === true,
    features,
    featuresAny: raw?.featuresAny === true,
  };
}

/** Nothing to check. */
export const isEmpty = (p) => !p || (!p.bab && !p.hd && !(p.skills?.length > 0) && !(p.features?.length > 0));

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

/** A family's subskill key for a named subskill: the key itself, else one whose key or name matches. */
export function findSubskill(subSkills, sub) {
  if (!subSkills || !sub) return null;
  if (subSkills[sub]) return sub;
  const want = slug(sub);
  return Object.entries(subSkills).find(([k, s]) => slug(k) === want || slug(s?.name) === want)?.[0] ?? null;
}

/**
 * A skill's rank. With `sub`, that one subskill's (0 when the actor lacks it); without,
 * the skill's own rank or its highest subskill; the highest Knowledge for the pseudo-key.
 * `find(family, sub, subSkills)` picks the actor's subskill key.
 */
export function skillRank(skills, key, sub = null, find = (_f, s, subs) => findSubskill(subs, s)) {
  if (!skills) return 0;
  if (key === KNOWLEDGE) {
    return Math.max(0, ...Object.entries(skills).filter(([k]) => KNOWLEDGE_KEY.test(k)).map(([k]) => skillRank(skills, k)));
  }
  const skill = skills[key];
  if (!skill) return 0;
  const subSkills = skill.subSkills ?? {};
  if (sub) {
    const found = find(key, sub, subSkills);
    return found && subSkills[found] ? Number(subSkills[found].rank) || 0 : 0;
  }
  const subs = Object.values(subSkills).map((s) => Number(s?.rank) || 0);
  return Math.max(Number(skill.rank) || 0, ...subs);
}

/**
 * Whether a held list covers a feature: a source uuid in common, or the same type and
 * identifier. Held entries: { keys: string[], type, tag }, keys already passed through `key`.
 */
export function holds(held, feature, key = (u) => u) {
  const want = feature.uuid ? key(feature.uuid) : null;
  return (held ?? []).some(
    (h) => (want && h.keys?.includes(want)) || (!!feature.tag && h.type === feature.type && h.tag === feature.tag)
  );
}

/**
 * What isn't met. All-mode lists: one row per failed member. Any-mode lists with more
 * than one member: one row naming every member, only when none is met.
 * @param {object} prereq        A normalized entry.
 * @param {object} stats         { bab, hd, skills, held, key, find } read off the actor.
 * @returns {object[]}           { kind: "bab"|"hd"|"skill"|"skillAny"|"feature"|"featureAny", ... }
 */
export function unmet(prereq, { bab = 0, hd = 0, skills = {}, held = [], key, find } = {}) {
  if (isEmpty(prereq)) return [];
  const out = [];
  if (prereq.bab && bab < prereq.bab) out.push({ kind: "bab", need: prereq.bab, have: bab });
  if (prereq.hd && hd < prereq.hd) out.push({ kind: "hd", need: prereq.hd, have: hd });

  const rows = (prereq.skills ?? []).map(({ skill, sub, ranks }) => ({
    skill,
    sub: sub ?? null,
    need: ranks,
    have: skillRank(skills, skill, sub, find),
  }));
  const shortRows = rows.filter((r) => r.have < r.need);
  if (prereq.skillsAny && rows.length > 1) {
    if (shortRows.length === rows.length) out.push({ kind: "skillAny", options: rows });
  } else {
    for (const r of shortRows) out.push({ kind: "skill", ...r });
  }

  const features = prereq.features ?? [];
  const missing = features.filter((f) => !holds(held, f, key));
  if (prereq.featuresAny && features.length > 1) {
    if (missing.length === features.length) out.push({ kind: "featureAny", names: features.map((f) => f.name) });
  } else {
    for (const f of missing) out.push({ kind: "feature", name: f.name });
  }
  return out;
}

export const meets = (prereq, stats) => unmet(prereq, stats).length === 0;

/**
 * "BAB +6 · 5 HD · Acrobatics 15 or Climb 15 · Dodge", with skill labels from
 * `label(key, sub)` and `or` as the any-mode joiner.
 */
export function describe(prereq, label = (k, sub) => (sub ? `${k} (${sub})` : k), or = "or") {
  if (isEmpty(prereq)) return "";
  const parts = [];
  if (prereq.bab) parts.push(`BAB +${prereq.bab}`);
  if (prereq.hd) parts.push(`${prereq.hd} HD`);
  const skills = prereq.skills.map(({ skill, sub, ranks }) => `${label(skill, sub)} ${ranks}`);
  if (prereq.skillsAny && skills.length > 1) parts.push(skills.join(` ${or} `));
  else parts.push(...skills);
  const features = (prereq.features ?? []).map((f) => f.name);
  if (prereq.featuresAny && features.length > 1) parts.push(features.join(` ${or} `));
  else parts.push(...features);
  return parts.join(" · ");
}
