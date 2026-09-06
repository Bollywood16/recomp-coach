#!/usr/bin/env node
/* Task 3, logger UI round: buildSegmentRows (pre-fill per
 * totalSegmentsFor, requirement 1) and formatSchemeSets (legible
 * rendering, requirement 3). The UI wiring itself (ExerciseCard, the Log
 * tab's quick-log form) isn't unit-testable through this harness — see
 * check-set-scheme-e2e.js for the real end-to-end browser verification
 * the user asked for (prescribe a backoff scheme, log it, confirm
 * recommend() doesn't read it as decay next time).
 *
 * Run: node scripts/check-set-scheme-logger.js (wired into `npm test`).
 */
const assert = require("assert");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp(["buildSegmentRows", "formatSchemeSets"]);

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

/* ===== buildSegmentRows: requirement 1's pre-fill ===== */
check("straight/no scheme: N rows, all 'top', at the recommended weight",
  app.buildSegmentRows({ sets: 3 }, { weight: 95 }),
  [{ w: "95", r: "", segment: "top" }, { w: "95", r: "", segment: "top" }, { w: "95", r: "", segment: "top" }]);

check("backoff: topSets at top weight, backoffSets at backoffLoadPct of it",
  app.buildSegmentRows({ sets: 4, scheme: { type: "backoff", topSets: 2, backoffSets: 2, backoffLoadPct: 80 } }, { weight: 100 }),
  [
    { w: "100", r: "", segment: "top" }, { w: "100", r: "", segment: "top" },
    { w: "80", r: "", segment: "backoff" }, { w: "80", r: "", segment: "backoff" },
  ]);

check("backoff: an absolute backoffLoad wins over the percentage default",
  app.buildSegmentRows({ sets: 3, scheme: { type: "backoff", topSets: 2, backoffSets: 1, backoffLoad: 70 } }, { weight: 100 }),
  [{ w: "100", r: "", segment: "top" }, { w: "100", r: "", segment: "top" }, { w: "70", r: "", segment: "backoff" }]);

check("drop lastSet: N top rows then exactly one drop row appended after the last",
  app.buildSegmentRows({ sets: 3, scheme: { type: "drop", drops: 1, dropPct: 20, appliesTo: "lastSet" } }, { weight: 100 }),
  [
    { w: "100", r: "", segment: "top" }, { w: "100", r: "", segment: "top" }, { w: "100", r: "", segment: "top" },
    { w: "80", r: "", segment: "drop" },
  ]);

check("drop allSets: every top row gets its own drop row immediately after",
  app.buildSegmentRows({ sets: 2, scheme: { type: "drop", drops: 1, dropPct: 25, appliesTo: "allSets" } }, { weight: 80 }),
  [
    { w: "80", r: "", segment: "top" }, { w: "60", r: "", segment: "drop" },
    { w: "80", r: "", segment: "top" }, { w: "60", r: "", segment: "drop" },
  ]);

{
  // Bodyweight guard: round5's floor of 5 must not manufacture a fake
  // "5 lb" backoff/drop load for a pure-bodyweight exercise.
  const rows = app.buildSegmentRows({ sets: 3, scheme: { type: "backoff", topSets: 2, backoffSets: 1, backoffLoadPct: 80 } }, { weight: 0 });
  ok("bodyweight exercise's backoff stays bodyweight (blank), not a manufactured '5'",
    rows.every((r) => r.w === ""), JSON.stringify(rows));
}

/* ===== formatSchemeSets: requirement 3, matching the spec's own example ===== */
ok("matches the spec's literal example exactly",
  app.formatSchemeSets([{ w: 12.5, r: 15, segment: "top" }, { w: 12.5, r: 15, segment: "top" }, { w: 10, r: 15, segment: "backoff" }, { w: 10, r: 15, segment: "backoff" }])
    === "2 × 15 @ 12.5 lb, then 2 × 15 @ 10 lb");

ok("plain unscemed session: one group, no 'then', no label",
  app.formatSchemeSets([{ w: 95, r: 8, segment: "top" }, { w: 95, r: 8, segment: "top" }]) === "2 × 8 @ 95 lb");

ok("legacy rows with no segment field at all render identically to 'top'",
  app.formatSchemeSets([{ w: 95, r: 8 }, { w: 95, r: 8 }]) === "2 × 8 @ 95 lb");

ok("varied reps within one group falls back to a slash-joined list, not a silently-picked number",
  app.formatSchemeSets([{ w: 95, r: 8, segment: "top" }, { w: 95, r: 7, segment: "top" }]) === "2 × 8/7 @ 95 lb");

ok("drop segment renders as its own trailing group",
  app.formatSchemeSets([{ w: 95, r: 8, segment: "top" }, { w: 95, r: 8, segment: "top" }, { w: 75, r: 12, segment: "drop" }])
    === "2 × 8 @ 95 lb, then 1 × 12 @ 75 lb");

ok("bodyweight rows render as 'BW', not '0'",
  app.formatSchemeSets([{ w: 0, r: 10, segment: "top" }]) === "1 × 10 @ BW lb");

ok("empty input returns empty string, not a crash", app.formatSchemeSets([]) === "");

if (failures > 0) {
  console.error(`\nSET-SCHEME LOGGER CHECK FAILED: ${failures}/${checks} assertions failed.`);
  process.exit(1);
}
console.log(`Set-scheme logger check passed: ${checks} assertions — buildSegmentRows' per-segment pre-fill (straight/backoff/drop, both appliesTo values, the bodyweight guard) and formatSchemeSets' legible rendering (matching the spec's own example exactly, migration-safe, varied-data fallback) both verified.`);
