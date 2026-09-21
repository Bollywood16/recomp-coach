# Handoff note (updated after Section 9, 2026-09-21 session — pre-merge)

**Done, all of it:** Tasks 0-7, all signed off, all committed on
`task-0-injury-profile`, NOT YET MERGED to `main`. Task 0 (injuryProfile
as protected, structured data), 1 (exercise attribute tagging, 75/75
coverage), 2 (day-resolution consolidation, sessionRules wiring,
prescription reconciliation, maxSetsPerMovement + pool-splitting), 3 (set
schemes — back-off and drop sets, data model through logger UI), 4
(safety gates 1-8), 5 (coach brief export — tiered checkin/full payload,
checkin-scope enforcement, uncapped injury/pain data), 6 (authored `days`
schema/persistence/gates 9-13, plan versioning + diff-and-confirm +
revert, deferred tests 4/7/8/9, pain-pattern taxonomy, day ordering by
emphasis + `sessionRules.trimPriority`), 7 (coach framing rewrite,
`<program_days>`/`<days_contract>` grounding, two live negative-control
tests against a fresh model). Review files in the repo root
(`TASK-N-*.txt`, now committed as build documentation rather than left
untracked — see the docs-cleanup commit) are the detailed record per
task; `BUILD-LOG.md` is the continuous run's own day-by-day record for
Sections 1-9; this note is just the pointer.

Also done: **Fix 1** (trim priority weights by emphasis level, floored per
group — see `FIX-1-TRIM-PRIORITY-SUMMARY.txt` and commit `aed617b`),
**Fix 2** (one shared `migrateInjuryAndGobletData` function for both the
boot path and `BackupCard.importData` — see
`FIX-2-BACKUP-IMPORT-MIGRATION-SUMMARY.txt`), and **Fix 3** (Gate 2 vs.
user swaps — warn, don't block; swap picker, persistent card warning,
Injury Profile card summary, all sharing one gate2Injury call with
tagSource-honest copy — see `FIX-3-GATE2-SWAP-WARNINGS-SUMMARY.txt`), all
three fixes that came out of testing Task 0-3's work against a real
pre-Task-0 backup export rather than seeded test data (full findings in
`TASK-0-BACKUP-MIGRATION-REVIEW.txt`).

**Known limitations, carried forward, not fixed in this run (see
`BUILD-LOG.md` Section 8 for the concrete real-data numbers behind the
first one):**
- Biceps/triceps balance on the Delts & Arms day is NOT a designed
  property and has now drifted twice (7v4 originally → 6v5 under Fix 1
  alone → 6v9 under Fix 1 + Section 6's reordering). Nothing in the
  codebase targets this ratio; don't assume it stays close.
- `sessionRules.orderByFocus` is accepted as a known plan key but still
  unwired — decorative today, same status as before Section 6.
- Pain-pattern taxonomy's cross-cat fix (Section 5) is verified only
  against a synthetic fixture — this specific real account has never
  logged a pain value, so there's no real session history to confirm it
  against in production.
- `splitPattern` (Task 6) is stored and echoed back but not enforced
  against anything — descriptive only, by design, not a gap.

**Next, in order:** nothing — Tasks 0-7 and Sections 1-9 of this run are
complete. What's left is entirely process, not build work: review this
branch, merge to `main` when ready (see `DEFERRED-TESTS.md`'s own
rollback procedure below for what to do if something ships broken), and
decide whether the real account's still-unresolved
`gobletBoxSquatMigration` prompt (see BUILD-LOG.md Section 8) needs
resolving before or after that first real-account boot on the new code.

**Task 2 (done)** (design in `TASK-2-RECONCILIATION-PROPOSAL.txt`,
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
- Commit 4 (done): `sessionRules.maxSetsPerMovement` + pool-splitting.
  Deferred test 2 below now passes. This is the fix for the build's own
  originating failure #1 (6 sets stacked on EZ-Bar Curl) — reproduced and
  confirmed fixed with the mechanism that actually caused it: pure
  Focus-tab emphasis scaling, zero prescriptions, zero sessionRules ever
  configured (`scripts/check-pool-splitting.js`'s point-6 test; also
  confirmed live in a real browser). New `capAndSplitMovement`, called
  from `resolveDayExercises` LAST — after generator, bonus, and
  prescription reconciliation — so it catches overflow regardless of
  origin. A default cap of 4 applies even with no `sessionRules` ever
  pasted (`DEFAULT_MAX_SETS_PER_MOVEMENT`), the same role
  `defaultGroupCap` already plays for Gate 6; a real
  `sessionRules.maxSetsPerMovement` overrides it. Candidate order for
  which pool-mate gets spawned is deterministic: `rank` ascending (the
  same field the swap picker already uses), tied-broken by name — never
  `ALL_KNOWN` declaration order, verified by deliberately reverting the
  sort and confirming the wrong candidate gets picked. Every candidate
  runs Gate 1 and Gate 2 (the same functions, not a reimplementation)
  before being chosen; verified against a real, non-synthetic
  contraindication (goblet/hip_labrum) that the fallback correctly moves
  to the next candidate rather than spawning something contraindicated —
  and, with a deliberately reverted gate check, confirmed the test
  catches exactly that failure. If no candidate survives, the movement is
  capped with no spawn and a stated reason — never exceeds the cap as a
  fallback. The delts_lateral/delts_rear split from Task 1 is
  specifically exercised: a lateral-raise overflow never spawns a
  rear-delt movement, even with one already present in the same day.
  Never persisted, same as bonus lifts — recomputed fresh from the
  day's current state every render, so a spawned entry can never drift
  from what it's covering for.

  **Real bug found and fixed while verifying this, not hypothetical:** 37
  of 75 `ALL_KNOWN` exercises (LIBRARY/LIBRARY_EXT alternates never used
  as a `slot()` argument in any `PROGRAMS` day) carry no `repMin`/
  `repMax` at all. A live browser run of the exact point-6 scenario above
  showed "2 × – at 15 lb/hand" for the spawned Incline DB Curl — a blank
  rep range, visible in the real UI, not caught by any prior test because
  every earlier test that exercised the ADD path happened to supply an
  explicit `repMin`/`repMax` override. Fixed in both places this can
  happen (`resolveDayExercises`'s prescription-ADD branch, from commit 3,
  and `capAndSplitMovement`'s spawn construction): a spawned entry
  inherits the overflowing exercise's own rep range first (matching
  `resolveSlot`'s existing swap precedent), an ADD prescription falls
  back to the base exercise's own range, and a new
  `DEFAULT_REP_RANGE` (8-12, an ordinary hypertrophy range — not a
  safety-relevant value) is the last resort when nothing else has one.
  Both fixed call sites have regression tests, both verified against a
  deliberately reverted fix.

  `scripts/check-pool-splitting.js`: 28 assertions. Two more tests
  updated for real, intentional behavior change rather than a
  regression: `scripts/check-day-resolution.js`'s reference
  implementations now also run capping (its specialize-tier scenarios
  legitimately produce different numbers now — that IS the fix, not a
  drift); `scripts/check-prescription-reconciliation.js`'s REPLACE test
  raises its own `sessionRules.maxSetsPerMovement` so it keeps testing
  REPLACE mechanics in isolation from capping, plus a new assertion for
  the rep-range fallback. `npm test`: all five scripts pass. Live
  headless-browser confirmation of the fixed original-bug scenario,
  banners and rep ranges both correct, zero console errors.

  Full design record and the six scope points from the review round, all
  addressed, in `TASK-2-RECONCILIATION-PROPOSAL.txt`.

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

## Second amendment to Task 4's sign-off: Gate 5's set count excludes drop segments

Task 3 (set schemes) needed `gate5PainEscalation`'s `lastSetCount` to stop
reading `last.sets.length` — a raw logged-row count — and start reading a
hard-set row count instead (`segment !== "drop"`). A drop segment is a
continuation of an existing set, not a separate one (`hardSetsFor`); once
drop segments are logged as their own rows, the raw count over-counts (a
4-hard-set session with one drop logs as 5 rows), which would silently let
the escalation cap admit MORE volume next time than it should — the exact
kind of quiet loosening Gate 5 exists to prevent.

This is a correction to Task 4's implementation for the same reason as the
Gate 8 amendment above: Task 4 built Gate 5 before set schemes (or their
underlying "a row isn't always a hard set" concept) existed, so there was
nothing to get wrong yet. The RULE Gate 5 enforces — cap sets at what was
actually done last time, don't loosen — is unchanged; only the counting
method needed fixing once "a row" and "a hard set" stopped being the same
thing. Migration-safe by construction: a pre-Task-3 session has no
`segment` field at all, and the exclusion form (`!== "drop"`) reads that as
"not a drop," so every existing session still counts exactly as it did
before this shipped — verified in `scripts/check-set-schemes.js`, including
a deliberately-reintroduced-bug check: reverting to raw `.length` on a
4-hard-set-plus-1-drop session let the cap admit 4 sets instead of the
correct 3, confirmed, then restored.

Full Task 3 design record, decisions, and the set-row-consumer audit in
`TASK-3-SET-SCHEMES-PROPOSAL.txt`.

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
| 2 | 6 sets prescribed on a single movement with `maxSetsPerMovement: 4` → capped; overflow spawns a second movement from the same pool. | `sessionRules.maxSetsPerMovement` + pool-splitting logic | Task 2 | **Passed** — `scripts/check-pool-splitting.js`, see the Task 2 commit 4 section below |
| 4 | A forbidden-attribute exercise arriving via `days` substitution → Gate 9/2 rejects, original retained. | `days` array schema + Gate 9 (thin wrapper reusing Gates 1-8 per exercise) | Task 6 | **Passed** — `scripts/check-deferred-tests-4-7-8-9.js` |
| 7 | `estimatedMin` understated by 30% → Gate 10 rejects the day, other days apply. | `days[].estimatedMin` + Gate 10 (recompute-and-compare) | Task 6 | **Passed** — `scripts/check-deferred-tests-4-7-8-9.js` |
| 8 | A day omitting the `specialize` group entirely → Gate 12 rejects. | `days` schema + focus-group tracking per day + Gate 12 | Task 6 | **Passed** — `scripts/check-deferred-tests-4-7-8-9.js` |
| 9 | A trim that would cut RDL / goblet squat / hip thrust below the maintain floor → Gate 13 rejects. | `days` schema + maintain-floor concept + Gate 13 | Task 6 | **Passed** — `scripts/check-deferred-tests-4-7-8-9.js`, all three named lifts covered (hip thrust directly, RDL on balanced's lowerB, goblet squat via its shared pool with legpress on ufLower) |

**Real-data note for row 9 (Fix 1, TASK-0-BACKUP-MIGRATION-REVIEW.txt):**
Fix 1's time-budget trim now gives specialize/emphasize groups a real
floor (a share of their own pre-trim volume), but maintain still gets
none beyond the pre-existing per-exercise minimum — deliberately, per
that fix's design ("maintain yields first," Gate 13's job to change).
Stress-tested against this user's real `ufLower` day (legs = maintain) at
an extreme forced budget: **hip thrust and calf raise are the two
movements that get dropped entirely** (not just cut to their floor —
removed from the day) before goblet squat / leg press / leg curl, which
hold at their per-exercise floor instead. Both are rehab-relevant lifts
on this profile. Whoever builds Gate 13 should treat these as the
concrete real-world case the maintain floor needs to cover, not a
hypothetical.

## Fix 1 (trim priority) follow-ups — not fixed

- **Biceps (6) vs triceps (5) on the Delts & Arms day is incidental, not
  a designed balance.** Fix 1 corrected the emphasis-level inversion
  (arms was getting cut harder than shoulders despite being the higher
  priority), and the biceps/triceps split happened to tighten from 7v4 to
  6v5 as a side effect of which spawned/bonus movements absorb the
  remaining trim — nothing in `trimPriority`/`groupTrimFloors` targets
  that ratio. Don't rely on it staying close as inputs (focus levels,
  swaps, session length) change. Not scheduled against any task; flagging
  so it isn't later described as fixed.
- **`sessionRules.trimPriority` is still inert.** Accepted as a known
  plan key (so a paste isn't rejected for including it) but never read by
  `fitDayToTime` or `gate7DurationTrim`, before or after Fix 1. Letting a
  coach plan override the default emphasis-tier ordering is a separate
  feature with its own shape to design (per-group ranking list? per-
  exercise?) — out of scope for Fix 1, not assigned to a task yet.

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

## Rollback procedure (written for a phone, pre-Section-9-merge)

This app has no build step and no GitHub Actions workflow — it's a single
`index.html`, static-hosted on GitHub Pages, served directly from
whatever `main` currently points to. There is no separate "redeploy"
step: pushing to `main` IS the deploy. Pages picks up the new commit
within roughly a minute on its own. (One thing to verify once, not
knowable from the repo files alone: Settings → Pages → confirm the
source is set to the `main` branch, root — if it's actually a
`gh-pages` branch or a `/docs` folder, substitute that below.)

**Before merging this branch**, `main`'s current tip is commit
`61f26a5` ("v14 workout features..."). That's the exact commit to roll
back to if something ships broken. Copy that SHA somewhere off-repo
too (a notes app) in case you're rolling back from a phone with no
other terminal history to grep.

**To roll back after merging (safe — adds a new commit, never rewrites
history, safe to do from a phone with just git + push access):**

```
git checkout main
git pull
git revert --no-edit <bad-commit-or-merge-SHA>
git push
```

Replace `<bad-commit-or-merge-SHA>` with whatever landed this branch —
`git log main --oneline -5` on your phone will show it as the newest
commit on top of `61f26a5`. If it was a normal merge commit (two
parents), `git revert` will ask which parent to keep; add `-m 1` to
keep `main`'s own line:

```
git revert --no-edit -m 1 <merge-SHA>
git push
```

Pages redeploys automatically once the push lands — reload the site
after ~60-90 seconds to confirm.

**Emergency alternative (only if `revert` itself is broken or blocked —
rewrites history, needs explicit confirmation, not a first choice):**

```
git checkout main
git reset --hard 61f26a5
git push --force-with-lease
```

`--force-with-lease` (not plain `--force`) refuses to push if someone
else pushed to `main` since your last pull, so it won't silently
clobber anything you haven't seen. Still: only use this path if a plain
revert genuinely doesn't work, and only against `61f26a5` unless you've
independently confirmed a different commit is the right target.

**After either path**: the branch `task-0-injury-profile` itself is
untouched by a `main` rollback — it still holds all the work, so nothing
is lost. Re-merging later (once whatever broke is fixed) is just a
normal merge again, not a re-do of the rollback.
