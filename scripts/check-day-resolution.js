#!/usr/bin/env node
/* Behavior-agreement check for resolveDayExercises and its consumers
 * (Task 2 reconciliation work, TASK-2-RECONCILIATION-PROPOSAL.txt section
 * 1 / open decision 3). Before commit 1's refactor, DayPage,
 * weeklySetsByGroup, dayFittedMinutes, and dayFocusSummary each
 * independently rebuilt a day's exercise list — the exact gap that let
 * Gate 6's tally drift from what DayPage actually renders (DEFERRED-
 * TESTS.md handoff items 1-2). This test proves the consolidation into
 * one resolveDayExercises() keeps all four call sites agreeing with each
 * other and with a reference implementation.
 *
 * Method: the REFERENCE_* functions below independently rebuild each call
 * site's logic (composition of the same lower-level primitives
 * resolveDayExercises itself uses — resolveSlot, bonusForDay,
 * capAndSplitMovement), then everything is compared for exact structural
 * equality against what the app's real functions produce.
 *
 * Updated for commit 4 (maxSetsPerMovement + pool-splitting): originally
 * these were frozen, byte-for-byte copies of each call site's
 * PRE-COMMIT-1 inline logic, deliberately not re-derived, to catch the
 * refactor itself introducing a behavior change. Commit 4 legitimately
 * changes real numbers for any scenario that triggers capping (that IS
 * the fix — see index.html's capAndSplitMovement comment), so the
 * reference functions now also run their combined list through the real
 * capAndSplitMovement, same as resolveDayExercises does — keeping this
 * test's actual job (four call sites can't silently disagree) intact
 * across every commit, rather than pinning it to a frozen pre-commit-1
 * snapshot that commit 4 was always going to legitimately invalidate.
 * scripts/check-pool-splitting.js covers capAndSplitMovement's own
 * correctness (rank ordering, gate enforcement, the delts split, etc.) in
 * detail; this file's job is strictly "do the call sites agree."
 *
 * DayPicker.lastDone is deliberately NOT covered here — it never included
 * bonus lifts or focus-adjusted sets, has different semantics than the
 * other four, and was left as its own narrower one-liner rather than
 * folded into resolveDayExercises (see the comment on resolveDayExercises
 * itself in index.html). Nothing to prove behavior-neutral there because
 * nothing about it changed.
 *
 * Run: node scripts/check-day-resolution.js (wired into `npm test`).
 */
const assert = require("assert");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "PROGRAMS",
  "DEFAULT_FOCUS",
  "DEFAULT_INJURY_PROFILE",
  "DEFAULT_MAX_SETS_PER_MOVEMENT",
  "getProgram",
  "resolveSlot",
  "bonusForDay",
  "capAndSplitMovement",
  "fitDayToTime",
  "weeklySetsByGroup",
  "dayFittedMinutes",
  "dayFocusSummary",
  "resolveDayExercises",
]);
const { DEFAULT_FOCUS } = app;

/* ===== Reference implementations ===== */

// Same cap/injuryProfile derivation resolveDayExercises itself uses —
// kept here as its own step (not hidden inside REFERENCE_dayPageEntries)
// so a future reader can see plainly that this mirrors, rather than
// bypasses, the real function's logic.
function applyCap(list, data) {
  const cap = (data.plan && data.plan.sessionRules && data.plan.sessionRules.maxSetsPerMovement) ?? app.DEFAULT_MAX_SETS_PER_MOVEMENT;
  const injuryProfile = data.injuryProfile || app.DEFAULT_INJURY_PROFILE;
  return app.capAndSplitMovement(list, cap, injuryProfile).list;
}

function REFERENCE_dayPageEntries(day, data) {
  const focusObj = data.focus || DEFAULT_FOCUS;
  const program = app.getProgram(data);
  const list = [
    ...day.exercises.map((s) => ({ slot: s, ex: app.resolveSlot(s, data.swaps, focusObj) })),
    ...app.bonusForDay(day, focusObj, program).map((b) => ({ slot: b, ex: b })),
  ];
  return applyCap(list, data);
}

function REFERENCE_dayFittedMinutes(day, data) {
  const list = REFERENCE_dayPageEntries(day, data).map((e) => e.ex);
  return app.fitDayToTime(list, (data.plan && data.plan.sessionMin) || 60).minutes;
}

function REFERENCE_weeklySetsByGroup(data, CAT_TO_GROUP) {
  const program = app.getProgram(data);
  const t = {};
  program.forEach((day) => {
    const list = REFERENCE_dayPageEntries(day, data).map((e) => e.ex);
    const fitted = app.fitDayToTime(list, (data.plan && data.plan.sessionMin) || 60).list;
    fitted.forEach((ex) => {
      const g = CAT_TO_GROUP[ex.cat];
      if (g) t[g] = (t[g] || 0) + ex.sets;
    });
  });
  return t;
}

function REFERENCE_dayFocusSummary(day, data, CAT_TO_GROUP, MUSCLE_GROUPS) {
  let added = 0, bonusCount = 0;
  const groups = new Set();
  REFERENCE_dayPageEntries(day, data).forEach(({ ex }) => {
    const g = CAT_TO_GROUP[ex.cat];
    if (ex.isBonus) {
      bonusCount++;
      if (g) groups.add(MUSCLE_GROUPS[g]?.name);
      return;
    }
    const delta = (ex.sets || 0) - (ex.baseSets || ex.sets || 0);
    if (delta > 0 && g) { added += delta; groups.add(MUSCLE_GROUPS[g]?.name); }
    if (delta < 0 && g) { groups.add(MUSCLE_GROUPS[g]?.name); }
  });
  return { added, bonusCount, groups: [...groups] };
}

/* Need CAT_TO_GROUP/MUSCLE_GROUPS for two of the reference fns above but
 * didn't want to widen the app's export surface just for this test's own
 * bookkeeping — derive them the same way index.html does, from PROGRAMS'
 * own categories being a strict subset. Simpler: pull them straight off
 * the loaded app instead of re-deriving. */
const app2 = loadApp(["CAT_TO_GROUP", "MUSCLE_GROUPS"]);
const { CAT_TO_GROUP, MUSCLE_GROUPS } = app2;

/* ===== Seeded datasets ===== */

const BASE_SESSIONS = []; // volume/timing math here doesn't depend on logged history

const scenarios = [
  {
    name: "balanced, no swap, default focus",
    data: { plan: { template: "balanced", sessionMin: 60 }, focus: DEFAULT_FOCUS, swaps: {}, sessions: BASE_SESSIONS },
  },
  {
    name: "upperFocus, arms specialize + shoulders emphasize (stacks bonus lifts across 3 days incl. specialize-tier finishers)",
    data: {
      plan: { template: "upperFocus", sessionMin: 75 },
      focus: { ...DEFAULT_FOCUS, arms: "specialize", shoulders: "emphasize", legs: "maintain" },
      swaps: {},
      sessions: BASE_SESSIONS,
    },
  },
  {
    name: "upperFocus, with an active swap (hammer -> cablecurl) on top of arms specialize",
    data: {
      plan: { template: "upperFocus", sessionMin: 60 },
      focus: { ...DEFAULT_FOCUS, arms: "specialize" },
      swaps: { hammer: "cablecurl" },
      sessions: BASE_SESSIONS,
    },
  },
  {
    name: "superhero, legs specialize (bonus_walkinglunge) + tight sessionMin forcing a trim",
    data: {
      plan: { template: "superhero", sessionMin: 45 },
      focus: { ...DEFAULT_FOCUS, legs: "specialize", shoulders: "specialize" },
      swaps: {},
      sessions: BASE_SESSIONS,
    },
  },
];

let failures = 0;
let checks = 0;

// Both sides are plain data built (in part) inside the loaded app's own vm
// realm, which has its own Object.prototype distinct from this test
// process's. assert.deepStrictEqual treats that alone as inequality even
// when every own enumerable property matches — a realm artifact of this
// harness, not a real behavior difference. A JSON round-trip strips
// prototypes/realm identity from both sides before comparing; everything
// these functions return is plain JSON-safe data (numbers, strings,
// arrays, plain objects — no functions, Dates, or Sets survive to the
// return value), so this is a legitimate byte-for-byte comparison, not a
// weakened one.
function normalize(x) { return JSON.parse(JSON.stringify(x)); }

function check(label, actual, expected) {
  checks++;
  try {
    assert.deepStrictEqual(normalize(actual), normalize(expected));
  } catch (e) {
    failures++;
    console.error(`FAIL: ${label}`);
    console.error(e.message);
  }
}

scenarios.forEach(({ name, data }) => {
  const program = app.getProgram(data);

  // weeklySetsByGroup — whole-program tally, one call per scenario.
  check(
    `[${name}] weeklySetsByGroup`,
    app.weeklySetsByGroup(data),
    REFERENCE_weeklySetsByGroup(data, CAT_TO_GROUP)
  );

  program.forEach((day) => {
    check(
      `[${name}] dayFittedMinutes(${day.id})`,
      app.dayFittedMinutes(day, data),
      REFERENCE_dayFittedMinutes(day, data)
    );
    check(
      `[${name}] dayFocusSummary(${day.id})`,
      app.dayFocusSummary(day, data),
      REFERENCE_dayFocusSummary(day, data, CAT_TO_GROUP, MUSCLE_GROUPS)
    );
    check(
      `[${name}] resolveDayExercises(${day.id}) matches pre-refactor DayPage entries`,
      app.resolveDayExercises(day, data),
      REFERENCE_dayPageEntries(day, data)
    );
  });
});

if (failures > 0) {
  console.error(`\nDAY-RESOLUTION CHECK FAILED: ${failures}/${checks} assertions failed.`);
  process.exit(1);
}
console.log(`Day-resolution check passed: ${checks} assertions across ${scenarios.length} seeded scenarios — DayPage, weeklySetsByGroup, dayFittedMinutes, and dayFocusSummary all agree with each other via resolveDayExercises.`);
