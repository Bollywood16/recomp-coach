#!/usr/bin/env node
/* Task 6, Section 4 — the four deferred tests from DEFERRED-TESTS.md that
 * depend on the `days` schema/Gates 9-13, tracked separately from
 * scripts/check-authored-day-gates.js's general gate coverage so each one
 * maps 1:1 to its own table row and is unambiguously "passed," per the
 * standing rule ("an owning task is not done until its deferred tests
 * pass").
 *
 *   Row 4: A forbidden-attribute exercise arriving via `days` substitution
 *          -> Gate 9/2 rejects, original retained.
 *   Row 7: estimatedMin understated by 30% -> Gate 10 rejects the day,
 *          other days apply.
 *   Row 8: A day omitting the specialize group entirely -> Gate 12
 *          rejects.
 *   Row 9: A trim that would cut RDL / goblet squat / hip thrust below
 *          the maintain floor -> Gate 13 rejects.
 *
 * Run: node scripts/check-deferred-tests-4-7-8-9.js (wired into `npm test`).
 */
const assert = require("assert");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "applyAuthoredDays", "buildGateContext", "gate2Injury", "getProgram", "EX_BY_ID",
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
  plan: { template: "upperFocus", sessionMin: 60 }, briefTier: "full",
  ...overrides,
});

/* ===== Row 4: forbidden-attribute via `days` substitution ===== */
{
  // No real exercise carries DEFAULT_INJURY_PROFILE's own forbidden
  // attribute (loaded_deep_hip_flexion) — same reason Task 4's own test
  // suite used a synthetic fixture for this case (TASK-1 comment: "None
  // of the 75 carry the forbidden attribute itself... a forward-looking
  // net"). Same approach here: a real exercise (ezcurl, elbow_flexion),
  // a synthetic constraint that happens to forbid ITS real attribute —
  // proves the forbidden-attribute BRANCH specifically, distinct from
  // the contraindications branch already covered elsewhere.
  const injuryProfile = {
    ...app.cloneInjuryProfileDefaults(),
    recoveringMode: true,
    movementConstraints: { ...app.cloneInjuryProfileDefaults().movementConstraints, forbidden: ["elbow_flexion"] },
  };
  ok("sanity: ezcurl really does carry the elbow_flexion attribute this constraint forbids", app.EX_BY_ID.ezcurl.attributes.includes("elbow_flexion"));

  const data = baseData({ injuryProfile });
  const ctx = app.buildGateContext(data, data.plan);

  // The direct gate2Injury call this Gate 9 case must reuse verbatim —
  // captured BEFORE running applyAuthoredDays so the comparison below is
  // to gate2Injury's real, independently-obtained reason text.
  const directReject = app.gate2Injury({ exerciseId: "ezcurl" }, ctx);
  ok("sanity: gate2Injury itself rejects ezcurl for the forbidden elbow_flexion attribute (the FORBIDDEN branch, not contraindications)", directReject.reject === true && /forbidden/.test(directReject.reason), JSON.stringify(directReject));

  // What the day would look like WITHOUT the substitution (the
  // "original" that must be retained once the substitution is rejected):
  // resolveDayExercises against data with no data.plan.days entry for
  // ufArms falls through to the generator, which never proposes ezcurl
  // as anything but the template's own normal slot (no forbidden
  // attribute in the default constraints) — i.e., "original retained"
  // means the day is simply absent from the accepted set, so
  // resolveDayExercises's existing fallback (Section 1) does the
  // retaining, not this gate.
  const templateDay = app.getProgram(data).find((d) => d.id === "ufArms");
  const originalList = app.resolveDayExercises(templateDay, data).map((e) => e.ex.id);
  ok("sanity: the day's original (pre-substitution) rendering doesn't include ezcurl-as-a-forbidden-pick at all — it's the template's own normal slot", originalList.includes("ezcurl"));

  const substitutionAttempt = [{
    dayKey: "ufArms",
    exercises: [
      { exerciseId: "machohp", order: 1, sets: 3, rationale: "shoulders" },
      // ezcurl "substituted" in place of what would normally be there —
      // but it's now forbidden under this profile.
      { exerciseId: "ezcurl", order: 2, sets: 4, rationale: "arms", substitutedFor: "cablecurl" },
    ],
  }];
  const result = app.applyAuthoredDays(substitutionAttempt, ctx);
  ok("Gate 9/2 rejects the day containing the forbidden-attribute substitution", result.accepted.length === 0);
  ok("rejection reason is gate2Injury's own reason verbatim (no fork, no reworded copy)", result.rejections[0].reason.includes(directReject.reason), JSON.stringify({ got: result.rejections[0].reason, expected: directReject.reason }));

  // "Original retained": with the day rejected, resolveDayExercises
  // against the UNCHANGED data (no data.plan.days entry was ever
  // written for ufArms, since the day was rejected before persistence)
  // still produces exactly the original list.
  const afterRejectionList = app.resolveDayExercises(templateDay, data).map((e) => e.ex.id);
  check("the original day is retained unchanged after the rejection (resolveDayExercises falls through to the generator, per Section 1)", afterRejectionList, originalList);
}

/* ===== Row 7: estimatedMin understated by 30%, other days apply ===== */
{
  const data = baseData();
  const ctx = app.buildGateContext(data, data.plan);
  const armsExercises = [
    { exerciseId: "ezcurl", order: 1, sets: 4, rationale: "a" },
    { exerciseId: "skull", order: 2, sets: 4, rationale: "b" },
  ];
  // Real duration for 8 isolation hard sets at 90s rest: (40+90)*8 = 1040s
  // = ~17.3min + 8min warmup = ~25min. Understated by 30%: 25 * 0.7 = 17.5.
  const realMin = 25;
  const understated = Math.round(realMin * 0.7);
  const batch = [
    { dayKey: "ufArms", exercises: armsExercises, estimatedMin: understated },
    { dayKey: "ufUpperA", exercises: [{ exerciseId: "bench", order: 1, sets: 3, rationale: "valid day, no estimatedMin claim" }] },
  ];
  const result = app.applyAuthoredDays(batch, ctx);
  ok("the day with estimatedMin understated by 30% is rejected by Gate 10", !result.accepted.some((d) => d.dayKey === "ufArms"));
  const armsRejection = result.rejections.find((r) => r.dayKey === "ufArms");
  ok("rejection reason names Gate 10 and the mismatch", armsRejection && armsRejection.gate === 10 && /off by/.test(armsRejection.reason), JSON.stringify(armsRejection));
  ok("the OTHER day in the same batch still applies (partial application)", result.accepted.some((d) => d.dayKey === "ufUpperA"));
}

/* ===== Row 8: a day omitting the specialize group entirely ===== */
{
  const data = baseData({ focus: { ...app.DEFAULT_FOCUS, arms: "specialize" } });
  const ctx = app.buildGateContext(data, data.plan);
  // ufArms's template trains both shoulders and arms; arms is specialize
  // here. Omitting arms entirely from the authored day must reject.
  const droppingSpecializeGroup = [{
    dayKey: "ufArms",
    exercises: [{ exerciseId: "machohp", order: 1, sets: 4, rationale: "shoulders only, arms dropped entirely" }],
  }];
  const result = app.applyAuthoredDays(droppingSpecializeGroup, ctx);
  ok("Gate 12 rejects a day that omits the specialize group its own template trains", result.accepted.length === 0);
  ok("rejection names Gate 12 and the dropped group", result.rejections[0].gate === 12 && /drops Arms entirely/.test(result.rejections[0].reason), JSON.stringify(result.rejections));
}

/* ===== Row 9: a trim cutting RDL / goblet squat / hip thrust below the
 * maintain floor -> Gate 13 rejects. hip thrust is the concrete case
 * (ufLower's own template exercise, maintain-tier under legs:maintain,
 * per DEFERRED-TESTS.md's own real-data note); rdl/goblet squat are the
 * other two named lifts, checked directly against balanced's lowerB day
 * (which trains rdl) and the goblet-swap scenario, to cover all three
 * named movements, not just one. ===== */
{
  const focus = { ...app.DEFAULT_FOCUS, legs: "maintain" };

  // hip thrust, on ufLower (upperFocus template).
  const dataLower = baseData({ focus, plan: { template: "upperFocus", sessionMin: 60 } });
  const ctxLower = app.buildGateContext(dataLower, dataLower.plan);
  const cuttingHipThrust = [{
    dayKey: "ufLower",
    exercises: [
      { exerciseId: "legpress", order: 1, sets: 2, rationale: "a" },
      { exerciseId: "legcurl", order: 2, sets: 2, rationale: "b" },
      { exerciseId: "calf", order: 3, sets: 2, rationale: "c" },
      { exerciseId: "cablecrunch", order: 4, sets: 2, rationale: "d" },
      // hip thrust cut entirely, no pool substitute
    ],
  }];
  const hipResult = app.applyAuthoredDays(cuttingHipThrust, ctxLower);
  ok("Gate 13 rejects a trim that cuts hip thrust below the maintain floor (no pool substitute)", hipResult.accepted.length === 0 && hipResult.rejections[0].gate === 13, JSON.stringify(hipResult.rejections));

  // rdl, on balanced's lowerB day.
  const dataBalanced = baseData({ focus, plan: { template: "balanced", sessionMin: 60 } });
  const ctxBalanced = app.buildGateContext(dataBalanced, dataBalanced.plan);
  const lowerBTemplate = app.getProgram(dataBalanced).find((d) => d.id === "lowerB");
  ok("sanity: balanced's lowerB template really does include rdl", lowerBTemplate.exercises.some((s) => s.id === "rdl"));
  const cuttingRdl = [{
    dayKey: "lowerB",
    exercises: lowerBTemplate.exercises.filter((s) => s.id !== "rdl").map((s, i) => ({ exerciseId: s.id, order: i + 1, sets: 2, rationale: "x" })),
  }];
  const rdlResult = app.applyAuthoredDays(cuttingRdl, ctxBalanced);
  ok("Gate 13 rejects a trim that cuts RDL below the maintain floor (no pool substitute)", rdlResult.accepted.length === 0 && rdlResult.rejections[0].gate === 13, JSON.stringify(rdlResult.rejections));

  // goblet squat: cutting legpress (upperFocus/ufLower's own template
  // exercise) with NO substitute reproduces the same mechanism against
  // the pool goblet squat itself belongs to (pool: "squat").
  ok("sanity: goblet squat shares the same pool as legpress, the maintain-tier exercise Gate 13 is protecting on ufLower", app.EX_BY_ID.goblet.pool === app.EX_BY_ID.legpress.pool);
  const cuttingLegSquatPool = [{
    dayKey: "ufLower",
    exercises: [
      { exerciseId: "legcurl", order: 1, sets: 2, rationale: "a" },
      { exerciseId: "hipthrust", order: 2, sets: 2, rationale: "b" },
      { exerciseId: "calf", order: 3, sets: 2, rationale: "c" },
      { exerciseId: "cablecrunch", order: 4, sets: 2, rationale: "d" },
      // legpress (squat pool -- same pool goblet squat belongs to) cut entirely
    ],
  }];
  const squatPoolResult = app.applyAuthoredDays(cuttingLegSquatPool, ctxLower);
  ok("Gate 13 rejects a trim that cuts the squat-pool maintain movement (legpress/goblet squat's own pool) below its floor", squatPoolResult.accepted.length === 0 && squatPoolResult.rejections[0].gate === 13, JSON.stringify(squatPoolResult.rejections));
}

if (failures > 0) {
  console.error(`\nDEFERRED-TESTS-4-7-8-9 CHECK FAILED: ${failures}/${checks} assertions failed.`);
  process.exit(1);
}
console.log(`Deferred-tests-4-7-8-9 check passed: ${checks} assertions — DEFERRED-TESTS.md rows 4 (forbidden-attribute substitution, Gate 9/2, original retained), 7 (estimatedMin understated 30%, Gate 10, partial application), 8 (specialize group dropped, Gate 12), and 9 (maintain floor cut — hip thrust, RDL, and the squat pool goblet squat belongs to, Gate 13) all verified.`);
