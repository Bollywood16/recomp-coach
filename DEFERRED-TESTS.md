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

## Also worth knowing (not a defect, not fixed, just observed)

`MUSCLE_GROUPS.legs.mav` is 20, but the `balanced` template's own default
program already prescribes ~26 leg sets/week with no focus adjustment at
all. Gate 6 falls back to `mav` as the cap when no `sessionRules.
weeklyGroupSetCaps` override is given (since Task 2 hasn't wired up real
per-user caps yet) — meaning, today, Gate 6's *default* cap is stricter
than the live program's own baseline for legs specifically. Not a Task 4
bug (Task 2 is what makes this configurable for real), but worth someone's
attention when Task 2 lands.
