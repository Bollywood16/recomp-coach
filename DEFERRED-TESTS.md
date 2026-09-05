# Handoff note (end of 2026-09-05 session)

**Done:** Tasks 0 (injuryProfile as protected, structured data), 1
(exercise attribute tagging, 75/75 coverage), 4 (safety gates 1-8), 5
(coach brief export — tiered checkin/full payload, checkin-scope
enforcement, uncapped injury/pain data). All signed off, all committed on
`task-0-injury-profile`. Review files in the repo root (`TASK-N-*.txt`)
are the detailed record per task; this note is just the pointer.

**Next:** Task 2 (per-exercise prescriptions / sessionRules — the
generator-side half of what Task 4's gates already validate). Three
specific things Task 2 must address, beyond its own stated scope:

1. **Render-time prescription reconciliation (architecture note owed from
   Task 4).** `applyPasted` in `index.html` already stores gated
   `prescriptions` onto `data.plan.prescriptions`, with a comment
   admitting "merging them into what the generator actually renders per
   day is Task 2's wiring, not this gate pipeline's job." That wiring
   doesn't exist yet. The render pipeline (`getProgram(data)` ->
   `PROGRAMS[template]` -> `resolveSlot`/swaps/focus-driven bonus lifts)
   computes each day's exercises today with zero awareness that
   `data.plan.prescriptions` exists. Task 2 has to decide the semantics,
   not just wire plumbing: does a stored prescription for an exerciseId
   that's ALREADY in the generator's output for that day REPLACE that
   slot (its sets/reps/load override the generator's own), or does it ADD
   a new entry alongside whatever the generator already produces? This
   isn't cosmetic — it's the direct cause of item 2 below, and
   `weeklySetsByGroup(data)` (which Gate 6's running tally starts from)
   is computed from the CURRENT rendered program, so whatever semantics
   Task 2 picks has to keep that baseline calculation honest rather than
   double-counting.

2. **Gate 6's legs-cap headroom limitation.** `defaultGroupCap(group,
   weeklyGroupSets) = max(MUSCLE_GROUPS[group].mav, current baseline)` —
   correct in that it's never stricter than what the app already
   prescribes unprompted, but for a group already at/above its own mav
   (legs: baseline ~26 sets vs. mav 20), there's currently zero headroom
   for anything new in that group, because the running tally also starts
   from the full baseline with no way to say "this prescription replaces
   part of that baseline, don't double-count it." Same root cause as
   item 1 above — fixing the reconciliation there fixes this too, not two
   separate problems.

3. **Deferred test 2** (from the table below): 6 sets prescribed on a
   single movement with `maxSetsPerMovement: 4` -> capped, overflow spawns
   a second movement from the same pool. Needs `sessionRules.
   maxSetsPerMovement` + pool-splitting logic, both Task 2's job. Per the
   standing rule below, Task 2 isn't done until this passes.

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
