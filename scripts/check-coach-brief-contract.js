#!/usr/bin/env node
/* Task 7, Section 7 — coach framing and grounding. buildCoachBrief's
 * system framing rewritten per RECOMP-COACH-BUILD.md's Task 7 spec; the
 * full-tier brief now declares the `days` contract and the
 * decline-not-substitute rule explicitly, per the run instructions.
 *
 * This is a STRUCTURAL/CONTENT test — it verifies the brief text itself
 * is correctly formed (the right sections exist, contain the right
 * facts, are present/absent at the right tier). It does NOT verify
 * actual model behavior given that text — that's a genuinely different
 * kind of claim, checked separately by re-running Task 5's negative
 * controls against a reconstructed brief (see BUILD-LOG.md's Section 7
 * entry for that result, including the caveat that a model reasoning
 * about its own instructions isn't a clean test — the negative controls
 * were re-run via a FRESH agent with no shared context, matching Task
 * 5's original methodology).
 *
 * This covers:
 *   1. The rewritten system framing contains the spec's key phrases
 *      (design complete sessions, ground in research + cite source,
 *      decline conflicts to the constraint not the preference, respect
 *      movement constraints, leave a slot out rather than substitute).
 *   2. Full tier: <days_contract> present, states DECLINE-DON'T-
 *      SUBSTITUTE explicitly, describes the exact schema fields Gate
 *      9-13 actually check (rationale required, estimatedMin/
 *      weeklyGroupSets recomputed, Gate 12/13 named).
 *   3. Checkin tier: <days_contract> ABSENT entirely — day authorship
 *      is a full-tier-only feature (Section 2's checkin-scope reject),
 *      the brief shouldn't invite a doomed proposal.
 *   4. <program_days> present at BOTH tiers (prescriptions need valid
 *      dayKeys too, pre-dating Task 6), listing the REAL current
 *      template's day ids — checked against getProgram(data) directly,
 *      not just presence of the tag.
 *   5. Full tier still carries the whole research corpus (dynamic count,
 *      not a stale literal) and the whole tagged library (all 75,
 *      attributes visible) — Task 5's requirements, unregressed.
 *
 * Run: node scripts/check-coach-brief-contract.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "buildCoachBrief", "cloneInjuryProfileDefaults", "DEFAULT_INJURY_PROFILE", "ALL_KNOWN",
  "RESEARCH_CORPUS", "getProgram",
]);

let failures = 0, checks = 0;
function ok(label, cond, extra) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${extra ? "\n" + extra : ""}`); }
}

const baseData = () => ({
  sessions: [], swaps: {}, focus: null, plan: { template: "upperFocus", sessionMin: 60 },
  injuryProfile: { ...app.cloneInjuryProfileDefaults(), recoveringMode: true },
});

const fullBrief = app.buildCoachBrief(baseData(), { text: "bigger arms" }, "full");
const checkinBrief = app.buildCoachBrief(baseData(), { text: "bigger arms" }, "checkin");

/* ===== 1. System framing ===== */
{
  ok("framing: 'design complete sessions' language present", /Design complete sessions/.test(fullBrief));
  ok("framing: ground in research + cite the source", /Ground every decision in <research_context>/.test(fullBrief) && /cite the specific entry/.test(fullBrief));
  ok("framing: where the corpus doesn't cover something, say so rather than assert", /does not cover something, say so rather than asserting/.test(fullBrief));
  ok("framing: conflicts program for the constraint, not the preference", /program for the constraint, not the preference/.test(fullBrief));
  ok("framing: must respect movement constraints / tagged attributes", /must respect <constraints> and the tagged attributes/.test(fullBrief));
  ok("framing: leave a slot out and explain why, never substitute unverifiable", /leave it out and explain why — never substitute an exercise you cannot verify/.test(fullBrief));
  ok("same framing text appears in the checkin-tier brief too (framing isn't full-tier-only, only the days_contract detail is)", fullBrief.split("\n")[0] === checkinBrief.split("\n")[0]);
}

/* ===== 2. Full tier: days_contract present and correct ===== */
{
  ok("full tier: <days_contract> section present", /<days_contract>/.test(fullBrief));
  ok("full tier: DECLINE, DON'T SUBSTITUTE stated explicitly, in those words", /DECLINE, DON'T SUBSTITUTE/.test(fullBrief));
  ok("full tier: rationale is stated as required", /rationale.*required/i.test(fullBrief.match(/<days_contract>[\s\S]*?<\/days_contract>/)[0]));
  ok("full tier: estimatedMin/weeklyGroupSets described as recomputed with a 10% tolerance", /off by more than 10%/.test(fullBrief));
  ok("full tier: Gate 12 (specialize coverage) named", /Gate 12/.test(fullBrief));
  ok("full tier: Gate 13 (maintain floor / pool substitute) named", /Gate 13/.test(fullBrief));
  ok("full tier: an unrecognized exerciseId is rejected outright, no fallback", /rejected outright, no fallback/.test(fullBrief));
  ok("full tier: a REAL substitution (substitutedFor + rationale) is distinguished from guessing", /substitutedFor.*to A's id/.test(fullBrief) && /not the same as guessing/.test(fullBrief));
  ok("full tier: partial application is explained (one bad day doesn't cost the rest)", /doesn't cost you the rest of the plan/.test(fullBrief));
}

/* ===== 3. Checkin tier: days_contract absent ===== */
{
  ok("checkin tier: <days_contract> is ABSENT — day authorship isn't offered at checkin scope", !/<days_contract>/.test(checkinBrief) && !/days_contract/.test(checkinBrief));
  ok("checkin tier: instructions don't mention `days` as an optional field", !/Optional `days`/.test(checkinBrief));
}

/* ===== 4. program_days at both tiers, real dayKeys ===== */
{
  const data = baseData();
  const program = app.getProgram(data);
  [fullBrief, checkinBrief].forEach((brief, i) => {
    const tierName = i === 0 ? "full" : "checkin";
    ok(`${tierName} tier: <program_days> present`, /<program_days>/.test(brief));
    program.forEach((day) => {
      ok(`${tierName} tier: <program_days> lists the real dayKey "${day.id}"`, brief.includes(`- ${day.id} "`), brief.match(/<program_days>[\s\S]*?<\/program_days>/) ? brief.match(/<program_days>[\s\S]*?<\/program_days>/)[0] : "(section not found)");
    });
  });
}

/* ===== 5. Full tier: whole corpus, whole tagged library (Task 5, unregressed) ===== */
{
  ok("full tier: every RESEARCH_CORPUS entry's finding text appears in the brief (dynamic count, not a stale literal)", app.RESEARCH_CORPUS.every((r) => fullBrief.includes(r.finding)));
  ok(`full tier: states the real corpus count (${app.RESEARCH_CORPUS.length}), not a hardcoded old number`, fullBrief.includes(`All ${app.RESEARCH_CORPUS.length} corpus entries`));
  ok(`full tier: library section states all ${app.ALL_KNOWN.length} exercises`, fullBrief.includes(`Full library: ${app.ALL_KNOWN.length} exercises`));
  ok("full tier: attribute tags are visible in the library listing (not just id|name)", /\|horizontal_press,free_weight\|\|/.test(fullBrief) || /elbow_flexion/.test(fullBrief));
  const sampleIds = app.ALL_KNOWN.slice(0, 5).map((e) => e.id);
  ok("full tier: a sample of real exercise ids actually appear in the library text", sampleIds.every((id) => new RegExp(`^${id}\\|`, "m").test(fullBrief)), sampleIds);
}

/* ===== 6. Real data ===== */
const BACKUP_FILE = path.join(__dirname, "..", "recomp-coach-backup-2026-09-06.json");
if (!fs.existsSync(BACKUP_FILE)) {
  console.warn("NOTE: recomp-coach-backup-2026-09-06.json not found — skipping the real-data case (synthetic cases above still ran).");
} else {
  const raw = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
  const real = raw.data || raw;
  const data = { ...real, injuryProfile: { ...app.cloneInjuryProfileDefaults(), recoveringMode: true } };
  let threw = null;
  let brief = null;
  try { brief = app.buildCoachBrief(data, { text: "bigger arms" }, "full"); } catch (e) { threw = e; }
  ok("real data: full-tier brief builds without throwing", !threw, threw && threw.stack);
  if (brief) {
    ok("real data: <days_contract> present", /<days_contract>/.test(brief));
    ok("real data: <program_days> lists ufArms (the real Delts & Arms day)", /- ufArms "Delts & Arms"/.test(brief));
    ok("real data: the real goblet contraindication is visible in the library (hip_labrum)", /goblet\|.*\|hip_labrum/.test(brief));
  }
}

if (failures > 0) {
  console.error(`\nCOACH-BRIEF-CONTRACT CHECK FAILED: ${failures}/${checks} assertions failed.`);
  process.exit(1);
}
console.log(`Coach-brief-contract check passed: ${checks} assertions — the rewritten system framing's key phrases, the full-tier days_contract (decline-not-substitute stated explicitly, rationale required, Gate 12/13 named, real-substitution distinguished from guessing), its absence at checkin tier, program_days listing real dayKeys at both tiers, and Task 5's whole-corpus/whole-library requirements unregressed.`);
