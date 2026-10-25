#!/usr/bin/env node
/* coach-apply-overhaul P3-12: corpus retrieval (FIX_SPEC.md item 12).
 *   1. A brief that invites prescriptions includes EVERY corpus entry
 *      tagged order / volume / rest, plus the top phase entry — in the
 *      check-in tier (the full tier already sends the whole corpus).
 *   2. Tags with no corpus entry (order, today) are named in the brief so
 *      the model doesn't assert research it doesn't have.
 *   3. Proposed research notes stay proposals: docs/proposed-research-
 *      notes.md exists, and none of its proposed ids/topics are in
 *      RESEARCH_CORPUS or any brief.
 *
 * Run: node scripts/check-corpus-retrieval.js (wired into `npm test`).
 */
const fs = require("fs");
const path = require("path");
const { loadApp } = require("./lib/load-app.js");

const app = loadApp([
  "RESEARCH_CORPUS", "researchForPrescriptions", "researchForCheckIn", "buildCoachBrief",
  "PRESCRIPTION_RESEARCH_TAGS", "uncoveredPrescriptionTags",
]);

let failures = 0, checks = 0;
function ok(label, cond, detail) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}${detail ? `\n  ${detail}` : ""}`); }
}
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "synthetic-backup.json"), "utf8")).data;
const tagged = app.RESEARCH_CORPUS.filter((r) => (r.tags || []).some((t) => ["order", "volume", "rest"].includes(t)));

ok("corpus has volume and rest entries tagged", tagged.some((r) => r.tags.includes("volume")) && tagged.some((r) => r.tags.includes("rest")),
  tagged.map((r) => `${r.id}:${r.tags}`).join(" "));
ok("tagged set is r05, r06, r07, r19 (volume) and r23 (rest)", tagged.map((r) => r.id).sort().join() === "r05,r06,r07,r19,r23");

const picked = app.researchForPrescriptions(data);
ok("prescription retrieval includes every order/volume/rest entry", tagged.every((r) => picked.includes(r)));
ok("...and the top phase entry first", picked[0] === app.researchForCheckIn(data)[0]);
ok("...with no duplicates", new Set(picked.map((r) => r.id)).size === picked.length);

const brief = app.buildCoachBrief(data, { text: "arms" }, "checkin");
ok("check-in brief carries every tagged finding", tagged.every((r) => brief.includes(r.finding)));
ok("check-in brief says what the research slice is", brief.includes("plus every entry tagged order/volume/rest"));
ok("'order' has no corpus entry today -> the brief says so", app.uncoveredPrescriptionTags().join() === "order" && brief.includes("The corpus has NO entry on: order"));

const full = app.buildCoachBrief(data, { text: "arms" }, "full");
ok("full tier still sends the whole corpus", app.RESEARCH_CORPUS.every((r) => full.includes(r.finding)));

/* Proposals stay proposals. */
{
  const doc = path.join(__dirname, "..", "docs", "proposed-research-notes.md");
  ok("docs/proposed-research-notes.md exists", fs.existsSync(doc));
  const text = fs.existsSync(doc) ? fs.readFileSync(doc, "utf8") : "";
  ok("it says it is not ingested", /NOT in the corpus/.test(text) && /never auto-ingested/.test(text));
  const proposedIds = [...text.matchAll(/\{ id:"(r\d+)"/g)].map((m) => m[1]);
  const proposedTopics = [...text.matchAll(/topic:"([a-z_]+)"/g)].map((m) => m[1]);
  ok("two proposals present (exercise order, energy balance)", proposedTopics.join() === "exercise_order,energy_balance_hypertrophy", proposedTopics.join());
  ok("no proposed id is in RESEARCH_CORPUS", proposedIds.every((id) => !app.RESEARCH_CORPUS.some((r) => r.id === id)));
  ok("no proposed topic is in RESEARCH_CORPUS", proposedTopics.every((t) => !app.RESEARCH_CORPUS.some((r) => r.topic === t)));
  ok("no brief mentions the proposed sources (Simão, Murphy & Koehler)", ![brief, full].some((b) => /Simão|Murphy & Koehler/.test(b)));
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  ok("the app never reads the proposals file", !html.includes("proposed-research-notes"));
}

if (failures) {
  console.error(`\n${failures} of ${checks} assertions FAILED (check-corpus-retrieval.js)`);
  process.exit(1);
}
console.log(`check-corpus-retrieval.js: ${checks} assertions passed — prescription briefs carry every order/volume/rest entry plus the phase entry, uncovered tags are named, proposals stay out of the corpus and briefs.`);
