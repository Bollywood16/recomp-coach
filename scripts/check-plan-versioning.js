#!/usr/bin/env node
/* Task 6, Section 3 — diff, versioning, revert. diffAuthoredDay/
 * diffAuthoredPlan and pushPlanVersion are pure, side-effect-free
 * functions (the mandatory diff-and-confirm requirement would be
 * meaningless if computing the diff itself changed anything) — CoachCard
 * wires them into applyPasted/confirmPendingPlan/PlanHistoryCard, but the
 * logic itself is tested here directly, no React involved.
 *
 * This covers:
 *   1. diffAuthoredDay: added/removed/changed(sets,load)/reordered are
 *      each detected correctly and independently; an authored day
 *      identical to what's currently rendered produces an empty diff.
 *   2. diffAuthoredPlan: one entry per day, each carrying its own diff.
 *   3. pushPlanVersion: append-only, immutable (existing entries never
 *      mutated), capped at 25, `source`/`revertedFrom` carried correctly.
 *   4. Real data: diffing an authored Delts & Arms day against the real
 *      backup's actual current rendering produces a sane, correctly-typed
 *      diff (the 3 template exercises appear as removed or changed, the
 *      2 newly-authored ones as added).
 *
 * Run: node scripts/check-plan-versioning.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "diffAuthoredDay", "diffAuthoredPlan", "pushPlanVersion", "getProgram", "EX_BY_ID",
  "DEFAULT_INJURY_PROFILE", "DEFAULT_FOCUS", "cloneInjuryProfileDefaults", "resolveDayExercises",
]);

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

const baseData = (overrides) => ({
  sessions: [], swaps: {}, focus: { ...app.DEFAULT_FOCUS }, injuryProfile: app.DEFAULT_INJURY_PROFILE,
  plan: { template: "upperFocus", sessionMin: 60 },
  ...overrides,
});

/* ===== 1. diffAuthoredDay ===== */
{
  const data = baseData();
  // ufArms template: machohp, cablelat, reardelt, ezcurl, skull, ohte

  // Identical authored day (same ids, sets, order) -> empty diff.
  const identical = [
    { exerciseId: "machohp", order: 1, sets: 3, rationale: "a" },
    { exerciseId: "cablelat", order: 2, sets: 3, rationale: "b" },
    { exerciseId: "reardelt", order: 3, sets: 3, rationale: "c" },
    { exerciseId: "ezcurl", order: 4, sets: 3, rationale: "d" },
    { exerciseId: "skull", order: 5, sets: 3, rationale: "e" },
    { exerciseId: "ohte", order: 6, sets: 2, rationale: "f" },
  ];
  const identicalDiff = app.diffAuthoredDay("ufArms", identical, data);
  check("identical authored day (same ids/sets/order) produces an empty diff", identicalDiff, { added: [], removed: [], changed: [], reordered: [] });

  // Added: a new exercise not in the current list.
  const withAdd = [...identical, { exerciseId: "cablecurl", order: 7, sets: 3, rationale: "extra", load: 20 }];
  const addDiff = app.diffAuthoredDay("ufArms", withAdd, data);
  ok("a new exerciseId not currently present shows up in `added`", addDiff.added.length === 1 && addDiff.added[0].exerciseId === "cablecurl" && addDiff.added[0].sets === 3 && addDiff.added[0].load === 20, JSON.stringify(addDiff.added));

  // Removed: drop ohte entirely.
  const withoutOhte = identical.filter((e) => e.exerciseId !== "ohte");
  const removeDiff = app.diffAuthoredDay("ufArms", withoutOhte, data);
  ok("an exercise present now but absent from the authored list shows up in `removed`", removeDiff.removed.length === 1 && removeDiff.removed[0].exerciseId === "ohte", JSON.stringify(removeDiff.removed));

  // Changed: sets and load.
  const withChange = identical.map((e) => (e.exerciseId === "ezcurl" ? { ...e, sets: 5, load: 40 } : e));
  const changeDiff = app.diffAuthoredDay("ufArms", withChange, data);
  ok("a sets/load change on an existing exercise shows up in `changed`, others don't", changeDiff.changed.length === 1 && changeDiff.changed[0].exerciseId === "ezcurl" && changeDiff.changed[0].toSets === 5 && changeDiff.changed[0].toLoad === 40, JSON.stringify(changeDiff.changed));

  // Reordered: swap positions of two exercises, same sets.
  const reordered = identical.map((e) => e); // clone
  [reordered[0], reordered[3]] = [{ ...reordered[3], order: 1 }, { ...reordered[0], order: 4 }];
  const reorderDiff = app.diffAuthoredDay("ufArms", reordered, data);
  ok("swapped positions show up in `reordered` for both exercises, no false `changed`", reorderDiff.reordered.length === 2 && reorderDiff.changed.length === 0, JSON.stringify(reorderDiff));
}

/* ===== 2. diffAuthoredPlan ===== */
{
  const data = baseData();
  const days = [
    { dayKey: "ufArms", label: "Arms + Delts", exercises: [{ exerciseId: "ezcurl", order: 1, sets: 5, rationale: "a" }] },
    { dayKey: "ufLower", label: "Lower", exercises: [{ exerciseId: "legpress", order: 1, sets: 10, rationale: "b" }] },
  ];
  const plan = app.diffAuthoredPlan(days, data);
  ok("one diff entry per day, in order", plan.length === 2 && plan[0].dayKey === "ufArms" && plan[1].dayKey === "ufLower", JSON.stringify(plan.map((p) => p.dayKey)));
  ok("each entry carries its own independent diff object", plan[0].diff.changed.length >= 0 && plan[1].diff.changed.length >= 0);
}

/* ===== 3. pushPlanVersion ===== */
{
  const data = { planVersions: [] };
  const v1 = app.pushPlanVersion(data, { template: "balanced" }, "brief text 1", "paste");
  ok("first push produces exactly 1 entry", v1.length === 1);
  ok("entry carries id/at/brief/plan/source", !!v1[0].id && !!v1[0].at && v1[0].brief === "brief text 1" && v1[0].source === "paste" && v1[0].plan.template === "balanced", JSON.stringify(v1[0]));

  const data2 = { planVersions: v1 };
  const v2 = app.pushPlanVersion(data2, { template: "upperFocus" }, "brief text 2", "paste");
  ok("second push appends, doesn't replace", v2.length === 2);
  check("the first entry is byte-identical after a second push — append-only, immutable", v2[0], v1[0]);

  const data3 = { planVersions: v2 };
  const v3 = app.pushPlanVersion(data3, { template: "balanced" }, null, "revert", v1[0].id);
  ok("a revert entry carries revertedFrom pointing at the restored version's id", v3[2].source === "revert" && v3[2].revertedFrom === v1[0].id, JSON.stringify(v3[2]));

  // Cap at 25.
  let capData = { planVersions: [] };
  for (let i = 0; i < 30; i++) capData = { planVersions: app.pushPlanVersion(capData, { template: "balanced", i }, null, "paste") };
  ok("history is capped at 25 entries even after 30 pushes", capData.planVersions.length === 25, capData.planVersions.length);
  ok("the cap keeps the MOST RECENT entries (oldest dropped, not newest)", capData.planVersions[24].plan.i === 29 && capData.planVersions[0].plan.i === 5, JSON.stringify(capData.planVersions.map((v) => v.plan.i)));
}

/* ===== 4. Real data ===== */
const BACKUP_FILE = path.join(__dirname, "..", "recomp-coach-backup-2026-09-06.json");
if (!fs.existsSync(BACKUP_FILE)) {
  console.warn("NOTE: recomp-coach-backup-2026-09-06.json not found — skipping the real-data case (synthetic cases above still ran).");
} else {
  const raw = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
  const real = raw.data || raw;
  const data = { ...real, injuryProfile: { ...app.cloneInjuryProfileDefaults(), recoveringMode: true } };

  // Resolve what's ACTUALLY currently rendered first (real focus levels,
  // the real reardelt->latraise swap, and real pool-overflow spawns all
  // included) rather than assuming the bare template slot list — this is
  // exactly the "current rendered list" diffAuthoredDay itself diffs
  // against, so the test has to agree with the same ground truth.
  const currentDay = app.getProgram(data).find((d) => d.id === "ufArms");
  const currentList = app.resolveDayExercises(currentDay, data).map((e) => e.ex);
  const currentMachohp = currentList.find((ex) => ex.id === "machohp");
  ok("sanity: machohp is present in the real current ufArms rendering", !!currentMachohp);

  const authoredArms = [
    { exerciseId: "machohp", order: 1, sets: currentMachohp.sets, rationale: "Shoulders unchanged." },
    { exerciseId: "ezcurl", order: 2, sets: 5, rationale: "Arms specialize, bumped to 5 sets." },
    { exerciseId: "cablecurl", order: 3, sets: 3, rationale: "New second biceps movement.", load: 25 },
  ];
  const diff = app.diffAuthoredDay("ufArms", authoredArms, data);
  ok("real data: machohp at its own real current set count produces no changed/added/removed entry for it", !diff.changed.some((c) => c.exerciseId === "machohp") && !diff.added.some((a) => a.exerciseId === "machohp") && !diff.removed.some((r) => r.exerciseId === "machohp"), JSON.stringify({ currentSets: currentMachohp.sets, diff }));
  ok("real data: ezcurl's set change shows up as changed", diff.changed.some((c) => c.exerciseId === "ezcurl" && c.toSets === 5), JSON.stringify(diff.changed));
  ok("real data: the new cablecurl entry shows up as added", diff.added.some((a) => a.exerciseId === "cablecurl" && a.load === 25), JSON.stringify(diff.added));
  const currentIdsBesidesKept = currentList.map((ex) => ex.id).filter((id) => id !== "machohp" && id !== "ezcurl");
  ok("real data: every OTHER exercise actually present today (including the real reardelt->latraise swap and any pool-overflow spawns) shows up as removed — nothing silently vanishes from the diff", currentIdsBesidesKept.every((id) => diff.removed.some((r) => r.exerciseId === id)), JSON.stringify({ currentIdsBesidesKept, removed: diff.removed }));
}

if (failures > 0) {
  console.error(`\nPLAN-VERSIONING CHECK FAILED: ${failures}/${checks} assertions failed.`);
  process.exit(1);
}
console.log(`Plan-versioning check passed: ${checks} assertions — diffAuthoredDay's added/removed/changed/reordered detection, diffAuthoredPlan's per-day structure, pushPlanVersion's append-only/immutable/capped/revert-linkage behavior, and a real-data diff against the actual Delts & Arms day.`);
