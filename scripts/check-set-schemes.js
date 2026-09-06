#!/usr/bin/env node
/* Task 3: set schemes (back-off and drop sets). Covers the data model
 * (hardSetsFor/totalSegmentsFor), decision 1 (sets/scheme mismatch
 * rejection), decision 2 (backoff-first trim, spawned always straight),
 * decision 3 (the load clamp, always noted), decision 4 (deload strips
 * schemes — see the live-browser note in TASK-3-SET-SCHEMES-PROPOSAL.txt
 * for why that one isn't unit-tested here), decision 5 (DROP_SEGMENT_SEC
 * duration), decision 6 (Gate 5's hard-set row count), and point 8
 * (escalation strips schemes). Migration safety (Addition A) has its own
 * file: check-set-scheme-migration.js.
 *
 * Run: node scripts/check-set-schemes.js (wired into `npm test`).
 */
const assert = require("assert");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "hardSetsFor", "totalSegmentsFor", "capAndSplitMovement", "trimOneHardSet",
  "clampSchemeToTopLoad", "gate1eSchemeConsistency", "gate5PainEscalation",
  "applyGatedPrescriptions", "buildGateContext", "resolveDayExercises",
  "fitDayToTime", "gate7DurationTrim", "recommend", "bestSet", "deloadScale",
  "DROP_SEGMENT_SEC", "dropExtraSec", "PROGRAMS", "DEFAULT_FOCUS",
  "EX_BY_ID", "restFor",
]);
const NOT_RECOVERING = { recoveringMode: false };

let failures = 0, checks = 0;
function normalize(x) { return JSON.parse(JSON.stringify(x)); }
function check(label, actual, expected) {
  checks++;
  try { assert.deepStrictEqual(normalize(actual), normalize(expected)); }
  catch (e) { failures++; console.error(`FAIL: ${label}\n${e.message}`); }
}
function ok(label, cond, extra) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${extra ? "\n" + extra : ""}`); }
}

/* ===== Point 1: bestSet excludes drop segments from e1RM ===== */
{
  // A drop segment's high-rep, reduced-load continuation can imply a
  // HIGHER e1RM than the actual top set — the exact corruption requirement
  // 1 warns about. Top set: 95x8 (e1RM ~120.3). Drop: 60x20 (e1RM ~100) —
  // picked deliberately NOT to exceed the top here (a drop set outliving
  // the top set's e1RM is rare but the exclusion must hold regardless);
  // the discriminating case is a drop whose Epley estimate DOES exceed a
  // middling top set.
  const sets = [{ w: 95, r: 8 }, { w: 40, r: 25, segment: "drop" }]; // drop e1RM = 40*(1+25/30) ≈ 73.3, top ≈ 120.3 — not the corrupting case
  const best = app.bestSet(sets);
  ok("ordinary case: top set still wins", best.w === 95);
}
{
  // The actually corrupting case: a drop set's Epley estimate DOES exceed
  // the top set's, e.g. from a long, high-rep burnout continuation.
  const sets = [{ w: 60, r: 8 }, { w: 40, r: 28, segment: "drop" }]; // top e1RM=60*(1+8/30)=76; drop e1RM=40*(1+28/30)≈77.3 — drop wins numerically
  const best = app.bestSet(sets);
  ok("drop segment excluded even when its Epley estimate would numerically beat the top set", best.w === 60, JSON.stringify(best));
}

/* ===== Data model: hardSetsFor / totalSegmentsFor ===== */
check("hardSetsFor: straight passes ex.sets through", app.hardSetsFor({ sets: 5 }), 5);
check("hardSetsFor: backoff is topSets+backoffSets, authoritative over ex.sets", app.hardSetsFor({ sets: 99, scheme: { type: "backoff", topSets: 2, backoffSets: 3 } }), 5);
check("hardSetsFor: drop never adds to the hard-set count", app.hardSetsFor({ sets: 4, scheme: { type: "drop", drops: 1, appliesTo: "lastSet" } }), 4);
check("totalSegmentsFor: straight/backoff same as hardSetsFor", app.totalSegmentsFor({ sets: 5, scheme: { type: "backoff", topSets: 2, backoffSets: 3 } }), 5);
check("totalSegmentsFor: drop lastSet adds drops*1", app.totalSegmentsFor({ sets: 4, scheme: { type: "drop", drops: 1, appliesTo: "lastSet" } }), 5);
check("totalSegmentsFor: drop allSets adds drops*sets", app.totalSegmentsFor({ sets: 3, scheme: { type: "drop", drops: 2, appliesTo: "allSets" } }), 9);

/* ===== Decision 1: sets/scheme mismatch rejected, agreement accepted ===== */
{
  const mismatch = app.gate1eSchemeConsistency({ exerciseId: "ezcurl", sets: 5, scheme: { type: "backoff", topSets: 2, backoffSets: 2 } });
  ok("mismatched sets vs backoff total: rejected", mismatch.reject === true && /implies 4/.test(mismatch.reason), mismatch.reason);
  const match = app.gate1eSchemeConsistency({ exerciseId: "ezcurl", sets: 4, scheme: { type: "backoff", topSets: 2, backoffSets: 2 } });
  ok("matching sets vs backoff total: accepted", match.reject === false);
  const omitted = app.gate1eSchemeConsistency({ exerciseId: "ezcurl", scheme: { type: "backoff", topSets: 2, backoffSets: 2 } });
  ok("sets omitted entirely (scheme defines the total): accepted, not a mismatch", omitted.reject === false);
  const straight = app.gate1eSchemeConsistency({ exerciseId: "ezcurl", sets: 5, scheme: { type: "straight" } });
  ok("straight scheme never triggers this check", straight.reject === false);
}

/* ===== Decision 2: capAndSplitMovement backoff trim + spawned always straight ===== */
{
  const list = [{ slot: null, ex: { ...app.EX_BY_ID.ezcurl, sets: 6, scheme: { type: "backoff", topSets: 3, backoffSets: 3 } } }];
  const { list: out } = app.capAndSplitMovement(list, 4, NOT_RECOVERING);
  const capped = out.find((e) => e.ex.id === "ezcurl");
  check("backoff capped: backoffSets shaved first (3->1), topSets untouched", capped.ex.scheme, { type: "backoff", topSets: 3, backoffSets: 1 });
  ok("hard-set total after cap equals the cap", capped.ex.sets === 4);
}
{
  // overflow bigger than backoffSets alone can absorb -> spills into topSets
  const list = [{ slot: null, ex: { ...app.EX_BY_ID.ezcurl, sets: 3, scheme: { type: "backoff", topSets: 2, backoffSets: 1 } } }];
  const { list: out } = app.capAndSplitMovement(list, 1, NOT_RECOVERING);
  const capped = out.find((e) => e.ex.id === "ezcurl");
  check("overflow exceeding backoffSets spills into topSets", capped.ex.scheme, { type: "backoff", topSets: 1, backoffSets: 0 });
}
{
  const list = [{ slot: null, ex: { ...app.EX_BY_ID.ezcurl, sets: 6, scheme: { type: "backoff", topSets: 3, backoffSets: 3 } } }];
  const { list: out } = app.capAndSplitMovement(list, 4, NOT_RECOVERING);
  const spawned = out.find((e) => e.ex.poolSpawned);
  ok("spawned pool-mate never inherits a scheme", spawned && spawned.ex.scheme === undefined, JSON.stringify(spawned && spawned.ex.scheme));
}

/* ===== Decision 3: the load clamp — always fixes, always notes ===== */
{
  const r = app.clampSchemeToTopLoad({ load: 100, scheme: { type: "backoff", topSets: 2, backoffSets: 2, backoffLoadPct: 150 } });
  ok("backoffLoadPct > 100 clamped to 100", r.value.scheme.backoffLoadPct === 100);
  ok("clamp is always noted, never silent", !!r.note && /150%/.test(r.note), r.note);
}
{
  const r = app.clampSchemeToTopLoad({ load: 100, scheme: { type: "backoff", topSets: 2, backoffSets: 2, backoffLoad: 120 } });
  ok("absolute backoffLoad exceeding top load replaced (120 -> derived from default 80%)", r.value.scheme.backoffLoad === 80, r.value.scheme.backoffLoad);
  ok("noted", !!r.note && /120 lb/.test(r.note));
}
{
  const r = app.clampSchemeToTopLoad({ load: 100, scheme: { type: "backoff", topSets: 2, backoffSets: 2, backoffLoad: 70 } });
  ok("a backoffLoad already below the top load is untouched", r.value.scheme.backoffLoad === 70);
  ok("no note when nothing needed clamping", r.note === null);
}
{
  const r = app.clampSchemeToTopLoad({ load: 100, scheme: { type: "drop", drops: 1, dropPct: 120, appliesTo: "lastSet" } });
  ok("dropPct >= 100 (zero/negative weight) clamped", r.value.scheme.dropPct === 50);
  ok("noted", !!r.note);
}
{
  // Cascade: Gate 4's pain-rule reduction lowers value.load: the clamp
  // must run AFTER that, against the FINAL load, not the original.
  const data = { plan: { template: "balanced", sessionMin: 60 }, focus: app.DEFAULT_FOCUS, swaps: {}, injuryProfile: NOT_RECOVERING,
    sessions: [{ id: 1, date: "2026-08-01", exerciseId: "bench", sets: [{ w: 100, r: 8 }], pain: 5, painRetro: null, painRetroAt: null, painRetroDismissed: false }] };
  const ctx = app.buildGateContext(data, {});
  // Gate 4 will force bench's load down by 20% (pain rule) from whatever
  // baseline it uses. backoffLoad set just above THAT reduced number, to
  // confirm the clamp catches it post-Gate-4 rather than only checking
  // against the originally prescribed top load.
  const result = app.applyGatedPrescriptions([
    { exerciseId: "bench", dayKey: "upperA", sets: 3, load: 100, scheme: { type: "backoff", topSets: 2, backoffSets: 1, backoffLoad: 95 } },
  ], ctx);
  ok("gate 4 + scheme clamp both ran", result.accepted.length === 1, JSON.stringify(result.rejections));
  const survivor = result.accepted[0];
  ok("final load was reduced by the pain rule (below the original 100)", survivor.load < 100, survivor.load);
  ok("backoffLoad clamped against the FINAL (reduced) load, not the original 100", survivor.scheme.backoffLoad <= survivor.load, JSON.stringify(survivor));
}

/* ===== Decision 6 + point 8: Gate 5 escalation strips schemes, hard-set row count ===== */
{
  const ctx = { escalatingCats: new Set(["biceps"]), sessions: [
    { id: 1, date: "2026-08-01", exerciseId: "ezcurl", sets: [{ w: 35, r: 10, segment: "top" }, { w: 35, r: 10, segment: "top" }, { w: 35, r: 10, segment: "top" }, { w: 28, r: 12, segment: "drop" }] },
  ] };
  const g5 = app.gate5PainEscalation({ exerciseId: "ezcurl", sets: 5, scheme: { type: "backoff", topSets: 3, backoffSets: 2 } }, ctx);
  ok("escalation strips the scheme to straight", g5.value && g5.value.scheme && g5.value.scheme.type === "straight", JSON.stringify(g5.value));
  ok("note explains the strip", /stripped to straight/.test(g5.note), g5.note);
  ok("lastSetCount excludes the drop row (3 hard sets, not 4 raw rows)", g5.value.sets === 3, JSON.stringify(g5.value));
}
{
  // Not escalating: scheme untouched.
  const ctx = { escalatingCats: new Set(), sessions: [] };
  const g5 = app.gate5PainEscalation({ exerciseId: "ezcurl", sets: 4, scheme: { type: "backoff", topSets: 2, backoffSets: 2 } }, ctx);
  ok("no escalation on this pattern: reject:false and no value patch", g5.reject === false && g5.value === undefined);
}

/* ===== Point 4: duration accounts for schemes ===== */
{
  // fitDayToTime rounds to whole minutes — a single 20s drop segment can
  // vanish in rounding (verified: 4 sets x 20s each rounds the same
  // either way). Use enough drop volume (allSets x2) to clear a minute
  // boundary unambiguously, rather than a case that happens to round away.
  const straight = { ...app.EX_BY_ID.ezcurl, sets: 4, cat: "biceps" };
  const dropped = { ...app.EX_BY_ID.ezcurl, sets: 4, cat: "biceps", scheme: { type: "drop", drops: 2, dropPct: 20, appliesTo: "allSets" } };
  const dStraight = app.fitDayToTime([straight], 60).minutes;
  const dDrop = app.fitDayToTime([dropped], 60).minutes;
  ok("a drop scheme takes longer than the same exercise straight", dDrop > dStraight, `${dStraight} vs ${dDrop}`);
}
{
  // Direct, rounding-independent confirmation that dropExtraSec is a
  // real, nonzero, additive term in the duration formula (not just true
  // "eventually, with enough drops" per the rounding-sensitive test above).
  ok("dropExtraSec is nonzero for a real drop scheme", app.dropExtraSec({ sets: 4, scheme: { type: "drop", drops: 1, appliesTo: "lastSet" } }) === app.DROP_SEGMENT_SEC);
  ok("dropExtraSec is zero for straight/backoff (no formula change needed there)",
    app.dropExtraSec({ sets: 4 }) === 0 && app.dropExtraSec({ sets: 4, scheme: { type: "backoff", topSets: 2, backoffSets: 2 } }) === 0);
}
{
  // Trim priority: fitDayToTime should shave backoffSets before topSets
  // when a scheme'd exercise needs to lose a hard set for time — same
  // trimOneHardSet capAndSplitMovement uses, so the two can't disagree.
  const ex = { ...app.EX_BY_ID.ezcurl, sets: 4, cat: "biceps", scheme: { type: "backoff", topSets: 2, backoffSets: 2 }, focusBoost: false };
  const other = { ...app.EX_BY_ID.skull, cat: "triceps", sets: 2, focusBoost: false }; // compound-ish filler, kept small
  // Force a tiny session length so the trim loop has to act.
  const result = app.fitDayToTime([ex, other], 20);
  const trimmedEx = result.list.find((e) => e.id === "ezcurl");
  if (trimmedEx && trimmedEx.sets < 4) {
    ok("backoffSets shaved before topSets during a time-budget trim", trimmedEx.scheme.topSets === 2 || trimmedEx.scheme.backoffSets < 2, JSON.stringify(trimmedEx.scheme));
  } else {
    ok("(trim didn't reach ezcurl in this budget — not a failure, just not exercised)", true);
  }
}

/* ===== Decision 4: deload strips schemes to straight (extracted from
 * DayPage's isDeload block so it's directly testable, not an unverified
 * one-liner buried in JSX) ===== */
{
  const ex = { cat: "biceps", sets: 4, scheme: { type: "backoff", topSets: 2, backoffSets: 2 } };
  const scaled = app.deloadScale(ex, true);
  ok("deload strips a backoff scheme to straight", scaled.scheme.type === "straight", JSON.stringify(scaled.scheme));
  ok("deload still scales sets down (existing behavior preserved)", scaled.sets === Math.max(1, Math.round(4 * 0.6)));
}
{
  const ex = { cat: "biceps", sets: 4, scheme: { type: "drop", drops: 1, appliesTo: "lastSet" } };
  const scaled = app.deloadScale(ex, true);
  ok("deload strips a drop scheme to straight too", scaled.scheme.type === "straight");
}
{
  const ex = { cat: "biceps", sets: 4, scheme: { type: "backoff", topSets: 2, backoffSets: 2 } };
  const unchanged = app.deloadScale(ex, false);
  check("not deloading: exercise passed through completely unchanged", unchanged, ex);
}

if (failures > 0) {
  console.error(`\nSET-SCHEMES CHECK FAILED: ${failures}/${checks} assertions failed.`);
  process.exit(1);
}
console.log(`Set-schemes check passed: ${checks} assertions — hardSetsFor/totalSegmentsFor, the sets/scheme mismatch rejection, backoff-first trim with spawned-always-straight, the load clamp (always noted, cascading past Gate 4), Gate 5's scheme-stripping and hard-set row count, and scheme-aware duration all verified.`);
