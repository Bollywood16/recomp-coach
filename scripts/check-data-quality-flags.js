#!/usr/bin/env node
/* coach-apply-overhaul P2-8: load-sanity and e1RM-drop flags (FIX_SPEC.md
 * item 8 + Sean's change 2). Warnings, never silent fixes.
 *   1. Prescribed load > 2x or < 0.5x the last logged load -> "unverified",
 *      judged on the coach's RAW load before Gate 3's clamp; the note
 *      carries raw and applied values; never a rejection.
 *   2. Weekly e1RM drop > 30% within < 3 weeks -> "possible data error",
 *      excluded from stallScore / isRegressing / coachMetrics trend until
 *      confirmed via data.dataQualityConfirmations; raw series untouched.
 *
 * Run: node scripts/check-data-quality-flags.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "applyCoachGates", "coachMetrics", "buildPlanPreview", "e1rmDataFlags", "trustedSeries", "dataQualityFlags",
  "weeklySeries", "stallScore", "isRegressing", "DEFAULT_INJURY_PROFILE", "buildCoachBrief",
]);

let failures = 0, checks = 0;
function ok(label, cond, detail) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${detail ? `\n  ${detail}` : ""}`); }
}
const FIX = path.join(__dirname, "fixtures");
const data = JSON.parse(fs.readFileSync(path.join(FIX, "synthetic-backup.json"), "utf8")).data;
const rec = JSON.parse(fs.readFileSync(path.join(FIX, "synthetic-rejected-plan.json"), "utf8"));
const gate = (d, r) => app.applyCoachGates(r, app.coachMetrics(d), d.injuryProfile || app.DEFAULT_INJURY_PROFILE, d);

/* 1. Load sanity on the raw load. Fixture: reardelt logged at 10, plan prescribes 40. */
{
  const gated = gate(data, rec);
  const n = (gated.prescriptionNotes || []).find((x) => x.gate === "load-sanity" && x.exerciseId === "reardelt");
  ok("40 lb prescribed vs 10 lb logged (4x) -> unverified note", !!n, JSON.stringify(gated.prescriptionNotes));
  ok("note carries the RAW load (40) and the last logged (10)", n && n.rawLoad === 40 && n.lastLogged === 10);
  ok("note carries the applied (Gate 3-clamped) load, which differs from raw", n && n.appliedLoad != null && n.appliedLoad !== 40, n && JSON.stringify(n));
  ok("note text shows both raw and applied", n && /prescribed 40 lb — 4× your last logged 10 lb/.test(n.note) && /Applied: \d+ lb \(raw 40 lb\)/.test(n.note), n && n.note);
  const rd = gated.prescriptions.find((p) => p.exerciseId === "reardelt");
  ok("prescription accepted (warning, not rejection) and marked loadUnverified", rd && rd.loadUnverified === true);
  const preview = app.buildPlanPreview(data, gated, "2026-10-01");
  ok("preview shows the note and still allows Apply", preview.ok && preview.notes.some((x) => x.gate === "load-sanity"));

  // Within 2x / 0.5x: no flag. bench logged 140, prescribe 150.
  const near = gate(data, { ...rec, prescriptions: [{ exerciseId: "bench", dayKey: "ufUpperA", sets: 3, load: 150 }] });
  ok("150 vs 140 logged: no unverified flag", !(near.prescriptionNotes || []).some((x) => x.gate === "load-sanity"));
  // Below 0.5x: flagged too.
  const low = gate(data, { ...rec, prescriptions: [{ exerciseId: "bench", dayKey: "ufUpperA", sets: 3, load: 60 }] });
  ok("60 vs 140 logged (<0.5x): flagged", (low.prescriptionNotes || []).some((x) => x.gate === "load-sanity" && x.rawLoad === 60));
  // No load: nothing to judge.
  const none = gate(data, { ...rec, prescriptions: [{ exerciseId: "bench", dayKey: "ufUpperA", sets: 3 }] });
  ok("no prescribed load: no flag", !(none.prescriptionNotes || []).some((x) => x.gate === "load-sanity"));
}

/* 2. e1RM drop. Synthetic: an otherwise-steady row with one bogus week. */
{
  const mk = (id, date, w, r) => ({ id, date, exerciseId: "ohp", sets: [{ w, r }] });
  const sessions = [
    mk(1, "2026-08-03", 95, 8), mk(2, "2026-08-10", 95, 8), mk(3, "2026-08-17", 100, 8),
    mk(4, "2026-08-24", 45, 8),  // -55% in one week: almost certainly a logging slip
    mk(5, "2026-08-31", 100, 8),
  ];
  const d = { ...data, sessions: [...data.sessions.filter((s) => s.exerciseId !== "ohp"), ...sessions] };
  const raw = app.weeklySeries(d.sessions, "ohp");
  const flags = app.e1rmDataFlags(raw, "ohp", {});
  ok("exactly the bogus week is flagged", flags.length === 1 && flags[0].week === raw[3].week, JSON.stringify(flags));
  ok("flag reports the drop vs the best of the prior <3 weeks", flags[0] && flags[0].dropPct === 55 && flags[0].refWeek === raw[2].week, JSON.stringify(flags[0]));
  const trusted = app.trustedSeries(d.sessions, "ohp", {}).series;
  ok("trusted series drops the flagged week; raw series untouched", trusted.length === raw.length - 1 && raw.length === 5);
  ok("unconfirmed flag listed by dataQualityFlags", app.dataQualityFlags(d).some((f) => f.exId === "ohp" && !f.confirmed));
  ok("coachMetrics exposes the flag to the brief", app.coachMetrics(d).dataFlags.some((s) => /^ohp wk .*possible data error/.test(s)));
  ok("...and the brief carries it", app.buildCoachBrief(d, { text: "x" }, "checkin").includes("possible data error, excluded until confirmed"));

  // Stall: with the bogus week, raw "last 3" = 100, 45, 100 -> 100 <= 100*1.005 => stalled.
  // Trusted "last 3" = 95, 100, 100 -> +5% => not stalled.
  const stalledIds = (dd) => { const s = app.stallScore(dd); return s.stalled; };
  const only = (dd) => ({ ...dd, sessions: dd.sessions.filter((s) => s.exerciseId === "ohp") });
  ok("bogus week excluded from the stall count", stalledIds(only(d)) === 0, JSON.stringify(app.stallScore(only(d))));
  const id = flags[0].id;
  const confirmed = { ...only(d), dataQualityConfirmations: { [id]: { confirmedAt: "2026-09-01T00:00:00Z" } } };
  ok("once confirmed, the week counts again (stall = 1)", app.stallScore(confirmed).stalled === 1, JSON.stringify(app.stallScore(confirmed)));
  ok("once confirmed, no longer listed", !app.dataQualityFlags(confirmed).length);

  // Regressing must not be triggered by a bogus low week either.
  const reg = [mk(11, "2026-08-03", 100, 8), mk(12, "2026-08-10", 100, 8), mk(13, "2026-08-17", 100, 8), mk(14, "2026-08-24", 40, 8)];
  const dr = { ...data, sessions: reg };
  ok("a single bogus low week doesn't make the lift 'regressing'", !app.isRegressing(dr.sessions, "ohp", {}));
  ok("...but confirmed, the same week does count", app.isRegressing(dr.sessions, "ohp", { [app.e1rmDataFlags(app.weeklySeries(reg, "ohp"), "ohp", {})[0].id]: { confirmedAt: "x" } }));
}

/* 3. Real data, local only: the assisted pull-up input errors are caught. */
{
  const LOCAL = path.join(FIX, "local");
  const f = fs.existsSync(LOCAL) && fs.readdirSync(LOCAL).filter((x) => /^recomp-coach-backup-.*\.json$/.test(x)).sort().pop();
  if (!f) console.log("SKIP (local): no real backup — real-data case not run.");
  else {
    const real = JSON.parse(fs.readFileSync(path.join(LOCAL, f), "utf8")).data;
    const pf = app.dataQualityFlags(real).filter((x) => x.exId === "pullup");
    console.log("local: pull-up data flags:", pf.map((x) => `${x.week} -${x.dropPct}%`).join(", ") || "(none)");
    ok("local: both mistyped assisted pull-up weeks are flagged", pf.length === 2, JSON.stringify(pf));
  }
}

if (failures) {
  console.error(`\n${failures} of ${checks} assertions FAILED (check-data-quality-flags.js)`);
  process.exit(1);
}
console.log(`check-data-quality-flags.js: ${checks} assertions passed — raw-load 2x/0.5x unverified notes (raw + applied shown, never a reject), >30%-in-<3-weeks e1RM drops flagged and excluded from stall/regressing/brief trends until confirmed.`);
