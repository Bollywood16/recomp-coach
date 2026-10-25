#!/usr/bin/env node
/* coach-apply-overhaul P0-2: atomic apply with preview (FIX_SPEC.md
 * item 2). buildPlanPreview is the single source for what the preview
 * shows and whether Apply is allowed; CoachCard's confirmPendingPlan
 * refuses unless preview.ok. Asserts:
 *   1. Any rejection (prescription OR authored day) -> ok=false: nothing
 *      may be applied, and every rejection is listed with gate + reason.
 *   2. A clean plan -> ok=true, with per-group before -> after matching
 *      Gate 6's own projection, and each day's final ordered list
 *      matching what that day renders once the plan is stored.
 *   3. planUpdateFrom (what Apply persists) and the preview's projection
 *      are the same object shape — the preview can't show a plan
 *      different from the one Apply writes.
 *   4. CoachCard source: no immediate-apply path left; confirm checks ok.
 *
 * Run: node scripts/check-atomic-apply.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "applyCoachGates", "coachMetrics", "buildPlanPreview", "planUpdateFrom", "weeklySetsByGroup",
  "resolveDayExercises", "fitDayToTime", "getProgram", "trimPriorityOf", "DEFAULT_INJURY_PROFILE",
]);

let failures = 0, checks = 0;
function ok(label, cond, detail) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${detail ? `\n  ${detail}` : ""}`); }
}
const FIX = path.join(__dirname, "fixtures");
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const data = readJson("synthetic-backup.json").data;
const rec = readJson("synthetic-rejected-plan.json");
const TODAY = "2026-10-01";
const gate = (d, r) => app.applyCoachGates(r, app.coachMetrics(d), d.injuryProfile || app.DEFAULT_INJURY_PROFILE, d);

/* 1. Clean plan: ok, before/after, day lists. */
{
  const gated = gate(data, rec);
  const preview = app.buildPlanPreview(data, gated, TODAY);
  ok("clean plan: ok=true", preview.ok === true, JSON.stringify(preview.rejections));
  ok("clean plan: no rejections", preview.rejections.length === 0);
  const arms = preview.groups.find((g) => g.group === "arms");
  const sh = preview.groups.find((g) => g.group === "shoulders");
  ok("preview arms before -> after = 32 -> 26", arms.before === 32 && arms.after === 26, JSON.stringify(arms));
  ok("preview shoulders after = 16", sh.after === 16, JSON.stringify(sh));
  ok("preview after matches Gate 6's projection",
    preview.groups.every((g) => g.after === ((gated.weeklyGroupSetsAfter || {})[g.group] || 0)));
  ok("preview shows cap per group (explicit arms 28)", arms.cap === 28);
  ok("preview lists all four upperFocus days", preview.days.map((d) => d.dayKey).join(",") === "ufUpperA,ufLower,ufUpperB,ufArms",
    preview.days.map((d) => d.dayKey).join(","));

  // 3. What Apply persists renders exactly the preview's days.
  const applied = { ...data, focus: gated.focus, plan: app.planUpdateFrom(data, gated, TODAY) };
  const week = app.weeklySetsByGroup(applied);
  ok("applied plan's week == preview after",
    preview.groups.every((g) => g.after === (week[g.group] || 0)));
  app.getProgram(applied).forEach((day) => {
    const list = app.fitDayToTime(app.resolveDayExercises(day, applied).map((e) => e.ex),
      applied.plan.sessionMin, applied.focus, app.trimPriorityOf(applied)).list;
    const pd = preview.days.find((d) => d.dayKey === day.id);
    ok(`${day.id}: preview list is exactly the rendered day (order + sets)`,
      pd && JSON.stringify(pd.exercises.map((e) => `${e.id}:${e.sets}`)) === JSON.stringify(list.map((e) => `${e.id}:${e.sets}`)),
      pd && `${pd.exercises.map((e) => `${e.id}:${e.sets}`).join(" ")} vs ${list.map((e) => `${e.id}:${e.sets}`).join(" ")}`);
  });
  ok("coach-prescribed rows are marked in the preview",
    preview.days.find((d) => d.dayKey === "ufArms").exercises.filter((e) => e.prescribed).length === 6);
  ok("notes carry the over-cap baseline warning",
    preview.notes.some((n) => /already at 32 weekly sets/.test(n.note)));
  ok("reconcile bookkeeping notes are not shown as notes", !preview.notes.some((n) => n.gate === "reconcile"));
}

/* 2. One rejected prescription blocks everything. */
{
  const bad = { ...rec, prescriptions: [...rec.prescriptions, { exerciseId: "goblet", dayKey: "ufLower", sets: 3 }] };
  const gated = gate(data, bad);
  const preview = app.buildPlanPreview(data, gated, TODAY);
  ok("one Gate 2 rejection -> ok=false (nothing applies)", preview.ok === false);
  ok("the rejection is listed with gate + reason",
    preview.rejections.some((r) => r.gate === 2 && r.exerciseId === "goblet" && /squat_depth|contraindicated|forbidden/.test(r.reason)),
    JSON.stringify(preview.rejections));
  ok("rejection kind is 'prescription'", preview.rejections.every((r) => r.kind === "prescription"));
}

/* 2b. Over-cap group blocks everything, including the groups that passed. */
{
  const tight = { ...rec, sessionRules: { ...rec.sessionRules, weeklyGroupSetCaps: { arms: 20, shoulders: 20 } } };
  const preview = app.buildPlanPreview(data, gate(data, tight), TODAY);
  ok("Gate 6 rejection on arms -> ok=false even though shoulders passed", preview.ok === false);
  ok("all 7 arm rejections listed", preview.rejections.filter((r) => r.gate === 6).length === 7,
    `${preview.rejections.length}`);
}

/* 2c. A rejected authored day blocks everything too. */
{
  const withDay = { ...rec, days: [{ dayKey: "ufArms", label: "Arms", exercises: [
    { exerciseId: "nope_unknown", order: 1, sets: 3, rationale: "x" }] }] };
  const d = { ...data, briefTier: "full" };
  const preview = app.buildPlanPreview(d, gate(d, withDay), TODAY);
  ok("rejected authored day -> ok=false", preview.ok === false);
  ok("day rejection listed as kind 'day'", preview.rejections.some((r) => r.kind === "day"), JSON.stringify(preview.rejections));
}

/* 4. CoachCard has no immediate-apply path, and confirm enforces ok. */
{
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const card = html.slice(html.indexOf("function CoachCard("), html.indexOf("function Insights("));
  const calls = (card.match(/persistAppliedPlan\(/g) || []).length;
  ok("persistAppliedPlan is called from exactly one place (confirmPendingPlan)", calls === 1, `${calls} call sites`);
  ok("confirmPendingPlan refuses unless preview.ok",
    /const confirmPendingPlan = \(\) => \{[\s\S]{0,300}?!pendingPlan\.preview\.ok\) return;/.test(card));
  ok("no legacy applyPlan (template/focus-only partial apply) remains", !/const applyPlan = /.test(card));
}

if (failures) {
  console.error(`\n${failures} of ${checks} assertions FAILED (check-atomic-apply.js)`);
  process.exit(1);
}
console.log(`check-atomic-apply.js: ${checks} assertions passed — any rejection blocks the whole apply; preview before/after and day lists equal what Apply persists and renders.`);
