#!/usr/bin/env node
/* coach-apply-overhaul P2-9: assisted pull-up e1RM, input-error check,
 * and per-set bodyweight entry (FIX_SPEC.md item 9 + Sean's change 6 +
 * the 2026-10-25 input-error rule and per-set entry request).
 *   1. Effective load: assisted = bw - assist; more assist -> lower e1RM.
 *   2. Legacy bodyweight rows (added weight only, often 0) score as
 *      bw + added — never e1rm(0, reps) = reps.
 *   3. Legacy rows without bw use the NEAREST weigh-in; none at all ->
 *      unresolvable, flagged, excluded. Never a silent 146.
 *   4. Input-error flags: assist > 50% bw, or > 2x the previous unflagged
 *      session's assist; excluded from trends until confirmed; no auto-fix.
 *      Synthetic analogues committed; Sean's two real rows checked locally.
 *   5. Per-set entry: assist / bodyweight / +weight each store effective w,
 *      mode, raw input and bw; the prefill converts the recommended
 *      EFFECTIVE load into the assist value (the bug behind the errors).
 *
 * Run: node scripts/check-assisted-e1rm.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "effectiveLoad", "bodyweightOn", "weeklySeries", "assistedInputErrors", "unresolvableBodyweightRows",
  "dataQualityFlags", "trendPct", "trustedSeries", "isBodyweightLoaded", "defaultBodyweightMode",
  "entryRowFromEffective", "storedSetFromEntry", "EX_BY_ID", "recommend", "buildSegmentRows", "loadSessions",
]);

let failures = 0, checks = 0;
function ok(label, cond, detail) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${detail ? `\n  ${detail}` : ""}`); }
}
const FIX = path.join(__dirname, "fixtures");
const data = JSON.parse(fs.readFileSync(path.join(FIX, "synthetic-backup.json"), "utf8")).data;
const W = [{ date: "2026-08-01", lbs: 160 }, { date: "2026-09-01", lbs: 150 }];

/* 1. More assistance -> lower effective load -> lower e1RM. */
{
  const mk = (id, date, assist) => ({ id, date, exerciseId: "pullup", sets: [{ w: 160 - assist, r: 8, assist, bw: 160 }] });
  const s = [mk(1, "2026-08-03", 60), mk(2, "2026-08-10", 30)];
  const ser = app.weeklySeries(s, "pullup", { weights: W });
  ok("assist 60 -> effective 100; assist 30 -> effective 130", ser[0].topW === 100 && ser[1].topW === 130, JSON.stringify(ser));
  ok("more assistance reads as LOWER e1RM", ser[0].e1 < ser[1].e1);
}

/* 2-3. Legacy bodyweight rows: bw + added, nearest weigh-in, never 146. */
{
  ok("pull-up / chin-up / dips are bodyweight-loaded; bench is not",
    app.isBodyweightLoaded("pullup") && app.isBodyweightLoaded("chinup") && app.isBodyweightLoaded("dips") && !app.isBodyweightLoaded("bench"));
  ok("nearest weigh-in to 2026-08-25 is the Sep 1 one (150)", app.bodyweightOn(W, "2026-08-25") === 150);
  ok("nearest weigh-in to 2026-08-10 is the Aug 1 one (160)", app.bodyweightOn(W, "2026-08-10") === 160);
  ok("no weigh-ins -> null (never 146)", app.bodyweightOn([], "2026-08-10") === null);

  const pureBw = { w: 0, r: 10 };              // old "Bodyweight / +weight" entry, no added load
  const plus = { w: 25, r: 6 };                 // old entry with a 25 lb belt
  ok("legacy pure-bodyweight row = bw (160), not 0", app.effectiveLoad(pureBw, "chinup", "2026-08-10", W).load === 160);
  ok("legacy +25 row = bw + 25 (185)", app.effectiveLoad(plus, "chinup", "2026-08-10", W).load === 185);
  ok("legacy assisted row without bw uses the nearest weigh-in", app.effectiveLoad({ w: 99, r: 8, assist: 40 }, "pullup", "2026-08-28", W).load === 110);
  const ser = app.weeklySeries([{ id: 1, date: "2026-08-10", exerciseId: "chinup", sets: [pureBw] }], "chinup", { weights: W });
  ok("legacy pure-bodyweight e1RM uses 160 lb, not e1rm(0, reps) = reps", ser[0].e1 > 100, JSON.stringify(ser));

  const none = { sessions: [{ id: 9, date: "2026-08-10", exerciseId: "chinup", sets: [pureBw] }], weights: [] };
  ok("no weigh-ins at all: the row is unresolvable, excluded from the series", app.weeklySeries(none.sessions, "chinup", { weights: [] }).length === 0);
  ok("...and flagged (no-bw)", app.unresolvableBodyweightRows(none).length === 1 && app.dataQualityFlags(none).some((f) => f.kind === "no-bw"));
  ok("non-bodyweight lifts are untouched (bench w as logged)", app.effectiveLoad({ w: 135, r: 5 }, "bench", "2026-08-10", []).load === 135);
}

/* 4. Input-error flags — synthetic analogues of Sean's two rows. */
{
  const flags = app.assistedInputErrors(data.sessions, "pullup", data.weights, {});
  const ids = flags.map((f) => f.sessionId).sort();
  ok("both synthetic mistyped sessions flagged (1011, 1014), nothing else", ids.join() === "1011,1014", JSON.stringify(flags));
  const f1 = flags.find((f) => f.sessionId === 1011), f2 = flags.find((f) => f.sessionId === 1014);
  ok("1011: assist 110 > 50% of 160 AND > 2x the previous 30", f1 && f1.reasons.length === 2, JSON.stringify(f1));
  ok("1014: assist 130 > 50% of 158 AND > 2x the previous UNFLAGGED 25", f2 && f2.reasons.length === 2 && /from 25 to 130/.test(f2.reasons[1]), JSON.stringify(f2));
  const trusted = app.weeklySeries(data.sessions, "pullup", { weights: data.weights }).map((p) => p.topW);
  ok("trend excludes the flagged sessions (only 120, 130, 135 remain)", trusted.join() === "120,130,135", trusted.join());
  ok("no auto-fix: the stored rows are unchanged", data.sessions.find((s) => s.id === 1011).sets[0].assist === 110);
  const confirmed = app.weeklySeries(data.sessions, "pullup", { weights: data.weights, confirmations: { "input|1011": { confirmedAt: "x" } } });
  ok("confirming 1011 brings its week back", confirmed.some((p) => p.topW === 50), JSON.stringify(confirmed));
  ok("both listed as input flags for the Progress card", app.dataQualityFlags(data).filter((f) => f.kind === "input").length === 2);
  const t = app.trendPct(app.trustedSeries(data.sessions, "pullup", {}, data.weights).series);
  ok("trusted pull-up trend is positive once the input errors are out", t && t.pct > 0, JSON.stringify(t));
}

/* 4b. Load decisions skip unconfirmed input errors (found in the in-app
       check: recommend() was prefilling from the mistyped last session). */
{
  const ls = app.loadSessions(data);
  ok("loadSessions drops the two flagged sessions only", data.sessions.length - ls.length === 2 && !ls.some((s) => [1011, 1014].includes(s.id)));
  const rec = app.recommend({ ...app.EX_BY_ID.pullup, repMin: 6, repMax: 10 }, ls, false);
  ok("pull-up recommendation is based on the last GOOD session (135 effective), not the mistyped 30", rec.weight >= 135, JSON.stringify(rec));
  const conf = { ...data, dataQualityConfirmations: { "input|1014": { confirmedAt: "x" } } };
  ok("once confirmed, that session counts for load decisions again", app.loadSessions(conf).some((s) => s.id === 1014));
}

/* 5. Per-set entry. */
{
  const bw = 150;
  ok("assist mode: 50 assist -> stored w 100, mode, raw assist, bw",
    JSON.stringify(app.storedSetFromEntry({ mode: "assist", w: "50", r: "8" }, bw)) === JSON.stringify({ w: 100, r: 8, mode: "assist", assist: 50, bw: 150, segment: "top" }));
  ok("bodyweight mode: stored w = bw, input ignored",
    app.storedSetFromEntry({ mode: "bw", w: "", r: "10" }, bw).w === 150);
  ok("added mode: +20 -> stored w 170", app.storedSetFromEntry({ mode: "added", w: "20", r: "5" }, bw).w === 170);
  ok("mixed modes in one session each keep their own mode",
    ["assist", "bw", "added"].map((m) => app.storedSetFromEntry({ mode: m, w: "10", r: "5" }, bw).mode).join() === "assist,bw,added");

  // THE root-cause fix: a recommended EFFECTIVE 106 must prefill as assist 40 (at bw 146), not 106.
  const row = app.entryRowFromEffective({ w: 106, r: "", segment: "top" }, "assist", 146);
  ok("prefill converts recommended effective 106 into assist 40 (the old form put 106 in the assist box)", row.w === "40" && row.mode === "assist", JSON.stringify(row));
  ok("round-trip: saving that prefill unedited logs effective 106, not 40",
    app.storedSetFromEntry({ ...row, r: "10" }, 146).w === 106);
  ok("added-mode prefill: effective 170 at bw 150 -> +20", app.entryRowFromEffective({ w: 170 }, "added", 150).w === "20");
  ok("bodyweight-mode prefill has no input", app.entryRowFromEffective({ w: 150 }, "bw", 150).w === "");

  ok("default mode follows the last logged set (synthetic: assist)", app.defaultBodyweightMode(app.EX_BY_ID.pullup, data.sessions) === "assist");
  ok("first time: assistable -> assist, otherwise bodyweight",
    app.defaultBodyweightMode(app.EX_BY_ID.pullup, []) === "assist" && app.defaultBodyweightMode(app.EX_BY_ID.chinup, []) === "bw");
}

/* Real data, local only: Sean's two rows + the trend re-check. */
{
  const LOCAL = path.join(FIX, "local");
  const f = fs.existsSync(LOCAL) && fs.readdirSync(LOCAL).filter((x) => /^recomp-coach-backup-.*\.json$/.test(x)).sort().pop();
  if (!f) console.log("SKIP (local): no real backup — real-data cases not run.");
  else {
    const real = JSON.parse(fs.readFileSync(path.join(LOCAL, f), "utf8")).data;
    const flags = app.assistedInputErrors(real.sessions, "pullup", real.weights, {});
    const dates = flags.map((x) => x.date).sort();
    ok("local: exactly the 2026-08-21 and 2026-09-11 pull-up rows are flagged", dates.join() === "2026-08-21,2026-09-11", JSON.stringify(flags.map((x) => ({ d: x.date, r: x.reasons }))));
    const rawT = app.trendPct(app.weeklySeries(real.sessions.map((s) => s), "pullup", { weights: real.weights, confirmations: Object.fromEntries(flags.map((x) => [x.id, { confirmedAt: "x" }])) }));
    const fixedT = app.trendPct(app.trustedSeries(real.sessions, "pullup", real.dataQualityConfirmations, real.weights).series);
    const tops = app.trustedSeries(real.sessions, "pullup", real.dataQualityConfirmations, real.weights).series.map((p) => p.topW);
    console.log(`local: pull-up trend with the errors ${rawT ? rawT.pct.toFixed(1) : "n/a"}% -> without ${fixedT ? fixedT.pct.toFixed(1) : "n/a"}%; weekly top effective loads: ${tops.join(", ")}`);
    ok("local: the -25%-style trend is gone once the input errors are excluded (trend >= 0)", fixedT && fixedT.pct >= 0, JSON.stringify(fixedT));
  }
}

if (failures) {
  console.error(`\n${failures} of ${checks} assertions FAILED (check-assisted-e1rm.js)`);
  process.exit(1);
}
console.log(`check-assisted-e1rm.js: ${checks} assertions passed — effective-load e1RM (more assist = lower), legacy bodyweight rows scored from the nearest weigh-in or flagged, assisted input errors flagged and excluded until confirmed, per-set assist/BW/+weight entry with the prefill fix.`);
