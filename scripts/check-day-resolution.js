#!/usr/bin/env node
/* Behavior-neutrality check for the resolveDayExercises consolidation
 * (Task 2 reconciliation work, TASK-2-RECONCILIATION-PROPOSAL.txt section
 * 1 / open decision 3). Before this refactor, DayPage, weeklySetsByGroup,
 * dayFittedMinutes, and dayFocusSummary each independently rebuilt a day's
 * exercise list via `day.exercises.map(resolveSlot) + bonusForDay(...)`.
 * That's the exact gap that let Gate 6's tally drift from what DayPage
 * actually renders (DEFERRED-TESTS.md handoff items 1-2). This test proves
 * the consolidation into one resolveDayExercises() didn't change any of the
 * four call sites' output.
 *
 * Method: the four REFERENCE_* functions below are frozen, byte-for-byte
 * copies of each call site's pre-refactor inline logic (copied at the time
 * this test was written — deliberately NOT re-derived from the current
 * source, since the point is to catch the current source drifting from
 * that known-good baseline). Each is exercised against several seeded
 * `data` objects covering all three templates, an active swap, and
 * focus levels that trigger bonus lifts (including the specialize-tier
 * "second finisher" bonuses) — then compared for exact structural equality
 * against what the app's real (post-refactor) functions produce today.
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
  "getProgram",
  "resolveSlot",
  "bonusForDay",
  "fitDayToTime",
  "weeklySetsByGroup",
  "dayFittedMinutes",
  "dayFocusSummary",
  "resolveDayExercises",
]);
const { DEFAULT_FOCUS } = app;

/* ===== Frozen reference implementations (pre-refactor, copied verbatim) ===== */

function REFERENCE_dayFittedMinutes(day, data) {
  const f = data.focus || DEFAULT_FOCUS;
  const p = app.getProgram(data);
  const list = [
    ...day.exercises.map((s) => app.resolveSlot(s, data.swaps, f)),
    ...app.bonusForDay(day, f, p),
  ];
  return app.fitDayToTime(list, (data.plan && data.plan.sessionMin) || 60).minutes;
}

function REFERENCE_weeklySetsByGroup(data, CAT_TO_GROUP) {
  const focus = data.focus || DEFAULT_FOCUS;
  const program = app.getProgram(data);
  const t = {};
  program.forEach((day) => {
    const list = [
      ...day.exercises.map((slot) => app.resolveSlot(slot, data.swaps, focus)),
      ...app.bonusForDay(day, focus, program),
    ];
    const fitted = app.fitDayToTime(list, (data.plan && data.plan.sessionMin) || 60).list;
    fitted.forEach((ex) => {
      const g = CAT_TO_GROUP[ex.cat];
      if (g) t[g] = (t[g] || 0) + ex.sets;
    });
  });
  return t;
}

function REFERENCE_dayFocusSummary(day, data, CAT_TO_GROUP, MUSCLE_GROUPS) {
  const focus = data.focus || DEFAULT_FOCUS;
  let added = 0, groups = new Set();
  day.exercises.forEach((slot) => {
    const ex = app.resolveSlot(slot, data.swaps, focus);
    const g = CAT_TO_GROUP[ex.cat];
    const delta = (ex.sets || 0) - (ex.baseSets || ex.sets || 0);
    if (delta > 0 && g) { added += delta; groups.add(MUSCLE_GROUPS[g]?.name); }
    if (delta < 0 && g) { groups.add(MUSCLE_GROUPS[g]?.name); }
  });
  const bonus = app.bonusForDay(day, focus, app.getProgram(data));
  bonus.forEach((b) => { const g = CAT_TO_GROUP[b.cat]; if (g) groups.add(MUSCLE_GROUPS[g]?.name); });
  return { added, bonusCount: bonus.length, groups: [...groups] };
}

function REFERENCE_dayPageEntries(day, data) {
  const focusObj = data.focus || DEFAULT_FOCUS;
  const program = app.getProgram(data);
  return [
    ...day.exercises.map((s) => ({ slot: s, ex: app.resolveSlot(s, data.swaps, focusObj) })),
    ...app.bonusForDay(day, focusObj, program).map((b) => ({ slot: b, ex: b })),
  ];
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
console.log(`Day-resolution check passed: ${checks} assertions across ${scenarios.length} seeded scenarios — resolveDayExercises is behavior-neutral vs. the pre-refactor per-call-site logic.`);
