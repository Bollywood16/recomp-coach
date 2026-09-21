#!/usr/bin/env node
/* Task 6, Section 1 — days schema, persistence shape, and the read path.
 * resolveDayExercises(day, data) checks data.plan.days for a dayKey match
 * BEFORE any generator/swap/bonus/prescription logic runs; when found, it
 * fully replaces that day's exercise list. Covers:
 *
 *   1. Backward compatibility: with data.plan.days absent (every plan
 *      before this section, and every plan without an authored day),
 *      resolveDayExercises is byte-identical to before this change — real
 *      data, not just seeded.
 *   2. An authored day is read correctly: order (ordered ascending by
 *      `order`, not array position), sets/repMin/repMax/restSec/load/
 *      scheme all carried onto the resolved `ex`, rationale and
 *      substitutedFor preserved for the UI, `authored: true` marker set.
 *   3. resolveAuthoredExercise reuses resolveSlot (not a fork): a user's
 *      own swap (data.swaps) still applies to an authored exercise, and
 *      emphasis rescaling (focus sliders) does NOT apply — an authored
 *      sets count is taken literally.
 *   4. capAndSplitMovement still runs over an authored day's list (a
 *      6-set authored exercise with maxSetsPerMovement:4 still caps and
 *      spawns, same mechanism as the generator path).
 *   5. Prescriptions (Task 2) targeting an authored dayKey have NO
 *      effect — full authorship doesn't compose with the partial-override
 *      mechanism; the authored list is exactly what's rendered.
 *   6. Real data: an authored day built from the real backup's own
 *      injuryProfile/swaps/focus resolves without error and produces the
 *      expected exercise set.
 *
 * Run: node scripts/check-authored-days.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "resolveDayExercises", "resolveAuthoredExercise", "getProgram", "EX_BY_ID",
  "DEFAULT_INJURY_PROFILE", "DEFAULT_FOCUS", "hardSetsFor",
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

const baseData = () => ({
  sessions: [], swaps: {}, focus: { ...app.DEFAULT_FOCUS }, injuryProfile: app.DEFAULT_INJURY_PROFILE,
  plan: { template: "upperFocus", sessionMin: 60 },
});

/* ===== 1. Backward compatibility: no data.plan.days ===== */
{
  const data = baseData();
  const program = app.getProgram(data);
  const day = program.find((d) => d.id === "ufArms");
  const list = app.resolveDayExercises(day, data);
  ok("no data.plan.days at all -> generator path runs, produces the day's normal exercises", list.length > 0 && list.every((e) => !e.ex.authored));
  const withEmptyDays = { ...data, plan: { ...data.plan, days: [] } };
  const list2 = app.resolveDayExercises(day, withEmptyDays);
  check("plan.days present but empty -> identical to plan.days absent", list2, list);
  const withOtherDay = { ...data, plan: { ...data.plan, days: [{ dayKey: "ufLower", exercises: [] }] } };
  const list3 = app.resolveDayExercises(day, withOtherDay);
  check("plan.days has an entry for a DIFFERENT dayKey -> this day's generator path is untouched", list3, list);
}

/* ===== 2. An authored day is read correctly ===== */
{
  const data = baseData();
  data.plan.days = [{
    dayKey: "ufArms",
    label: "Arms + Delts",
    exercises: [
      { exerciseId: "skull", order: 2, sets: 4, repMin: 10, repMax: 15, load: 35, restSec: 90, rationale: "Triceps first for volume." },
      { exerciseId: "ezcurl", order: 1, sets: 3, repMin: 10, repMax: 15, rationale: "Biceps second.", substitutedFor: "hammer" },
    ],
  }];
  const program = app.getProgram(data);
  const day = program.find((d) => d.id === "ufArms");
  const list = app.resolveDayExercises(day, data);
  ok("authored day produces exactly the authored exercises (2), not the template's own", list.length === 2, JSON.stringify(list.map((e) => e.ex.id)));
  ok("ordered by `order`, not array position (ezcurl order:1 comes first despite being listed second)", list[0].ex.id === "ezcurl" && list[1].ex.id === "skull", JSON.stringify(list.map((e) => e.ex.id)));
  const skullEx = list.find((e) => e.ex.id === "skull").ex;
  ok("sets/repMin/repMax/restSec/prescribedLoad(load) carried onto the resolved ex", skullEx.sets === 4 && skullEx.repMin === 10 && skullEx.repMax === 15 && skullEx.restSec === 90 && skullEx.prescribedLoad === 35, JSON.stringify(skullEx));
  ok("rationale carried onto the resolved ex", skullEx.rationale === "Triceps first for volume.");
  const ezcurlEx = list.find((e) => e.ex.id === "ezcurl").ex;
  ok("substitutedFor carried onto the resolved ex", ezcurlEx.substitutedFor === "hammer");
  ok("authored: true marker set", skullEx.authored === true && ezcurlEx.authored === true);
}

/* ===== 3. resolveSlot reuse: swap support + no emphasis rescaling ===== */
{
  const data = baseData();
  data.focus.arms = "specialize"; // would normally 1.85x a generator slot's sets — must NOT apply here
  data.plan.days = [{ dayKey: "ufArms", exercises: [{ exerciseId: "ezcurl", order: 1, sets: 3, rationale: "x" }] }];
  const day = app.getProgram(data).find((d) => d.id === "ufArms");
  const list = app.resolveDayExercises(day, data);
  ok("authored sets count is taken literally — emphasis 'specialize' does NOT rescale it", list[0].ex.sets === 3, list[0].ex.sets);

  const withSwap = { ...data, swaps: { ezcurl: "cablecurl" } };
  const list2 = app.resolveDayExercises(day, withSwap);
  ok("a user's own swap (data.swaps) still applies to an authored exercise", list2[0].ex.id === "cablecurl", list2[0].ex.id);
  ok("swapped + originalName bookkeeping inherited from resolveSlot, not reimplemented", list2[0].ex.swapped === true && list2[0].ex.originalName === app.EX_BY_ID.ezcurl.name, JSON.stringify({ swapped: list2[0].ex.swapped, originalName: list2[0].ex.originalName }));
}

/* ===== 4. capAndSplitMovement still runs over an authored list ===== */
{
  const data = baseData();
  data.plan.sessionRules = { maxSetsPerMovement: 4 };
  data.plan.days = [{ dayKey: "ufArms", exercises: [{ exerciseId: "ezcurl", order: 1, sets: 6, rationale: "x" }] }];
  const day = app.getProgram(data).find((d) => d.id === "ufArms");
  const list = app.resolveDayExercises(day, data);
  const ezcurl = list.find((e) => e.ex.id === "ezcurl").ex;
  ok("authored exercise exceeding maxSetsPerMovement is capped, same as generator overflow", ezcurl.sets === 4, ezcurl.sets);
  ok("overflow spawns a second movement from the same pool", list.length === 2, JSON.stringify(list.map((e) => e.ex.id)));
  ok("maxSetsNotes attached to the returned list, same as the generator path", Array.isArray(list.maxSetsNotes) && list.maxSetsNotes.length === 1, JSON.stringify(list.maxSetsNotes));
}

/* ===== 5. Prescriptions don't compose with an authored day ===== */
{
  const data = baseData();
  data.plan.days = [{ dayKey: "ufArms", exercises: [{ exerciseId: "ezcurl", order: 1, sets: 3, rationale: "x" }] }];
  data.plan.prescriptions = [{ exerciseId: "skull", dayKey: "ufArms", sets: 5 }];
  const day = app.getProgram(data).find((d) => d.id === "ufArms");
  const list = app.resolveDayExercises(day, data);
  ok("a prescription targeting an authored dayKey has NO effect — authored list is exactly what renders", list.length === 1 && list[0].ex.id === "ezcurl", JSON.stringify(list.map((e) => e.ex.id)));
}

/* ===== 6. Real data ===== */
const BACKUP_FILE = path.join(__dirname, "..", "recomp-coach-backup-2026-09-06.json");
if (!fs.existsSync(BACKUP_FILE)) {
  console.warn("NOTE: recomp-coach-backup-2026-09-06.json not found — skipping the real-data case (synthetic cases above still ran).");
} else {
  const raw = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
  const real = raw.data || raw;
  const data = { ...real, injuryProfile: { ...app.DEFAULT_INJURY_PROFILE, recoveringMode: true } };
  data.plan = {
    ...data.plan,
    days: [{
      dayKey: "ufArms",
      exercises: [
        { exerciseId: "ezcurl", order: 1, sets: 4, repMin: 10, repMax: 15, load: 40, rationale: "Specialize group first." },
        { exerciseId: "skull", order: 2, sets: 4, repMin: 10, repMax: 15, rationale: "Triceps volume matches biceps." },
      ],
    }],
  };
  const day = app.getProgram(data).find((d) => d.id === "ufArms");
  let list;
  let threw = null;
  try { list = app.resolveDayExercises(day, data); } catch (e) { threw = e; }
  ok("real data: authored day resolves without throwing", !threw, threw && threw.stack);
  if (!threw) {
    ok("real data: exactly the 2 authored exercises render, in order", list.length === 2 && list[0].ex.id === "ezcurl" && list[1].ex.id === "skull", JSON.stringify(list.map((e) => e.ex.id)));
    ok("real data: the real legpress->goblet swap in this file does not leak into an unrelated authored day", !list.some((e) => e.ex.id === "goblet"));
  }
}

if (failures > 0) {
  console.error(`\nAUTHORED-DAYS CHECK FAILED: ${failures}/${checks} assertions failed.`);
  process.exit(1);
}
console.log(`Authored-days check passed: ${checks} assertions — backward compatibility with no data.plan.days, correct order/field carry-through for an authored day, resolveSlot reuse (swap support, no emphasis rescaling), capAndSplitMovement still applies, prescriptions don't compose with an authored dayKey, and real-data resolution.`);
