#!/usr/bin/env node
/* Fix 1 (TASK-0-BACKUP-MIGRATION-REVIEW.txt complaint 5): the time-budget
 * trim used to rank by a boolean (`focusBoost`), which collapsed
 * "emphasize" and "specialize" into the same priority — so a compound
 * tie-break, and after that list position, decided which focused muscle
 * actually got cut. On the Delts & Arms day that meant arms (specialize,
 * the user's HIGHER priority) got cut harder than shoulders (emphasize),
 * because shoulders is listed first and owns the day's one compound.
 *
 * This covers:
 *   1. emphasisRank/trimPriority order emphasis level ahead of compound
 *      status — a maintain-group compound never outranks a
 *      specialize-group isolation (the literal inversion this fix closes).
 *   2. groupTrimFloors gives specialize/emphasize a real floor (a share of
 *      their OWN pre-trim volume) while normal/maintain get none beyond
 *      the pre-existing per-exercise floor.
 *   3. fitDayToTime and gate7DurationTrim — two different callers sharing
 *      trimPriority/groupTrimFloors — produce IDENTICAL per-exercise set
 *      counts for the same exercises/sets/focus/budget. They used to be
 *      two separate, drifting implementations (gate7 had no emphasis
 *      awareness at all); this is what "shared, not duplicated" means in
 *      practice.
 *   4. The exact real-data regression this fix was written against
 *      (Delts & Arms, upperFocus, shoulders emphasize + arms specialize):
 *      shoulders and arms both stay recognizably what their focus level
 *      says — neither 12/11 (the original inversion) nor 4/19 (a strict
 *      lexicographic tier's own overcorrection, verified against real
 *      data during design and rejected).
 *   5. The maintain-floor stress case (Lower day, forced tiny budget):
 *      per-exercise floors still hold, and (Task 6 Section 2, Gate 13)
 *      maintain is now protected LAST for a full-movement drop — normal
 *      gives up its own movement first, and maintain only starts losing
 *      whole movements once normal has nothing left to give.
 *   6. A single emphasized group with nothing specialized (the common
 *      case) doesn't behave strangely — compounds and the emphasized
 *      group stay intact, only the lone unemphasized isolation lift
 *      absorbs a small trim.
 *
 * Run: node scripts/check-trim-priority.js (wired into `npm test`).
 */
const assert = require("assert");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "emphasisRank", "trimPriority", "groupTrimFloors", "fitDayToTime",
  "gate7DurationTrim", "isCompound", "CAT_TO_GROUP", "LEVEL_RANK",
  "EX_BY_ID", "DEFAULT_FOCUS",
]);

let failures = 0, checks = 0;
function ok(label, cond, extra) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${extra ? "\n" + extra : ""}`); }
}
function check(label, actual, expected) {
  checks++;
  try { assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected))); }
  catch (e) { failures++; console.error(`FAIL: ${label}\n${e.message}`); }
}

/* ===== 1. emphasisRank / trimPriority ordering ===== */
{
  const focus = { shoulders: "maintain", arms: "specialize" };
  const maintainCompound = { cat: "vpress" }; // shoulders -> maintain, compound
  const specializeIsolation = { cat: "biceps" }; // arms -> specialize, not compound
  ok("emphasisRank: maintain < specialize", app.emphasisRank(maintainCompound, focus) < app.emphasisRank(specializeIsolation, focus));
  ok(
    "trimPriority: a maintain-group COMPOUND never outranks a specialize-group isolation (the inversion this fix closes)",
    app.trimPriority(maintainCompound, focus) < app.trimPriority(specializeIsolation, focus),
    `${app.trimPriority(maintainCompound, focus)} vs ${app.trimPriority(specializeIsolation, focus)}`
  );
}
{
  // Full ordering across all four tiers, same cat (so compound-ness is held constant).
  const cat = "delts"; // -> shoulders
  const order = ["maintain", "normal", "emphasize", "specialize"].map((lvl) => app.trimPriority({ cat }, { shoulders: lvl }));
  ok("trimPriority strictly increases maintain < normal < emphasize < specialize", order[0] < order[1] && order[1] < order[2] && order[2] < order[3], JSON.stringify(order));
}
{
  // Within the same tier, compound still loses last (the old behavior, preserved as a tiebreak).
  const focus = { shoulders: "emphasize" };
  const compound = { cat: "vpress" };
  const isolation = { cat: "delts" };
  ok("within one tier, compound still outranks isolation (old tiebreak preserved)", app.trimPriority(compound, focus) > app.trimPriority(isolation, focus));
}

/* ===== 2. groupTrimFloors ===== */
{
  const focus = { shoulders: "specialize", arms: "emphasize", legs: "normal", core: "maintain" };
  const items = [
    { cat: "vpress", sets: 4 }, { cat: "delts", sets: 4 }, { cat: "delts", sets: 4 }, // shoulders: 12
    { cat: "biceps", sets: 6 }, { cat: "triceps", sets: 6 }, // arms: 12
    { cat: "squat", sets: 4 }, // legs: 4
    { cat: "core", sets: 4 }, // core: 4
  ];
  const floors = app.groupTrimFloors(items, focus);
  ok("specialize floor is a real majority share of its own pre-trim volume", floors.shoulders >= Math.round(12 * 0.7) && floors.shoulders < 12, floors.shoulders);
  ok("emphasize floor is a real but smaller share", floors.arms >= Math.round(12 * 0.5) && floors.arms < floors.shoulders, JSON.stringify(floors));
  ok("normal gets no floor beyond the per-exercise absolute floor (1 isolation set)", floors.legs === 2 /* squat is compound: absFloor 2 */, floors.legs);
  ok("maintain gets no floor beyond the per-exercise absolute floor", floors.core === 1 /* core isolation: absFloor 1 */, floors.core);
}

/* ===== 3. fitDayToTime and gate7DurationTrim agree on the same input ===== */
{
  const focus = { shoulders: "emphasize", arms: "specialize" };
  // Same exercises, same sets, same budget — one as a resolved day list, one as prescriptions.
  const dayList = [
    { ...app.EX_BY_ID.machohp, sets: 4 },
    { ...app.EX_BY_ID.cablelat, sets: 4 },
    { ...app.EX_BY_ID.ezcurl, sets: 6 },
    { ...app.EX_BY_ID.skull, sets: 6 },
  ];
  const prescriptions = [
    { exerciseId: "machohp", sets: 4, dayKey: "d" },
    { exerciseId: "cablelat", sets: 4, dayKey: "d" },
    { exerciseId: "ezcurl", sets: 6, dayKey: "d" },
    { exerciseId: "skull", sets: 6, dayKey: "d" },
  ];
  const fitted = app.fitDayToTime(dayList, 30, focus).list.map((e) => ({ id: e.id, sets: e.sets }));
  const trimmedRx = app.gate7DurationTrim(prescriptions, 30, focus).list.map((p) => ({ id: p.exerciseId, sets: p.sets }));
  check("fitDayToTime and gate7DurationTrim produce identical set counts for the same input", fitted, trimmedRx.map((r) => ({ id: r.id, sets: r.sets })));
}

/* ===== 4. Real-data regression: Delts & Arms (upperFocus), sessionMin 60 =====
 * Pins the exact split verified against the real backup during design —
 * see TASK-0-BACKUP-MIGRATION-REVIEW.txt and the Fix 1 proposal exchange.
 * If the day's own catalog/base-sets ever change, this is the place that
 * will need updating right alongside it — that's intentional, not
 * brittleness: it's what "both groups stay recognizably what their label
 * says" is supposed to look like on THIS exact day. */
{
  const focus = { shoulders: "emphasize", arms: "specialize", chest: "normal", back: "normal", legs: "normal", core: "normal" };
  const preFit = [
    { ...app.EX_BY_ID.machohp, sets: 4 },
    { ...app.EX_BY_ID.cablelat, sets: 4 },
    { ...app.EX_BY_ID.latraise, sets: 4 }, // reardelt -> latraise swap, same as the real scenario
    { ...app.EX_BY_ID.ezcurl, sets: 4 }, // already capped by maxSetsPerMovement, as resolveDayExercises produces
    { ...app.EX_BY_ID.skull, sets: 4 },
    { ...app.EX_BY_ID.ohte, sets: 4 },
    { ...app.EX_BY_ID.hammer, sets: 3, isBonus: true }, // stand-in for bonus_dbhammer
    { ...app.EX_BY_ID.inclinecurl, sets: 2 },
    { ...app.EX_BY_ID.ohte, id: "ohdbext2", sets: 2 }, // stand-in for the spawned triceps alternate
  ];
  const fit = app.fitDayToTime(preFit, 60, focus);
  const byGroup = {};
  fit.list.forEach((ex) => { const g = app.CAT_TO_GROUP[ex.cat]; byGroup[g] = (byGroup[g] || 0) + ex.sets; });
  ok("shoulders keeps a real floor, not gutted to its bare per-exercise minimum (>=8, not 4)", byGroup.shoulders >= 8, byGroup.shoulders);
  ok("shoulders isn't left untouched either — it absorbs cuts before arms does (<=9, not the original 12)", byGroup.shoulders <= 9, byGroup.shoulders);
  ok("arms keeps most of its specialize-level volume (>=13, not cut down to 11 as before this fix)", byGroup.arms >= 13, byGroup.arms);
  ok("arms doesn't end up with literally everything either (<=15, not 19 — the overcorrection this fix rejected)", byGroup.arms <= 15, byGroup.arms);
  ok("no exercise fell below its own absolute floor", fit.list.every((ex) => ex.sets >= (app.isCompound(ex) ? 2 : 1)));
}

/* ===== 5. Maintain-floor stress case (Lower day, forced tiny budget) =====
 * UPDATED for Task 6 Section 2 (Gate 13, pre-decision 3): before this,
 * maintain dropped FIRST for a full-movement removal (this exact test
 * used to assert kneeraise survives, hip thrust/calf don't — recorded as
 * the deliberate residual gap "Gate 13's job to change," DEFERRED-TESTS.md
 * row 9). dropTierRank now protects maintain LAST for a full drop — normal
 * gives up its own movement(s) first. Verified live, not guessed: under
 * this exact extreme budget, kneeraise alone isn't enough headroom, so
 * the drop proceeds into the (now-last-priority) maintain pool too, in
 * list order (calf idx4, then hipthrust idx3) — legcurl (also maintain,
 * idx2) is the one maintain isolation lift that survives, purely because
 * only 2 of the 3 tied maintain candidates were needed once kneeraise's
 * removal was already counted. */
{
  const focus = { legs: "maintain", core: "normal" };
  const preFit = [
    { ...app.EX_BY_ID.goblet, sets: 2 },
    { ...app.EX_BY_ID.legpress, sets: 2 },
    { ...app.EX_BY_ID.legcurl, sets: 2 },
    { ...app.EX_BY_ID.hipthrust, sets: 2 },
    { ...app.EX_BY_ID.calf, sets: 2 },
    { ...app.EX_BY_ID.kneeraise, sets: 3 },
  ];
  const fit = app.fitDayToTime(preFit, 20, focus);
  ok("no exercise fell below its own absolute floor under extreme budget pressure", fit.list.every((ex) => ex.sets >= (app.isCompound(ex) ? 2 : 1)), JSON.stringify(fit.list.map((e) => ({ id: e.id, sets: e.sets }))));
  const survivorIds = fit.list.map((e) => e.id);
  ok("Gate 13: normal-tier kneeraise is sacrificed BEFORE any maintain movement is fully dropped", !survivorIds.includes("kneeraise"), JSON.stringify(survivorIds));
  ok("maintain-tier hip thrust and calf raise are still dropped once normal's headroom (kneeraise) is exhausted and budget still isn't met — Gate 13 protects maintain from going FIRST, not from ever going", !survivorIds.includes("hipthrust") && !survivorIds.includes("calf"), JSON.stringify(survivorIds));
  ok("legcurl (maintain) survives — the one maintain isolation lift not needed to hit budget once kneeraise's removal is counted", survivorIds.includes("legcurl"), JSON.stringify(survivorIds));
}

/* ===== 6. Single emphasize, nothing specialized — the common case ===== */
{
  const focus = { ...app.DEFAULT_FOCUS, shoulders: "emphasize" };
  const preFit = [
    { ...app.EX_BY_ID.ohp, sets: 3 }, // shoulders, compound
    { ...app.EX_BY_ID.pullup, sets: 3 }, // back, compound, normal
    { ...app.EX_BY_ID.incdb, sets: 3 }, // chest, compound, normal
    { ...app.EX_BY_ID.cablerow, sets: 3 }, // back, compound, normal
    { ...app.EX_BY_ID.latraise, sets: 4 }, // shoulders, isolation, emphasize
    { ...app.EX_BY_ID.hammer, sets: 2 }, // arms, isolation, normal
  ];
  const fit = app.fitDayToTime(preFit, 60, focus);
  const byId = {};
  fit.list.forEach((ex) => { byId[ex.id] = ex.sets; });
  ok("every compound stays fully intact (no specialize group competing for protection)", ["ohp", "pullup", "incdb", "cablerow"].every((id) => byId[id] === 3), JSON.stringify(byId));
  ok("the emphasized isolation (latraise) is untouched", byId.latraise === 4, byId.latraise);
  ok("only the lone unemphasized isolation lift (hammer) absorbs the trim needed to fit budget", fit.trimmed === 0 || byId.hammer < 2, JSON.stringify({ trimmed: fit.trimmed, byId }));
}

if (failures) {
  console.error(`\n${failures}/${checks} trim-priority checks failed.`);
  process.exit(1);
} else {
  console.log(`Trim-priority check passed: ${checks} assertions — emphasis-level ranking, group floors, fitDayToTime/gate7DurationTrim agreement, the real Delts & Arms regression, the maintain-floor stress case, and the single-emphasize common case all verified.`);
}
