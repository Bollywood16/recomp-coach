#!/usr/bin/env node
/* Structural backstop for Task 0's write-isolation guarantee (spec
 * correction C). This app has no module system — everything lives in one
 * top-level <script type="text/babel"> block — so "the parser cannot write
 * injuryProfile" cannot be enforced by imports/exports. InjuryProfileCard's
 * closure design (its `save` is never assigned to a module-scope binding) is
 * the real guarantee; this script does not depend on that design being
 * followed correctly by every future edit. It asserts, textually:
 *
 *   1. No module-scope (top-level) binding with a setter-ish name for
 *      injuryProfile exists anywhere outside a function body.
 *   2. extractPlanJson and applyCoachGates — the actual parser/gate path a
 *      pasted plan runs through today — never reference `injuryProfile` as
 *      a write target.
 *
 * Run: node scripts/check-write-isolation.js  (also wired to `npm test`)
 * Exits non-zero and prints the violation(s) on failure.
 */

const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(file, "utf8");
const match = html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/);
if (!match) {
  console.error("FAIL: could not locate the app's <script type=\"text/babel\"> block.");
  process.exit(1);
}
const src = match[1];

function extractFunctionBody(name) {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (depth > 0 && i < src.length) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    i++;
  }
  return src.slice(start, i - 1);
}

// Blank out the contents of every {...} block so what's left is only true
// top-level (module-scope) source — a crude but effective stand-in for a
// real AST when checking "does no top-level binding exist".
function stripBlocks(text) {
  let depth = 0;
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") { out.push(depth === 0 ? "{" : " "); depth++; continue; }
    if (ch === "}") { depth--; out.push(depth === 0 ? "}" : " "); continue; }
    out.push(depth === 0 ? ch : (ch === "\n" ? "\n" : " "));
  }
  return out.join("");
}

const failures = [];

// 1. No top-level setter-like binding for injuryProfile.
const topLevel = stripBlocks(src);
const setterRe = /^\s*(const|let|var|function)\s+(set|write|mutate|update)InjuryProfile\b/im;
if (setterRe.test(topLevel)) {
  failures.push("A module-scope setter-like binding for injuryProfile exists outside InjuryProfileCard's closure.");
}

// 2. extractPlanJson and applyCoachGates never write injuryProfile: neither as
// an object-literal key (e.g. building a payload for persist/setData) nor as
// a property mutation (e.g. injuryProfile.recoveringMode = ...). Reassigning
// the local `injuryProfile` binding itself (e.g. `injuryProfile =
// deepFreeze(injuryProfile || DEFAULT_INJURY_PROFILE)`) is fine — that's a
// local variable, not the stored record, and is exactly this file's own
// runtime-freeze backstop.
["extractPlanJson", "applyCoachGates"].forEach((name) => {
  const body = extractFunctionBody(name);
  if (body === null) {
    failures.push(`Could not locate function ${name} to check — has it been renamed?`);
    return;
  }
  if (/injuryProfile\s*:/.test(body) || /injuryProfile\.\w+\s*=(?!=)/.test(body)) {
    failures.push(`${name} references injuryProfile as a write target — the parser/gate path must be read-only.`);
  }
});

if (failures.length) {
  console.error("WRITE-ISOLATION CHECK FAILED:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
console.log("Write-isolation check passed: no module-scope injuryProfile setter, and the parser/gate path never writes injuryProfile.");
