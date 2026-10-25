#!/usr/bin/env node
/* coach-apply-overhaul P1-5: deterministic exercise order engine
 * (FIX_SPEC.md item 5, a-g). Uses the synthetic fixture (arms specialize,
 * shoulders emphasize, chest/back normal, legs maintain; machrow regresses
 * -12.5% over 3 weeks, bench doesn't).
 *
 * Run: node scripts/check-order-engine.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "orderDay", "resolveDayExercises", "isRegressing", "getProgram", "applyCoachGates", "coachMetrics",
  "buildPlanPreview", "DEFAULT_INJURY_PROFILE", "REHAB_EXERCISE_IDS", "KNOWN_PLAN_KEYS",
]);

let failures = 0, checks = 0;
function ok(label, cond, detail) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${detail ? `\n  ${detail}` : ""}`); }
}
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "synthetic-backup.json"), "utf8")).data;
const dayOf = (d, id) => app.getProgram(d).find((x) => x.id === id);
const ids = (list) => list.map((e) => e.ex.id);
const pos = (list, id) => ids(list).indexOf(id);
const gate = (d, rec) => app.applyCoachGates(rec, app.coachMetrics(d), d.injuryProfile || app.DEFAULT_INJURY_PROFILE, d);
// Shoulder cap raised to 30 here: the fixture's shoulder baseline (21)
// already exceeds its stored 20 cap, and Gate 6 would reject any shoulder
// prescription before the order check ever saw it. These tests isolate (g).
const BASE_REC = { template: "upperFocus", focus: data.focus, sessionMin: 60, calorieDelta: 0,
  sessionRules: { ...data.plan.sessionRules, weeklyGroupSetCaps: { arms: 28, shoulders: 30 } } };

/* (d) regressing detection */
ok("machrow is regressing (-12.5% over 3 weeks)", app.isRegressing(data.sessions, "machrow"));
ok("bench is not regressing", !app.isRegressing(data.sessions, "bench"));

/* Spec test: arms day -> EZ curl / skullcrusher before machine shoulder press (a). */
{
  const list = app.resolveDayExercises(dayOf(data, "ufArms"), data);
  ok("Delts & Arms: EZ-bar curl before machine shoulder press", pos(list, "ezcurl") < pos(list, "machohp"), ids(list).join(" "));
  ok("Delts & Arms: skullcrusher before machine shoulder press", pos(list, "skull") < pos(list, "machohp"), ids(list).join(" "));
  ok("Delts & Arms: the whole arms block precedes every shoulder row",
    Math.max(...list.filter((e) => /^(biceps|triceps)$/.test(e.ex.cat)).map((e) => list.indexOf(e))) <
    Math.min(...list.filter((e) => /^(vpress|delts)$/.test(e.ex.cat)).map((e) => list.indexOf(e))), ids(list).join(" "));
}

/* Spec test (as corrected by Sean: chest & back both normal -> the
   regressing machrow goes before bench). Shoulders are at emphasize in
   this fixture, so (c) puts the shoulder press ahead of both. */
{
  const list = app.resolveDayExercises(dayOf(data, "ufUpperA"), data);
  ok("Upper A: arms (specialize, >=40% of sets) form the opening block",
    ids(list).slice(0, 3).every((id) => ["curl", "pressdn", "bonus_ohtri"].includes(id)), ids(list).join(" "));
  ok("Upper A: regressing machine row before bench (both normal)", pos(list, "machrow") < pos(list, "bench"), ids(list).join(" "));
  ok("Upper A: shoulder press (emphasize) before both normal compounds",
    pos(list, "dbohp") < pos(list, "machrow") && pos(list, "dbohp") < pos(list, "bench"), ids(list).join(" "));
  ok("Upper A: compounds before the non-block isolation (bonus side lateral last)",
    pos(list, "bonus_sidelat") === list.length - 1, ids(list).join(" "));
}

/* Without the override (Upper B: arms < 40%): compounds first, then isolation by focus. */
{
  const list = app.resolveDayExercises(dayOf(data, "ufUpperB"), data);
  const firstIso = list.findIndex((e) => !["vpress", "hpress", "hpull", "vpull", "squat", "hinge"].includes(e.ex.cat));
  ok("Upper B: every compound precedes every isolation",
    list.slice(firstIso).every((e) => !["vpress", "hpress", "hpull", "vpull"].includes(e.ex.cat)), ids(list).join(" "));
  ok("Upper B: arms isolation (specialize) before shoulder isolation (emphasize)",
    pos(list, "hammer") < pos(list, "latraise"), ids(list).join(" "));
  ok("Upper B: regressing pull-up first among the normal back/chest compounds",
    pos(list, "pullup") < pos(list, "cablerow") && pos(list, "pullup") < pos(list, "incdb"), ids(list).join(" "));
}

/* (e) Determinism: no tie depends on insertion order. */
{
  const day = dayOf(data, "ufUpperB");
  const entries = app.resolveDayExercises(day, data).map((e) => ({ slot: e.slot, ex: e.ex }));
  const a = ids(app.orderDay(entries, { focus: data.focus, sessions: data.sessions }).list);
  const b = ids(app.orderDay([...entries].reverse(), { focus: data.focus, sessions: data.sessions }).list);
  const shuffled = [...entries].sort((x, y) => x.ex.name.localeCompare(y.ex.name));
  const c = ids(app.orderDay(shuffled, { focus: data.focus, sessions: data.sessions }).list);
  ok("same order from forward, reversed and name-sorted input", a.join() === b.join() && a.join() === c.join(), `${a} | ${b} | ${c}`);
}

/* (f) Rehab lifts keep their template position; focus can't move them. */
{
  const lower = dayOf(data, "ufLower");
  const tmplIdx = (id) => lower.exercises.findIndex((s) => s.id === id);
  for (const focusLegs of ["maintain", "specialize"]) {
    const d = { ...data, focus: { ...data.focus, legs: focusLegs } };
    const list = app.resolveDayExercises(lower, d);
    ok(`Lower (legs ${focusLegs}): leg curl stays at template position ${tmplIdx("legcurl")}`, pos(list, "legcurl") === tmplIdx("legcurl"), ids(list).join(" "));
    ok(`Lower (legs ${focusLegs}): hip thrust stays at template position ${tmplIdx("hipthrust")}`, pos(list, "hipthrust") === tmplIdx("hipthrust"), ids(list).join(" "));
  }
  ok("rehab set is exactly hipthrust, rdl, legcurl", [...app.REHAB_EXERCISE_IDS].sort().join() === "hipthrust,legcurl,rdl");
  ok("no plan key can carry rehab tags", !app.KNOWN_PLAN_KEYS.some((k) => /rehab/i.test(k)));
}

/* (g) Coach order honored when it respects the hard rules. */
{
  const rec = { ...BASE_REC, prescriptions: [
    { exerciseId: "bench", dayKey: "ufUpperA", sets: 3, order: 1 },
    { exerciseId: "machrow", dayKey: "ufUpperA", sets: 3, order: 2 },
    { exerciseId: "dbohp", dayKey: "ufUpperA", sets: 3, order: 3 },
    { exerciseId: "latpd", dayKey: "ufUpperA", sets: 3, order: 4 },
  ] };
  const gated = gate(data, rec);
  ok("valid coach order: no order rejection", !(gated.orderRejections || []).length, JSON.stringify(gated.orderRejections));
  const stored = { ...data, plan: { ...data.plan, prescriptions: gated.prescriptions } };
  const list = app.resolveDayExercises(dayOf(stored, "ufUpperA"), stored);
  const comp = ids(list).filter((id) => ["bench", "machrow", "dbohp", "latpd"].includes(id));
  ok("valid coach order: the four compounds follow it (bench, machrow, dbohp, latpd)", comp.join() === "bench,machrow,dbohp,latpd", ids(list).join(" "));
  ok("valid coach order: the arms block still opens the day", ["curl", "pressdn", "bonus_ohtri"].includes(ids(list)[0]), ids(list).join(" "));
}

/* (g) Coach order that breaks (a) -> day rejected, plan blocked, render falls back. */
{
  const rec = { ...BASE_REC, prescriptions: [
    { exerciseId: "machohp", dayKey: "ufArms", sets: 3, order: 1 },
    { exerciseId: "ezcurl", dayKey: "ufArms", sets: 4, order: 2 },
  ] };
  const gated = gate(data, rec);
  const rej = gated.orderRejections || [];
  ok("shoulder press ordered before the specialized arms block -> order rejection", rej.length === 1 && rej[0].dayKey === "ufArms", JSON.stringify(rej));
  ok("reason names the specialize-first rule", rej[0] && /Arms is specialized and holds >= 40%/.test(rej[0].reason), rej[0] && rej[0].reason);
  const preview = app.buildPlanPreview(data, gated, "2026-10-01");
  ok("order rejection blocks the whole apply", preview.ok === false && preview.rejections.some((r) => r.gate === "order"));
  const stored = { ...data, plan: { ...data.plan, prescriptions: rec.prescriptions } };
  const list = app.resolveDayExercises(dayOf(stored, "ufArms"), stored);
  ok("render falls back to the engine order and records the violation (never a silent re-sort)",
    !!list.orderViolation && pos(list, "ezcurl") < pos(list, "machohp"), ids(list).join(" "));
}

/* (g) Coach order that puts non-focus isolation before specialized isolation. */
{
  const d = { ...data, focus: { ...data.focus, shoulders: "normal" } };
  // Arms cap raised too: with shoulders at normal the fixture's arms
  // baseline (37) is over 28, and Gate 6 would reject hammer first.
  const rec = { ...BASE_REC, focus: d.focus,
    sessionRules: { ...BASE_REC.sessionRules, weeklyGroupSetCaps: { arms: 40, shoulders: 30 } }, prescriptions: [
    { exerciseId: "latraise", dayKey: "ufUpperB", sets: 3, order: 1 },
    { exerciseId: "hammer", dayKey: "ufUpperB", sets: 3, order: 2 },
  ] };
  const gated = gate(d, rec);
  const rej = gated.orderRejections || [];
  ok("normal-focus lateral raise ordered before specialized hammer curl -> rejected",
    rej.some((r) => r.dayKey === "ufUpperB" && /Specialized isolation must come before non-focus isolation/.test(r.reason)), JSON.stringify(rej));
}

if (failures) {
  console.error(`\n${failures} of ${checks} assertions FAILED (check-order-engine.js)`);
  process.exit(1);
}
console.log(`check-order-engine.js: ${checks} assertions passed — spec override, compound/focus/regressing/id keys, input-order independence, rehab pins, and coach order honored-or-rejected.`);
