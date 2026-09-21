#!/usr/bin/env node
/* Orchestrates every scripts/check-*.js file `npm test` runs, in the same
 * order package.json used to chain them with `&&`, and prints a TOTAL line
 * summed fresh from each script's own output every run.
 *
 * Why this exists (Section 9's pre-ship audit, BUILD-LOG.md): this log had
 * been hand-tracking a running "N prior + M new = total" total in prose,
 * section by section. It drifted — several scripts gained assertions in a
 * LATER section than the one that first banked a cumulative total against
 * them, and nothing ever re-summed the true total against that drift. A
 * number a human has to keep adding up by hand is exactly the kind of thing
 * that silently goes stale; this computes it mechanically, from the actual
 * output of the actual run, every time.
 *
 * Each check script must print a line containing "<N> assertions" on
 * success (every scripts/check-*.js file already does — including
 * check-write-isolation.js, which prints a real non-hardcoded count of its
 * own discrete checks rather than the plain summary it used to). A script
 * whose output doesn't match that pattern fails this orchestrator loudly
 * instead of silently being excluded from the total the way the old
 * hand-tracked number silently excluded write-isolation for however long —
 * the whole point is that a script can no longer drop out of the count
 * without someone noticing.
 *
 * Run: node scripts/run-tests.js (wired as `npm test`).
 */
const { spawnSync } = require("child_process");
const path = require("path");

// Same order package.json's old `&&` chain used.
const SCRIPTS = [
  "check-write-isolation.js",
  "check-day-resolution.js",
  "check-session-rules.js",
  "check-prescription-reconciliation.js",
  "check-pool-splitting.js",
  "check-set-schemes.js",
  "check-set-scheme-migration.js",
  "check-set-scheme-logger.js",
  "check-trim-priority.js",
  "check-backup-import-migration.js",
  "check-injury-swap-warnings.js",
  "check-authored-days.js",
  "check-authored-day-gates.js",
  "check-plan-versioning.js",
  "check-deferred-tests-4-7-8-9.js",
  "check-pain-pattern-migration.js",
  "check-day-ordering.js",
  "check-coach-brief-contract.js",
];

const ASSERTION_RE = /(\d+)\s+assertions/;

let total = 0;
let ran = 0;

for (const script of SCRIPTS) {
  const file = path.join(__dirname, script);
  const result = spawnSync("node", [file], { encoding: "utf8" });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    console.error(`\nrun-tests.js: ${script} exited ${result.status} — stopping (matches the old && chain's fail-fast behavior).`);
    process.exit(result.status || 1);
  }

  const m = ASSERTION_RE.exec(result.stdout);
  if (!m) {
    console.error(`\nrun-tests.js: ${script} passed but printed no "<N> assertions" line — it can't be counted toward the total. Every scripts/check-*.js file must print one on success (see check-write-isolation.js for a script with no natural per-item counter doing this correctly). Fix the script's output before this can go green.`);
    process.exit(1);
  }
  total += Number(m[1]);
  ran++;
}

console.log(`\nTOTAL: ${total} assertions across ${ran}/${SCRIPTS.length} scripts, all passing.`);
