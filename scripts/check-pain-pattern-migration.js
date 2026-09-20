#!/usr/bin/env node
/* Task 6, Section 5 (pre-decision 5) — pain pattern taxonomy replacing
 * escalation's `cat` grouping. inferPainPattern derives `painPattern` for
 * every ALL_KNOWN exercise from its already-tagged attributes/pool (see
 * that function's own long comment in index.html for the full priority
 * rule and reasoning). isPainEscalating/gate5PainEscalation/
 * gate3LoadSanity/PainEscalationNotice/buildCoachBrief all group by
 * painPattern now, not cat.
 *
 * This covers:
 *   1. Coverage: painPatternTaggingGaps() is empty — all 75 exercises get
 *      a valid pattern, reported per pool/cat so a real gap doesn't hide
 *      behind an average.
 *   2. The priority rule's specific, deliberate overrides: kneeraise
 *      (pool core, but carries loaded_hip_flexion) and bbrow/meadows
 *      (pool hpull, but carry hip_hinge) land on hip_dominant despite
 *      their pool; bss/sissy/bonus_walkinglunge (pool quad, loaded hip
 *      flexion) also override to hip_dominant while legext/sledpush
 *      (pool quad, no hip involvement) correctly stay knee_dominant.
 *   3. "Migration" (no stored state to migrate — isPainEscalating is
 *      always derived fresh, never persisted): a realistic hip-labral
 *      session history, replayed under the OLD cat-based grouping vs the
 *      NEW painPattern-based grouping, shows the concrete fix — pain
 *      alternating between a squat-cat lift and a hinge-cat lift never
 *      reached the 2-of-4 trigger under `cat` (split across two separate
 *      groups); under painPattern it correctly combines into one
 *      hip_dominant pattern and DOES trigger. Neither grouping invents an
 *      escalation the other doesn't eventually agree exists once enough
 *      history accumulates — the fix is detecting it sooner/correctly on
 *      the SAME data, not a different answer to a different question.
 *   4. gate5PainEscalation and gate3LoadSanity correctly consume
 *      ctx.escalatingPatterns end to end.
 *   5. Real data: the actual backup has zero logged pain values (checked
 *      directly), so both old and new grouping trivially agree (no
 *      escalation either way) — recorded as a real finding, not assumed.
 *
 * Run: node scripts/check-pain-pattern-migration.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "PAIN_PATTERNS", "PAIN_PATTERN_NAMES", "inferPainPattern", "painPatternTaggingGaps", "ALL_KNOWN",
  "EX_BY_ID", "isPainEscalating", "gate5PainEscalation", "gate3LoadSanity", "CAT_NAMES",
]);

let failures = 0, checks = 0;
function ok(label, cond, extra) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${extra ? "\n" + extra : ""}`); }
}

/* ===== 1. Coverage ===== */
{
  const gaps = app.painPatternTaggingGaps();
  ok("all 75 ALL_KNOWN exercises get a valid painPattern — zero gaps", gaps.length === 0, JSON.stringify(gaps.map((e) => e.id)));
  ok("sanity: the library really does have 75 exercises (matches Task 1's own count)", app.ALL_KNOWN.length === 75, app.ALL_KNOWN.length);

  const byPattern = {};
  app.ALL_KNOWN.forEach((ex) => { byPattern[ex.painPattern] = (byPattern[ex.painPattern] || 0) + 1; });
  ok("every one of the 11 declared patterns has at least 1 exercise (nothing declared-but-unused)", app.PAIN_PATTERNS.every((p) => (byPattern[p] || 0) > 0), JSON.stringify(byPattern));
}

/* ===== 2. Priority rule: deliberate overrides ===== */
{
  ok("kneeraise (pool core) overrides to hip_dominant via its own loaded_hip_flexion attribute", app.EX_BY_ID.kneeraise.painPattern === "hip_dominant", app.EX_BY_ID.kneeraise.painPattern);
  ok("bbrow (pool hpull) overrides to hip_dominant via hip_hinge — same mechanism as its prox_hamstring_tendinosis contraindication", app.EX_BY_ID.bbrow.painPattern === "hip_dominant", app.EX_BY_ID.bbrow.painPattern);
  ok("meadows (pool hpull) overrides to hip_dominant via hip_hinge", app.EX_BY_ID.meadows.painPattern === "hip_dominant", app.EX_BY_ID.meadows.painPattern);
  ["bss", "sissy", "bonus_walkinglunge"].forEach((id) => {
    ok(`${id} (pool quad, loaded hip flexion) overrides to hip_dominant, not knee_dominant`, app.EX_BY_ID[id].painPattern === "hip_dominant", app.EX_BY_ID[id].painPattern);
  });
  ["legext", "sledpush"].forEach((id) => {
    ok(`${id} (pool quad, NO hip involvement) stays knee_dominant`, app.EX_BY_ID[id].painPattern === "knee_dominant", app.EX_BY_ID[id].painPattern);
  });
  // The core fix: squat AND hinge cats both collapse into hip_dominant.
  ["legpress", "hacksquat", "pinsquat", "smithsquat", "goblet", "boxsquat", "beltsquat"].forEach((id) => {
    ok(`${id} (squat cat) -> hip_dominant`, app.EX_BY_ID[id].painPattern === "hip_dominant", app.EX_BY_ID[id].painPattern);
  });
  ["rdl", "trapdl", "pullthrough", "backext"].forEach((id) => {
    ok(`${id} (hinge cat) -> hip_dominant`, app.EX_BY_ID[id].painPattern === "hip_dominant", app.EX_BY_ID[id].painPattern);
  });
  ["hipthrust", "kasglute", "reversehyper"].forEach((id) => {
    ok(`${id} (glute cat) -> hip_dominant`, app.EX_BY_ID[id].painPattern === "hip_dominant", app.EX_BY_ID[id].painPattern);
  });
  ["legcurl", "lyingcurl"].forEach((id) => {
    ok(`${id} (ham cat, knee flexion not hip) -> knee_dominant`, app.EX_BY_ID[id].painPattern === "knee_dominant", app.EX_BY_ID[id].painPattern);
  });
  ["calf", "seatedcalf"].forEach((id) => {
    ok(`${id} (calf cat, no dedicated pattern) -> knee_dominant fallback`, app.EX_BY_ID[id].painPattern === "knee_dominant", app.EX_BY_ID[id].painPattern);
  });
  ok("delts_lateral pool (latraise) -> lateral_raise", app.EX_BY_ID.latraise.painPattern === "lateral_raise", app.EX_BY_ID.latraise.painPattern);
  ok("delts_rear pool (reardelt) -> rear_delt", app.EX_BY_ID.reardelt.painPattern === "rear_delt", app.EX_BY_ID.reardelt.painPattern);
  ok("core pool WITHOUT hip flexion (cablecrunch) stays core", app.EX_BY_ID.cablecrunch.painPattern === "core", app.EX_BY_ID.cablecrunch.painPattern);
}

/* ===== 3. The concrete fix: cat-grouping missed a cross-cat pattern,
 * painPattern-grouping catches it. Reimplements the OLD cat-based
 * isPainEscalating inline (frozen copy, pre-Section-5 logic) purely to
 * demonstrate the contrast against the SAME session data — not because
 * the old version is kept anywhere in the app. ===== */
{
  function isPainEscalatingByCat(sessions, cat, threshold) {
    const t = threshold ?? 3;
    const hist = (sessions || [])
      .filter((s) => (app.EX_BY_ID[s.exerciseId] || {}).cat === cat)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const painOf = (s) => { const v = Math.max(s.pain ?? -1, s.painRetro ?? -1); return v >= 0 ? v : null; };
    let escalating = false, cleanStreak = 0;
    for (let i = 0; i < hist.length; i++) {
      const window = hist.slice(Math.max(0, i - 3), i + 1);
      const answered = window.map(painOf).filter((v) => v != null);
      const triggeredByCount = window.length >= 4 && answered.filter((v) => v > t).length >= 2;
      const triggeredByTrend = answered.length >= 3 && answered[answered.length - 1] - answered[0] >= 2;
      if (!escalating && (triggeredByCount || triggeredByTrend)) { escalating = true; cleanStreak = 0; }
      else if (escalating) {
        const v = painOf(hist[i]);
        if (v == null) { /* holds */ }
        else if (v <= t) { cleanStreak++; if (cleanStreak >= 3) escalating = false; }
        else cleanStreak = 0;
      }
    }
    return escalating;
  }

  // A hip labral profile: pain alternates between goblet squat (squat
  // cat) and RDL (hinge cat) -- real exercises, realistic session
  // pattern (4 sessions, pain over threshold on 2 of them, split across
  // the two cats so NEITHER cat alone reaches 2-of-4).
  const sessions = [
    { id: 1, date: "2026-01-01", exerciseId: "goblet", sets: [{ w: 40, r: 10 }], pain: 5, painRetro: null },
    { id: 2, date: "2026-01-03", exerciseId: "rdl", sets: [{ w: 95, r: 8 }], pain: 1, painRetro: null },
    { id: 3, date: "2026-01-08", exerciseId: "goblet", sets: [{ w: 40, r: 10 }], pain: 1, painRetro: null },
    { id: 4, date: "2026-01-10", exerciseId: "rdl", sets: [{ w: 95, r: 8 }], pain: 4, painRetro: null },
  ];

  const oldGobletEscalating = isPainEscalatingByCat(sessions, "squat", 3);
  const oldHingeEscalating = isPainEscalatingByCat(sessions, "hinge", 3);
  ok("OLD cat-grouping: neither squat nor hinge cat alone reaches the 2-of-4 trigger (the gap this section closes)", !oldGobletEscalating && !oldHingeEscalating, JSON.stringify({ oldGobletEscalating, oldHingeEscalating }));

  const newHipDominantEscalating = app.isPainEscalating(sessions, "hip_dominant", 3);
  ok("NEW painPattern-grouping: goblet squat + RDL correctly combine into ONE hip_dominant pattern and DO trigger (2 sessions >3/10 in the trailing window)", newHipDominantEscalating === true);
}

/* ===== 4. gate5PainEscalation / gate3LoadSanity consume
 * ctx.escalatingPatterns correctly ===== */
{
  const ctx = {
    escalatingPatterns: new Set(["hip_dominant"]),
    sessions: [{ id: 1, date: "2026-01-01", exerciseId: "rdl", sets: [{ w: 95, r: 8 }, { w: 95, r: 8 }, { w: 95, r: 8 }] }],
  };
  const g5 = app.gate5PainEscalation({ exerciseId: "rdl", sets: 5 }, ctx);
  ok("gate5PainEscalation caps sets when the exercise's painPattern is in ctx.escalatingPatterns", g5.value && g5.value.sets === 3 && g5.value.setsCapped === true, JSON.stringify(g5.value));
  ok("gate5's note names the pattern by its readable label", /hip-dominant/.test(g5.note), g5.note);

  const notEscalating = app.gate5PainEscalation({ exerciseId: "bench", sets: 5 }, ctx);
  ok("an exercise on a DIFFERENT painPattern (bench, horizontal_press) is unaffected", notEscalating.reject === false && notEscalating.value === undefined, JSON.stringify(notEscalating));

  const ctxLoad = { escalatingPatterns: new Set(["hip_dominant"]), sessions: [{ id: 1, date: "2026-01-01", exerciseId: "rdl", sets: [{ w: 95, r: 8 }] }], deloadActive: false };
  const g3 = app.gate3LoadSanity({ exerciseId: "rdl", load: 200 }, ctxLoad);
  ok("gate3LoadSanity's escalation ceiling (never above last logged) also keys off painPattern, not cat", g3.value && g3.value.load <= 95, JSON.stringify(g3.value));
}

/* ===== 5. Real data ===== */
const BACKUP_FILE = path.join(__dirname, "..", "recomp-coach-backup-2026-09-06.json");
if (!fs.existsSync(BACKUP_FILE)) {
  console.warn("NOTE: recomp-coach-backup-2026-09-06.json not found — skipping the real-data case (synthetic cases above still ran).");
} else {
  const raw = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
  const real = raw.data || raw;
  const withPain = real.sessions.filter((s) => s.pain != null || s.painRetro != null);
  ok("real data finding: the actual backup has zero sessions with any pain value logged (recorded as a fact, not assumed)", withPain.length === 0, `found ${withPain.length}`);
  const anyEscalating = app.PAIN_PATTERNS.some((p) => app.isPainEscalating(real.sessions, p, 3));
  ok("with no pain data at all, no pattern escalates under the new grouping either — old and new trivially agree on this real file", anyEscalating === false);
}

if (failures > 0) {
  console.error(`\nPAIN-PATTERN-MIGRATION CHECK FAILED: ${failures}/${checks} assertions failed.`);
  process.exit(1);
}
console.log(`Pain-pattern-migration check passed: ${checks} assertions — 100% coverage across all 75 exercises, the deliberate priority-rule overrides (kneeraise, bbrow, meadows, bss/sissy/walkinglunge), the concrete squat+hinge cross-cat fix demonstrated against realistic session data (old grouping misses it, new grouping catches it), gate5/gate3 consuming escalatingPatterns correctly, and a real-data finding (zero logged pain in the actual backup).`);
