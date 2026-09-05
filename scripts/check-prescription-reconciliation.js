#!/usr/bin/env node
/* Task 2 commit 3: prescription reconciliation, gate-side tally
 * subtraction, dayKey/ambiguity gates, within-batch collision handling,
 * the Gate 8 deload-scaling revision, and restSec/prescribedLoad actually
 * reaching the render layer. See TASK-2-RECONCILIATION-PROPOSAL.txt for
 * the design this verifies.
 *
 * Run: node scripts/check-prescription-reconciliation.js (wired into
 * `npm test`).
 */
const assert = require("assert");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "applyCoachGates", "buildGateContext", "applyGatedPrescriptions",
  "resolveDayExercises", "recommend", "restFor", "getProgram",
  "EX_BY_ID", "weeklySetsByGroup", "DEFAULT_FOCUS", "PROGRAMS",
  "MUSCLE_GROUPS", "CAT_TO_GROUP", "gate1cDayKey", "gate1dAmbiguousMatch",
]);
const { DEFAULT_FOCUS } = app;

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

const NOT_RECOVERING = { recoveringMode: false };
function baseData(overrides) {
  return {
    plan: { template: "balanced", sessionMin: 60 },
    focus: DEFAULT_FOCUS, swaps: {}, sessions: [],
    injuryProfile: NOT_RECOVERING, briefTier: "full",
    ...overrides,
  };
}
const upperA = () => app.PROGRAMS.balanced.find((d) => d.id === "upperA");

/* ===== 1. REPLACE — in place, no double count ===== */
{
  const data = baseData({ plan: { template: "balanced", sessionMin: 60, prescriptions: [
    { exerciseId: "bench", dayKey: "upperA", sets: 5, load: 100 },
  ] } });
  const list = app.resolveDayExercises(upperA(), data);
  ok("REPLACE: list length unchanged (6, not 7)", list.length === 6, `got ${list.length}`);
  const bench = list.find((e) => e.ex.id === "bench");
  ok("REPLACE: sets overridden", bench.ex.sets === 5);
  ok("REPLACE: prescribedLoad set from load", bench.ex.prescribedLoad === 100);
  ok("REPLACE: tagged prescribed/replace", bench.ex.prescribed === true && bench.ex.prescriptionApplied === "replace");
  const groupSets = app.weeklySetsByGroup(data);
  const baseline = app.weeklySetsByGroup(baseData({ plan: { template: "balanced", sessionMin: 60 } }));
  ok("REPLACE: chest tally moved by exactly the delta (+2), not the full new value",
    groupSets.chest - baseline.chest === 2, `baseline ${baseline.chest} -> ${groupSets.chest}`);
}

/* ===== 2. ADD — new entry, full addition to the tally ===== */
{
  const data = baseData({ plan: { template: "balanced", sessionMin: 60, prescriptions: [
    { exerciseId: "dips", dayKey: "upperA", sets: 3, repMin: 8, repMax: 12 },
  ] } });
  const list = app.resolveDayExercises(upperA(), data);
  ok("ADD: list grows by one (7)", list.length === 7, `got ${list.length}`);
  const added = list.find((e) => e.ex.id === "dips");
  ok("ADD: new entry present with prescribed fields", !!added && added.ex.sets === 3 && added.ex.prescriptionApplied === "add");
  const groupSets = app.weeklySetsByGroup(data);
  const baseline = app.weeklySetsByGroup(baseData({ plan: { template: "balanced", sessionMin: 60 } }));
  ok("ADD: chest tally moved by the full added amount (+3)",
    groupSets.chest - baseline.chest === 3, `baseline ${baseline.chest} -> ${groupSets.chest}`);
}

/* ===== 3. Ambiguous match at render time — defensive skip, not a guess ===== */
{
  // Two DIFFERENT real slots (bench, csrow) independently swapped to the
  // SAME replacement exercise — the only way a real day's list ends up
  // with a repeated exerciseId (verified in commit 1: no template's
  // static day list repeats one on its own).
  const data = baseData({
    swaps: { bench: "dips", csrow: "dips" },
    plan: { template: "balanced", sessionMin: 60, prescriptions: [
      { exerciseId: "dips", dayKey: "upperA", sets: 6 },
    ] },
  });
  const list = app.resolveDayExercises(upperA(), data);
  const dipsEntries = list.filter((e) => e.ex.id === "dips");
  ok("ambiguous render-time: both convergent slots present", dipsEntries.length === 2);
  ok("ambiguous render-time: neither was overridden (still base 3 sets, not 6)",
    dipsEntries.every((e) => e.ex.sets === 3), JSON.stringify(dipsEntries.map((e) => e.ex.sets)));
}

/* ===== 4. Gate 1c — dayKey required and must be valid ===== */
{
  const ctx = app.buildGateContext(baseData({}), {});
  const missing = app.gate1cDayKey({ exerciseId: "bench" }, ctx);
  ok("missing dayKey rejected", missing.reject === true && /missing dayKey/.test(missing.reason), missing.reason);
  const invalid = app.gate1cDayKey({ exerciseId: "bench", dayKey: "notaday" }, ctx);
  ok("invalid dayKey rejected, names valid days", invalid.reject === true && /notaday/.test(invalid.reason) && /upperA/.test(invalid.reason), invalid.reason);
  const valid = app.gate1cDayKey({ exerciseId: "bench", dayKey: "upperA" }, ctx);
  ok("valid dayKey accepted", valid.reject === false);
}

/* ===== 5. Gate 1d — ambiguous match rejected at gate time, names both slots ===== */
{
  const data = baseData({ swaps: { bench: "dips", csrow: "dips" } });
  const ctx = app.buildGateContext(data, {});
  const result = app.applyGatedPrescriptions([{ exerciseId: "dips", dayKey: "upperA", sets: 5 }], ctx);
  ok("ambiguous match rejected at gate time", result.accepted.length === 0 && result.rejections.length === 1);
  const reason = result.rejections[0] && result.rejections[0].reason;
  ok("rejection names both slot ids (bench, csrow)", reason && /bench/.test(reason) && /csrow/.test(reason), reason);
}

/* ===== 6. Within-batch collision — deterministic first-wins, names what happened ===== */
{
  const data = baseData({});
  const ctx = app.buildGateContext(data, {});
  const result = app.applyGatedPrescriptions([
    { exerciseId: "pressdn", dayKey: "upperA", sets: 2 },
    { exerciseId: "pressdn", dayKey: "upperA", sets: 4 },
  ], ctx);
  ok("first survives, second rejected", result.accepted.length === 1 && result.rejections.length === 1);
  ok("the FIRST one (array order) is the one kept", result.accepted[0] && result.accepted[0].sets === 2, JSON.stringify(result.accepted));
  const reason = result.rejections[0] && result.rejections[0].reason;
  ok("rejection explains it was already applied earlier in this plan", reason && /already applied earlier in this same plan/.test(reason), reason);
}

/* ===== 7. Tally subtraction fixes the legs-cap headroom gap =====
 * legs baseline (balanced, default focus) = 26 sets; mav = 20; default cap
 * = max(mav, baseline) = 26 — already at/over the group's own mav, so
 * there is deliberately zero naive headroom. A REPLACE that trims 2 sets
 * off legpress (3 -> 1) and an ADD of a new 2-set leg exercise should net
 * to exactly 26 again (26 - 3 + 1 + 2), NOT be evaluated as 26 + 1 + 2 =
 * 29 (which would wrongly reject against the 26 cap — the exact bug
 * DEFERRED-TESTS.md's handoff item 2 described). */
{
  const data = baseData({});
  const baseline = app.weeklySetsByGroup(data);
  ok("sanity: legs baseline is 26 as expected by this test's arithmetic", baseline.legs === 26, `got ${baseline.legs}`);
  ok("sanity: legs mav is 20 (baseline already at/above mav)", app.MUSCLE_GROUPS.legs.mav === 20);
  const ctx = app.buildGateContext(data, {});
  const result = app.applyGatedPrescriptions([
    { exerciseId: "legpress", dayKey: "lowerA", sets: 1 },   // REPLACE: 3 -> 1 (-2)
    { exerciseId: "hacksquat", dayKey: "lowerA", sets: 2 },  // ADD: +2
  ], ctx);
  ok("both accepted (net-neutral volume change should not trip the cap)",
    result.accepted.length === 2 && result.rejections.length === 0,
    JSON.stringify(result.rejections));
}
// Negative control: prove the subtraction is actually doing something —
// an ADD-only version of the same net change (no replace to offset it)
// SHOULD be rejected, since it pushes legs to 26 + 2 = 28 > cap 26.
{
  const data = baseData({});
  const ctx = app.buildGateContext(data, {});
  const result = app.applyGatedPrescriptions([
    { exerciseId: "hacksquat", dayKey: "lowerA", sets: 2 }, // pure ADD, no offsetting replace
  ], ctx);
  ok("negative control: a pure addition against an at-cap group IS rejected",
    result.accepted.length === 0 && result.rejections.length === 1 && result.rejections[0].gate === 6,
    JSON.stringify(result.rejections));
}

/* ===== 8. prescribedLoad in recommend() — deload-aware ===== */
{
  const ex = { id: "x", cat: "hpress", prescribedLoad: 100, repMin: 6, repMax: 10 };
  const noDeload = app.recommend(ex, [], false);
  ok("prescribed load used verbatim when not deloading", noDeload.weight === 100 && noDeload.tag === "Prescribed", JSON.stringify(noDeload));
  const deload = app.recommend(ex, [], true);
  ok("prescribed load scaled ~90% during deload, tagged Deload", deload.weight === 90 && deload.tag === "Deload", JSON.stringify(deload));
}

/* ===== 9. restSec reaches restFor (display AND duration math share one source) ===== */
{
  check("restSec < 60 formatted in seconds", app.restFor({ cat: "biceps", restSec: 45 }), { sec: 45, label: "45 s" });
  check("restSec >= 60 formatted in minutes", app.restFor({ cat: "biceps", restSec: 150 }), { sec: 150, label: "2.5 min" });
  check("no restSec falls through to the category default, unchanged", app.restFor({ cat: "squat" }), { sec: 180, label: "2–3 min" });
}

/* ===== 10. Gate 8 — stored prescriptions hold RAW values, never deload-scaled ===== */
{
  const futureDeload = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const data = baseData({ phase: { deloadUntil: futureDeload } });
  const rec = { template: "balanced", focus: {}, sessionMin: 60, calorieDelta: 0,
    prescriptions: [{ exerciseId: "bench", dayKey: "upperA", sets: 4, load: 100 }] };
  const gated = app.applyCoachGates(rec, {}, NOT_RECOVERING, data);
  ok("deload was in fact active for this test", (gated.prescriptionNotes || []).some((n) => /Deload week active/.test(n.note)), JSON.stringify(gated.prescriptionNotes));
  const stored = gated.prescriptions.find((p) => p.exerciseId === "bench");
  ok("stored load is the RAW prescribed value (100), not deload-scaled (90)", stored && stored.load === 100, JSON.stringify(stored));
  ok("stored sets are RAW (4), not deload-scaled", stored && stored.sets === 4, JSON.stringify(stored));
}

/* ===== 11. lastDone-equivalent now sees ADDed exercises, still not bonus ===== */
{
  const data = baseData({
    plan: { template: "balanced", sessionMin: 60, prescriptions: [
      { exerciseId: "dips", dayKey: "upperA", sets: 3 },
    ] },
    sessions: [{ id: 1, date: "2026-08-20", exerciseId: "dips", sets: [{ w: 0, r: 10 }], pain: null, painRetro: null, painRetroAt: null, painRetroDismissed: false }],
  });
  const ids = app.resolveDayExercises(upperA(), data).filter((e) => !e.ex.isBonus).map((e) => e.ex.id);
  ok("ADDed exercise id is in the lastDone-equivalent id set", ids.includes("dips"), JSON.stringify(ids));
  const dates = data.sessions.filter((s) => ids.includes(s.exerciseId)).map((s) => s.date);
  ok("a session logged only against the ADDed exercise now registers as 'last done'", dates.length === 1 && dates[0] === "2026-08-20");
}
{
  // Regression from commit 1: bonus lifts still excluded from lastDone.
  const specData = baseData({
    focus: { ...DEFAULT_FOCUS, arms: "specialize" },
    sessions: [{ id: 1, date: "2026-08-20", exerciseId: "bonus_ohtri", sets: [{ w: 30, r: 10 }], pain: null, painRetro: null, painRetroAt: null, painRetroDismissed: false }],
  });
  const ids = app.resolveDayExercises(upperA(), specData).filter((e) => !e.ex.isBonus).map((e) => e.ex.id);
  ok("bonus lift id excluded from lastDone-equivalent set", !ids.includes("bonus_ohtri"), JSON.stringify(ids));
}

if (failures > 0) {
  console.error(`\nPRESCRIPTION-RECONCILIATION CHECK FAILED: ${failures}/${checks} assertions failed.`);
  process.exit(1);
}
console.log(`Prescription-reconciliation check passed: ${checks} assertions — REPLACE/ADD semantics, gate-side tally subtraction, dayKey/ambiguity gates, within-batch collisions, Gate 8's render-time-only deload scaling, and restSec/prescribedLoad reaching the render layer all verified.`);
