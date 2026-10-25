#!/usr/bin/env node
/* coach-apply-overhaul P0-3/4: truthful coach brief (FIX_SPEC.md items 3
 * and 4). Asserts, for both tiers and every template:
 *   1. The brief's compliant list (ok=Y) is a SUBSET of the exercises that
 *      pass the apply step's own exercise-level gates (Gate 1 + Gate 2,
 *      called directly — not a reimplementation).
 *   2. Every library row carries gating tags (romProfile / gating
 *      attributes / contraindications columns present, ok column present).
 *   3. The blanket "already gate-compliant" claim is gone.
 *   4. Every exercise in <program_days> and training_metrics.lifts is in
 *      the library or explicitly flagged ("not in live library" / inLibrary N).
 *   5. <program_days> shows the day as it renders (swaps applied), and
 *      flags a Gate-2-rejected live exercise (goblet via swap).
 *   6. training_metrics carries weeklySets == weeklySetsByGroup(data).
 *
 * Run: node scripts/check-brief-truthfulness.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "buildCoachBrief", "gate1UnknownId", "gate2Injury", "ALL_KNOWN", "EX_BY_ID", "PROGRAMS",
  "weeklySetsByGroup", "coachMetrics", "DEFAULT_INJURY_PROFILE", "checkInExerciseLibrary", "resolveDayExercises",
]);

let failures = 0, checks = 0;
function ok(label, cond, detail) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${detail ? `\n  ${detail}` : ""}`); }
}
const base = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "synthetic-backup.json"), "utf8")).data;
const GOAL = { text: "bigger arms, capped shoulders" };
// The real section opens with the tag on its own line; prose elsewhere in
// the brief mentions "<training_metrics> numbers…" inline, which must not match.
const section = (brief, tag) => {
  const m = brief.match(new RegExp(`(?:^|\\n)<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`));
  return m ? m[1] : "";
};
// Library rows: lines in <exercise_library> that start with a known id and a pipe.
const libraryRows = (brief) => section(brief, "exercise_library").split("\n")
  .filter((l) => /^[A-Za-z_0-9]+\|/.test(l) && app.EX_BY_ID[l.split("|")[0]]);
const passesApplyGates = (id, ip) =>
  !app.gate1UnknownId({ exerciseId: id }).reject && !app.gate2Injury({ exerciseId: id }, { injuryProfile: ip }).reject;

for (const template of Object.keys(app.PROGRAMS)) {
  for (const tier of ["checkin", "full"]) {
    const data = { ...base, plan: { ...base.plan, template } };
    const ip = data.injuryProfile || app.DEFAULT_INJURY_PROFILE;
    const brief = app.buildCoachBrief(data, GOAL, tier);
    const tag = `${template}/${tier}`;
    const rows = libraryRows(brief);
    const expectedCols = tier === "full" ? 8 : 6;

    ok(`${tag}: library has rows`, rows.length > 0);
    ok(`${tag}: every row has ${expectedCols} columns (tags + ok)`,
      rows.every((r) => r.split("|").length === expectedCols),
      rows.filter((r) => r.split("|").length !== expectedCols).slice(0, 3).join(" / "));
    const compliant = rows.filter((r) => r.split("|").pop() === "Y").map((r) => r.split("|")[0]);
    const notCompliant = rows.filter((r) => r.split("|").pop() !== "Y").map((r) => r.split("|")[0]);
    ok(`${tag}: compliant list ⊆ exercises passing the apply gates`,
      compliant.every((id) => passesApplyGates(id, ip)),
      compliant.filter((id) => !passesApplyGates(id, ip)).join(", "));
    ok(`${tag}: and every ok=N row really fails them (no false N)`,
      notCompliant.every((id) => !passesApplyGates(id, ip)),
      notCompliant.filter((id) => passesApplyGates(id, ip)).join(", "));
    ok(`${tag}: no blanket "already gate-compliant" claim`, !/already gate-compliant/.test(brief));

    // 4. program_days + lifts coverage.
    const libIds = new Set(rows.map((r) => r.split("|")[0]));
    const pd = section(brief, "program_days");
    const pdItems = [...pd.matchAll(/\[([a-z_0-9]+)(;[^\]]*)?\]/gi)]
      .map((m) => ({ id: m[1], flags: m[2] || "" }))
      .filter((it) => app.EX_BY_ID[it.id]); // skip the legend's literal "[id; flags]"
    ok(`${tag}: program_days lists exercises`, pdItems.length > 0);
    ok(`${tag}: every program_days exercise is in the library or flagged`,
      pdItems.every((it) => libIds.has(it.id) || /not in live library/.test(it.flags)),
      pdItems.filter((it) => !libIds.has(it.id) && !/not in live library/.test(it.flags)).map((it) => it.id).join(", "));
    const tm = section(brief, "training_metrics");
    const liftRows = tm.split("\n").filter((l) => /^[a-z_0-9]+\|/i.test(l) && l.split("|").length === 8);
    ok(`${tag}: lifts carry the inLibrary column`, liftRows.length > 0);
    ok(`${tag}: inLibrary is truthful for every lift`,
      liftRows.every((l) => { const c = l.split("|"); return (c[7] === "Y") === libIds.has(c[0]); }),
      liftRows.filter((l) => { const c = l.split("|"); return (c[7] === "Y") !== libIds.has(c[0]); }).join(" / "));

    // 6. weeklySets
    const week = app.weeklySetsByGroup(data);
    ok(`${tag}: training_metrics has weeklySets equal to weeklySetsByGroup`,
      tm.includes(`"weeklySets":${JSON.stringify(week)}`), JSON.stringify(week));
  }
}

/* 5. Swaps resolved in program_days; goblet (Gate 2 reject) flagged. */
{
  const brief = app.buildCoachBrief(base, GOAL, "checkin");
  const pd = section(brief, "program_days");
  ok("program_days shows the swapped-in Machine Row, not the template's Chest-Supported Row",
    /\[machrow\]/.test(pd) && !/\[csrow/.test(pd), pd);
  ok("program_days flags goblet (live via swap) as failing Gate 2", /\[goblet;[^\]]*fails Gate 2/.test(pd), pd);
  const rows = libraryRows(brief);
  const goblet = rows.find((r) => r.startsWith("goblet|"));
  ok("checkin library row for goblet shows squatDepth tag and ok=N:G2",
    goblet && /squatDepth=below_parallel/.test(goblet) && goblet.endsWith("|N:G2"), goblet);
  ok("intro states how many live exercises are ok=N", /1 of them are ok=N/.test(section(brief, "exercise_library")),
    section(brief, "exercise_library").split("\n")[1]);
  // rdl is logged (synthetic has none) — use a lift logged outside the library:
  const withRdl = { ...base, sessions: [...base.sessions,
    { id: 2001, date: "2026-09-20", exerciseId: "rdl", sets: [{ w: 95, r: 8 }] }] };
  const b2 = app.buildCoachBrief(withRdl, GOAL, "checkin");
  const rdlLine = section(b2, "training_metrics").split("\n").find((l) => l.startsWith("rdl|"));
  ok("a logged lift outside the live library (rdl) is flagged inLibrary=N", rdlLine && rdlLine.endsWith("|N"), rdlLine);
}

/* Library includes everything the live program renders (prescription ADDs too). */
{
  const withAdd = { ...base, plan: { ...base.plan,
    prescriptions: [{ exerciseId: "cablecurl", dayKey: "ufUpperB", sets: 3 }] } };
  const lib = app.checkInExerciseLibrary(withAdd).map((e) => e.id);
  ok("checkin library includes a stored prescription ADD (cablecurl)", lib.includes("cablecurl"));
}

if (failures) {
  console.error(`\n${failures} of ${checks} assertions FAILED (check-brief-truthfulness.js)`);
  process.exit(1);
}
console.log(`check-brief-truthfulness.js: ${checks} assertions passed — compliant ⊆ apply-gate passes (no false N either), tags on every row, program_days resolved and flagged, lifts' inLibrary truthful, weeklySets present.`);
