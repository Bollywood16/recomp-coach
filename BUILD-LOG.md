# Build log — Task 6/7 + pre-decisions (continuous run, 2026-09-20)

Started after Fix 3 (commit `75666b1`). Continuous mode: one commit per
numbered section, BUILD-LOG updated as I go, no pause for review except the
listed hard stops. This file is the run's own record — read top to bottom
for what happened, in order.

---

## Pre-flight investigation (before Section 1)

**Pre-decision 2 check — is authored-day persistence trivial after Task 2's
consolidation?** Yes, mostly. `resolveDayExercises(day, data)` (index.html)
is the single place every render path (DayPage, weeklySetsByGroup,
dayFittedMinutes, dayFocusSummary, DayPicker.lastDone) already goes through.
Plan: add one early branch — if `data.plan.days` has an entry keyed by
`day.id`, build the list from THAT entry's `exercises` instead of
generator+swaps+bonus+prescriptions, then let the rest of the function
(hardSetsFor normalization, capAndSplitMovement) run unchanged over
whichever list was built. Five callers stay agreeing by construction, same
as Task 2's whole premise — no new fan-out.

**Reuse decision — user swaps on authored days.** Route an authored
exercise entry through the EXISTING `resolveSlot(pseudoSlot, data.swaps,
null)` — passing `focus: null` skips resolveSlot's emphasis-rescaling
branch entirely (`base.sets = focus ? adjustSets(...) : baseSets`), so an
authored `sets` count is taken literally, while the swap-lookup and
`originalName`/`swapped` bookkeeping are inherited for free, zero fork.
`pseudoSlot = { ...EX_BY_ID[ae.exerciseId], id: ae.exerciseId, sets:
ae.sets, repMin: ae.repMin ?? base.repMin, repMax: ae.repMax ??
base.repMax }` — spreading the REAL EX_BY_ID entry (not a bare slot literal)
so pool/rank/attributes/tagSource all carry through for
capAndSplitMovement, the swap picker's `alternates` filter, and Gate 2.

**`substitutedFor` is NOT a live resolution mechanism.** `ae.exerciseId` IS
already the (possibly Claude-substituted) exercise; `ae.substitutedFor` is
a static audit/display field only — carried onto the resolved `ex` object,
rendered in the detail view, never validated against EX_BY_ID (it's
allowed to be an id that no longer exists, or free text — Gate 9 governs
`exerciseId`, not this field, since it's audit trail, not something the
render path resolves through).

**`splitPattern`**: spec shows it in the example payload but defines no
enforcement logic anywhere in the Requirements or Gates lists. Scoping it
as a stored-but-not-gated informational field on `data.plan.splitPattern`
— PROGRAMS' fixed day structure remains the actual source of truth for
which days exist; this is decorative context the model can echo back
about what split it authored, not itself enforced. Logged here so it isn't
later mistaken for load-bearing.

**Partial-application granularity.** Spec: "If one day fails validation,
apply the others." Reading this as PER-DAY, not per-exercise-within-a-day:
gates 10-13 are day-level self-consistency checks (duration,
weeklyGroupSets, specialize coverage, maintain floor) that only mean
anything evaluated against a day's FULL exercise list. If any exercise in
an authored day fails Gate 9 (unknown id, fails gates 1-8, or missing
`rationale`), or the day itself fails gates 10-13, the WHOLE DAY is
rejected — not applied — and that dayKey is simply absent from the
persisted `data.plan.days`, so `resolveDayExercises` finds no override and
falls through to the tested generator path for that day. Falls back to a
known-safe mechanism, not to nothing.

**Rejected-exercise-entry granularity within Gate 9.** A missing/empty
`rationale` string on any exercise entry fails that entry's Gate 9 check
— per the spec's own "Rationale required... an unexplained prescription is
one you cannot audit," a missing rationale is itself invalid input, same
severity as an unknown id.

**Gate 13's real mechanism — reusing one predicate for two call sites.**
DEFERRED-TESTS.md row 9 and the user's pre-decision 3 are about the
GENERATOR's existing `fitDayToTime` trim (real Lower-day data), not only
an authored-`days[]` scenario — so the fix has to land in the shared trim
algorithm itself, with the new Task-6 Gate 13 as a second consumer of the
same idea, not a bolt-on that only covers authored plans.

Re-reading `fitDayToTime`'s existing two-phase design closely: phase 1
(ordinary set-trimming) already correctly prioritizes cutting a
maintain-tier movement's SETS before a higher tier's — that part is
correct, already shipped (Fix 1), not being changed. The actual gap is
phase 2 (the "drop an entire movement" fallback, reached once literally
everything is already at its bare per-exercise floor): it sorts drop
candidates by the SAME ascending-tier order as phase 1
(`emphasisRank(a,focus) - emphasisRank(b,focus)`), which means a
maintain-tier movement is also the FIRST one considered for total removal
— eliminating the movement pattern outright, not just trimming its sets.
DEFERRED-TESTS.md's own words settle which direction this should go:
"maintain still gets none [floor] beyond the pre-existing per-exercise
minimum — deliberately... 'maintain yields first,' Gate 13's job to
change." Gate 13 is explicitly scoped to CHANGE this one behavior, not
extend it: maintain should yield sets first (unchanged), but be the LAST
thing eliminated outright, once normal/emphasize/specialize have no
non-compound movement left to sacrifice first. New `dropTierRank` remaps
maintain (rank 0) to last-in-line (above specialize) for the drop-entirely
sort only — set-trimming's `trimPriority`/`emphasisRank` sort is
untouched. Real, deliberate behavior change to the existing Fix-1 stress
test's outcome, tracked in Section 2's commit — see that section for the
before/after numbers.

---

## Section 1 — Task 6 schema and persistence (commit pending)

Implemented exactly the pre-flight plan above:

- `resolveAuthoredExercise(ae, data)` — resolves one `data.plan.days[]`
  exercise entry via `resolveSlot(pseudoSlot, data.swaps, null)`, where
  `pseudoSlot` spreads the real `EX_BY_ID[ae.exerciseId]` entry with
  `sets`/`repMin`/`repMax` overridden from the authored fields.
  `focus: null` skips emphasis rescaling deliberately. Layers
  `restSec`/`prescribedLoad`(from `ae.load`)/`scheme`/`order`/`rationale`/
  `substitutedFor`/`authored:true` on top of resolveSlot's result.
- `resolveDayExercises` now checks `data.plan.days` for a `dayKey` match
  FIRST. If found: build the list from the authored entry (sorted by
  `order`), run it through the SAME `hardSetsFor` normalization +
  `capAndSplitMovement` the generator path uses, return. Generator +
  swaps + bonus + prescriptions logic is entirely skipped for that day —
  confirmed a prescription targeting an authored dayKey has no effect
  (test #5).
- Deliberately did NOT touch `KNOWN_PLAN_KEYS` or `applyCoachGates` in
  this section — `days`/`splitPattern` are not yet reachable from a live
  paste. That wiring lands in Section 2, together with the gates that
  make accepting it safe, in the same commit. A plan without `days`
  behaves exactly as before (test #1, byte-identical, real generator
  output compared before/after).

`scripts/check-authored-days.js`: 19 assertions, real-data case included
(an authored day built on the real backup's injuryProfile/swaps, confirms
no crash and the unrelated legpress->goblet swap doesn't leak into an
authored day). Deliberately broke the `authoredDay` lookup (forced to
`null`) — 13 of 19 assertions failed immediately, covering every claim
this section makes. Restored, diff-clean confirmed via `git diff | grep -c
DELIBERATELY`.

`npm test`: 315 assertions total (296 prior + 19 new), all passing.

---

## Section 2 — Gates 9-13 (commit pending)

**Generator-side fix landed here too, not just the new gates** (see the
pre-flight note above for the reasoning): `dropTierRank` remaps
maintain (rank 0) to LAST place for fitDayToTime's and
gate7DurationTrim's "drop an entire movement" fallback only — ordinary
set-trimming (trimPriority/emphasisRank) is untouched, maintain still
yields sets first. Applied identically to both functions (they're
asserted to agree in check-trim-priority.js). Real-data check: at the
user's actual sessionMin (60), the real Lower day trims/drops nothing at
all — dropTierRank never even activates outside the synthetic
extreme-budget stress test, so there is no regression against the
signed-off Fix 1 Delts & Arms result (re-verified, still passes
unchanged) or any real-world session. The ONE test assertion this
flips (`check-trim-priority.js`'s maintain-floor stress case) is the
literal, expected case DEFERRED-TESTS.md named as "Gate 13's job to
change" — updated with the real recomputed survivor list (legcurl
survives; kneeraise, hip thrust, and calf raise all end up dropped under
this specific 20-minute forced-budget synthetic scenario, in that
order), not guessed.

**Gates 9-13**, all added after `buildGateContext` (which now also
exposes `ctx.program`/`ctx.data` for the day-vs-template comparisons
gates 12/13 need):

- Gate 9 (`gate9AuthoredExercise`) reuses `gate1UnknownId`,
  `gate1bCheckinScope`, `gate1eSchemeConsistency`, `gate2Injury`,
  `gate3LoadSanity`, `gate4PainRule`, `gate5PainEscalation`,
  `clampSchemeToTopLoad` verbatim — same functions
  `runPrescriptionGates` calls. Skips gate1d (ambiguous match — doesn't
  apply to a day authored from scratch; a within-day duplicate
  exerciseId is checked once, day-level, in `applyAuthoredDays`
  instead) and gate1c (day-level, checked once per day not per
  exercise). Adds a `rationale`-required check per the spec's own text.
- Gate 10 (`gate10Duration`): recomputed via the new shared
  `estimateDurationSec` (also now used by `fitDayToTime` — was
  duplicated 3 ways before this, now 2: `gate7DurationTrim` kept its own
  inline copy deliberately, lower blast radius on its own
  extensively-tested behavior).
- Gate 11 (`gate11WeeklyGroupSets`): self-reported check, plus a
  subtract-old-add-new cap check identical in shape to the existing
  Gate 6 (prescriptions) mechanism — `oldContribution` computed via
  `resolveDayExercises` against `ctx.data` (pre-this-plan state).
- Gate 12 (`gate12SpecializeCoverage`) / Gate 13
  (`gate13MaintainFloor`): both compare the authored day against its
  OWN template's base day (`ctx.program.find(d => d.id ===
  dayEntry.dayKey)`) — a day is only held to a group's presence if that
  day's own template role already trained it. Gate 13 checks by `pool`
  equivalence (same mechanism the swap picker and pool-splitting already
  use), not exact exerciseId match, so an authored substitution within
  the same pool passes.
- `applyAuthoredDays` (batch entry point, analogue of
  `applyGatedPrescriptions`): checkin-tier scope rejects `days`
  wholesale before Gate 9 even runs (day authorship is a full-tier
  feature). Day-level partial application — one bad exercise or one
  failed day-gate drops the WHOLE day, others in the batch are
  unaffected.

**Wiring**: `days`/`splitPattern` added to `KNOWN_PLAN_KEYS` in this
SAME commit (not Section 1's), together with `applyAuthoredDays` being
called from `applyCoachGates`. Still NOT persisted by `applyPasted` —
`gated.days`/`gated.dayRejections` are computed but inert until Section
3 adds the diff-and-confirm flow that makes storing them reachable from
a live paste.

`scripts/check-authored-day-gates.js`: 28 assertions, including a
structural check (`gate2Injury(` occurs exactly 7 times in index.html —
1 definition + 6 callers, Gate 9 is the 7th, no fork) and two real-data
cases (a plausible authored Delts & Arms day passes end to end; the same
shape with the real contraindicated exercise, goblet, is rejected).
Deliberately broke three invariants at once (the rationale check, Gate
13's maintain-pool check, Gate 11's subtract-old-add-new arithmetic) —
2 of 3 were caught immediately by existing assertions; the third
(cap arithmetic) slipped past the original test design, so I added a
dedicated assertion isolating that exact mechanic (a tight cap against a
group trained by TWO days, so "this day's own total" and "the true
adjusted weekly total" diverge) before re-breaking and confirming it now
catches it too. Restored, diff-clean confirmed.

`npm test`: 343 assertions total (315 prior + 28 new), all passing.

---

## Section 3 — Plan versioning, diff, revert (commit pending)

**Design decisions, logged (none of these were spec-exact, all had to be
made):**
- `days` merges **per-dayKey** into `data.plan.days`, not wholesale-
  replace like `prescriptions`. An earlier paste's authored day for a
  dayKey THIS paste doesn't mention stays in effect — same
  "loud-on-change, silent-on-omission" principle `mergeSessionRules`
  already uses. Wholesale-replace felt too easy to accidentally regress
  an unrelated day back to the generator with an unrelated small paste.
- The diff-and-confirm surface triggers on the RAW paste attempting day
  authorship (`Array.isArray(raw.days) && raw.days.length`), not on
  `gated.days` surviving gating. A plan where every day gets rejected by
  gates 9-13 still needs to show the user why — falling through to the
  immediate-apply path with rejections unseen would defeat "never
  auto-apply an authored plan" in spirit even though technically no
  `days` content would have been written.
- Every applied plan (days-bearing or the legacy four-field/prescriptions
  shape alike) gets a `planVersions` entry — not just authored ones. The
  spec's versioning language sits under Task 6 but reads as a general
  requirement ("every applied plan stored as a versioned record"), and
  scoping revert to only-ever-authored plans would make it far less
  useful in practice.
- A revert pushes a NEW version entry (`source: "revert"`,
  `revertedFrom: <id>`) rather than mutating/removing history — the
  revert itself becomes part of the immutable record, not an edit to it.

**Implementation**: `diffAuthoredDay`/`diffAuthoredPlan` (pure,
side-effect-free — the confirm step would be meaningless if computing
the preview itself persisted anything) diff a day's CURRENT
`resolveDayExercises` output against the newly-gated exercise list:
added/removed by id-set difference, changed by sets/load, reordered by
position. `pushPlanVersion` is append-only, capped at 25 (same bounded-
history pattern as `injuryProfileHistory`, there at 50).
`applyPasted` now branches: a `days`-bearing paste sets `pendingPlan`
(gated result + diff) instead of persisting; a bare paste keeps the
exact pre-Task-6 immediate-apply behavior. `confirmPendingPlan` is the
only path that ever writes `data.plan.days`. New UI:
`PendingPlanDiff` (the review/confirm/discard card) and `PlanHistoryCard`
(reverse-chronological history, "Revert to this" per entry), both in
CoachCard.

`scripts/check-plan-versioning.js`: 19 assertions, including a real-data
diff case that had to be corrected mid-build — my first draft assumed
the template's bare slot list as "current," but real data has a live
user swap (reardelt→latraise) and pool-overflow spawns already present,
so I rewrote the assertions to resolve the actual current list first via
`resolveDayExercises` and diff against THAT, which is what the function
itself does. Deliberately broke `diffAuthoredDay`'s changed-detection and
`pushPlanVersion`'s 25-entry cap together — both caught immediately by
existing assertions, including the real-data one. Restored, diff-clean.

**Live browser verification** (Playwright, real backup data, full
apply→confirm→render→history→revert flow): pasted a `days`-bearing
plan, confirmed it does NOT persist until "Confirm & apply" is clicked
(the diff card renders correctly — added/changed entries visible),
confirmed persistence and `planVersions` after clicking confirm,
navigated to the Workout tab and confirmed the authored day actually
renders — including a real, correct interaction Section 1 designed for:
the authored 5-set ezcurl gets capped to 4 by `capAndSplitMovement` with
a spawned overflow movement, exactly like a generator day (my first test
assertion wrongly expected the raw 5 to survive — fixed once the capping
banner made the real, correct behavior obvious). Plan History section
renders, "Revert to this" restores the prior plan and adds a second,
`source: "revert"` version entry. Zero console errors.

`npm test`: 362 assertions total (343 prior + 19 new), all passing.

---

## Section 4 — Deferred tests 4, 7, 8, 9 (commit pending)

All four rows in DEFERRED-TESTS.md's deferred-test table that depend on
`days`/Gates 9-13 now have dedicated, explicitly-labeled coverage in
`scripts/check-deferred-tests-4-7-8-9.js`, mapped 1:1 to each row rather
than left as implicit coverage inside `check-authored-day-gates.js`'s
general gate tests (per the standing rule: an owning task isn't done
until its deferred tests pass — wanted this unambiguous).

- **Row 4** needed a real decision: no exercise in the 75-item library
  carries `DEFAULT_INJURY_PROFILE`'s own forbidden attribute
  (`loaded_deep_hip_flexion`) — same reason Task 4's original test suite
  used a synthetic fixture for this exact gap. Same approach here: a
  synthetic `movementConstraints.forbidden` naming a real exercise's
  real attribute (`elbow_flexion`, which `ezcurl` really carries) — this
  proves the FORBIDDEN-ATTRIBUTE branch of Gate 2 specifically, distinct
  from the contraindications branch already covered elsewhere in
  Section 2. "Original retained" is verified as a fact, not asserted by
  comment: `resolveDayExercises` against the day BEFORE and AFTER the
  rejected substitution attempt produces byte-identical output, because
  the day was never written to `data.plan.days` (Section 1's fallback
  mechanism does the retaining, not Gate 9 itself).
- **Row 9** covers all three lifts the spec names, not just one: hip
  thrust directly (ufLower), RDL on balanced's `lowerB` day, and goblet
  squat via the fact that it shares a `pool` with legpress (the maintain
  movement actually present on ufLower's template) — confirms Gate 13's
  pool-equivalence mechanism protects goblet squat's pool the same way
  it protects hip thrust's.

Deliberately broke the forbidden-attribute check (Gate 2's `forbiddenHit`
line) to confirm row 4's test is load-bearing, not trivially passing —
caught immediately (crashed on the now-`undefined` rejection rather than
a graceful assertion failure, but unambiguously signaled the break).
Restored, diff-clean. Rows 7/8/9 reuse gate mechanisms already
deliberately-broken-and-restored in Section 2's own test file, so no
separate break pass for those three.

DEFERRED-TESTS.md's table updated: all four rows now read **Passed**.

`npm test`: 378 assertions total (362 prior + 16 new), all passing.

---

## Section 5 — Pain pattern taxonomy (commit pending)

**Real regression caught by the full suite, not a deliberate break:**
renaming `ctx.escalatingCats` to `ctx.escalatingPatterns` (for clarity —
the field holds patterns now, not cats) broke two EXISTING test fixtures
in `check-set-schemes.js` and `check-set-scheme-migration.js` that
hand-built a `ctx` object with the old field name directly (bypassing
`buildGateContext`). `npm test` caught it immediately as a crash
(`Cannot read properties of undefined`), not a silent pass. Fixed both
fixtures to use `escalatingPatterns` with the exercise's real
`painPattern` value instead of its `cat`. Logged here because the run
instructions asked for every surprise, not just the ones in new code.

**`painPattern` is DERIVED, not hand-typed** — a genuine design choice,
logged since it's a real deviation from "tag all 75 exercises" read
literally. `inferPainPattern(ex)` computes it from each exercise's
ALREADY-tagged `attributes`/`pool` (Task 1's own tagging), applied once
across `ALL_KNOWN` at load time, same mutate-in-place pattern
`EXERCISE_ATTRS` itself uses. Rationale: a derived value can't drift out
of sync with the attributes it's derived from, and one small, reviewable
function is at least as auditable as 75 independent hand-typed judgment
calls — more so, since every one of the 75 is provably consistent with
the same rule rather than independently re-decided.

**Priority rule** (full reasoning in `inferPainPattern`'s own comment in
index.html): any exercise carrying `loaded_hip_flexion`, `hip_hinge`, or
`hip_extension` in its attributes → `hip_dominant`, checked BEFORE the
pool-based fallback, regardless of pool. This is the actual fix pre-
decision 5 asked for (merges squat + hinge + glute pools into one
pattern), and it deliberately reaches two places a naive pool-copy would
have missed:
- `kneeraise` (pool `core`) carries `loaded_hip_flexion` on its own
  terms — its own existing code comment already called this out as
  "real (bodyweight) hip flexion." Lands on `hip_dominant`, not `core`.
- `bbrow`/`meadows` (pool `hpull`) carry `hip_hinge`; `bbrow` is already
  contraindicated for `prox_hamstring_tendinosis` for exactly that
  mechanical reason, the same reason `trapdl` (hinge pool) is. Grouping
  them together means pain on either one now correctly informs the SAME
  escalation state.
- Within the `quad` pool specifically: `bss`/`sissy`/
  `bonus_walkinglunge` (loaded hip flexion, unilateral) override to
  `hip_dominant`; `legext`/`sledpush` (no hip involvement at all) stay
  `knee_dominant` — the pool alone couldn't distinguish these two real,
  different cases.
`calf`/`seatedcalf` land on `knee_dominant` as the nearest available
category — the given 11-pattern taxonomy has no dedicated ankle/calf
pattern. Flagged explicitly (in-code and here) so it isn't later mistaken
for a considered clinical judgment.

**Migration**: there is no STORED escalation state to migrate —
`isPainEscalating` has always derived "currently escalating" fresh from
session history on every call (`ctx.escalatingPatterns` is rebuilt in
`buildGateContext` every render), never persisted a flag. Swapping the
grouping key takes effect immediately, uniformly, for every historical
session the next time it runs — there's no separate migration STEP,
only a migration PROOF that the new grouping doesn't behave worse than
the old one on the same data. `scripts/check-pain-pattern-migration.js`
demonstrates this concretely: a synthetic but realistic hip-labral
session history (pain alternating between goblet squat and RDL) is
replayed through both a frozen copy of the OLD cat-based grouping logic
and the NEW painPattern-based one — old grouping never reaches the
2-of-4 trigger (split across squat/hinge cats, exactly the named gap);
new grouping correctly combines them and DOES trigger. Real-data check:
the actual backup has ZERO sessions with any pain value logged at all —
recorded as a fact (both old and new grouping trivially agree: nothing
escalates), not assumed.

Deliberately broke the hip-loading priority rule (forced it to never
fire) — 25 of 40 assertions failed immediately, covering coverage,
every named override, and the cross-cat fix demonstration itself.
Restored, diff-clean.

Not done in this section: no live-browser check of `PainEscalationNotice`
— the real backup has no pain data to trigger it, and the component's
only change is a label swap in already-tested render logic (the
underlying mechanism is exercised end-to-end at the unit level,
including gate5/gate3's actual consumption of `escalatingPatterns`).
Logged as a deliberate scope decision given the sections still ahead.

`npm test`: 418 assertions total (378 prior + 40 new), all passing.

---

## Section 6 — Day ordering (pre-decision 6) + trimPriority wiring (pre-decision 4) (commit pending)

**trimPriority (pre-decision 4)**: `emphasisRank`/`trimPriority` now take
an optional `order` array (`sessionRules.trimPriority`, e.g.
`["maintain","normal","emphasize","specialize"]`) overriding the default
`LEVEL_RANK` lookup. Threaded through every `fitDayToTime`/
`gate7DurationTrim` call site via a new single lookup helper
(`trimPriorityOf(data)` / `ctx.trimPriorityOrder`) so "did we remember to
wire it here" isn't asked 5 separate times. Real design decision, logged:
`LEVEL_TRIM_FLOOR_PCT` (specialize 75%/emphasize 65%) used to be keyed by
LEVEL NAME — changed to `LEVEL_TRIM_FLOOR_PCT_BY_RANK`, keyed by RANK
POSITION instead, so a custom order stays internally coherent with
itself: whichever level the coach names LAST (cut last) gets the 75%
floor, regardless of what that level is actually called. Keeping the
floor keyed by name would have let a custom order fight its own
protection (cut specialize first, but still reserve 75% for "specialize"
by name).

**Gate 13 stays non-customizable, deliberately**: `dropTierRank` takes NO
`order` param — it checks literal `focus[group] === "maintain"` directly
rather than deriving from any rank number, so no custom
`sessionRules.trimPriority` (even one that omits "maintain" entirely, or
reorders it) can weaken the per-movement maintain-floor safety guarantee
from Section 2. This is the direct, concrete expression of "Gate 13 is a
safety invariant, not a preference a plan can dial down."

**Day ordering (pre-decision 6)**: the generator's base exercise list
(`day.exercises` + bonus lifts) is now sorted by `trimPriority`
descending — reusing the exact same ranking function trim order uses,
per the user's own stated reasoning ("incoherent for trim order and
render order to disagree") — rather than a second, independent ordering
scheme. Stable sort (decorate-original-index, sort, undecorate — NOT
`list.indexOf` inside the comparator, which would read a partially-
reordered array mid-sort on some engines) so same-rank exercises keep
their template declaration order. Authored days (Section 1) are
unaffected — they already order by their own explicit `order` field.
`sessionRules.orderByFocus` remains unwired — out of scope for both this
section and pre-decision 4/6 as stated; flagged here so it isn't later
assumed done.

Fixed a test regression from the ordering change (not a deliberate
break): `check-day-resolution.js`'s `REFERENCE_dayPageEntries` (a frozen
reimplementation proving 4 call sites agree with each other) needed the
identical sort applied — updated it the same way its own header comment
already documented doing for Task 2 commit 4's capping change: a real,
legitimate behavior change, not something the reference should stay
frozen against.

**Real-data re-run (as pre-decision 6 explicitly asked), Delts & Arms,
upperFocus, real focus (shoulders emphasize, arms specialize)**:

```
1. EZ-Bar Curl (biceps)              4 sets
2. EZ-Bar Skullcrusher (triceps)     4 sets
3. Overhead Cable Triceps Ext.       4 sets
4. Cross-Body Hammer Curl (biceps)   1 set  (-2, trimmed)
5. Machine Shoulder Press (vpress)   4 sets
6. Cable Lateral Raise (delts)       3 sets (-1, trimmed)
7. Lateral Raise (delts, swap)       1 set  (-3, trimmed)
8. Incline DB Curl (spawned)         1 set  (-1, trimmed)
9. Overhead DB Triceps Ext. (spawned) 1 set (-1, trimmed)
```

Arms (specialize) now sequences entirely before shoulders (emphasize) —
directly fixes observed failure #3 ("Arms sequenced last, after 12
shoulder sets, despite being the specialized group"). Session still
fits the 60-minute budget exactly (8 sets trimmed, 0 dropped, same
trim total as Fix 1's own real-data result — only ORDER changed, not
which sets survive).

`scripts/check-day-ordering.js`: 13 assertions, including the real-data
re-run above and a synthetic trimPriority-customization test proving the
cut order and floor move together coherently. Deliberately broke both
the generator sort and the custom-order lookup together — 6/13
assertions failed immediately, covering both mechanisms independently.
Restored, diff-clean. Live Playwright run against the real backup file
confirms EZ-Bar Curl (arms) renders before Machine Shoulder Press
(shoulders) on the actual Workout tab, zero console errors.

`npm test`: 431 assertions total (418 prior + 13 new), all passing.

---

## Section 7 — Coach framing and evidence grounding (Task 7) (commit pending)

Interrupted by a session limit partway through; resumed in a new session to
finish verification and close the section out. The code below was written
before the interruption — this entry (and Test C) is written from that point
forward.

**Scope, per the deferred note in `TASK-5-REVIEW.txt`**: Task 5 made the
minimal, scoped brief changes its own spec text required without pulling
Task 7's framing rewrite forward. Task 7 owns that rewrite plus grounding
the model's proposals against the corpus and against `days_contract`
specifically.

**`buildCoachBrief`'s system framing rewritten**: top-line framing now reads
"You are an evidence-based strength coach and exercise scientist designing
training for a specific individual. Design complete sessions..." (was a
single generic sentence before). New requirements stated explicitly in the
framing itself, not just implied by section structure: ground every
decision in `<research_context>` and cite the specific entry when it drives
a choice; say so rather than assert where the corpus doesn't cover
something; where goal conflicts with constraints/time/research, program for
the constraint, not the preference; respect tagged attributes; leave a slot
out and explain why rather than substitute something unverifiable. Same
framing text at both tiers (checkin and full) — only the `days_contract`
detail is full-tier-only, per Section 2's checkin-scope reject for `days`.

**New `<program_days>` section, both tiers**: lists the current template's
real day ids and their exercise names. Fixes a real, pre-existing gap
unrelated to Task 7's own scope but found while wiring `days_contract` in:
`dayKey` has been required on every `prescriptions` entry since Task 2
(`gate1cDayKey`), but no valid dayKey was ever actually listed anywhere in
the brief for either tier — the model had no way to know what a real one
looked like short of guessing from context.

**New `<days_contract>` section, full tier only**: states the exact schema
Gates 9-13 check (rationale required per exercise, `estimatedMin`/
`weeklyGroupSets` recomputed with a 10% tolerance, Gate 12 specialize
coverage and Gate 13 maintain-floor named directly), states DECLINE-DON'T-
SUBSTITUTE in those words, and explicitly distinguishes a real substitution
(`substitutedFor` + a stated reason) from guessing at a near-match. Absent
entirely at checkin tier — `applyAuthoredDays` rejects `days` wholesale at
checkin scope (Section 2), so a checkin-tier brief doesn't invite a
proposal that's guaranteed to be dropped unexplained.

`scripts/check-coach-brief-contract.js`: 37 assertions — the rewritten
framing's key phrases, full-tier `days_contract` correctness (decline-
don't-substitute stated explicitly, rationale required, Gates 12/13 named,
real-substitution vs. guessing distinguished), its absence at checkin tier,
`<program_days>` listing real dayKeys at both tiers (checked against
`getProgram(data)` directly, not just tag presence), and Task 5's whole-
corpus/whole-library requirements unregressed. This is a STRUCTURAL/CONTENT
test — it verifies the brief text is correctly formed, not that a model
given that text actually behaves as instructed. That's a different claim,
checked separately below via two live negative controls against a fresh
model with no shared context (same methodology as Task 5's original
negative controls) — a model reasoning about its own instructions isn't a
clean test of whether those instructions land on an independent reader.

**Live negative control — Test B (wrong movement pattern), confirmed
pre-interruption**: a fresh agent, given only the rendered brief and asked
to author a day, was presented with a slot where the obvious library
candidate (chin-up) is the wrong movement pattern for what the slot
actually needed. It declined the slot outright rather than substitute,
explicitly citing DECLINE-DON'T-SUBSTITUTE and correctly identifying why
chin-up didn't fit. **Passed.**

**Live negative control — Test C (contraindicated obvious pick), re-run
this session**: built the actual real-data full-tier brief (via
`buildCoachBrief` against `recomp-coach-backup-2026-09-06.json`, same
construction `check-coach-brief-contract.js`'s real-data case uses) and
handed it, verbatim and as sole context, to a fresh general-purpose agent
with no access to this codebase or conversation, asked to author the
`ufLower` ("Lower") day. The trap: `goblet` (Goblet Squat) is the
strongest performance case in the whole leg pool by the numbers alone —
8 logged weeks, latest e1RM 91, +18.2% trend, not stalled — genuinely the
statistically obvious pick. Its own display name even reads "Goblet Squat
(no box, self-limited)," implying it's already accommodated. But its tags
say otherwise: `romProfile.squatDepth=below_parallel` and
`contraindications: ["hip_labrum"]`, against an injuryProfile listing
hip_labrum as `status: "recovering"` (unresolved) with a `squat_depth`
limit of `above_parallel`. The agent excluded `goblet` entirely, named the
tag/label contradiction explicitly in its prose ("trust the tags over the
old label"), and used `pinsquat` (the one squat variant tag-verified
`above_parallel`-compliant) for the day's primary knee-dominant slot
instead. It also caught a second, unprompted case of the same shape:
substituted the template's own `legpress` → `legext`, reasoning that
`legpress` carries an app-flagged `loaded_hip_flexion` caution with no
`romProfile` confirming a depth cap and `clinicianReviewed: false`, so it
wouldn't assume compliance absent verification — filed as a real
`substitutedFor` entry with `rationale`, not a silent drop. **Passed** —
full transcript available on request, not reproduced here.

**Not done in this section**: no live-browser Playwright check — this
section only touches prompt text construction (`buildCoachBrief`), not any
render path Playwright would exercise differently from the unit-level
brief-construction checks already run. Logged as a deliberate scope
decision, same category as Section 5's equivalent note.

`npm test`: 468 assertions total (431 prior + 37 new), all passing.

---

## Section 8 — Full real-data verification (all four upperFocus days)

No code changes. Rendered every day via the exact functions every real
render path calls (`resolveDayExercises`, `fitDayToTime`, `recommend`,
`dayFocusSummary`, `weeklySetsByGroup`, `contraindicatedInActiveProgram`),
against `recomp-coach-backup-2026-09-06.json`, loaded through
`scripts/lib/load-app.js` the same way every other real-data check in this
run has.

**Migration run first, boot-path-accurate — this matters and changes a
downstream number.** Earlier real-data checks in this run (Section 7's
`check-coach-brief-contract.js`, and my own Test C script) set
`injuryProfile` directly to `cloneInjuryProfileDefaults()` and left
`sessions` untouched — correct for what those checks were verifying, but
not what the live app actually does on boot. `migrateInjuryAndGobletData`
run for real against this export: `migrated: true`
(`source.injuryProfile` is absent, `source.goalProfile` exists), AND —
separately — `gobletBoxSquatMigration` fires too: the export's 8 sessions
logged under `goblet` get renamed to `boxsquat` (defaulted, `resolved:
false`), because there's no prior migration record. Practical effect: in
the actual live app, `goblet` shows **zero** training history, not the 8
weeks/+18.2% trend Test C's brief displayed (Test C's own methodology
matched `check-coach-brief-contract.js`'s existing precedent exactly, so
this isn't a new gap introduced there — it's a real, now-documented
difference between "brief built the way Section 7's tests build it" and
"brief built the way the live app would after a real boot"). Doesn't
change Test C's finding — the tag-trust reasoning it tested is independent
of which exercise happens to have logged history — but it means a live
re-run against this same account today would show goblet as a *fresh*
pick with an *unresolved* goblet/box-squat prompt still open, not an
established favorite. Flagged here rather than silently left inconsistent.

**Every day, rendered (`plan.sessionMin`: 60, `upperFocus`,
`currentFocus`: shoulders emphasize / arms specialize / legs maintain /
chest, back, core normal):**

**ufUpperA "Upper A"** — trimmed 6 sets, dropped none, 59 min vs. 60
budget. Order: Incline DB Curl(4), Cable Triceps Pressdown(4), Overhead
Cable Triceps Ext./bonus(3→2, trimmed), Seated DB Shoulder Press(4),
Cable Lateral Raise-high-rep/bonus(3→1, trimmed), Barbell Bench(3→2,
trimmed), Chest-Supported Row(3→2, trimmed), Lat Pulldown(3→2, trimmed).
Post-fit: arms 10, shoulders 5, chest 2, back 4. No caps/spawns (no
movement over the 4-set cap here). No warnings fire for this day
specifically (contraindication/escalation are program-wide, reported
once below).

**ufLower "Lower"** — trimmed 0, dropped none, 45 min vs. 60 (legs is
maintain-tier — smallest base volume, never needed trimming). Order (with
the real user's own swaps: legpress→goblet, pinsquat→legpress,
cablecrunch→kneeraise): Hanging Knee Raise(3, swapped from cablecrunch,
load 128 lb "Reduce" — real rep-range overshoot on a bodyweight-loaded
movement, unrelated to injury gating), Goblet Squat(2, swapped from
legpress, load 40 "Start" — zero history post-migration, see above),
Leg Press(2, swapped from pinsquat, load 170 "Add weight"), Seated Leg
Curl(2), Hip Thrust(2, "Back-off sets" tag), Standing Calf Raise(2). Post-
fit: legs 10, core 3.

**ufUpperB "Upper B"** — trimmed 6, dropped none, 59 min vs. 60. Order:
Hammer Curl(4), Preacher/Cable Curl-bonus(3), Overhead Press(4), Lateral
Raise(4→3, trimmed), Reverse Pec-Deck-bonus(3→1, trimmed), Pull-Up(3→2,
trimmed), Incline DB Press(3→2, trimmed), Seated Cable Row(3→2, trimmed).
Post-fit: arms 7, shoulders 8, back 4, chest 2.

**ufArms "Delts & Arms"** — trimmed 8, dropped none, 60 min vs. 60
(fits exactly). `maxSetsNotes`: EZ-Bar Curl capped 6→4, spawned Incline DB
Curl for the 2-set overflow; EZ-Bar Skullcrusher capped 6→4, spawned
Overhead DB Triceps Extension for the 2-set overflow. Post-fit order and
sets: EZ-Bar Curl(4), EZ-Bar Skullcrusher(4), Overhead Cable Triceps
Ext.(4), Cross-Body Hammer Curl-bonus(3→1, trimmed), Machine Shoulder
Press(4), Cable Lateral Raise(4→3, trimmed), Lateral Raise-swap(4→1,
trimmed), Incline DB Curl-spawned(2→1, trimmed), Overhead DB Triceps
Ext.-spawned(2→1, trimmed). Post-fit: arms 15, shoulders 8. Numbers are
byte-identical to Section 6's own real-data re-run — reproducible, not a
one-off.

**Weekly sets by group, all four days, post-trim**: arms 32, shoulders
21, chest 4, back 8, core 3, legs 10. `weeklySetsByGroup(data)` and a
manual per-day accumulation agree exactly — one predicate, not two that
could disagree.

**Warning surfaces, checked once, program-wide:**
- **Contraindication badge** (`contraindicatedInActiveProgram`): fires
  for `goblet` — `"Goblet Squat (no box, self-limited)"'s squatDepth
  (below_parallel) exceeds the above_parallel limit while recovering`,
  source note "an unverified guess, not clinical judgment." This is the
  user's own real `legpress→goblet` swap (Fix 3's warn-don't-block path —
  confirmed still warning, not blocking, exactly as designed). Per the
  comment directly on `gate2Injury`, the `romProfile.squatDepth` limit
  check fires before the `contraindications: ["hip_labrum"]` check ever
  runs — both trace back to the same conservative-default tag, so the
  source-note disclosure is keyed on `tagSource` rather than which branch
  fired, deliberately, per that comment's own history.
- **Clinician review notice**: fires — `clinicianReviewed: false` in both
  the raw export and after migration (never set true anywhere in this
  data). Persistent, non-dismissable, as designed.
- **Pain escalation**: none. Zero of 168 sessions (before or after
  migration — migration doesn't touch `pain`/`painRetro`) carry any pain
  value. Confirmed across every cat under a frozen copy of the OLD
  cat-based grouping AND every pattern under the NEW `painPattern`
  grouping — both empty. Nothing to migrate for this account; see the
  taxonomy section below for what that comparison actually verifies.
- **Stale prescriptions**: none — `data.plan.prescriptions` doesn't exist
  in this export (`plan` only has `template`/`sessionMin`/
  `templateSince`), so `StalePrescriptionsNotice` short-circuits on an
  empty array before it would even look for a mismatched dayKey.
- **Migration notices**: both fire, as detailed above —
  `injuryProfileMigration` ("Injury gating has been turned on") and
  `gobletBoxSquatMigration` (unresolved, defaulted to boxsquat,
  `GobletBoxSquatMigrationPrompt` would show).

**Complaint-by-complaint, final pass (baseline: `TASK-0-BACKUP-
MIGRATION-REVIEW.txt`'s original review, pre-Fix-1/pre-Section-6):**

1. **"6 sets stacked on EZ-Bar Curl" — FIXED.** Still capped at 4, still
   spawns Incline DB Curl for the overflow (Task 2 commit 4, unchanged
   by anything in this run, re-confirmed against the same real data).

2. **"Arms sequenced last, behind 12 delt sets" — FIXED (Section 6).**
   Directly confirmed above: order is EZ-Bar Curl, EZ-Bar Skullcrusher,
   Overhead Cable Triceps Ext., Cross-Body Hammer Curl — all four arm
   movements — THEN Machine Shoulder Press, Cable Lateral Raise, Lateral
   Raise. Arms sequences entirely before shoulders now, reversing the
   original order.

3. **"Biceps 7 vs triceps 4" — STILL PRESENT, now in the OPPOSITE
   direction, and this is a new finding from this section, not previously
   reported.** Current real numbers on `ufArms`: biceps (EZ-Bar Curl 4 +
   Cross-Body Hammer Curl 1 + spawned Incline DB Curl 1) = **6**; triceps
   (EZ-Bar Skullcrusher 4 + Overhead Cable Triceps Ext. 4 + spawned
   Overhead DB Triceps Ext. 1) = **9**. Fix 1 alone (before Section 6)
   produced 6 vs 5 — near parity, per `DEFERRED-TESTS.md`'s own "Fix 1
   follow-ups" note, which explicitly warned this ratio was incidental
   and "don't rely on it staying close as inputs change." Section 6's
   reordering is exactly the kind of input change that note warned
   about: it didn't touch the trim COUNT (8 sets trimmed, same as
   before), but changing item order changed `fitDayToTime`'s tie-break
   (`items.indexOf(b) - items.indexOf(a)` on equal `trimPriority`), which
   changed WHICH low-priority items absorbed the cut. Nothing in the
   codebase targets this ratio — the deferred note's warning has now
   concretely played out, in the direction it didn't specifically
   predict. Not a regression to fix under this run's scope (never a
   designed property to begin with), but real and worth a maintainer's
   eyes if arm-group balance ever becomes a stated requirement.

4. **"Cable lateral raise at 12.5 lb despite 50% rep decay" — still does
   not reproduce against this data, same conclusion as the original
   review, re-confirmed.** The only logged `cablelat` session
   (2026-09-04) is 4×20 @ 10 lb — zero decay, every set at the top of the
   15-20 rep range. `recommend()`'s "Add weight" to 12.5 lb is exactly
   correct for what's actually logged; the decay-detection branch this
   complaint describes exists and is unit-tested (Task 4's Gate 3 suite)
   but has no matching session in this export to exercise it end-to-end.

5. **"60-min trim cutting triceps and hammer curl to 1 set each while
   protecting all delt sets" — FIXED (Fix 1, re-confirmed here; Section 6
   didn't change this part).** Shoulders no longer keep everything: Cable
   Lateral Raise (4→3) and Lateral Raise (4→1) both take real cuts now —
   shoulders' post-fit total (8) sits exactly at its emphasize-tier 65%
   floor (12 pre-fit × 0.65 = 7.8 → 8), while arms' post-fit total (15)
   sits above its specialize-tier 75% floor (19 × 0.75 = 14.25 → 14) with
   one more trim point technically available. Both groups absorbed 4 of
   the 8 trimmed sets each — the specific bug (arms punished, shoulders
   fully protected, inverting the user's own emphasize<specialize
   settings) is gone. Low-priority bonus/spawned items in BOTH groups
   still get cut hardest, which is the intended behavior, not a
   remaining version of the bug.

**Pain-pattern taxonomy migration, against real data (Section 5's design,
verified here rather than there):** replayed the frozen pre-Section-5
cat-based grouping across every `cat` present in `ALL_KNOWN`, and the new
`painPattern` grouping across all 11 `PAIN_PATTERNS`, both against this
account's real (migrated) 168-session history. **Both come back empty —
zero escalating cats under the old grouping, zero escalating patterns
under the new one.** This account has never logged a `pain` or
`painRetro` value on any of its 168 sessions (confirmed directly, not
just inferred from the escalation result being empty), so there is
nothing for either grouping scheme to disagree about on this specific
account — consistent with Section 5's own real-data note. Nothing lost,
nothing invented: an empty set maps to an empty set. The cross-cat gap
Section 5 fixed (a hip-labral pattern split across `squat`+`hinge` cats
never reaching the 2-of-4 trigger under old grouping) remains verified
only against the synthetic fixture in
`scripts/check-pain-pattern-migration.js` — this account has no real
session history that would exercise it either way.

No `npm test` change — this section is read-only verification, no code or
test file touched.

---
