#!/usr/bin/env node
/* coach-apply-overhaul P1-7: maxSetsPerMovement through the coach-apply
 * path (FIX_SPEC.md item 7). check-pool-splitting.js already covers the
 * capAndSplitMovement mechanics; this covers the end-to-end path a pasted
 * plan takes:
 *   1. A prescription over the cap is split onto the next-ranked
 *      same-pool alternate, not stacked — in the preview AND after apply.
 *   2. Total sets are conserved (the split moves volume, Gate 6 counts it
 *      once), and the preview shows the split note on that day.
 *   3. A pasted sessionRules.maxSetsPerMovement governs the projection.
 *   4. No valid alternate (all fail Gate 2) -> capped with a note, never
 *      exceeded.
 *   5. The brief states the rule and the default.
 *
 * Run: node scripts/check-max-sets-apply.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "applyCoachGates", "coachMetrics", "buildPlanPreview", "planUpdateFrom", "resolveDayExercises", "getProgram",
  "buildCoachBrief", "DEFAULT_INJURY_PROFILE", "DEFAULT_MAX_SETS_PER_MOVEMENT", "ALL_KNOWN", "EX_BY_ID",
  "gate2Injury", "weeklySetsByGroup",
]);

let failures = 0, checks = 0;
function ok(label, cond, detail) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${detail ? `\n  ${detail}` : ""}`); }
}
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "synthetic-backup.json"), "utf8")).data;
const TODAY = "2026-10-01";
const gate = (d, r) => app.applyCoachGates(r, app.coachMetrics(d), d.injuryProfile || app.DEFAULT_INJURY_PROFILE, d);
const BASE = { template: "upperFocus", focus: data.focus, sessionMin: 75, calorieDelta: 0,
  sessionRules: { maxSetsPerMovement: 4, weeklyGroupSetCaps: { arms: 40, shoulders: 30 } } };
const armsDay = (d) => app.getProgram(d).find((x) => x.id === "ufArms");

/* 1-2. Prescription over the cap: split, not stacked; sets conserved; note shown. */
{
  const rec = { ...BASE, prescriptions: [{ exerciseId: "ezcurl", dayKey: "ufArms", sets: 6, repMin: 10, repMax: 15 }] };
  const gated = gate(data, rec);
  ok("6-set prescription accepted (the cap splits, it doesn't reject)", (gated.prescriptions || []).length === 1, JSON.stringify(gated.prescriptionRejections));
  ok("stored prescription keeps the coach's raw 6 sets", gated.prescriptions[0].sets === 6);

  const preview = app.buildPlanPreview(data, gated, TODAY);
  const day = preview.days.find((d) => d.dayKey === "ufArms");
  const ez = day.exercises.find((e) => e.id === "ezcurl");
  ok("preview: EZ-bar curl capped at 4", ez && ez.sets === 4, JSON.stringify(day.exercises));
  ok("preview: shows the per-movement split note for that day",
    day.maxSetsNotes.some((n) => n.exerciseId === "ezcurl" && /capped at 4 sets \(was 6\) — spawned/.test(n.note)), JSON.stringify(day.maxSetsNotes));

  const stored = { ...data, focus: gated.focus, plan: app.planUpdateFrom(data, gated, TODAY) };
  const list = app.resolveDayExercises(armsDay(stored), stored).map((e) => e.ex);
  const ezRow = list.find((e) => e.id === "ezcurl");
  const spawn = list.find((e) => e.poolSpawned && e.poolSpawnedFrom === "ezcurl");
  ok("after apply: EZ-bar curl renders at 4 (not stacked to 6)", ezRow && ezRow.sets === 4);
  ok("after apply: the overflow 2 sets land on a same-pool alternate", spawn && spawn.sets === 2 && spawn.pool === app.EX_BY_ID.ezcurl.pool, JSON.stringify(spawn));
  // Best-ranked candidate not already on the day that passes Gate 2:
  const onDay = new Set(list.filter((e) => !e.poolSpawned).map((e) => e.id));
  const ip = stored.injuryProfile || app.DEFAULT_INJURY_PROFILE;
  const expected = app.ALL_KNOWN
    .filter((a) => a.pool === "biceps" && a.id !== "ezcurl" && !onDay.has(a.id))
    .sort((a, b) => (a.rank || 4) - (b.rank || 4) || a.name.localeCompare(b.name))
    .find((a) => !app.gate2Injury({ exerciseId: a.id }, { injuryProfile: ip }).reject);
  ok("after apply: the spawn is the NEXT-ranked compatible alternate", spawn && expected && spawn.id === expected.id, `${spawn && spawn.id} vs ${expected && expected.id}`);
  ok("no row on the day exceeds the cap", list.every((e) => e.sets <= 4), list.map((e) => `${e.id}:${e.sets}`).join(" "));
  const prescribedArms = list.filter((e) => ["biceps", "triceps"].includes(e.cat) && (e.prescribed || e.poolSpawnedFrom === "ezcurl"))
    .reduce((a, e) => a + e.sets, 0);
  ok("sets conserved: the prescribed 6 = 4 on EZ-bar + 2 on the spawn", prescribedArms === 6, `${prescribedArms}`);
}

/* 3. A pasted maxSetsPerMovement governs the projection. */
{
  const rec = { ...BASE, sessionRules: { ...BASE.sessionRules, maxSetsPerMovement: 3 },
    prescriptions: [{ exerciseId: "skull", dayKey: "ufArms", sets: 4 }] };
  const gated = gate(data, rec);
  const day = app.buildPlanPreview(data, gated, TODAY).days.find((d) => d.dayKey === "ufArms");
  const sk = day.exercises.find((e) => e.id === "skull");
  ok("pasted maxSetsPerMovement 3: a 4-set skullcrusher is capped at 3 in the preview", sk && sk.sets === 3, JSON.stringify(day.exercises));
  ok("...with the split note", day.maxSetsNotes.some((n) => n.exerciseId === "skull" && /capped at 3 sets \(was 4\)/.test(n.note)));
}

/* 4. No valid alternate -> capped with a note, never exceeded. The "calf"
      pool has exactly two members (calf, seatedcalf); with both on the
      Lower day, a 6-set standing calf raise has no pool-mate left to
      spawn and must be capped. */
{
  ok("sanity: calf has a real pool tag", app.EX_BY_ID.calf.pool === "calf");
  const calfPool = app.ALL_KNOWN.filter((e) => e.pool === "calf").map((e) => e.id).sort();
  ok("sanity: calf pool is exactly {calf, seatedcalf}", calfPool.join() === "calf,seatedcalf", calfPool.join());
  const rec = { ...BASE, prescriptions: [
    { exerciseId: "calf", dayKey: "ufLower", sets: 6 },
    { exerciseId: "seatedcalf", dayKey: "ufLower", sets: 2 },
  ] };
  const d = { ...data, briefTier: "full" };
  const gated = gate(d, { ...BASE, ...rec, sessionRules: { ...BASE.sessionRules, weeklyGroupSetCaps: { ...BASE.sessionRules.weeklyGroupSetCaps, legs: 30 } } });
  ok("both calf prescriptions accepted", (gated.prescriptions || []).length === 2, JSON.stringify(gated.prescriptionRejections));
  const day = app.buildPlanPreview(d, gated, TODAY).days.find((x) => x.dayKey === "ufLower");
  const row = day.exercises.find((e) => e.id === "calf");
  ok("no pool-mate left: standing calf capped at 4, not 6", row && row.sets === 4, JSON.stringify(day.exercises));
  ok("no spawn was invented outside the pool", !day.exercises.some((e) => !["calf", "seatedcalf"].includes(e.id) && app.EX_BY_ID[e.id] && app.EX_BY_ID[e.id].pool === app.EX_BY_ID.calf.pool));
  ok("the note says the overflow was dropped rather than exceeding the cap",
    day.maxSetsNotes.some((n) => n.exerciseId === "calf" && /dropped rather than exceeding the cap/.test(n.note)), JSON.stringify(day.maxSetsNotes));
}

/* 4b. Regression: every generator row in EVERY template carries its tags.
       EXERCISE_ATTRS lands only on EX_BY_ID (the first template's slot
       object); resolveSlot must spread it for all the other templates'
       slots, or their overflow is dropped as "untagged pool". */
{
  const missing = [];
  ["balanced", "upperFocus", "superhero"].forEach((template) => {
    const d = { ...data, swaps: {}, plan: { ...data.plan, template, prescriptions: [] } };
    app.getProgram(d).forEach((day) => {
      app.resolveDayExercises(day, d).forEach(({ ex }) => {
        const canon = app.EX_BY_ID[ex.id];
        if (canon && canon.pool && (ex.pool !== canon.pool || ex.tagSource !== canon.tagSource)) missing.push(`${template}/${day.id}/${ex.id}`);
      });
    });
  });
  ok("every resolved row (all templates) carries its canonical pool + tagSource", missing.length === 0, missing.join(", "));

  // And the concrete consequence: a generator calf row's overflow splits.
  const rec = { ...BASE, prescriptions: [{ exerciseId: "calf", dayKey: "ufLower", sets: 6 }],
    sessionRules: { ...BASE.sessionRules, weeklyGroupSetCaps: { ...BASE.sessionRules.weeklyGroupSetCaps, legs: 30 } } };
  const gated = gate(data, rec);
  const day = app.buildPlanPreview(data, gated, TODAY).days.find((x) => x.dayKey === "ufLower");
  ok("upperFocus Lower: a 6-set standing calf raise splits 4 + 2 onto seated calf (not dropped)",
    (day.exercises.find((e) => e.id === "calf") || {}).sets === 4 && (day.exercises.find((e) => e.id === "seatedcalf") || {}).sets === 2,
    JSON.stringify(day.exercises.map((e) => `${e.id}:${e.sets}`)));
}

/* 5. The brief states the rule. */
{
  const brief = app.buildCoachBrief(data, { text: "arms" }, "checkin");
  ok("brief states the per-movement cap and its default", brief.includes(`maxSetsPerMovement sets (default ${app.DEFAULT_MAX_SETS_PER_MOVEMENT})`));
}

if (failures) {
  console.error(`\n${failures} of ${checks} assertions FAILED (check-max-sets-apply.js)`);
  process.exit(1);
}
console.log(`check-max-sets-apply.js: ${checks} assertions passed — over-cap prescriptions split onto the next-ranked compatible alternate (preview and render agree, sets conserved), pasted cap honored, no-alternate case capped with a note, rule stated in the brief.`);
