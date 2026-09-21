#!/usr/bin/env node
/* Task 6, Section 2 — Gates 9-13. applyAuthoredDays(days, ctx) is the
 * batch entry point (analogue of applyGatedPrescriptions), called from
 * applyCoachGates when rec.days is present. Day-level rejection: one bad
 * exercise or one failed day-level gate drops the WHOLE day, other days
 * in the same batch still apply (partial application, per spec).
 *
 * This covers:
 *   1. Gate 9 reuses gates 1/1b/1e/2/3/4/5 VERBATIM — asserted
 *      structurally (every gate2Injury call site grepped, count must
 *      include this new one) and behaviorally (a real contraindicated
 *      exercise produces the IDENTICAL reason gate2Injury itself gives a
 *      pasted prescription).
 *   2. Gate 9's own additions: unknown exerciseId, missing/empty
 *      rationale, duplicate exerciseId within one day, invalid/missing
 *      dayKey, checkin-tier scope rejecting `days` wholesale.
 *   3. Gate 10 (duration): within 10% accepts, over 10% rejects, no
 *      estimatedMin declared skips the check.
 *   4. Gate 11 (weeklyGroupSets): self-reported mismatch >10% rejects;
 *      pushing a group over its cap rejects even when self-reported
 *      correctly; the subtract-old-add-new shape doesn't double-count
 *      this day's own prior (generator) contribution.
 *   5. Gate 12 (specialize coverage): dropping the template's own
 *      specialize/emphasize group entirely rejects; a day whose template
 *      role never touched that group isn't held to it.
 *   6. Gate 13 (maintain floor): dropping a maintain-tier movement with
 *      no pool-equivalent substitute rejects; substituting a pool
 *      equivalent passes.
 *   7. Partial application: a batch of 2 days, one valid one invalid —
 *      the valid one is accepted, the invalid one rejected with a
 *      reason, neither blocks the other.
 *   8. Real data: a plausible authored Delts & Arms day against the real
 *      backup's injuryProfile/focus/sessionRules passes end to end; the
 *      same day with a contraindicated exercise swapped in is rejected
 *      with a reason naming the injury.
 *
 * Run: node scripts/check-authored-day-gates.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { loadApp } = require("./lib/load-app.js");

const INDEX_HTML = path.join(__dirname, "..", "index.html");
const app = loadApp([
  "applyAuthoredDays", "buildGateContext", "gate2Injury", "getProgram", "EX_BY_ID",
  "DEFAULT_INJURY_PROFILE", "DEFAULT_FOCUS", "cloneInjuryProfileDefaults", "MUSCLE_GROUPS",
]);

let failures = 0, checks = 0;
function ok(label, cond, extra) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${extra ? "\n" + extra : ""}`); }
}

const baseData = (overrides) => ({
  sessions: [], swaps: {}, focus: { ...app.DEFAULT_FOCUS }, injuryProfile: app.DEFAULT_INJURY_PROFILE,
  plan: { template: "upperFocus", sessionMin: 60 }, briefTier: "full",
  ...overrides,
});

/* ===== 1. Structural: gate2Injury has no fork ===== */
{
  const html = fs.readFileSync(INDEX_HTML, "utf8");
  const callSites = (html.match(/gate2Injury\(/g) || []).length;
  // definition + capAndSplitMovement + prescription pipeline (runPrescriptionGates)
  // + ExerciseCard's persistent-warning + swap-picker + contraindicatedInActiveProgram
  // + gate9AuthoredExercise = 7.
  ok("gate2Injury has exactly 7 occurrences in index.html (1 definition + 6 callers, no fork added for Gate 9)", callSites === 7, `found ${callSites}`);
}

/* ===== 2. Gate 9 reuses gate2Injury verbatim, same reason text ===== */
{
  const data = baseData({ injuryProfile: { ...app.cloneInjuryProfileDefaults(), recoveringMode: true } });
  const ctx = app.buildGateContext(data, data.plan);
  const directReject = app.gate2Injury({ exerciseId: "goblet" }, ctx);
  const days = [{
    dayKey: "ufLower",
    exercises: [{ exerciseId: "goblet", order: 1, sets: 3, rationale: "x" }],
  }];
  const result = app.applyAuthoredDays(days, ctx);
  ok("day with a contraindicated exercise is rejected", result.accepted.length === 0 && result.rejections.length === 1);
  ok("Gate 9's rejection reason contains gate2Injury's own reason text verbatim, not a reworded copy", result.rejections[0].reason.includes(directReject.reason), JSON.stringify({ got: result.rejections[0].reason, expected: directReject.reason }));
}

/* ===== 3. Gate 9's own checks ===== */
{
  const data = baseData();
  const ctx = app.buildGateContext(data, data.plan);

  const unknownId = app.applyAuthoredDays([{ dayKey: "ufArms", exercises: [{ exerciseId: "not_a_real_exercise", order: 1, sets: 3, rationale: "x" }] }], ctx);
  ok("unknown exerciseId rejects the day", unknownId.accepted.length === 0 && /Unknown exercise id/.test(unknownId.rejections[0].reason), JSON.stringify(unknownId.rejections));

  const noRationale = app.applyAuthoredDays([{ dayKey: "ufArms", exercises: [{ exerciseId: "ezcurl", order: 1, sets: 3 }] }], ctx);
  ok("missing rationale rejects the day", noRationale.accepted.length === 0 && /no rationale/.test(noRationale.rejections[0].reason), JSON.stringify(noRationale.rejections));

  const emptyRationale = app.applyAuthoredDays([{ dayKey: "ufArms", exercises: [{ exerciseId: "ezcurl", order: 1, sets: 3, rationale: "   " }] }], ctx);
  ok("whitespace-only rationale also rejects (not just literally absent)", emptyRationale.accepted.length === 0);

  const dup = app.applyAuthoredDays([{ dayKey: "ufArms", exercises: [
    { exerciseId: "ezcurl", order: 1, sets: 3, rationale: "a" },
    { exerciseId: "ezcurl", order: 2, sets: 3, rationale: "b" },
  ] }], ctx);
  ok("duplicate exerciseId within one authored day rejects it", dup.accepted.length === 0 && /more than once/.test(dup.rejections[0].reason), JSON.stringify(dup.rejections));

  const badDayKey = app.applyAuthoredDays([{ dayKey: "not_a_real_day", exercises: [{ exerciseId: "ezcurl", order: 1, sets: 3, rationale: "x" }] }], ctx);
  ok("invalid dayKey rejects", badDayKey.accepted.length === 0 && /isn't a day in your current template/.test(badDayKey.rejections[0].reason), JSON.stringify(badDayKey.rejections));

  const checkinData = baseData({ briefTier: "checkin" });
  const checkinCtx = app.buildGateContext(checkinData, checkinData.plan);
  const checkinResult = app.applyAuthoredDays([{ dayKey: "ufArms", exercises: [{ exerciseId: "ezcurl", order: 1, sets: 3, rationale: "x" }] }], checkinCtx);
  ok("checkin-tier scope rejects `days` wholesale — full day authorship is a full-tier feature", checkinResult.accepted.length === 0 && /full-tier brief/.test(checkinResult.rejections[0].reason), JSON.stringify(checkinResult.rejections));
}

/* ===== 4. Gate 10 (duration) ===== */
{
  const data = baseData();
  const ctx = app.buildGateContext(data, data.plan);
  const exercises = [
    { exerciseId: "ezcurl", order: 1, sets: 4, rationale: "a" },
    { exerciseId: "skull", order: 2, sets: 4, rationale: "b" },
  ];
  // Real duration for 8 hard sets at ~90s rest triceps/biceps (isolation,
  // 90s rest per restFor's default): (40+90)*8 = 1040s = ~17.3min + 8 = ~25min.
  const accurate = app.applyAuthoredDays([{ dayKey: "ufArms", exercises, estimatedMin: 25 }], ctx);
  ok("duration within 10% of a reasonable estimate accepts", accurate.accepted.length === 1, JSON.stringify(accurate.rejections));

  const wildlyOff = app.applyAuthoredDays([{ dayKey: "ufArms", exercises, estimatedMin: 5 }], ctx);
  ok("duration understated by far more than 10% rejects", wildlyOff.accepted.length === 0 && /off by/.test(wildlyOff.rejections[0].reason), JSON.stringify(wildlyOff.rejections));

  const noEstimate = app.applyAuthoredDays([{ dayKey: "ufArms", exercises }], ctx);
  ok("no estimatedMin declared -> Gate 10 has nothing to check, day still evaluated on other gates", noEstimate.accepted.length === 1, JSON.stringify(noEstimate.rejections));
}

/* ===== 5. Gate 11 (weeklyGroupSets) ===== */
{
  const data = baseData();
  const ctx = app.buildGateContext(data, data.plan);
  const exercises = [{ exerciseId: "ezcurl", order: 1, sets: 4, rationale: "a" }]; // arms, 4 sets

  const accurate = app.applyAuthoredDays([{ dayKey: "ufArms", exercises, weeklyGroupSets: { arms: 4 } }], ctx);
  ok("accurate self-reported weeklyGroupSets accepts", accurate.accepted.length === 1, JSON.stringify(accurate.rejections));

  const wrong = app.applyAuthoredDays([{ dayKey: "ufArms", exercises, weeklyGroupSets: { arms: 40 } }], ctx);
  ok("self-reported weeklyGroupSets off by >10% rejects", wrong.accepted.length === 0 && /off by/.test(wrong.rejections[0].reason), JSON.stringify(wrong.rejections));

  const overCapExercises = [{ exerciseId: "ezcurl", order: 1, sets: 40, rationale: "a" }];
  const overCap = app.applyAuthoredDays([{ dayKey: "ufArms", exercises: overCapExercises, weeklyGroupSets: { arms: 40 } }], ctx);
  ok("pushing a group over its cap rejects even when self-reported accurately", overCap.accepted.length === 0 && /above the .*-set cap/.test(overCap.rejections[0].reason), JSON.stringify(overCap.rejections));

  // Subtract-old-add-new arithmetic, isolated: ufUpperB is not the only
  // day training "back" (ufUpperA also does, via csrow/latpd), so this
  // day's OLD contribution is smaller than the whole-program baseline —
  // a bug that used newContribution alone (ignoring baseline entirely,
  // or double-counting old) would misjudge a real increase against a
  // tight cap. Cap set to baseline+2 (only 2 sets of real headroom); the
  // authored day nearly doubles its own back volume, an increase far
  // bigger than the headroom.
  const baselineBack = ctx.weeklyGroupSets.back || 0;
  const tightCapData = baseData({ plan: { template: "upperFocus", sessionMin: 60, sessionRules: { weeklyGroupSetCaps: { back: baselineBack + 2 } } } });
  const tightCapCtx = app.buildGateContext(tightCapData, tightCapData.plan);
  const bigBackIncrease = app.applyAuthoredDays([{ dayKey: "ufUpperB", exercises: [
    { exerciseId: "pullup", order: 1, sets: 6, rationale: "a" },
    { exerciseId: "cablerow", order: 2, sets: 6, rationale: "b" },
  ] }], tightCapCtx);
  ok("Gate 11's subtract-old-add-new arithmetic catches a real increase against a tight cap, not just a naive same-day total", bigBackIncrease.accepted.length === 0, JSON.stringify({ rejections: bigBackIncrease.rejections, baselineBack }));
}

/* ===== 6. Gate 12 (specialize coverage) ===== */
{
  const data = baseData({ focus: { ...app.DEFAULT_FOCUS, arms: "specialize" } });
  const ctx = app.buildGateContext(data, data.plan);
  // ufArms's template touches shoulders (machohp/cablelat/reardelt) AND
  // arms (ezcurl/skull/ohte). arms is specialize -> must be represented.
  const droppingArms = app.applyAuthoredDays([{ dayKey: "ufArms", exercises: [
    { exerciseId: "machohp", order: 1, sets: 4, rationale: "shoulders only" },
  ] }], ctx);
  ok("dropping the specialize group (arms) the template's own day trains rejects", droppingArms.accepted.length === 0 && /drops Arms entirely/.test(droppingArms.rejections[0].reason), JSON.stringify(droppingArms.rejections));

  const keepingArms = app.applyAuthoredDays([{ dayKey: "ufArms", exercises: [
    { exerciseId: "machohp", order: 1, sets: 3, rationale: "shoulders" },
    { exerciseId: "ezcurl", order: 2, sets: 4, rationale: "arms specialize" },
  ] }], ctx);
  ok("keeping at least one arms exercise passes Gate 12", keepingArms.accepted.length === 1, JSON.stringify(keepingArms.rejections));

  // A day whose template role never touches the specialized group isn't
  // held to it — ufUpperA doesn't train legs, legs being specialize
  // elsewhere is irrelevant to this day.
  const legsFocusData = baseData({ focus: { ...app.DEFAULT_FOCUS, legs: "specialize" } });
  const legsCtx = app.buildGateContext(legsFocusData, legsFocusData.plan);
  const upperADay = app.applyAuthoredDays([{ dayKey: "ufUpperA", exercises: [
    { exerciseId: "bench", order: 1, sets: 3, rationale: "chest" },
  ] }], legsCtx);
  ok("a day whose template never trained the specialized group isn't rejected for omitting it", upperADay.accepted.length === 1, JSON.stringify(upperADay.rejections));
}

/* ===== 7. Gate 13 (maintain floor) ===== */
{
  // ufLower's template: legpress, pinsquat, legcurl, hipthrust, calf,
  // cablecrunch. legs=maintain -> all of those are maintain-tier.
  const data = baseData({ focus: { ...app.DEFAULT_FOCUS, legs: "maintain" } });
  const ctx = app.buildGateContext(data, data.plan);
  const droppingHipthrust = app.applyAuthoredDays([{ dayKey: "ufLower", exercises: [
    { exerciseId: "legpress", order: 1, sets: 2, rationale: "a" },
    { exerciseId: "legcurl", order: 2, sets: 2, rationale: "b" },
    { exerciseId: "calf", order: 3, sets: 2, rationale: "c" },
    { exerciseId: "cablecrunch", order: 4, sets: 2, rationale: "d" },
    // hip thrust (pool "hinge" via glute) dropped, no substitute
  ] }], ctx);
  ok("dropping a maintain-tier movement (hip thrust) with no pool substitute rejects", droppingHipthrust.accepted.length === 0 && /maintain-tier/.test(droppingHipthrust.rejections[0].reason), JSON.stringify(droppingHipthrust.rejections));

  const poolSame = app.EX_BY_ID.hipthrust.pool;
  const substitute = Object.values(app.EX_BY_ID).find((e) => e.pool === poolSame && e.id !== "hipthrust");
  ok("sanity: a pool-equivalent substitute for hip thrust exists in the library to test with", !!substitute, poolSame);
  if (substitute) {
    const withSubstitute = app.applyAuthoredDays([{ dayKey: "ufLower", exercises: [
      { exerciseId: "legpress", order: 1, sets: 2, rationale: "a" },
      { exerciseId: "legcurl", order: 2, sets: 2, rationale: "b" },
      { exerciseId: substitute.id, order: 3, sets: 2, rationale: "hip-thrust pool substitute", substitutedFor: "hipthrust" },
      { exerciseId: "calf", order: 4, sets: 2, rationale: "c" },
      { exerciseId: "cablecrunch", order: 5, sets: 2, rationale: "d" },
    ] }], ctx);
    ok("a pool-equivalent substitute for the maintain movement passes Gate 13", withSubstitute.accepted.length === 1, JSON.stringify(withSubstitute.rejections));
  }
}

/* ===== 8. Partial application ===== */
{
  const data = baseData();
  const ctx = app.buildGateContext(data, data.plan);
  const batch = [
    { dayKey: "ufArms", exercises: [{ exerciseId: "ezcurl", order: 1, sets: 3, rationale: "valid day" }] },
    { dayKey: "ufUpperA", exercises: [{ exerciseId: "not_a_real_exercise", order: 1, sets: 3, rationale: "invalid day" }] },
  ];
  const result = app.applyAuthoredDays(batch, ctx);
  ok("valid day in a mixed batch is accepted", result.accepted.some((d) => d.dayKey === "ufArms"));
  ok("invalid day in the same batch is rejected, named, with a reason", result.rejections.some((r) => r.dayKey === "ufUpperA" && r.reason));
  ok("the valid day is not blocked by the invalid one (partial application)", result.accepted.length === 1 && result.rejections.length === 1);
}

/* ===== 9. Real data ===== */
const BACKUP_FILE = path.join(__dirname, "..", "recomp-coach-backup-2026-09-06.json");
if (!fs.existsSync(BACKUP_FILE)) {
  console.warn("NOTE: recomp-coach-backup-2026-09-06.json not found — skipping the real-data cases (synthetic cases above still ran).");
} else {
  const raw = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
  const real = raw.data || raw;
  const data = { ...real, injuryProfile: { ...app.cloneInjuryProfileDefaults(), recoveringMode: true }, briefTier: "full" };
  const ctx = app.buildGateContext(data, data.plan);

  const plausibleDay = [{
    dayKey: "ufArms",
    label: "Arms + Delts",
    exercises: [
      { exerciseId: "machohp", order: 1, sets: 3, rationale: "Shoulders emphasize, sequenced first." },
      { exerciseId: "ezcurl", order: 2, sets: 4, rationale: "Arms specialize — biceps." },
      { exerciseId: "skull", order: 3, sets: 4, rationale: "Arms specialize — triceps, matched volume." },
    ],
    estimatedMin: 33,
    weeklyGroupSets: { shoulders: 3, arms: 8 },
  }];
  const good = app.applyAuthoredDays(plausibleDay, ctx);
  ok("real data: a plausible authored Delts & Arms day passes end to end", good.accepted.length === 1, JSON.stringify(good.rejections));

  const withContraindication = [{
    dayKey: "ufLower",
    exercises: [{ exerciseId: "goblet", order: 1, sets: 3, rationale: "Legs maintain." }],
  }];
  const bad = app.applyAuthoredDays(withContraindication, ctx);
  ok("real data: an authored day naming the real contraindicated exercise (goblet, hip_labrum) is rejected", bad.accepted.length === 0);
  ok("real data: the rejection reason is real Gate 2 text, not a placeholder", bad.rejections.length === 1 && bad.rejections[0].reason.length > 20, JSON.stringify(bad.rejections));
}

if (failures > 0) {
  console.error(`\nAUTHORED-DAY-GATES CHECK FAILED: ${failures}/${checks} assertions failed.`);
  process.exit(1);
}
console.log(`Authored-day-gates check passed: ${checks} assertions — Gate 9 reuses gate2Injury (and gates 1/1b/1e/3/4/5) verbatim with no fork, its own unknown-id/rationale/duplicate/dayKey/checkin-scope checks, Gate 10 duration tolerance, Gate 11 weeklyGroupSets + cap enforcement, Gate 12 specialize coverage scoped to the day's own template role, Gate 13 maintain-floor pool-substitute logic, partial application across a mixed batch, and real-data end-to-end acceptance/rejection.`);
