#!/usr/bin/env node
/* coach-apply-overhaul, commit 1: replay fixture for the rejected coach
 * apply (FIX_SPEC.md "Background"). Two parts:
 *
 *   A. SYNTHETIC (always runs, committed). scripts/fixtures/synthetic-*.json
 *      reproduce the failure's conditions with invented numbers: upperFocus,
 *      arms=specialize, shoulders=emphasize, stored caps arms 28 /
 *      shoulders 20, and a plan whose own arm prescriptions total 26 and
 *      shoulder prescriptions 16.
 *      Commit 1 characterized the bug on main (Gate 6 rejected all 7 arm
 *      prescriptions against an inflated baseline of 32; partial apply).
 *      As of P0-1 it asserts the fix: Gate 6 nets against the projected
 *      week (arms 26, shoulders 16, zero rejections), plus the netting
 *      cases from FIX_SPEC.md item 1.
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
  "resolveDayExercises",
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
  console.log("synthetic projected weekly sets (after apply):", JSON.stringify(gated.weeklyGroupSetsAfter));
  rejections.forEach((r) => console.log(`  - [gate ${r.gate}] ${r.exerciseId}: ${r.reason}`));

  // The baseline really is inflated (that's what fooled the old Gate 6)...
  ok("baseline arms (with focus uplift + bonus lifts) exceed the plan's own 26",
    (before.arms || 0) > 26, `baseline arms ${before.arms}`);
  // ...and P0-1 nets against the projected week instead.
  ok("P0-1: no Gate 6 rejections on the replayed plan", gate6.length === 0,
    gate6.map((r) => r.reason).join(" | "));
  ok("P0-1: no arm prescription rejected", !rejections.some((r) => armIds.has(r.exerciseId)));
  ok("P0-1: projected arms = 26", gated.weeklyGroupSetsAfter.arms === 26, `got ${gated.weeklyGroupSetsAfter.arms}`);
  ok("P0-1: projected shoulders = 16", gated.weeklyGroupSetsAfter.shoulders === 16, `got ${gated.weeklyGroupSetsAfter.shoulders}`);
  ok("P0-1: before/after reported for the preview",
    gated.weeklyGroupSetsBefore && gated.weeklyGroupSetsBefore.arms === before.arms);
  ok("Gate 7 per day: all 18 prescriptions survive (no cross-day single-session trim)",
    (gated.prescriptions || []).length === rec.prescriptions.length, `got ${(gated.prescriptions || []).length}`);
  ok("baseline over cap is warned, not used to raise the cap",
    (gated.prescriptionNotes || []).some((n) => n.gate === "6-baseline" && n.group === "arms"));
  // P0-2 (atomic) will add: any rejection -> nothing applied.

  // Netting cases, on top of the plan now being stored.
  const stored = { ...data, focus: gated.focus,
    plan: { ...data.plan, prescriptions: gated.prescriptions, sessionRules: gated.sessionRules } };
  const storedWeek = app.weeklySetsByGroup(stored);
  ok("stored plan renders the same week Gate 6 projected",
    JSON.stringify(storedWeek) === JSON.stringify(gated.weeklyGroupSetsAfter),
    `${JSON.stringify(storedWeek)} vs ${JSON.stringify(gated.weeklyGroupSetsAfter)}`);

  const again = runApply(stored, rec);
  ok("re-applying an identical plan: no rejections", !(again.prescriptionRejections || []).length);
  ok("re-applying an identical plan nets to 0 (after === before)",
    JSON.stringify(again.weeklyGroupSetsAfter) === JSON.stringify(again.weeklyGroupSetsBefore),
    `${JSON.stringify(again.weeklyGroupSetsBefore)} -> ${JSON.stringify(again.weeklyGroupSetsAfter)}`);

  const fewer = { ...rec, prescriptions: rec.prescriptions.map((p) =>
    (p.exerciseId === "pressdn" && p.dayKey === "ufUpperA" ? { ...p, sets: 2 } : p)) };
  const fewerRes = runApply(stored, fewer);
  ok("replacement with fewer sets lowers the projected total by exactly that much",
    fewerRes.weeklyGroupSetsAfter.arms === storedWeek.arms - 2,
    `${storedWeek.arms} -> ${fewerRes.weeklyGroupSetsAfter.arms}`);

  // Over-cap group: every prescription in it rejected with a reason; other groups unaffected.
  const tight = { ...rec, sessionRules: { ...rec.sessionRules, weeklyGroupSetCaps: { arms: 20, shoulders: 20 } } };
  const tightRes = runApply(data, tight);
  const tightRej = tightRes.prescriptionRejections || [];
  ok("cap below plan: every arm prescription rejected by Gate 6",
    [...armIds].every((id) => tightRej.some((r) => r.gate === 6 && r.exerciseId === id)));
  ok("cap below plan: reason names projected total and cap",
    tightRej.some((r) => /would put Arms at \d+ weekly sets.*above the 20-set cap/.test(r.reason)));
  ok("cap below plan: shoulder prescriptions still accepted",
    (tightRes.prescriptions || []).some((p) => p.exerciseId === "machohp"));

  // No explicit cap: falls back to MAV (arms 24), not max(mav, baseline).
  const noCaps = { ...rec, sessionRules: { maxSetsPerMovement: 4 } };
  const noCapsData = { ...data, plan: { ...data.plan, sessionRules: { maxSetsPerMovement: 4 } } };
  const noCapsRes = runApply(noCapsData, noCaps);
  ok("no explicit cap: arms 26 > MAV 24 is rejected (cap not raised to baseline 32)",
    (noCapsRes.prescriptionRejections || []).some((r) => r.gate === 6 && /24-set cap/.test(r.reason)));

  // Render side: a prescribed (day, group) gets no bonus and no focus uplift.
  const partial = { ...data, plan: { ...data.plan,
    prescriptions: [{ exerciseId: "ezcurl", dayKey: "ufArms", sets: 4, repMin: 10, repMax: 15 }] } };
  const armsDay = app.PROGRAMS.upperFocus.find((d) => d.id === "ufArms");
  const rendered = app.resolveDayExercises(armsDay, partial).map((e) => e.ex);
  const byId = Object.fromEntries(rendered.map((e) => [e.id, e]));
  ok("prescribed group's other rows drop to template sets (skull 3, ohte 2)",
    byId.skull && byId.skull.sets === 3 && byId.ohte && byId.ohte.sets === 2,
    rendered.map((e) => `${e.id}:${e.sets}`).join(" "));
  ok("prescribed group gets no bonus lifts on that day",
    !rendered.some((e) => e.isBonus && e.bonusGroup === "arms"));
  ok("unprescribed group on the same day keeps its focus uplift (cablelat 3 -> 4 at emphasize)",
    byId.cablelat && byId.cablelat.sets === 4, `cablelat ${byId.cablelat && byId.cablelat.sets}`);

  // Maintain's 0.55x reduction is NOT an uplift — it survives a prescription
  // on the same (day, group), so prescribing one leg row never raises legs.
  const lowerDay = app.PROGRAMS.upperFocus.find((d) => d.id === "ufLower");
  const legsRx = { ...data, plan: { ...data.plan,
    prescriptions: [{ exerciseId: "goblet", dayKey: "ufLower", sets: 2 }] } };
  const legsBefore = app.resolveDayExercises(lowerDay, data).map((e) => e.ex);
  const legsAfter = app.resolveDayExercises(lowerDay, legsRx).map((e) => e.ex);
  const setsOf = (list, id) => (list.find((e) => e.id === id) || {}).sets;
  ok("maintain reduction kept on a prescribed group (legcurl stays at its maintain count)",
    setsOf(legsAfter, "legcurl") === setsOf(legsBefore, "legcurl") && setsOf(legsAfter, "legcurl") < 3,
    `legcurl ${setsOf(legsBefore, "legcurl")} -> ${setsOf(legsAfter, "legcurl")}`);
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

    const replyFile = ["rejected-coach-reply.md", "rejected-reply.json", "rejected-reply.txt", "rejected-reply.md"]
      .map((f) => path.join(LOCAL, f)).find((p) => fs.existsSync(p));
    if (!replyFile) {
      console.log("SKIP (local): no scripts/fixtures/local/rejected-coach-reply.md (or rejected-reply.*) — rejected-plan replay not run.");
    } else {
      const text = fs.readFileSync(replyFile, "utf8");
      const rec = app.extractPlanJson(text);
      rec.prescriptions = (rec.prescriptions || []).filter((p) => p.exerciseId !== "goblet");
      const gated = runApply(data, rec);
      console.log("local replay planned totals:", JSON.stringify(groupTotals(rec.prescriptions)));
      console.log(`local replay: ${(gated.prescriptions || []).length} accepted, ${(gated.prescriptionRejections || []).length} rejected`);
      console.log("local replay weekly sets before -> after:",
        JSON.stringify(gated.weeklyGroupSetsBefore), "->", JSON.stringify(gated.weeklyGroupSetsAfter));
      (gated.prescriptionRejections || []).forEach((r) => console.log(`  - [gate ${r.gate}] ${r.exerciseId}: ${r.reason}`));
      // FIX_SPEC Testing: "Replay the rejected plan (goblet removed): it
      // must pass Gate 6 with arms ≈ 26 and shoulders ≈ 16 weekly sets."
      const after = gated.weeklyGroupSetsAfter || {};
      ok("local replay: every prescription accepted (no Gate 6 or other prescription rejection)",
        !(gated.prescriptionRejections || []).length && (gated.prescriptions || []).length === rec.prescriptions.length,
        JSON.stringify(gated.prescriptionRejections));
      ok("local replay: arms ≈ 26 weekly sets", Math.abs((after.arms || 0) - 26) <= 1, `arms ${after.arms}`);
      ok("local replay: shoulders ≈ 16 weekly sets", Math.abs((after.shoulders || 0) - 16) <= 1, `shoulders ${after.shoulders}`);
    }
  }
}

if (failures) {
  console.error(`\n${failures} of ${checks} assertions FAILED (check-coach-apply-replay.js)`);
  process.exit(1);
}
console.log(`check-coach-apply-replay.js: ${checks} assertions passed`);
