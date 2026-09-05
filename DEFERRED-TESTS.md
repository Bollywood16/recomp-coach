# Handoff note (updated during Task 2, 2026-09-05 session)

**Done:** Tasks 0 (injuryProfile as protected, structured data), 1
(exercise attribute tagging, 75/75 coverage), 4 (safety gates 1-8), 5
(coach brief export — tiered checkin/full payload, checkin-scope
enforcement, uncapped injury/pain data). All signed off, all committed on
`task-0-injury-profile`. Review files in the repo root (`TASK-N-*.txt`)
are the detailed record per task; this note is just the pointer.

**Task 2, in progress** (design in `TASK-2-RECONCILIATION-PROPOSAL.txt`,
reviewed and approved before implementation, per that file's full record):

- Commit 1 (done): consolidated the day-exercise-list construction that
  used to be independently duplicated in DayPage, weeklySetsByGroup,
  dayFittedMinutes, and dayFocusSummary into one `resolveDayExercises`.
- Commit 2 (done): wired `sessionRules` (was silently dropped before this
  — never in `KNOWN_PLAN_KEYS` — so every weekly-set cap in this build had
  been inert since Task 4). Merges onto prior state rather than replacing
  it wholesale; a real change is loudly noted, an omission is silent.
- Commit 3 (done): the reconciliation itself. Both items below, from the
  original handoff note, are now resolved — see
  `scripts/check-prescription-reconciliation.js` for the tests proving it:
  - **Item 1 (render-time reconciliation)** — resolved. Default is
    REPLACE: a prescription naming an exerciseId already present in that
    day's current (swap- and focus-resolved) output overrides that slot's
    sets/reps/load/rest IN PLACE; a prescription naming anything else ADDs
    a new entry. New Gate 1c (dayKey required + must be a real day in the
    current template) and Gate 1d (reject if the named exerciseId is
    ambiguous — appears more than once in that day, which only happens via
    two independently converged swaps) back this with reject-with-reason,
    never a silent guess.
  - **Item 2 (legs-cap headroom)** — resolved. Gate 6's running tally now
    subtracts a replaced slot's own prior contribution before adding the
    prescription's new value (`ctx.currentSlotFor`, built from the same
    `resolveDayExercises` the render path uses — one predicate, not two
    that could disagree). A net-neutral REPLACE-plus-ADD against a group
    already at its cap is correctly accepted; a pure ADD with no offsetting
    replace against the same group is still correctly rejected (both
    covered as positive/negative-control assertions in the test file).
  - Also landed as part of this commit, all covered by the same test file:
    a within-batch collision guard (two prescriptions in one paste naming
    the same day+exercise — deterministic first-wins by array order, named
    in the rejection), a prescribed `load` actually reaching the render
    layer (`recommend()`'s new `ex.prescribedLoad` branch, deload-aware),
    a prescribed `restSec` reaching both the display text and the
    duration/trim math (one shared `restFor`), `DayPicker.lastDone` now
    counting an ADDed exercise's logged sessions (still excluding bonus
    lifts — see the Gate 8 amendment below for why a similar-looking
    "just wire it in" change elsewhere was deliberately NOT made the same
    way), and a `StalePrescriptionsNotice` for prescriptions left inert by
    a template switch.
- Commit 4 (not started): `sessionRules.maxSetsPerMovement` + pool-
  splitting overflow logic — deferred test 2 below. Gets its own review
  round before starting, per instruction.

## Amendment to Task 4's sign-off: Gate 8 is now render-time-only

Task 4's original Gate 8 (`gate8DeloadOverride`) mutated a surviving
prescription's `sets`/`load` before it was stored, baking ~60%/~90% deload
scaling into `data.plan.prescriptions` at apply time. That was correct
when prescriptions had no render path at all — but once Task 2 commit 3
made them actually render, it became wrong in two ways: (1) deload state
can start or end AFTER a plan was applied, with no re-paste to refresh a
frozen value, so a stored scaled value goes stale in either direction; (2)
DayPage's own render-time deload scaling (its `isDeload` block, which
applies to every rendered entry unconditionally) would then scale an
already-scaled stored value a SECOND time, silently compounding past the
intended ~60%/~90%.

Fixed as part of Task 2 commit 3, not a separate task: `gate8DeloadOverride`
no longer exists. Stored prescriptions always hold RAW values. Deload
scaling is applied exactly once, at render time, uniformly to every
rendered entry regardless of origin (generator, bonus, or
prescription-reconciled) — DayPage's existing `isDeload` block continues
to own `sets` (unchanged, it always applied to everything already), and a
new `recommend()` branch (`ex.prescribedLoad`, checked before the deload
branch so deload still overrides it) now owns `load` for a prescribed
exercise the same way `recommend()`'s history-driven logic already owned
it for a generator exercise.

This is a correction to Task 4's implementation, not a reversal of Task
4's SPEC requirement — "deload overrides all prescriptions, unconditionally"
still holds exactly as stated; only the mechanism moved. Gate 3/4/5's
escalation ratchet (the actual subject of Task 4's most safety-sensitive
review round) is untouched by this. Verified by
`scripts/check-prescription-reconciliation.js`: applying a prescription
with an explicit `load` while a deload is active asserts the STORED value
is still the raw prescribed number, never `round5(load * 0.9)`.

---

# Deferred tests

The build spec's required test suite (`RECOMP-COACH-BUILD.md`) lists 10 test
cases, but 5 of them exercise schema that Tasks 2 and 6 create — not
something Task 4 (Safety gates 1-8) can build against without pulling those
tasks forward out of order. Recorded here per the 2026-09-05 review so they
stay tracked against their owning task rather than quietly dropped.

**Rule: an owning task is not done until its deferred test(s) below pass.**

| # | Test case | Depends on | Owning task | Status |
|---|-----------|------------|-------------|--------|
| 2 | 6 sets prescribed on a single movement with `maxSetsPerMovement: 4` → capped; overflow spawns a second movement from the same pool. | `sessionRules.maxSetsPerMovement` + pool-splitting logic | Task 2 | Not started |
| 4 | A forbidden-attribute exercise arriving via `days` substitution → Gate 9/2 rejects, original retained. | `days` array schema + Gate 9 (thin wrapper reusing Gates 1-8 per exercise) | Task 6 | Not started |
| 7 | `estimatedMin` understated by 30% → Gate 10 rejects the day, other days apply. | `days[].estimatedMin` + Gate 10 (recompute-and-compare) | Task 6 | Not started |
| 8 | A day omitting the `specialize` group entirely → Gate 12 rejects. | `days` schema + focus-group tracking per day + Gate 12 | Task 6 | Not started |
| 9 | A trim that would cut RDL / goblet squat / hip thrust below the maintain floor → Gate 13 rejects. | `days` schema + maintain-floor concept + Gate 13 | Task 6 | Not started |

## Completed now (Task 4, gates 1-8)

Tested against the 5 directly-applicable required cases, plus 2 synthetic
Gate 2 fixtures (since zero exercises in the real 75-exercise library carry
the forbidden attribute — Task 1 finding — the forbidden path would
otherwise ship unexercised):

| # | Test case | Result |
|---|-----------|--------|
| 1 | Reverse Pec-Deck prescribed at 40 lb vs. 10 lb logged history → Gate 3 rejects, falls back, surfaces reason. | Pass |
| 3 | Forbidden-attribute exercise via `prescriptions` → Gate 2 rejects. | Pass (both a bare gate call and the full paste-and-apply UI path, plus a live browser run) |
| 5 | Untagged exercise while `recoveringMode` is true → deny by default. | Pass (and confirmed it passes once `recoveringMode` is false) |
| 6 | Pasted plan attempting to modify `injuryProfile` → structurally impossible. | Pass — plus a real gap found and fixed: `applyCoachGates`'s blind `{...rec}` spread could have carried an attacker-supplied `injuryProfile` key through to `gated` (never applied today only because persist() call sites pick fields individually — an accident, not a guarantee). Now explicitly scrubbed (`delete gated.injuryProfile`), and `check-write-isolation.js` asserts that scrub stays present. |
| 10 | Legacy four-field plan block → applies unchanged, no regression. | Pass |

Also found and fixed while testing (not in the required list, but real):

- **Gate 2 never checked `ex.contraindications`.** The spec's own
  illustrative gate-logic pseudocode only shows the attributes/romProfile
  checks — it doesn't mention `contraindications` at all. Without checking
  it, every `contraindications` tag from Task 1 (bbrow, trapdl, goblet)
  would be inert, unenforced data, and the goblet/boxsquat split's entire
  premise (only the self-limited variant carries the contraindication)
  would have no actual effect. Added the check: an exercise is rejected if
  any of its `contraindications` matches an injury in
  `injuryProfile.injuries` whose `status` isn't `"resolved"`. Verified in
  isolation (forbidden/limited cleared) that `goblet` is still rejected via
  contraindications alone, and passes once `hip_labrum` is marked resolved.
- **`recommend()` needs the prescription's own `repMin`/`repMax`, not
  whatever happens to be baked into `EX_BY_ID`.** `EX_BY_ID[exerciseId]`
  for any exercise referenced somewhere in `PROGRAMS` carries whichever
  `repMin`/`repMax` that *first* program slot merged in via `slot()` —
  arbitrary relative to a specific pasted prescription's own target rep
  range. Confirmed this silently produced a wrong recommendation (bench
  logged at 18 reps read as "maxed out, add weight" under a baked-in
  repMax:10 from an unrelated slot, when the actual prescription's
  15-20 rep range meant 18 reps was still mid-progression). Fixed with
  `exerciseForRecommend()`, used by both Gate 3 and Gate 4.

Additional tests written beyond the required list, since the spec's test
suite itself has no case for gates 1, 4, 5, 6, 7, or 8: unknown-id
rejection (Gate 1), forced 20% reduction on logged pain including via the
24h-after `painRetro` field but never via a dismissed/unanswered one
(Gate 4), pain-escalation suppressing Gates 3/4's auto-adjustment with a
persistent clinician-consult notice (Gate 5), a weekly volume cap with a
running tally across a batch (Gate 6), a duration trim under a tight
session budget (Gate 7), and deload overriding sets/load unconditionally
(Gate 8). 41 assertions total, all passing, plus 3 separate live-browser
runs (Gate 3 fallback, Gate 2 rejection via a real shipped exercise) with
zero console errors.

## Fixed in the 2026-09-05 review round (items 1-5)

- **Item 1 — Gate 5 was suppressing Gates 3/4 on escalation, not tightening
  them.** As first built, an escalating pattern lost its load sanity check
  and its forced pain-rule reduction entirely — backwards from the intent.
  Escalation is now a one-way ratchet: Gate 4's reduction is unconditional
  (nothing suppresses it), Gate 3's ceiling tightens from +15% to "never
  above last logged" (including when load is omitted and would otherwise
  progress via `recommend()` at render time), and Gate 5 additionally caps
  sets at the last logged count. See the ratchet comment directly above
  `gate3LoadSanity` in index.html — written so it can't be re-inverted
  without deleting the comment first.
- **Item 2 — escalation now has a defined, automatic clearance.** 3
  consecutive sessions on the pattern with an *answered* pain value at or
  below threshold clears it (`isPainEscalating`); dismissed/unanswered
  sessions hold the streak, they neither advance nor reset it. Clearance
  is logged to `injuryProfileHistory` (via `PainEscalationNotice`'s
  transition-detecting `useEffect`, not inside the pure `isPainEscalating`
  read). The notice states the clearance condition explicitly.
- **Item 3 — the "trending upward" heuristic is now pinned down in one
  place** (the comment above `isPainEscalating`): among the last 4 sessions
  for a pattern, if >=3 have an answered pain value, escalation triggers
  when the most recent is >=2 points above the oldest in that window.
  Explicitly labeled as a chosen heuristic with no clinical basis, biased
  to over-trigger per instruction.
- **Item 4 — `applyCoachGates` now picks known keys off `rec` instead of
  spreading it.** `KNOWN_PLAN_KEYS` is the explicit allowlist; anything
  else in a pasted plan is dropped and surfaced as an "ignored field"
  message rather than silently carried through or silently doing nothing.
  `check-write-isolation.js` asserts both that no `...rec` spread exists
  and that `injuryProfile` is never in the allowlist.
- **Item 5 — Gate 6's default cap decided.** When no `sessionRules.
  weeklyGroupSetCaps` override exists, the default cap is
  `max(group.mav, current program's baseline for that group)`
  (`defaultGroupCap`) — never stricter than what the app already
  prescribes unprompted. Residual limitation, not fixed: a prescription
  meant to *replace* an exercise the baseline already counts (rather than
  add to it) is still evaluated as pure addition, since Task 4 has no
  concept of "this prescription supersedes that generator slot" — that
  reconciliation is Task 2's job.

## Item 6 — escalation's pattern grouping needs a real taxonomy (not fixed)

Grouping by `cat` (the same field the swap picker uses) is wrong in both
directions for escalation specifically:

- **Too wide:** pain on any one lift suppresses/tightens every other lift
  sharing that `cat` — e.g. any squat-cat exercise showing pain tightens
  every other squat-cat exercise, even unrelated ones.
- **Too narrow:** a hip labral issue presents across BOTH the squat and
  hinge cats (loaded hip flexion in one, hip extension/hinge in the
  other), which this grouping treats as two unrelated patterns — neither
  alone may reach the 2-of-4 trigger even if the underlying joint is
  clearly the common thread.

This under-detects exactly the injury this app was built around. Not
rebuilt now — needs a real pattern taxonomy (hip-dominant, knee-dominant,
etc.) distinct from `cat`, owned by whichever task next touches the
escalation gate. Flagged directly in `PainEscalationNotice`'s copy so it's
not a silent gap to the user either.

## Also worth knowing (not a defect, not fixed, just observed)

Playwright's `page.evaluate()` cannot reach this app's top-level
`const`/`let` bindings (EX_BY_ID, ALL_KNOWN, etc.) even though there's no
ES module wrapper — Babel Standalone transforms and evaluates
`<script type="text/babel">` content inside a function scope, so top-level
declarations never land on `window`. Worked around during Task 4 by using
real shipped exercises for browser-level fixture tests instead of
injecting synthetic ones. For Task 6, don't fight this: either add a build
step emitting a pre-transpiled test bundle, or expose a single
explicitly-named test hook (`window.__RECOMP_TEST_HOOK__`) assigned only
when a query param is present — and if the hook route is taken,
`check-write-isolation.js` must assert it provides no write path to
`injuryProfile`.
