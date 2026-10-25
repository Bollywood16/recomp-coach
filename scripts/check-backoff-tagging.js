#!/usr/bin/env node
/* coach-apply-overhaul P2-10: back-off tagging (FIX_SPEC.md item 10).
 * A mid-exercise load drop (30, 30, 25, 25) is offered for tagging as
 * back-off / drop; "just fatigue" leaves it untagged and readable as
 * fatigue. Never tagged automatically.
 *   1. untaggedLoadDrops finds exactly the lighter untagged sets.
 *   2. Already-tagged sets, rising loads, and equal loads aren't flagged.
 *   3. Tagging changes only the dropped sets' segment.
 *   4. Consequence: a tagged back-off set no longer counts as an
 *      under-range "too heavy" signal; untagged it still does.
 *   5. UI wiring (source): both save paths ask before saving; the history
 *      list asks once (dropTagAnswered) and "just fatigue" changes no set.
 *
 * Run: node scripts/check-backoff-tagging.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp(["untaggedLoadDrops", "tagSetsAs", "recommend", "EX_BY_ID"]);

let failures = 0, checks = 0;
function ok(label, cond, detail) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${detail ? `\n  ${detail}` : ""}`); }
}
const S = (...pairs) => pairs.map(([w, r, segment]) => ({ w, r, ...(segment ? { segment } : {}) }));

/* 1-2. Detection. */
ok("30,30,25,25 -> sets 3 and 4", JSON.stringify(app.untaggedLoadDrops(S([30, 10], [30, 9], [25, 10], [25, 9]))) === "[2,3]");
ok("rising/equal loads -> nothing", app.untaggedLoadDrops(S([25, 10], [30, 8], [30, 7])).length === 0);
ok("already tagged back-off -> nothing", app.untaggedLoadDrops(S([30, 8], [25, 10, "backoff"], [25, 9, "backoff"])).length === 0);
ok("'top' segment counts as untagged", JSON.stringify(app.untaggedLoadDrops(S([30, 8, "top"], [25, 10, "top"]))) === "[1]");
ok("a drop below a later peak is measured against the running peak", JSON.stringify(app.untaggedLoadDrops(S([25, 10], [35, 6], [30, 8]))) === "[2]");
ok("bodyweight row with w 0 is ignored", app.untaggedLoadDrops(S([0, 10], [0, 8])).length === 0);

/* 3. Tagging is targeted. */
{
  const sets = S([30, 10], [30, 9], [25, 10], [25, 9]);
  const tagged = app.tagSetsAs(sets, [2, 3], "backoff");
  ok("only sets 3-4 become back-off", tagged.map((s) => s.segment || "-").join() === "-,-,backoff,backoff");
  ok("loads and reps untouched", JSON.stringify(tagged.map((s) => [s.w, s.r])) === JSON.stringify(sets.map((s) => [s.w, s.r])));
}

/* 4. Why it matters: progression reads tagged back-offs differently. */
{
  const ex = { ...app.EX_BY_ID.curl, repMin: 10, repMax: 15 };
  const mk = (sets) => [{ id: 1, date: "2026-09-01", exerciseId: "curl", sets }];
  const untagged = app.recommend(ex, mk(S([30, 12], [30, 11], [25, 7], [25, 6])), false);
  const tagged = app.recommend(ex, mk(S([30, 12], [30, 11], [25, 7, "backoff"], [25, 6, "backoff"])), false);
  console.log(`recommend: untagged drop -> ${untagged.tag} ${untagged.weight}; tagged back-off -> ${tagged.tag} ${tagged.weight}`);
  ok("untagged lighter under-range sets still read as fatigue/too heavy (not 'Add weight')", untagged.tag !== "Add weight");
  ok("tagged back-off sets are not read as a failing top load (recommendation differs)", tagged.tag !== untagged.tag || tagged.weight !== untagged.weight,
    JSON.stringify({ untagged, tagged }));
}

/* 5. UI wiring. */
{
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const card = html.slice(html.indexOf("function ExerciseCard("), html.indexOf("function ExerciseCard(") + 9000);
  const log = html.slice(html.indexOf("function Log("), html.indexOf("function Progress("));
  ok("workout card asks before saving when there's an untagged drop", /untaggedLoadDrops\(clean\)[\s\S]{0,120}setDropPrompt\(\{ clean, drops \}\); return;/.test(card));
  ok("Log form asks before saving too", /untaggedLoadDrops\(clean\)[\s\S]{0,120}setDropPrompt\(\{ clean, drops \}\); return;/.test(log));
  ok("history list offers it only until answered", /!s\.dropTagAnswered && untaggedLoadDrops\(s\.sets\)\.length > 0/.test(log));
  ok("'just fatigue' in history keeps the sets as they were", /sets: seg \? tagSetsAs\(s\.sets, drops, seg\) : s\.sets, dropTagAnswered: true/.test(log));
}

if (failures) {
  console.error(`\n${failures} of ${checks} assertions FAILED (check-backoff-tagging.js)`);
  process.exit(1);
}
console.log(`check-backoff-tagging.js: ${checks} assertions passed — untagged mid-exercise load drops detected and offered for back-off/drop tagging on save and in history; "just fatigue" leaves them untagged.`);
