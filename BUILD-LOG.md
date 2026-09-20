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
