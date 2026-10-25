#!/usr/bin/env node
/* coach-apply-overhaul P3-13: nutrition context (FIX_SPEC.md item 13).
 *   1. bwSlopePerWeek null -> the brief SAYS so (it used to vanish: the
 *      training_metrics JSON drops nulls), with the weigh-in count.
 *   2. With no trend, calorieDelta > +150 is a rejection (whole apply
 *      blocked) with a weigh-in prompt; <= +150 and any decrease pass.
 *   3. With a trend, +300 passes this gate (still clamped to ±300).
 *   4. The coach card shows a weigh-in prompt while there's no trend.
 *
 * Run: node scripts/check-nutrition-context.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp(["coachMetrics", "buildCoachBrief", "applyCoachGates", "buildPlanPreview", "DEFAULT_INJURY_PROFILE"]);

let failures = 0, checks = 0;
function ok(label, cond, detail) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${detail ? `\n  ${detail}` : ""}`); }
}
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "synthetic-backup.json"), "utf8")).data;
const withTrend = { ...data, weights: [
  { date: "2026-08-25", lbs: 161 }, { date: "2026-09-01", lbs: 160 }, { date: "2026-09-08", lbs: 159.4 }, { date: "2026-09-15", lbs: 158.6 },
] };
const REC = { template: "upperFocus", focus: data.focus, sessionMin: 60, sessionRules: data.plan.sessionRules };
const gate = (d, delta) => app.applyCoachGates({ ...REC, calorieDelta: delta }, app.coachMetrics(d), d.injuryProfile || app.DEFAULT_INJURY_PROFILE, d);

/* 1. Brief. */
{
  ok("fixture: 3 weigh-ins -> no slope", app.coachMetrics(data).bwSlopePerWeek === null && app.coachMetrics(data).weighIns === 3);
  const brief = app.buildCoachBrief(data, { text: "x" }, "checkin");
  ok("brief states there is no bodyweight trend, with the count", /Bodyweight trend: NONE — only 3 weigh-ins logged \(a trend needs at least 4\)/.test(brief));
  ok("brief warns that > +150 will be rejected", /calorieDelta above \+150 will be rejected/.test(brief));
  const b2 = app.buildCoachBrief(withTrend, { text: "x" }, "checkin");
  ok("with a trend the brief states the slope instead", /bwSlopePerWeek = -?\d+(\.\d+)? lb\/week from 4 weigh-ins/.test(b2) && !/Bodyweight trend: NONE/.test(b2));
}

/* 2-3. Gate. */
{
  const g = gate(data, 300);
  ok("no trend: +300 rejected with a weigh-in prompt", g.nutritionRejections.length === 1 && /Log your weight daily/.test(g.nutritionRejections[0].reason), JSON.stringify(g.nutritionRejections));
  ok("...and it blocks the whole apply", app.buildPlanPreview(data, g, "2026-10-01").ok === false);
  ok("no trend: +150 passes", gate(data, 150).nutritionRejections.length === 0);
  ok("no trend: -300 passes (cutting further isn't what's gated)", gate(data, -300).nutritionRejections.length === 0);
  ok("with a trend: +300 passes this gate", gate(withTrend, 300).nutritionRejections.length === 0);
  ok("existing ±300 clamp unchanged", gate(withTrend, 900).calorieDelta === 300);
}

/* 4. Coach card prompt. */
{
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const card = html.slice(html.indexOf("function CoachCard("), html.indexOf("function Insights("));
  ok("coach card shows the weigh-in prompt while weigh-ins < 4", /\(data\.weights \|\| \[\]\)\.length < BW_TREND_MIN_WEIGHINS && \(/.test(card) && /No bodyweight trend yet/.test(card));
}

if (failures) {
  console.error(`\n${failures} of ${checks} assertions FAILED (check-nutrition-context.js)`);
  process.exit(1);
}
console.log(`check-nutrition-context.js: ${checks} assertions passed — missing bodyweight trend stated in the brief, calorie increases > +150 held (whole apply) until there is one, weigh-in prompt on the coach card.`);
