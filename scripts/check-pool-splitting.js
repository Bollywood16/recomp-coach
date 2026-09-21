#!/usr/bin/env node
/* Task 2 commit 4: maxSetsPerMovement + pool-splitting. Deferred test 2's
 * acceptance criterion (RECOMP-COACH-BUILD.md's required test suite,
 * item 2) plus the six scope points from the commit-4 review round:
 *   1. deferred test 2 itself (6 sets, cap 4 -> capped + spawn)
 *   2. deterministic, explainable pool selection (rank, then name —
 *      never ALL_KNOWN declaration order)
 *   3. every spawned movement runs the full gate stack (Gate 2 in
 *      particular, same implementation as a prescribed exercise)
 *   4. no valid pool-mate -> capped, not exceeded, reason stated
 *   5. the delts_lateral / delts_rear split actually prevents a
 *      lateral-raise overflow from spawning a rear-delt movement
 *   6. maxSetsPerMovement applies to GENERATOR output, not just
 *      prescriptions — the build's own originating bug, reproduced and
 *      confirmed fixed with zero prescriptions/sessionRules involved
 *
 * Run: node scripts/check-pool-splitting.js (wired into `npm test`).
 */
const assert = require("assert");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "capAndSplitMovement", "resolveDayExercises", "PROGRAMS", "DEFAULT_FOCUS",
  "DEFAULT_INJURY_PROFILE", "DEFAULT_MAX_SETS_PER_MOVEMENT", "EX_BY_ID", "ALL_KNOWN",
]);
const { DEFAULT_FOCUS } = app;
const NOT_RECOVERING = { recoveringMode: false };

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

function entry(id, overrides) {
  return { slot: null, ex: { ...app.EX_BY_ID[id], ...overrides } };
}

/* ===== 1. Deferred test 2, direct: 6 sets, cap 4 -> capped + spawn ===== */
{
  const list = [entry("ezcurl", { sets: 6 })];
  const { list: out, notes } = app.capAndSplitMovement(list, 4, NOT_RECOVERING);
  const original = out.find((e) => e.ex.id === "ezcurl");
  ok("overflowing movement capped at 4", original.ex.sets === 4, `got ${original.ex.sets}`);
  ok("cappedFrom records the pre-cap value", original.ex.cappedFrom === 6);
  const spawned = out.find((e) => e.ex.poolSpawned);
  ok("overflow spawned a second movement from the same pool", !!spawned && app.EX_BY_ID[spawned.ex.id].pool === "biceps", JSON.stringify(spawned));
  ok("spawned movement carries exactly the overflow (2 sets)", spawned.ex.sets === 2, `got ${spawned.ex.sets}`);
  ok("total volume preserved (4 + 2 = 6, the original intent)", original.ex.sets + spawned.ex.sets === 6);
  ok("a note explains what happened", notes.length === 1 && /capped at 4/.test(notes[0].note) && /biceps/.test(notes[0].note));
}

/* ===== 2. Deterministic rank ordering: inclinecurl (rank 1) beats
 * cablecurl (rank 2) beats curl/hammer (unranked, default 4) ===== */
{
  const list = [entry("ezcurl", { sets: 6 })];
  const { list: out } = app.capAndSplitMovement(list, 4, NOT_RECOVERING);
  const spawned = out.find((e) => e.ex.poolSpawned);
  ok("best-ranked candidate (inclinecurl, rank 1) chosen over cablecurl (rank 2) and unranked options",
    spawned.ex.id === "inclinecurl", `got ${spawned && spawned.ex.id}`);
}

/* ===== 3. Deterministic tie-break by name, not ALL_KNOWN declaration
 * order — AND Gate 2 fires on a spawned candidate exactly as on a
 * prescribed one. Real, non-synthetic mechanics: the squat pool's
 * tagged, non-resolved contraindication (goblet <-> hip_labrum, the
 * actual reason this app's goblet/box-squat split exists).
 *
 * Every real squat-pool member is untagged with `rank` (all default to
 * 4), so candidate order is decided ENTIRELY by the name tie-break.
 * beltsquat/boxsquat pinned as "already in the day" so they're excluded
 * as candidates, leaving goblet as the alphabetically-first remaining
 * candidate — declaration order in ALL_KNOWN would instead try legpress
 * first (it's declared via PROGRAM_EXERCISES, ahead of LIBRARY's
 * hacksquat/smithsquat/goblet), and legpress isn't contraindicated, so a
 * declaration-order bug would spawn legpress immediately and never even
 * reach goblet's rejection or hacksquat's fallback — this scenario is
 * discriminating, not just deterministic. */
{
  const list = [
    entry("beltsquat"), entry("boxsquat"), // already "in the day"
    entry("pinsquat", { sets: 6 }),        // the overflowing one
  ];
  const { list: out, notes } = app.capAndSplitMovement(list, 4, app.DEFAULT_INJURY_PROFILE);
  const spawned = out.find((e) => e.ex.poolSpawned);
  ok("goblet (alphabetically first remaining, contraindicated) was skipped, not spawned",
    spawned && spawned.ex.id !== "goblet", JSON.stringify(spawned));
  ok("hacksquat (next alphabetically, passes Gate 2) was spawned instead",
    spawned && spawned.ex.id === "hacksquat", JSON.stringify(spawned));
  ok("the note reflects the ACTUAL spawn (hacksquat), not the rejected candidate",
    /hacksquat|Hack Squat/i.test(notes[0].note) && !/goblet|Goblet/i.test(notes[0].note), notes[0].note);
}

/* ===== 4. No valid pool-mate anywhere in the pool -> capped, not
 * exceeded, reason names the pool. Every real squat-pool member other
 * than the overflowing one is pinned as already present. ===== */
{
  const others = ["beltsquat", "boxsquat", "goblet", "hacksquat", "legpress", "smithsquat"].map((id) => entry(id));
  const list = [...others, entry("pinsquat", { sets: 6 })];
  const { list: out, notes } = app.capAndSplitMovement(list, 4, NOT_RECOVERING);
  ok("capped at 4, not left at 6", out.find((e) => e.ex.id === "pinsquat").ex.sets === 4);
  ok("nothing new spawned (list length unchanged)", out.length === list.length, `${out.length} vs ${list.length}`);
  ok("exactly one note, explaining no valid alternative existed",
    notes.length === 1 && /no valid alternative/.test(notes[0].note) && /"squat"/.test(notes[0].note), JSON.stringify(notes));
}

/* ===== 4b. Untagged pool (no `pool` field at all) -> capped, no search
 * attempted, distinct reason. Every real exercise in this library is
 * pool-tagged (checked directly: 0/75), so this is necessarily a
 * synthetic entry — the untagged-pool branch is a defensive case for
 * data that shouldn't exist today, not a reachable real scenario. ===== */
{
  const list = [{ slot: null, ex: { id: "synthetic_untagged", name: "Synthetic Untagged Exercise", cat: "biceps", sets: 6 } }];
  const { list: out, notes } = app.capAndSplitMovement(list, 4, NOT_RECOVERING);
  ok("capped at 4 despite no pool to search", out[0].ex.sets === 4);
  ok("note explains the untagged-pool reason specifically",
    notes.length === 1 && /untagged pool/.test(notes[0].note), JSON.stringify(notes));
}

/* ===== 5. delts_lateral / delts_rear split: a lateral-raise overflow
 * must never spawn a rear-delt movement, even when one is already
 * present in the same day (spawning it again would be a double proof of
 * the bug — it's mechanically wrong regardless of whether it's already
 * there or not). ===== */
{
  const list = [
    entry("latraise", { sets: 6 }),
    entry("reardelt"), // present in the day — must not be touched or duplicated
  ];
  const { list: out, notes } = app.capAndSplitMovement(list, 4, NOT_RECOVERING);
  const spawned = out.find((e) => e.ex.poolSpawned);
  ok("a delts_lateral alternative was spawned", !!spawned && app.EX_BY_ID[spawned.ex.id].pool === "delts_lateral", JSON.stringify(spawned));
  ok("the spawned movement is NOT the rear-delt exercise", spawned.ex.id !== "reardelt");
  const reardeltEntry = out.find((e) => e.ex.id === "reardelt");
  ok("reardelt's own entry is untouched (still its base 3 sets, not capped/altered)",
    reardeltEntry.ex.sets === 3 && !reardeltEntry.ex.cappedFrom && !reardeltEntry.ex.poolSpawned);
  ok("note names delts_lateral as the pool searched, not delts_rear",
    /"delts_lateral"/.test(notes[0].note) && !/delts_rear/.test(notes[0].note), notes[0].note);
}

/* ===== 6. Point 6 — applies to GENERATOR output, not just prescriptions.
 * The build's own originating bug: arms: "specialize" alone (via the
 * Focus tab, zero prescriptions, zero sessionRules ever configured)
 * stacked 6 sets on EZ-Bar Curl. Reproduced end-to-end through
 * resolveDayExercises with NO plan.prescriptions and NO plan.sessionRules
 * at all — if this only worked via the prescription path, this test
 * would still show 6. ===== */
{
  const ufArms = app.PROGRAMS.upperFocus.find((d) => d.id === "ufArms");
  const data = {
    plan: { template: "upperFocus", sessionMin: 90 }, // no sessionRules key at all
    focus: { ...DEFAULT_FOCUS, arms: "specialize" },
    swaps: {}, sessions: [], injuryProfile: NOT_RECOVERING,
  };
  const list = app.resolveDayExercises(ufArms, data);
  const ezcurl = list.find((e) => e.ex.id === "ezcurl");
  ok("generator-driven overflow (no paste involved) is still capped at the default (4)",
    ezcurl.ex.sets === app.DEFAULT_MAX_SETS_PER_MOVEMENT, `got ${ezcurl.ex.sets}`);
  ok("cappedFrom shows it really was 6 before capping (the exact historical bug number)",
    ezcurl.ex.cappedFrom === 6, `got ${ezcurl.ex.cappedFrom}`);
  const spawned = list.find((e) => e.ex.poolSpawned && e.ex.poolSpawnedFrom === "ezcurl");
  ok("overflow correctly redistributed to a spawned biceps movement", !!spawned, JSON.stringify(list.map((e) => e.ex.id)));
  ok("notes are exposed on the returned list for DayPage's banner",
    Array.isArray(list.maxSetsNotes) && list.maxSetsNotes.some((n) => n.exerciseId === "ezcurl"));
}

/* ===== 6b. A real sessionRules.maxSetsPerMovement override changes the
 * cap end-to-end through resolveDayExercises, not just the default. ===== */
{
  const ufArms = app.PROGRAMS.upperFocus.find((d) => d.id === "ufArms");
  const data = {
    plan: { template: "upperFocus", sessionMin: 90, sessionRules: { maxSetsPerMovement: 6 } },
    focus: { ...DEFAULT_FOCUS, arms: "specialize" },
    swaps: {}, sessions: [], injuryProfile: NOT_RECOVERING,
  };
  const list = app.resolveDayExercises(ufArms, data);
  const ezcurl = list.find((e) => e.ex.id === "ezcurl");
  ok("an explicit looser cap (6) is honored — 6 sets is no longer over cap, nothing split",
    ezcurl.ex.sets === 6 && !ezcurl.ex.cappedFrom, `sets=${ezcurl.ex.sets} cappedFrom=${ezcurl.ex.cappedFrom}`);
  ok("nothing spawned when nothing overflowed", !list.some((e) => e.ex.poolSpawned));
}

/* ===== 7. Rep range never blank on a spawned entry — found live in a
 * real browser run (not hypothetical): 37 of 75 ALL_KNOWN exercises are
 * LIBRARY_EXT alternates with no native repMin/repMax at all (never used
 * as a slot() argument in any PROGRAMS day, the only place a range gets
 * attached today), and inclinecurl/ohdbext — the exact candidates the
 * ezcurl/skull overflow above spawns — are both among them. Without a
 * fallback the rendered set line read "4 x – at 35 lb". Spawned entries
 * must inherit the overflowing exercise's own range (the same precedent
 * resolveSlot's swap path already follows), falling back to
 * DEFAULT_REP_RANGE only if neither has one. ===== */
{
  const list = [entry("ezcurl", { sets: 6, repMin: 10, repMax: 15 })];
  const { list: out } = app.capAndSplitMovement(list, 4, NOT_RECOVERING);
  const spawned = out.find((e) => e.ex.poolSpawned);
  ok("spawned candidate (inclinecurl) has no native rep range of its own",
    app.EX_BY_ID.inclinecurl.repMin === undefined && app.EX_BY_ID.inclinecurl.repMax === undefined);
  ok("spawned entry's rep range is never blank",
    spawned.ex.repMin !== undefined && spawned.ex.repMax !== undefined, JSON.stringify(spawned.ex));
  ok("inherits the OVERFLOWING exercise's own range (10-15), not some other default",
    spawned.ex.repMin === 10 && spawned.ex.repMax === 15, `${spawned.ex.repMin}-${spawned.ex.repMax}`);
}

if (failures > 0) {
  console.error(`\nPOOL-SPLITTING CHECK FAILED: ${failures}/${checks} assertions failed.`);
  process.exit(1);
}
console.log(`Pool-splitting check passed: ${checks} assertions — deferred test 2, deterministic rank+name ordering (not declaration order), Gate 2 on spawned candidates, the no-valid-alternative fallback, the delts_lateral/delts_rear split, and generator-side (not just prescription-side) enforcement all verified.`);
