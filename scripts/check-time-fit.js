#!/usr/bin/env node
/* coach-apply-overhaul P1-6: time-fit trimming (FIX_SPEC.md item 6 +
 * Sean's change 5 + the 2026-10-25 emphasize decision).
 *   - Trim in trimPriority tiers (non-focus isolation first).
 *   - Hard floors: specialize keeps 100% of its sets, emphasize 65%,
 *     compounds >= 2. Keyed on the level — custom order can't weaken them.
 *   - Within a tier, cut from the end of the (orderDay) list.
 *   - A day that can't fit without breaking a floor -> overBudgetMin > 0;
 *     at apply that's a Gate 7 rejection (whole plan blocked).
 *   - Stored prescriptions keep their raw sets (no hidden Gate 7 trim).
 *
 * Run: node scripts/check-time-fit.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "fitDayToTime", "resolveDayExercises", "getProgram", "applyCoachGates", "coachMetrics", "buildPlanPreview",
  "DEFAULT_INJURY_PROFILE", "EX_BY_ID", "CAT_TO_GROUP", "isCompound", "trimPriorityOf",
]);

let failures = 0, checks = 0;
function ok(label, cond, detail) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${detail ? `\n  ${detail}` : ""}`); }
}
const FIX = path.join(__dirname, "fixtures");
const data = JSON.parse(fs.readFileSync(path.join(FIX, "synthetic-backup.json"), "utf8")).data;
const rec = JSON.parse(fs.readFileSync(path.join(FIX, "synthetic-rejected-plan.json"), "utf8"));
const byGroup = (list) => list.reduce((t, e) => { const g = app.CAT_TO_GROUP[e.cat]; t[g] = (t[g] || 0) + e.sets; return t; }, {});
const gate = (d, r) => app.applyCoachGates(r, app.coachMetrics(d), d.injuryProfile || app.DEFAULT_INJURY_PROFILE, d);
const E = app.EX_BY_ID;

/* Spec test: a 60-minute fit of the arms day keeps all arm sets and trims delts first. */
{
  const day = app.getProgram(data).find((d) => d.id === "ufArms");
  const pre = app.resolveDayExercises(day, data).map((e) => e.ex);
  const fit = app.fitDayToTime(pre, 60, data.focus, app.trimPriorityOf(data));
  const b = byGroup(pre), a = byGroup(fit.list);
  ok("arms day @60: every arm set kept", a.arms === b.arms, `${b.arms} -> ${a.arms}`);
  ok("arms day @60: delts trimmed first (shoulders lose sets, arms none)", a.shoulders < b.shoulders, `${b.shoulders} -> ${a.shoulders}`);
  ok("arms day @60: shoulders (emphasize) never below 65% of their sets", a.shoulders >= Math.round(b.shoulders * 0.65), `${a.shoulders} vs floor ${Math.round(b.shoulders * 0.65)}`);
  ok("arms day @60: this fixture's day can't fit with both floors -> reported over budget, not gutted", fit.overBudgetMin > 0, fit.overBudgetMin);
}

/* Compound minimum, and within-tier cut from the END of the list. */
{
  const focus = { chest: "normal", back: "normal" };
  const list = [
    { ...E.bench, sets: 4 }, { ...E.latpd, sets: 4 },        // normal compounds
    { ...E.pecdeck || E.machpress, sets: 4 },                  // filler
  ];
  const tight = app.fitDayToTime(list.map((e) => ({ ...e })), 20, focus);
  ok("no compound ever cut below 2 sets", tight.list.filter((e) => app.isCompound(e)).every((e) => e.sets >= 2), JSON.stringify(tight.list.map((e) => `${e.id}:${e.sets}`)));

  const iso = [{ ...E.hammer, sets: 4 }, { ...E.pressdn, sets: 4 }]; // same tier: arms normal isolation
  const one = app.fitDayToTime(iso.map((e) => ({ ...e })), 20, { arms: "normal" });
  // Budget 20 min = 12 min of work; trimming starts with the LAST-listed (pressdn).
  const s = (f, id) => (f.list.find((e) => e.id === id) || { sets: 0 }).sets;
  ok("within a tier, the last-listed lift is cut first", s(one, "pressdn") <= s(one, "hammer"), `hammer ${s(one, "hammer")}, pressdn ${s(one, "pressdn")}`);
  const flipped = app.fitDayToTime([...iso].reverse().map((e) => ({ ...e })), 20, { arms: "normal" });
  ok("...and reversing the list flips which one is cut first", s(flipped, "hammer") <= s(flipped, "pressdn"), `hammer ${s(flipped, "hammer")}, pressdn ${s(flipped, "pressdn")}`);
}

/* Hard floors aren't customizable. */
{
  const focus = { arms: "specialize", shoulders: "emphasize" };
  const list = [{ ...E.ezcurl, sets: 4 }, { ...E.skull, sets: 4 }, { ...E.cablelat, sets: 4 }, { ...E.latraise, sets: 4 }];
  const custom = app.fitDayToTime(list.map((e) => ({ ...e })), 20, focus, ["specialize", "emphasize", "normal", "maintain"]);
  const a = byGroup(custom.list);
  ok("custom order naming specialize first: arms still keep all 8", a.arms === 8, JSON.stringify(a));
  ok("custom order: shoulders still keep >= 65% (round(8 x 0.65) = 5)", a.shoulders >= 5, JSON.stringify(a));
  ok("custom order: an unfittable day is over budget, not cut through a floor", custom.overBudgetMin > 0, custom.overBudgetMin);
  ok("specialize isolation is never dropped entirely", custom.list.some((e) => e.id === "ezcurl") && custom.list.some((e) => e.id === "skull"));
}

/* Apply: replay plan fits -> applies; prescriptions keep raw sets. */
{
  const gated = gate(data, rec);
  ok("replay @60: no Gate 7 fit rejections", !(gated.fitRejections || []).length, JSON.stringify(gated.fitRejections));
  const raw = Object.fromEntries(rec.prescriptions.map((p) => [`${p.dayKey}/${p.exerciseId}`, p.sets]));
  ok("stored prescriptions keep their raw sets (no hidden Gate 7 trim)",
    gated.prescriptions.every((p) => p.sets === raw[`${p.dayKey}/${p.exerciseId}`]),
    gated.prescriptions.filter((p) => p.sets !== raw[`${p.dayKey}/${p.exerciseId}`]).map((p) => `${p.exerciseId}:${p.sets}`).join(" "));
}

/* Apply: an unfittable day is a Gate 7 rejection with the overage in minutes, and blocks everything. */
{
  const short = { ...rec, sessionMin: 45 };
  const gated = gate(data, short);
  const rej = gated.fitRejections || [];
  ok("45-min session: at least one day can't fit -> Gate 7 rejection", rej.length > 0, JSON.stringify(gated.fitNotes));
  ok("rejection states the overage in minutes", rej.every((r) => r.gate === 7 && /runs \d+ min over your 45-minute session/.test(r.reason)), rej.map((r) => r.reason).join(" | "));
  const preview = app.buildPlanPreview(data, gated, "2026-10-01");
  ok("Gate 7 rejection blocks the whole apply", preview.ok === false);
  ok("preview day shows its overage", preview.days.some((d) => d.overBudgetMin > 0));
}

if (failures) {
  console.error(`\n${failures} of ${checks} assertions FAILED (check-time-fit.js)`);
  process.exit(1);
}
console.log(`check-time-fit.js: ${checks} assertions passed — specialize 100% / emphasize 65% / compound 2 hard floors, end-of-list cuts, over-budget days rejected at apply, raw prescriptions stored.`);
