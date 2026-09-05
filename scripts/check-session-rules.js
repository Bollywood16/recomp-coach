#!/usr/bin/env node
/* Regression coverage for sessionRules wiring (Task 2 commit 2,
 * TASK-2-RECONCILIATION-PROPOSAL.txt condition C). Before this change,
 * sessionRules wasn't in KNOWN_PLAN_KEYS at all — a pasted plan's
 * sessionRules was silently dropped and reported as an "ignored field"
 * before buildGateContext ever saw it, meaning weeklyGroupSetCaps /
 * maxSetsPerMovement / trimPriority / orderByFocus were inert regardless
 * of what was pasted. This asserts:
 *   1. sessionRules is no longer reported as an ignored field.
 *   2. Omitting sessionRules on a paste carries the existing stored value
 *      forward UNCHANGED (no reset), with no "updated" note.
 *   3. A paste that includes sessionRules MERGES onto what was already
 *      stored — a new cap for one group doesn't erase an existing cap for
 *      another — and only fields actually present in the paste move.
 *   4. A merge that actually changes a stored value produces a loud,
 *      specific note (gated.gates), naming the group and the old -> new
 *      values; a no-op merge (paste omits sessionRules, or repeats an
 *      identical value) produces no note.
 *
 * Run: node scripts/check-session-rules.js (wired into `npm test`).
 */
const assert = require("assert");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp(["applyCoachGates", "mergeSessionRules", "describeSessionRulesChange"]);

const BASE_REC = { template: "balanced", focus: {}, sessionMin: 60, calorieDelta: 0 };
const NOT_RECOVERING = { recoveringMode: false };

let failures = 0, checks = 0;
// See scripts/check-day-resolution.js's `normalize` comment: objects built
// inside the loaded app's vm realm have a different Object.prototype than
// plain object literals written in this test file, which makes
// deepStrictEqual report inequality on structurally identical plain data.
// A JSON round-trip strips that realm distinction — safe here since every
// value under test is plain JSON-safe data.
function normalize(x) { return JSON.parse(JSON.stringify(x)); }
function check(label, actual, expected) {
  checks++;
  try {
    assert.deepStrictEqual(normalize(actual), normalize(expected));
  } catch (e) {
    failures++;
    console.error(`FAIL: ${label}\n${e.message}`);
  }
}
function ok(label, cond) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
}

// 1. sessionRules is a recognized key — no "ignored field" note.
{
  const rec = { ...BASE_REC, sessionRules: { maxSetsPerMovement: 4 } };
  const gated = app.applyCoachGates(rec, {}, NOT_RECOVERING, { plan: {} });
  ok("sessionRules not reported as an ignored field",
    !gated.gates.some((g) => g.includes("Ignored") && g.includes("sessionRules")));
}

// 2. Omitted on this paste, prior exists -> carried forward unchanged, no note.
{
  const prior = { weeklyGroupSetCaps: { legs: 18 }, maxSetsPerMovement: 4 };
  const gated = app.applyCoachGates(BASE_REC, {}, NOT_RECOVERING, { plan: { sessionRules: prior } });
  check("omitted sessionRules carries prior forward unchanged", gated.sessionRules, prior);
  ok("no 'session rules updated' note when this paste didn't touch it",
    !gated.gates.some((g) => g.startsWith("Session rules updated")));
}

// 2b. Omitted on this paste, no prior at all -> stays undefined, no crash, no note.
{
  const gated = app.applyCoachGates(BASE_REC, {}, NOT_RECOVERING, { plan: {} });
  ok("no prior + no incoming -> sessionRules undefined", gated.sessionRules === undefined);
  ok("no note when there was never anything to update",
    !gated.gates.some((g) => g.startsWith("Session rules updated")));
}

// 3. Merge, not replace: new cap for one group must not erase an existing
//    cap for a different group.
{
  const prior = { weeklyGroupSetCaps: { legs: 18 }, maxSetsPerMovement: 4 };
  const rec = { ...BASE_REC, sessionRules: { weeklyGroupSetCaps: { shoulders: 24 } } };
  const gated = app.applyCoachGates(rec, {}, NOT_RECOVERING, { plan: { sessionRules: prior } });
  check("weeklyGroupSetCaps merges per-group (legs kept, shoulders added)",
    gated.sessionRules.weeklyGroupSetCaps, { legs: 18, shoulders: 24 });
  check("maxSetsPerMovement untouched by this paste is preserved",
    gated.sessionRules.maxSetsPerMovement, 4);
}

// 3b. A key present in the new paste always wins outright (can tighten or
//     loosen a specific cap already set).
{
  const prior = { weeklyGroupSetCaps: { legs: 18 } };
  const rec = { ...BASE_REC, sessionRules: { weeklyGroupSetCaps: { legs: 22 } } };
  const gated = app.applyCoachGates(rec, {}, NOT_RECOVERING, { plan: { sessionRules: prior } });
  check("an explicitly re-specified cap overwrites the old value for that group",
    gated.sessionRules.weeklyGroupSetCaps, { legs: 22 });
}

// 4. A merge that actually changes something produces a specific, named note.
{
  const prior = { weeklyGroupSetCaps: { shoulders: 20 } };
  const rec = { ...BASE_REC, sessionRules: { weeklyGroupSetCaps: { shoulders: 24 }, maxSetsPerMovement: 3 } };
  const gated = app.applyCoachGates(rec, {}, NOT_RECOVERING, { plan: { sessionRules: prior } });
  const note = gated.gates.find((g) => g.startsWith("Session rules updated"));
  ok("changed cap produces an 'updated' note", !!note);
  ok("note names the group and the old -> new values", note && note.includes("Shoulders weekly cap 20") && note.includes("24"));
  ok("note also covers the changed maxSetsPerMovement", note && note.includes("maxSetsPerMovement"));
}

// 4b. Re-pasting an IDENTICAL value produces no note (real no-op, not just
//     an absent key).
{
  const prior = { weeklyGroupSetCaps: { shoulders: 20 } };
  const rec = { ...BASE_REC, sessionRules: { weeklyGroupSetCaps: { shoulders: 20 } } };
  const gated = app.applyCoachGates(rec, {}, NOT_RECOVERING, { plan: { sessionRules: prior } });
  ok("identical re-paste produces no 'updated' note",
    !gated.gates.some((g) => g.startsWith("Session rules updated")));
}

// 5. Unit coverage on the merge helper directly, including the "no prior at
//    all, fresh incoming" case exercised end-to-end above via applyCoachGates.
check("mergeSessionRules: no incoming -> existing returned as-is",
  app.mergeSessionRules({ maxSetsPerMovement: 4 }, undefined), { maxSetsPerMovement: 4 });
check("mergeSessionRules: no existing, fresh incoming -> incoming as the whole result",
  app.mergeSessionRules(undefined, { maxSetsPerMovement: 5 }), { maxSetsPerMovement: 5 });
check("describeSessionRulesChange: no actual difference -> no notes",
  app.describeSessionRulesChange({ maxSetsPerMovement: 4 }, { maxSetsPerMovement: 4 }), []);

if (failures > 0) {
  console.error(`\nSESSION-RULES CHECK FAILED: ${failures}/${checks} assertions failed.`);
  process.exit(1);
}
console.log(`Session-rules check passed: ${checks} assertions — sessionRules merges onto prior state, changes are loudly noted, no-ops are silent.`);
