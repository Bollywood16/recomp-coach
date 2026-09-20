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
