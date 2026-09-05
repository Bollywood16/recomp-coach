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
 *   2. extractPlanJson (the parser's entry point, checked unconditionally
 *      even though it doesn't take injuryProfile as a parameter) and every
 *      function discovered to take `injuryProfile` as a named parameter
 *      never reference it as a write target.
 *   3. That discovered set is compared against REVIEWED_READERS below. A
 *      function found here that ISN'T in that list fails the check — Task 4
 *      adds runGates and eight gate functions, Task 6 adds more, and a
 *      hardcoded two-function check would go stale on exactly the commit
 *      that makes it matter. Adding a new reader is a deliberate,
 *      reviewed-and-added-here decision, not something that silently starts
 *      passing.
 *
 * Convention this relies on: any function that consumes injuryProfile must
 * take it as an explicitly named parameter (destructure it out of a context
 * object if needed) rather than burying it in an opaque unnamed blob — that's
 * what makes it visible to this scan. Keep that convention in Task 4/6.
 *
 * Run: node scripts/check-write-isolation.js  (also wired to `npm test`)
 * Exits non-zero and prints the violation(s) on failure.
 */

const fs = require("fs");
const path = require("path");

// Functions intentionally reviewed and confirmed to only READ injuryProfile.
// InjuryProfileCard.save() is the one legitimate writer, but it's a closure
// method on a component, not a top-level function taking injuryProfile as a
// parameter — it isn't discovered by this scan, and that's correct: it never
// appears here because it never takes injuryProfile as an input, it takes
// `next` (the new record) and constructs the write from data/props directly.
const REVIEWED_READERS = [
  "isSpecializationUnlocked",
  "findAllPendingPainRetros",
  "painReportingGaps",
  "applyCoachGates",
  "askCoachLLM",
  "unknownInjuryIds",
  "gate2Injury",
  "gate4PainRule",
];

// Always checked regardless of its parameter list — the actual parser entry
// point a pasted plan's text runs through first.
const ALWAYS_CHECK = ["extractPlanJson"];

const file = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(file, "utf8");
const match = html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/);
if (!match) {
  console.error("FAIL: could not locate the app's <script type=\"text/babel\"> block.");
  process.exit(1);
}
const src = match[1];

function extractFunctionBody(name) {
  const re = new RegExp(`function\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`);
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
  return { params: m[1], body: src.slice(start, i - 1) };
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

function writesInjuryProfile(body) {
  // Object-literal key (building a payload for persist/setData) or a property
  // mutation (injuryProfile.recoveringMode = ...). Reassigning the local
  // `injuryProfile` binding itself — e.g. `injuryProfile =
  // deepFreeze(injuryProfile || DEFAULT_INJURY_PROFILE)` — is fine: that's a
  // local variable, not the stored record, and is the runtime-freeze backstop.
  return /injuryProfile\s*:/.test(body) || /injuryProfile\.\w+\s*=(?!=)/.test(body);
}

const failures = [];

// 1. No top-level setter-like binding for injuryProfile.
const topLevel = stripBlocks(src);
const setterRe = /^\s*(const|let|var|function)\s+(set|write|mutate|update)InjuryProfile\b/im;
if (setterRe.test(topLevel)) {
  failures.push("A module-scope setter-like binding for injuryProfile exists outside InjuryProfileCard's closure.");
}

// 2. Discover every top-level function taking injuryProfile as a named
// parameter (present in its raw parameter-list text, word-boundaried so
// `injuryProfileHistory` etc. don't false-match).
const discovered = new Set();
const funcDeclRe = /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*\{/g;
let fm;
while ((fm = funcDeclRe.exec(src))) {
  const [, name, params] = fm;
  if (/\binjuryProfile\b/.test(params)) discovered.add(name);
}

// 3. Every discovered function must be in the reviewed allowlist — an
// undiscovered-but-present name fails loudly instead of silently passing.
discovered.forEach((name) => {
  if (!REVIEWED_READERS.includes(name)) {
    failures.push(`${name} takes injuryProfile as a parameter but isn't in REVIEWED_READERS — review it (confirm it's read-only) and add it explicitly, or fix it if it writes.`);
  }
});
REVIEWED_READERS.forEach((name) => {
  if (!discovered.has(name)) {
    console.warn(`NOTE: ${name} is in REVIEWED_READERS but no longer takes injuryProfile as a parameter (renamed/removed?) — safe to prune from the list.`);
  }
});

// 4. Every discovered-and-reviewed function, plus the always-checked parser
// entry point, must never write injuryProfile.
[...ALWAYS_CHECK, ...discovered].forEach((name) => {
  const fn = extractFunctionBody(name);
  if (fn === null) {
    failures.push(`Could not locate function ${name} to check — has it been renamed?`);
    return;
  }
  if (writesInjuryProfile(fn.body)) {
    failures.push(`${name} references injuryProfile as a write target — the parser/gate path must be read-only.`);
  }
});

// 5. applyCoachGates spreads `rec` — arbitrary parsed JSON from a pasted
// LLM reply — into `gated`. That blind spread would otherwise carry
// through a key named injuryProfile if one were present in the parsed
// JSON; nothing downstream happening to not read it back out is an
// accident of the current persist() call shapes, not a guarantee. Assert
// the explicit scrub is still there rather than trusting that accident to
// hold forever.
{
  const fn = extractFunctionBody("applyCoachGates");
  if (fn && !/delete\s+gated\.injuryProfile/.test(fn.body)) {
    failures.push("applyCoachGates no longer scrubs gated.injuryProfile after spreading `rec` — a pasted plan's parsed JSON could carry an injuryProfile key straight through if a future persist() call ever spreads ...gated directly.");
  }
}

if (failures.length) {
  console.error("WRITE-ISOLATION CHECK FAILED:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
console.log(`Write-isolation check passed: no module-scope injuryProfile setter; ${ALWAYS_CHECK.length} always-checked + ${discovered.size} discovered reader(s) (${[...discovered].join(", ")}) never write injuryProfile.`);
