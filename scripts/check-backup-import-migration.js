#!/usr/bin/env node
/* Fix 2 (TASK-0-BACKUP-MIGRATION-REVIEW.txt, section 1): before this fix,
 * only App's boot-time localStorage read ran the goalProfile.injuryRecovery
 * fail-safe migration, the one-time migration notice, and the goblet ->
 * boxsquat session rename. BackupCard.importData — the only path a
 * downloaded backup file ever actually travels back into the app — silently
 * skipped all three. migrateInjuryAndGobletData (index.html) is now the one
 * function both paths call, so they cannot drift apart again.
 *
 * This covers:
 *   1. The fail-safe's polarity in both directions against the user's real
 *      pre-Task-0 export (recomp-coach-backup-2026-09-06.json, gitignored,
 *      read directly if present — skipped with a clear note if not, e.g. on
 *      a machine that never had it exported): an explicit
 *      goalProfile.injuryRecovery === false is honored as OFF (a confirmed
 *      prior user choice), while true/absent/null all fail safe to ON.
 *      Confirmed by the user directly (2026-09-20): only ambiguous input
 *      defaults ON; a real false is not overridden. The notice fires in
 *      BOTH directions — silence was always the bug, never the polarity.
 *   2. The goblet -> boxsquat rename applies to the user's real 8 logged
 *      goblet sessions IN PLACE — same ids, same sets, only exerciseId
 *      changes — and weeklySeries's per-week e1RM/tonnage series computed
 *      under the new id is IDENTICAL to the series computed under the old
 *      id before the rename. That's the concrete check that the rename
 *      can't split one lift's history into two at the boundary.
 *   3. Both call sites' semantics: `existing` (the current in-memory data
 *      the boot path never has, and the import path always does) is
 *      consulted only for bookkeeping fallbacks (history, an
 *      already-resolved goblet/boxsquat decision) — never for whether the
 *      incoming record itself needs migrating. An already-resolved local
 *      goblet decision is NOT re-triggered by re-importing an old file.
 *   4. This is the only place either the boot path OR the import path gets
 *      exercised against real (not seeded) data — there was no test for
 *      the boot-time migration at all before this file, seeded or real.
 *
 * Deliberately-broken-and-restored verification (done by hand while writing
 * this, not left in the tree): reverted migrateInjuryAndGobletData's
 * `explicitlyOff` check to always treat goalProfile as absent (the shape of
 * the original import-path bug) and confirmed check 1's false-case
 * assertion below fails; reverted the goblet rename's `!gobletBoxSquatMigration`
 * guard to always re-rename and confirmed the "existing decision is not
 * re-triggered" assertion fails. Both restored before this file was
 * finalized.
 *
 * Run: node scripts/check-backup-import-migration.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp(["migrateInjuryAndGobletData", "weeklySeries", "cloneInjuryProfileDefaults"]);

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

/* ================================================================
 * SYNTHETIC CASES — always run, no dependency on a real backup file
 * ================================================================ */

// ----- Boot-path shape (existing=null): absent injuryProfile, absent
// goalProfile too (older than even the goalProfile-based toggle) -> no
// migration event, no notice, but still fails safe to recoveringMode true.
{
  const source = { sessions: [] };
  const r = app.migrateInjuryAndGobletData(source, null);
  ok("no goalProfile at all: still fails safe to recoveringMode true", r.injuryProfile.recoveringMode === true);
  ok("no goalProfile at all: no migration notice (nothing to attribute the default to)", r.injuryProfileMigration === null);
  ok("migrated flag false when nothing needed migrating", r.migrated === false);
}

// ----- Already has an injuryProfile: pure passthrough, migration never
// runs even if a stale goalProfile is also present in the record.
{
  const existingProfile = { ...app.cloneInjuryProfileDefaults(), recoveringMode: false, clinicianReviewed: true };
  const source = { injuryProfile: existingProfile, goalProfile: { injuryRecovery: false }, sessions: [] };
  const r = app.migrateInjuryAndGobletData(source, null);
  check("an already-present injuryProfile passes through untouched (merged onto defaults, not re-derived)", r.injuryProfile, { ...app.cloneInjuryProfileDefaults(), ...existingProfile });
  ok("no migration notice when injuryProfile already existed", r.injuryProfileMigration === null);
}

// ----- Import-path shape (existing set): a device that already resolved
// the goblet/boxsquat prompt (chose to keep "goblet") must not have that
// decision re-triggered by importing an old file that predates the field.
{
  const existing = {
    injuryProfile: app.cloneInjuryProfileDefaults(),
    injuryProfileHistory: [{ at: "2026-08-01T00:00:00.000Z", device: "phone", profile: {} }],
    gobletBoxSquatMigration: { at: "2026-08-15T00:00:00.000Z", resolved: true, defaultedTo: "goblet" },
  };
  const source = {
    injuryProfile: app.cloneInjuryProfileDefaults(),
    sessions: [{ id: 1, date: "2026-07-01", exerciseId: "goblet", sets: [{ w: 40, r: 12 }] }],
  };
  const r = app.migrateInjuryAndGobletData(source, existing);
  ok("an already-resolved local goblet/boxsquat decision is NOT re-triggered by an old import", r.gobletBoxSquatMigration.resolved === true && r.gobletBoxSquatMigration.defaultedTo === "goblet");
  check("sessions stay tagged goblet — the prior resolved-to-goblet decision is honored, not overridden", r.sessions, source.sessions);
  ok("no new migration event: source already had its own injuryProfile", r.injuryProfileMigration === null);
  check("existing injuryProfileHistory carries forward when the incoming file has none of its own and no new migration fires", r.injuryProfileHistory, existing.injuryProfileHistory);
}

// ----- Import path never falls back to `existing` for whether the incoming
// record itself needs migrating — a live app's default injuryProfile is
// always truthy, so folding it in would make the fail-safe unreachable.
{
  const existing = { injuryProfile: app.cloneInjuryProfileDefaults(), sessions: [] };
  const source = { goalProfile: { injuryRecovery: false }, sessions: [] };
  const r = app.migrateInjuryAndGobletData(source, existing);
  ok("importing an old file with no injuryProfile still runs the fail-safe even though `existing` already has one", r.injuryProfileMigration !== null);
  ok("explicit false in the imported file is honored as OFF, not overridden by `existing`'s default-on profile", r.injuryProfile.recoveringMode === false);
}

/* ================================================================
 * REAL-DATA CASES — recomp-coach-backup-2026-09-06.json
 * (gitignored, never committed; skipped with a note if absent)
 * ================================================================ */

const BACKUP_FILE = path.join(__dirname, "..", "recomp-coach-backup-2026-09-06.json");

if (!fs.existsSync(BACKUP_FILE)) {
  console.warn("NOTE: recomp-coach-backup-2026-09-06.json not found — skipping the real-data cases (synthetic cases above still ran). Re-export to restore this coverage.");
} else {
  const raw = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
  const real = raw.data || raw;
  ok("sanity: real file has the 168 sessions the migration report recorded", real.sessions.length === 168);
  const realGoblet = real.sessions.filter((s) => s.exerciseId === "goblet");
  ok("sanity: real file has the 8 goblet sessions the migration report recorded", realGoblet.length === 8);
  ok("sanity: real file predates Task 0 (no injuryProfile)", !real.injuryProfile);

  // Pre-rename reference series, computed directly on the untouched file —
  // this is what a continuous "goblet" history looked like before Fix 2.
  const preRenameSeries = app.weeklySeries(real.sessions, "goblet");
  ok("sanity: pre-rename goblet series is non-empty", preRenameSeries.length > 0);

  function realCase(label, goalProfileOverride, existing) {
    const source = { ...real, goalProfile: goalProfileOverride };
    return { label, result: app.migrateInjuryAndGobletData(source, existing) };
  }

  // Both calling conventions the app actually uses: `existing=null` (boot,
  // nothing loaded yet) and `existing=<a plausible current app state>`
  // (import, restoring into an already-running app). The fail-safe
  // decision must be identical either way — it's evaluated off `source`.
  const bootExisting = null;
  const importExisting = { injuryProfile: app.cloneInjuryProfileDefaults(), injuryProfileHistory: [], sessions: [] };

  // ----- Case 1: goalProfile.injuryRecovery === true (the real, unmodified
  // value in this file) -----
  {
    const boot = realCase("boot, true", { ...real.goalProfile, injuryRecovery: true }, bootExisting);
    const imp = realCase("import, true", { ...real.goalProfile, injuryRecovery: true }, importExisting);
    ok("real file, injuryRecovery true (boot): recoveringMode seeds true", boot.result.injuryProfile.recoveringMode === true);
    ok("real file, injuryRecovery true (boot): 'turned on' notice fires", boot.result.injuryProfileMigration && /turned on/.test(boot.result.injuryProfileMigration.message), JSON.stringify(boot.result.injuryProfileMigration));
    ok("real file, injuryRecovery true (import): same recoveringMode as boot", imp.result.injuryProfile.recoveringMode === boot.result.injuryProfile.recoveringMode);
    ok("real file, injuryRecovery true (import): notice fires here too — this path used to be completely silent", imp.result.injuryProfileMigration !== null);
  }

  // ----- Case 2: goalProfile.injuryRecovery flipped to false — the case
  // the migration report flagged as currently silent. Confirmed with the
  // user: an explicit false is honored as OFF, and the notice must still
  // fire so the carry-forward isn't silent either. -----
  {
    const boot = realCase("boot, false", { ...real.goalProfile, injuryRecovery: false }, bootExisting);
    const imp = realCase("import, false", { ...real.goalProfile, injuryRecovery: false }, importExisting);
    ok("real file, injuryRecovery false (boot): recoveringMode honors the explicit false -> stays off", boot.result.injuryProfile.recoveringMode === false);
    ok("real file, injuryRecovery false (boot): 'stayed off, carried over' notice fires — silence was the bug, not the value", boot.result.injuryProfileMigration && /stayed off/.test(boot.result.injuryProfileMigration.message), JSON.stringify(boot.result.injuryProfileMigration));
    ok("real file, injuryRecovery false (import): THE case that was silent before Fix 2 — now honors false and notifies", imp.result.injuryProfile.recoveringMode === false && imp.result.injuryProfileMigration !== null);
    check("boot and import agree exactly on the false case", imp.result.injuryProfile, boot.result.injuryProfile);
  }

  // ----- Case 3: goalProfile entirely absent (as if this were an even
  // older export, predating the goalProfile toggle itself) -----
  {
    const boot = realCase("boot, absent", undefined, bootExisting);
    const imp = realCase("import, absent", undefined, importExisting);
    ok("real file, no goalProfile (boot): fails safe to recoveringMode true", boot.result.injuryProfile.recoveringMode === true);
    ok("real file, no goalProfile (boot): no migration notice — nothing to attribute the default to, matches pre-Fix-2 boot behavior exactly", boot.result.injuryProfileMigration === null);
    check("boot and import agree exactly on the absent case", imp.result.injuryProfile, boot.result.injuryProfile);
  }

  // ----- Goblet -> boxsquat rename: in place, not split -----
  {
    const { result } = realCase("rename check", { ...real.goalProfile, injuryRecovery: true }, bootExisting);
    const migratedGoblet = result.sessions.filter((s) => s.exerciseId === "goblet");
    const migratedBoxsquat = result.sessions.filter((s) => s.exerciseId === "boxsquat");
    ok("total session count is unchanged by the rename (168 in, 168 out)", result.sessions.length === real.sessions.length);
    ok("zero sessions remain tagged goblet after migration", migratedGoblet.length === 0);
    ok("exactly the 8 original goblet sessions are now tagged boxsquat", migratedBoxsquat.length === 8);

    // Same ids, same sets, ONLY exerciseId changed — proves rename-in-place,
    // not "old rows kept under goblet, new rows added under boxsquat".
    const origById = new Map(realGoblet.map((s) => [s.id, s]));
    migratedBoxsquat.forEach((s) => {
      const orig = origById.get(s.id);
      ok(`renamed session ${s.id} matches its pre-rename row except for exerciseId`, orig && JSON.stringify(orig.sets) === JSON.stringify(s.sets) && orig.date === s.date);
    });

    ok("gobletBoxSquatMigration recorded, unresolved, defaulted to boxsquat", result.gobletBoxSquatMigration && result.gobletBoxSquatMigration.resolved === false && result.gobletBoxSquatMigration.defaultedTo === "boxsquat");

    // The actual continuity check: the per-week e1RM/tonnage series is
    // IDENTICAL under the new id to what it was under the old one. If the
    // rename had split history (e.g. only renaming sessions after some
    // cutoff, or leaving duplicates under both ids), this would diverge.
    const postRenameSeries = app.weeklySeries(result.sessions, "boxsquat");
    check("weeklySeries under the new id is identical to the pre-rename series under the old id — no split at the rename boundary", postRenameSeries, preRenameSeries);

    // And the old id now has no history left to fragment against.
    const postRenameOldIdSeries = app.weeklySeries(result.sessions, "goblet");
    ok("no residual history left under the old id post-rename", postRenameOldIdSeries.length === 0);
  }
}

if (failures > 0) {
  console.error(`\nBACKUP-IMPORT MIGRATION CHECK FAILED: ${failures}/${checks} assertions failed.`);
  process.exit(1);
}
console.log(`Backup-import migration check passed: ${checks} assertions — boot and import paths share migrateInjuryAndGobletData and agree exactly (true/false/absent goalProfile cases), the goblet->boxsquat rename is in-place with an identical pre/post weeklySeries (no split), and an already-resolved local goblet decision survives a re-import. Real-data cases run against the actual Sept 6 backup when present.`);
