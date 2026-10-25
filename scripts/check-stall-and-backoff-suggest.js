#!/usr/bin/env node
/* coach-apply-overhaul P2-11 + back-off suggestions while logging.
 *   P2-11 (FIX_SPEC item 11): stallScore excludes lifts with < 3 logged
 *   weeks, maintain-group lifts and rehab lifts, reports what it excluded
 *   and why, and the denominator is shown (PhaseCard line, deload text,
 *   brief's stallCheck).
 *   Back-off suggestions (Sean, 2026-10-25): one-tap, never automatic.
 *     - plan: recommend()'s backoffTop -> backoff pre-fills set 1 top,
 *       the rest tagged back-off.
 *     - live: an untagged set under repMin with sets still to log offers
 *       stepDown() on the remaining sets, tagged back-off; bodyweight lifts
 *       get the back-off written as more assistance.
 *
 * Run: node scripts/check-stall-and-backoff-suggest.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "stallScore", "stallSummary", "phaseInfo", "coachMetrics", "recommend", "EX_BY_ID", "stepDown",
  "liveBackoffSuggestion", "applyLiveBackoff", "backoffPlanRows", "storedSetFromEntry", "untaggedLoadDrops",
]);

let failures = 0, checks = 0;
function ok(label, cond, detail) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${detail ? `\n  ${detail}` : ""}`); }
}

/* ---- P2-11 ---- */
{
  // Four compound lifts, 3+ flat weeks each: bench (chest normal), rdl (rehab),
  // legpress (legs maintain), ohp (shoulders normal, only 2 weeks).
  const wk = ["2026-08-03", "2026-08-10", "2026-08-17"];
  const flat = (id, w, dates) => dates.map((d, i) => ({ id: `${id}${i}`.length + i + Math.random(), date: d, exerciseId: id, sets: [{ w, r: 8 }] }));
  const sessions = [...flat("bench", 135, wk), ...flat("rdl", 135, wk), ...flat("legpress", 200, wk), ...flat("ohp", 75, wk.slice(0, 2))];
  const data = { sessions, weights: [], focus: { chest: "normal", back: "normal", shoulders: "normal", arms: "normal", legs: "maintain", core: "normal" }, plan: { template: "balanced" } };
  const st = app.stallScore(data);
  ok("only bench counts (1 of 1 stalled)", st.eligible === 1 && st.stalled === 1, JSON.stringify(st));
  const reasons = Object.fromEntries(st.excluded.map((e) => [e.id, e.reason]));
  ok("rdl excluded as rehab", reasons.rdl === "rehab");
  ok("legpress excluded as maintain", reasons.legpress === "maintain");
  ok("ohp excluded as too new (< 3 weeks)", reasons.ohp === "too new");
  const sum = app.stallSummary(st);
  ok("summary states the denominator and every exclusion reason",
    sum.startsWith("1 of 1 progressing lift stalled (3 not counted: ") && ["1 rehab", "1 maintain", "1 too new"].every((p) => sum.includes(p)), sum);
  const d2 = { ...data, focus: { ...data.focus, legs: "normal" } };
  ok("legs back to normal -> legpress counts again", app.stallScore(d2).eligible === 2);
  ok("brief carries the stall check", typeof app.coachMetrics(data).stallCheck === "string" && /progressing lift/.test(app.coachMetrics(data).stallCheck));
}

/* Real data, local only: before/after numbers. */
{
  const LOCAL = path.join(__dirname, "fixtures", "local");
  const f = fs.existsSync(LOCAL) && fs.readdirSync(LOCAL).filter((x) => /^recomp-coach-backup-.*\.json$/.test(x)).sort().pop();
  if (!f) console.log("SKIP (local): no real backup.");
  else {
    const real = JSON.parse(fs.readFileSync(path.join(LOCAL, f), "utf8")).data;
    const st = app.stallScore(real);
    console.log(`local: ${app.stallSummary(st)} -> ratio ${st.ratio.toFixed(2)}; stalled: ${st.stalledIds.join(", ")}`);
    ok("local: denominator excludes maintain-group and rehab lifts", st.excluded.every((e) => ["maintain", "rehab", "too new"].includes(e.reason)));
  }
}

/* ---- Back-off: plan ---- */
{
  const ex = { ...app.EX_BY_ID.dbohp, repMin: 8, repMax: 12 };
  const sessions = [{ id: 1, date: "2026-09-01", exerciseId: "dbohp", sets: [{ w: 35, r: 9 }, { w: 35, r: 8 }, { w: 35, r: 6 }] }];
  const rec = app.recommend(ex, sessions, false);
  ok("recommend proposes back-off with a top load", rec.tag === "Back-off sets" && rec.backoffTop === 35 && rec.backoff === 30, JSON.stringify(rec));
  const rows = [{ w: "35", r: "" }, { w: "35", r: "" }, { w: "35", r: "" }];
  const plan = app.backoffPlanRows(rows, rec, null);
  ok("plan: set 1 top @35, sets 2-3 back-off @30",
    plan.map((r) => `${r.w}:${r.segment}`).join() === "35:top,30:backoff,30:backoff", JSON.stringify(plan));
  ok("Reduce case also exposes the keep-the-top alternative",
    app.recommend(ex, [{ id: 2, date: "2026-09-01", exerciseId: "dbohp", sets: [{ w: 35, r: 9 }, { w: 35, r: 5 }, { w: 35, r: 4 }] }], false).backoffTop === 35);
}

/* ---- Back-off: live ---- */
{
  const ex = { ...app.EX_BY_ID.dbohp, repMin: 8, repMax: 12 };
  const rows = [{ w: "35", r: "9" }, { w: "35", r: "6" }, { w: "35", r: "" }, { w: "35", r: "" }];
  const s = app.liveBackoffSuggestion(rows, ex, null);
  ok("set 2 at 6 reps (< 8) with sets left -> suggestion for sets 3-4 at stepDown(35)", s && s.afterSet === 1 && s.remaining.join() === "2,3" && s.load === app.stepDown(35, 5) && s.load === 30, JSON.stringify(s));
  const applied = app.applyLiveBackoff(rows, s, null);
  ok("applied: sets 3-4 -> 30 lb, tagged back-off; sets 1-2 untouched",
    applied.map((r) => `${r.w}:${r.segment || "-"}`).join() === "35:-,35:-,30:backoff,30:backoff", JSON.stringify(applied));
  ok("after applying, no further suggestion", app.liveBackoffSuggestion(applied, ex, null) === null);
  ok("tagged back-offs aren't then flagged as untagged drops at save", app.untaggedLoadDrops(applied.map((r) => ({ ...r, r: 8 }))).length === 0);
  ok("no suggestion when all sets are already logged", app.liveBackoffSuggestion([{ w: "35", r: "9" }, { w: "35", r: "6" }], ex, null) === null);
  ok("no suggestion while reps stay in range", app.liveBackoffSuggestion([{ w: "35", r: "9" }, { w: "35", r: "8" }, { w: "35", r: "" }], ex, null) === null);
}

/* ---- Back-off: bodyweight lift (assist) ---- */
{
  const ex = { ...app.EX_BY_ID.pullup, repMin: 6, repMax: 10 };
  const bw = 150;
  const rows = [{ mode: "assist", w: "30", r: "5" }, { mode: "assist", w: "30", r: "" }];
  const s = app.liveBackoffSuggestion(rows, ex, bw);
  ok("pull-up: effective 120 at 5 reps -> back off to stepDown(120) effective", s && s.fromLoad === 120 && s.load === app.stepDown(120, 5), JSON.stringify(s));
  const applied = app.applyLiveBackoff(rows, s, bw);
  ok("written back as MORE assistance (assist 150 - 110 = 40), tagged back-off",
    applied[1].mode === "assist" && applied[1].w === "40" && applied[1].segment === "backoff", JSON.stringify(applied[1]));
  ok("and stores effective 110", app.storedSetFromEntry({ ...applied[1], r: "6" }, bw).w === 110);
}

/* UI wiring. */
{
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  ok("workout card renders the live suggestion", /<BackoffSuggestion rows=\{sets\} ex=\{ex\}/.test(html));
  ok("Log form renders the live suggestion", /<BackoffSuggestion rows=\{sets\} ex=\{selectedEx\}/.test(html));
  ok("workout card offers 'Use back-off plan'", /Use back-off plan/.test(html));
  ok("PhaseCard shows the stall denominator line", /info\.stallLine &&/.test(html));
}

if (failures) {
  console.error(`\n${failures} of ${checks} assertions FAILED (check-stall-and-backoff-suggest.js)`);
  process.exit(1);
}
console.log(`check-stall-and-backoff-suggest.js: ${checks} assertions passed — stall denominator excludes too-new/maintain/rehab lifts and is shown; back-off plan + live back-off suggestions (incl. bodyweight lifts) are one-tap and tagged.`);
