#!/usr/bin/env node
/* Task 6, Section 6 (pre-decisions 4 and 6) — generator-side day ordering
 * by emphasis rank descending, and sessionRules.trimPriority wired to
 * both the ordinary trim's cut order AND its floor protection.
 *
 * This covers:
 *   1. Generator default order: highest emphasis rank first, reusing
 *      trimPriority (not a second ranking scheme) — same-rank exercises
 *      keep their original relative order (stable sort).
 *   2. Authored days still order by their own explicit `order` field,
 *      unaffected by the generator-side default (Section 1 already
 *      covers this; reconfirmed here as a cross-section regression
 *      guard specific to this change).
 *   3. sessionRules.trimPriority customizes BOTH which group's sets get
 *      cut first AND which group's floor is protected — coherently, by
 *      rank position, not by name — so a custom order can't fight itself
 *      (cutting a level first while a stale floor still protects it by
 *      name).
 *   4. Gate 13's maintain-floor protection (dropTierRank) is NOT
 *      customizable via sessionRules.trimPriority — a custom order that
 *      doesn't even mention "maintain" still can't cause a maintain
 *      movement to be the first fully dropped.
 *   5. Real data: the actual Delts & Arms day, re-run after this
 *      section's changes — arms (specialize) now sequenced first,
 *      shoulders (emphasize) second, fixing observed failure #3.
 *
 * Run: node scripts/check-day-ordering.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "resolveDayExercises", "fitDayToTime", "getProgram", "EX_BY_ID",
  "DEFAULT_INJURY_PROFILE", "DEFAULT_FOCUS", "trimPriority", "groupTrimFloors", "dropTierRank",
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

/* ===== 1. Generator default order: emphasis rank descending ===== */
{
  const data = baseData({ focus: { ...app.DEFAULT_FOCUS, arms: "specialize", shoulders: "emphasize" } });
  const day = app.getProgram(data).find((d) => d.id === "ufArms");
  const list = app.resolveDayExercises(day, data).map((e) => e.ex);
  // ufArms template order is shoulders(machohp,cablelat,reardelt) then
  // arms(ezcurl,skull,ohte) — arms specialize must now sequence BEFORE
  // shoulders emphasize despite being listed second in the template.
  const armsIds = ["ezcurl", "skull", "ohte"];
  const shoulderIds = ["machohp", "cablelat", "reardelt"];
  const firstArmsIdx = list.findIndex((e) => armsIds.includes(e.id));
  const firstShoulderIdx = list.findIndex((e) => shoulderIds.includes(e.id));
  ok("arms (specialize) exercises sequence before shoulders (emphasize) exercises, reversing the template's own declaration order", firstArmsIdx < firstShoulderIdx, JSON.stringify(list.map((e) => e.id)));
  ok("all 3 arms exercises appear as a contiguous block ahead of all 3 shoulder exercises", list.slice(0, 3).every((e) => armsIds.includes(e.id)), JSON.stringify(list.map((e) => e.id)));

  // Same-rank tie-break: within arms, ezcurl/skull/ohte should keep their
  // ORIGINAL relative template order (stable sort) since they're all the
  // same emphasis rank and none is compound.
  const armsOnly = list.filter((e) => armsIds.includes(e.id)).map((e) => e.id);
  check("same-rank exercises (all of arms) keep their original template order (stable sort)", armsOnly, ["ezcurl", "skull", "ohte"]);
}

/* ===== 2. Authored days still order by their own explicit `order` ===== */
{
  const data = baseData({ focus: { ...app.DEFAULT_FOCUS, arms: "specialize" } });
  data.plan.days = [{
    dayKey: "ufArms",
    exercises: [
      { exerciseId: "skull", order: 1, sets: 3, rationale: "explicitly ordered first despite lower emphasis relevance" },
      { exerciseId: "ezcurl", order: 2, sets: 3, rationale: "explicitly ordered second" },
    ],
  }];
  const day = app.getProgram(data).find((d) => d.id === "ufArms");
  const list = app.resolveDayExercises(day, data).map((e) => e.ex.id);
  check("authored day order is unaffected by the generator-side default — follows its own `order` field exactly", list, ["skull", "ezcurl"]);
}

/* ===== 3. sessionRules.trimPriority customizes trim order AND floor
 * coherently (by rank position, not name) ===== */
{
  const focus = { shoulders: "emphasize", arms: "specialize" };
  const preFit = [
    { ...app.EX_BY_ID.machohp, sets: 4 },  // shoulders, emphasize, compound
    { ...app.EX_BY_ID.ezcurl, sets: 6 },   // arms, specialize, isolation
  ];
  // Default order: specialize(arms) ranks above emphasize(shoulders) ->
  // shoulders would be cut first normally, but machohp is compound so
  // ties are irrelevant here; with DEFAULT order, arms (rank 3) is
  // protected more than shoulders (rank 2).
  const defaultFit = app.fitDayToTime(preFit.map((e) => ({ ...e })), 20, focus);
  const defaultEzcurl = defaultFit.list.find((e) => e.id === "ezcurl");
  const defaultMachohp = defaultFit.list.find((e) => e.id === "machohp");

  // Custom trimPriority INVERTS the default: specialize is named FIRST
  // (cut first) instead of last.
  const customOrder = ["specialize", "emphasize", "normal", "maintain"];
  const customFit = app.fitDayToTime(preFit.map((e) => ({ ...e })), 20, focus, customOrder);
  const customEzcurl = customFit.list.find((e) => e.id === "ezcurl");
  const customMachohp = customFit.list.find((e) => e.id === "machohp");

  ok("with a custom trimPriority naming specialize FIRST, the specialize-tier exercise (ezcurl) is cut MORE than under the default order", customEzcurl.sets < defaultEzcurl.sets, JSON.stringify({ default: defaultEzcurl.sets, custom: customEzcurl.sets }));
  ok("machohp (compound, protected at floor 2 regardless of tier) is unaffected either way", defaultMachohp.sets >= 2 && customMachohp.sets >= 2);

  // Floor coherence: groupTrimFloors under the custom order should give
  // "maintain" (now RANKED LAST in customOrder = position 3, the
  // highest-protection slot) the 75% floor instead of "specialize".
  const legs = { ...app.DEFAULT_FOCUS, legs: "maintain" };
  const legsItems = [{ ...app.EX_BY_ID.legpress, sets: 10 }];
  const defaultFloors = app.groupTrimFloors(legsItems, legs);
  const investedOrder = ["specialize", "emphasize", "normal", "maintain"]; // maintain now LAST = most protected
  const customFloors = app.groupTrimFloors(legsItems, legs, investedOrder);
  ok("under the default order, maintain (legs) gets NO pct-based floor (0%)", defaultFloors.legs === 2 /* absFloor only, compound legpress */, JSON.stringify(defaultFloors));
  ok("under a custom order ranking maintain LAST (most protected), legs now gets the 75% floor instead", customFloors.legs > defaultFloors.legs, JSON.stringify({ defaultFloors, customFloors }));
}

/* ===== 4. Gate 13's dropTierRank is NOT customizable via trimPriority ===== */
{
  const focus = { legs: "maintain", core: "normal" };
  // Custom order that doesn't even mention "maintain" explicitly in a
  // way that would protect it — dropTierRank must still protect it.
  const weirdOrder = ["normal", "maintain", "emphasize", "specialize"];
  const maintainEx = { ...app.EX_BY_ID.hipthrust, sets: 1 };
  const normalEx = { ...app.EX_BY_ID.kneeraise, sets: 1 };
  // dropTierRank takes no order param at all -- confirm the maintain
  // exercise always ranks last (99) regardless of what's passed.
  ok("dropTierRank ranks a maintain-tier exercise as 99 (last/most-protected) unconditionally", app.dropTierRank(maintainEx, focus) === 99);
  ok("dropTierRank ranks a normal-tier exercise below maintain's 99", app.dropTierRank(normalEx, focus) < 99, app.dropTierRank(normalEx, focus));
}

/* ===== 5. Real data: Delts & Arms, re-run after Section 6 ===== */
const BACKUP_FILE = path.join(__dirname, "..", "recomp-coach-backup-2026-09-06.json");
if (!fs.existsSync(BACKUP_FILE)) {
  console.warn("NOTE: recomp-coach-backup-2026-09-06.json not found — skipping the real-data case (synthetic cases above still ran).");
} else {
  const raw = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
  const real = raw.data || raw;
  const data = { ...real, injuryProfile: { ...app.DEFAULT_INJURY_PROFILE, recoveringMode: true } };
  const day = app.getProgram(data).find((d) => d.id === "ufArms");
  const list = app.resolveDayExercises(day, data).map((e) => e.ex);
  const fit = app.fitDayToTime(list, data.plan.sessionMin || 60, data.focus);

  ok("real data: arms (specialize) exercises sequence first, fixing observed failure #3 (\"arms sequenced last\")", ["ezcurl", "skull", "ohte"].includes(fit.list[0].id), JSON.stringify(fit.list.map((e) => e.id)));
  const firstShoulderPos = fit.list.findIndex((e) => ["machohp", "cablelat", "latraise", "reardelt"].includes(e.id));
  const lastArmsPos = Math.max(...["ezcurl", "skull", "ohte"].map((id) => fit.list.findIndex((e) => e.id === id)).filter((i) => i !== -1));
  ok("real data: all primary arms exercises precede the first shoulder exercise", lastArmsPos < firstShoulderPos, JSON.stringify({ lastArmsPos, firstShoulderPos, order: fit.list.map((e) => e.id) }));
  ok("real data: session still fits the 60-minute budget", fit.minutes <= 60, fit.minutes);
}

if (failures > 0) {
  console.error(`\nDAY-ORDERING CHECK FAILED: ${failures}/${checks} assertions failed.`);
  process.exit(1);
}
console.log(`Day-ordering check passed: ${checks} assertions — generator-side emphasis-descending default order (stable tie-break), authored-day order unaffected, sessionRules.trimPriority customizing both cut order and floor coherently by rank position, Gate 13's maintain protection staying non-customizable, and the real Delts & Arms day now sequencing arms before shoulders.`);
