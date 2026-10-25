#!/usr/bin/env node
/* coach-apply-overhaul, commit 1: replay fixture for the rejected coach
 * apply (FIX_SPEC.md "Background"). Two parts:
 *
 *   A. SYNTHETIC (always runs, committed). scripts/fixtures/synthetic-*.json
 *      reproduce the failure's conditions with invented numbers: upperFocus,
 *      arms=specialize, shoulders=emphasize, stored caps arms 28 /
 *      shoulders 20, and a plan whose own arm prescriptions total 26 and
 *      shoulder prescriptions 16.
 *      This commit is a CHARACTERIZATION test: it asserts the bug as it
 *      exists on main today (Gate 6 rejects arm work the plan's own totals
 *      fit under the cap; the apply is partial). P0-1/P0-2 flip these
 *      assertions to the spec's expected behavior — see the "FLIPS IN"
 *      labels below.
 *
 *   B. LOCAL REAL DATA (skips with a notice when absent — never committed).
 *      scripts/fixtures/local/ is gitignored. Reads the newest
 *      recomp-coach-backup-*.json there and, if present, the rejected
 *      Claude reply (rejected-reply.txt|.md|.json). Prints per-group weekly
 *      sets and Gate 6 rejections; asserts nothing about the outcome yet
 *      (real data is the user's, not a contract) beyond that it loads.
 *
 * Run: node scripts/check-coach-apply-replay.js (wired into `npm test`).
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "applyCoachGates", "coachMetrics", "weeklySetsByGroup", "extractPlanJson",
  "EX_BY_ID", "CAT_TO_GROUP", "PROGRAMS", "DEFAULT_INJURY_PROFILE",
]);

const FIXTURES = path.join(__dirname, "fixtures");
const LOCAL = path.join(FIXTURES, "local");

let failures = 0, checks = 0;
function ok(label, cond, detail) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${detail ? `\n  ${detail}` : ""}`); }
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
// Backups wrap the app state as { app, version, exportedAt, data }.
const unwrap = (backup) => (backup && backup.data) || backup;

function groupTotals(prescriptions) {
  const t = {};
  prescriptions.forEach((p) => {
    const ex = app.EX_BY_ID[p.exerciseId];
    const g = ex && app.CAT_TO_GROUP[ex.cat];
    if (g) t[g] = (t[g] || 0) + (p.sets || 0);
  });
  return t;
}

function runApply(data, rec) {
  const injuryProfile = data.injuryProfile || app.DEFAULT_INJURY_PROFILE;
  return app.applyCoachGates(rec, app.coachMetrics(data), injuryProfile, data);
}

/* ---------------- A. synthetic ---------------- */
{
  const data = unwrap(readJson(path.join(FIXTURES, "synthetic-backup.json")));
  const rec = readJson(path.join(FIXTURES, "synthetic-rejected-plan.json"));

  // Fixture integrity — the numbers the spec's replay expectation is built on.
  const planned = groupTotals(rec.prescriptions);
  ok("fixture: plan's own arm prescriptions total 26", planned.arms === 26, `got ${planned.arms}`);
  ok("fixture: plan's own shoulder prescriptions total 16", planned.shoulders === 16, `got ${planned.shoulders}`);
  ok("fixture: plan has no goblet prescription (removed per spec)",
    !rec.prescriptions.some((p) => p.exerciseId === "goblet"));
  ok("fixture: every exerciseId is known to the app",
    rec.prescriptions.every((p) => app.EX_BY_ID[p.exerciseId]),
    rec.prescriptions.filter((p) => !app.EX_BY_ID[p.exerciseId]).map((p) => p.exerciseId).join(", "));
  const dayIds = new Set(app.PROGRAMS.upperFocus.map((d) => d.id));
  ok("fixture: every dayKey is an upperFocus day", rec.prescriptions.every((p) => dayIds.has(p.dayKey)));

  const before = app.weeklySetsByGroup(data);
  const gated = runApply(data, rec);
  const rejections = gated.prescriptionRejections || [];
  const gate6 = rejections.filter((r) => r.gate === 6);
  const armIds = new Set(rec.prescriptions
    .filter((p) => app.CAT_TO_GROUP[app.EX_BY_ID[p.exerciseId].cat] === "arms").map((p) => p.exerciseId));

  console.log("synthetic baseline weekly sets (before apply):", JSON.stringify(before));
  console.log(`synthetic apply: ${(gated.prescriptions || []).length} accepted, ${rejections.length} rejected`);
  rejections.forEach((r) => console.log(`  - [gate ${r.gate}] ${r.exerciseId}: ${r.reason}`));

  // CHARACTERIZATION of the bug on main. FLIPS IN P0-1: expected afterwards
  // is zero Gate 6 rejections, with arms ~26 and shoulders ~16 projected.
  ok("BUG REPRO (flips in P0-1): baseline arms already exceed the plan's own 26",
    (before.arms || 0) > 26, `baseline arms ${before.arms}`);
  ok("BUG REPRO (flips in P0-1): Gate 6 rejects at least one arm prescription",
    gate6.some((r) => armIds.has(r.exerciseId)));
  // FLIPS IN P0-2: expected afterwards is all-or-nothing — never a mix.
  ok("BUG REPRO (flips in P0-2): apply is partial (some accepted AND some rejected)",
    (gated.prescriptions || []).length > 0 && rejections.length > 0);
}

/* ---------------- B. local real data ---------------- */
{
  const backups = fs.existsSync(LOCAL)
    ? fs.readdirSync(LOCAL).filter((f) => /^recomp-coach-backup-.*\.json$/.test(f)).sort()
    : [];
  if (!backups.length) {
    console.log("SKIP (local): no scripts/fixtures/local/recomp-coach-backup-*.json — real-data replay not run.");
  } else {
    const file = backups[backups.length - 1];
    const data = unwrap(readJson(path.join(LOCAL, file)));
    ok("local: backup loads with sessions[]", Array.isArray(data.sessions));
    console.log(`local backup ${file}: ${data.sessions.length} session rows, template ${(data.plan || {}).template}`);
    console.log("local current weekly sets:", JSON.stringify(app.weeklySetsByGroup(data)));

    const replyFile = ["rejected-reply.json", "rejected-reply.txt", "rejected-reply.md"]
      .map((f) => path.join(LOCAL, f)).find((p) => fs.existsSync(p));
    if (!replyFile) {
      console.log("SKIP (local): no scripts/fixtures/local/rejected-reply.{json,txt,md} — rejected-plan replay not run.");
    } else {
      const text = fs.readFileSync(replyFile, "utf8");
      const rec = app.extractPlanJson(text);
      rec.prescriptions = (rec.prescriptions || []).filter((p) => p.exerciseId !== "goblet");
      const gated = runApply(data, rec);
      console.log("local replay planned totals:", JSON.stringify(groupTotals(rec.prescriptions)));
      console.log(`local replay: ${(gated.prescriptions || []).length} accepted, ${(gated.prescriptionRejections || []).length} rejected`);
      (gated.prescriptionRejections || []).forEach((r) => console.log(`  - [gate ${r.gate}] ${r.exerciseId}: ${r.reason}`));
    }
  }
}

if (failures) {
  console.error(`\n${failures} of ${checks} assertions FAILED (check-coach-apply-replay.js)`);
  process.exit(1);
}
console.log(`check-coach-apply-replay.js: ${checks} assertions passed`);
