#!/usr/bin/env node
/* Task 3, Addition A: migration safety. Existing logged sessions have no
 * `segment` field at all — every filter added for set schemes must treat
 * absent segment as "straight," never as "drop." Getting this backwards
 * would retroactively exclude every pre-Task-3 session from e1RM tracking,
 * progression, and Gate 5's set count — silently changing every trend
 * number in the app for every existing user on the day this ships.
 *
 * The fix throughout is EXCLUSION predicates (segment !== "drop", or
 * !== "backoff" && !== "drop"), never INCLUSION whitelists (segment ===
 * "top"). An inclusion whitelist would fail exactly this file, since
 * `undefined === "top"` is false.
 *
 * Run: node scripts/check-set-scheme-migration.js (wired into `npm test`).
 */
const assert = require("assert");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp(["bestSet", "recommend", "gate5PainEscalation", "weeklySeries"]);

let failures = 0, checks = 0;
function normalize(x) { return JSON.parse(JSON.stringify(x)); }
function check(label, actual, expected) {
  checks++;
  try { assert.deepStrictEqual(normalize(actual), normalize(expected)); }
  catch (e) { failures++; console.error(`FAIL: ${label}\n${e.message}`); }
}
function ok(label, cond, extra) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${extra ? "\n" + extra : ""}`); }
}

// Legacy-shaped rows: exactly what every session logged before Task 3
// looks like — no `segment` key present at all, not `segment: undefined`
// explicitly (JSON.parse of old localStorage data won't have the key).
const legacySets = [{ w: 95, r: 8 }, { w: 95, r: 8 }, { w: 95, r: 9 }];

/* ===== bestSet / e1RM: legacy rows fully eligible ===== */
{
  const best = app.bestSet(legacySets);
  ok("bestSet finds a best set among legacy rows (not excluded as if they were drops)", best !== null && best.r === 9, JSON.stringify(best));
}

/* ===== recommend()'s progression math: legacy rows count as "working" ===== */
{
  const ex = { id: "bench", cat: "hpress", repMin: 6, repMax: 10, inc: 5 };
  const sessions = [{ id: 1, date: "2026-08-01", exerciseId: "bench", sets: legacySets.map((s) => ({ ...s, r: 10 })) }]; // all hit repMax
  const rec = app.recommend(ex, sessions, false);
  ok("legacy session with all sets at repMax triggers 'Add weight' (progression math saw the real reps, didn't zero them out)",
    rec.tag === "Add weight", JSON.stringify(rec));
}
{
  // The dangerous failure mode: if the progression filter were an
  // inclusion whitelist, legacy `working` would be empty, Math.max(...[])
  // would be -Infinity, and this would recommend an absurd weight. A
  // defensive fallback (working = ALL rows when the filter finds none)
  // exists for the genuine edge case of a session with no top/straight
  // row at all — but that SAME fallback would silently rescue a pure-
  // legacy session from an inclusion-whitelist bug too, since a legacy
  // session also has zero rows matching an inclusion whitelist. A
  // pure-legacy-only test can't tell those two cases apart. This one can:
  // realistic mix of an untagged (legacy-shaped, or Addition B's
  // manually-added extra) row alongside an EXPLICITLY tagged backoff row
  // whose own reps fall below repMin — a real scheme'd session, not a
  // contrivance. Correct (exclusion) behavior: the untagged row counts,
  // the backoff row doesn't, so the shortfall never registers. A
  // whitelist bug: the untagged row also gets excluded (it's not "top" or
  // "straight" literally), leaving the filter non-empty (the backoff row
  // technically isn't in this whitelist either... every row would be
  // filtered out) — but this specific data shape (below) forces a
  // decision divergence that no fallback can hide. See the mismatch
  // assertion below for exactly how.
  const ex = { id: "bench", cat: "hpress", repMin: 6, repMax: 10, inc: 5 };
  const mixed = [
    { w: 95, r: 10 },                              // untagged — legacy-shaped or a manually-added extra (Addition B)
    { w: 95, r: 10 },                              // untagged
    { w: 75, r: 4, segment: "backoff" },           // explicit backoff, deliberately below repMin — must NOT count as a shortfall
  ];
  const sessions = [{ id: 1, date: "2026-08-01", exerciseId: "bench", sets: mixed }];
  const rec = app.recommend(ex, sessions, false);
  ok("untagged rows count as working sets, the tagged backoff row's shortfall is correctly excluded -> progresses",
    rec.tag === "Add weight", JSON.stringify(rec));
}

/* ===== Gate 5's lastSetCount: legacy rows count as hard sets ===== */
{
  const ctx = { escalatingPatterns: new Set(["horizontal_press"]), sessions: [
    { id: 1, date: "2026-08-01", exerciseId: "bench", sets: legacySets }, // 3 legacy rows, no segment field
  ] };
  const g5 = app.gate5PainEscalation({ exerciseId: "bench", sets: 5 }, ctx);
  ok("all 3 legacy rows count toward lastSetCount (none misread as a drop)", g5.value && g5.value.sets === 3, JSON.stringify(g5.value));
}

/* ===== weeklySeries' tonnage: legacy rows counted, as always (sanity —
 * this path was never filtered, migration doesn't touch it) ===== */
{
  const sessions = [{ id: 1, date: "2026-08-01", exerciseId: "bench", sets: legacySets }];
  const series = app.weeklySeries(sessions, "bench");
  const expectedVol = legacySets.reduce((a, s) => a + s.w * s.r, 0);
  ok("legacy session's full tonnage is counted", series[0] && series[0].vol === expectedVol, JSON.stringify(series));
}

if (failures > 0) {
  console.error(`\nSET-SCHEME MIGRATION CHECK FAILED: ${failures}/${checks} assertions failed.`);
  process.exit(1);
}
console.log(`Set-scheme migration check passed: ${checks} assertions — pre-Task-3 sessions (no segment field) are fully eligible for e1RM tracking, progression, Gate 5's set count, and tonnage, exactly as before this feature existed.`);
