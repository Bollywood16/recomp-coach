# Recomp Coach — Coach-plan apply & ordering overhaul

Branch: coach-apply-overhaul. Start in plan mode: propose the design for each item and STOP for Sean's review before implementing.

**Out of scope:** sync code, Supabase tables, and origin/event-sourced-sync-wip. Do not touch injuryProfile values or injury-gate thresholds (clinician data; clinicianReviewed stays false).

## Background (what went wrong on the last coach apply)
- Every arm prescription was rejected by Gate 6: "would push Arms to 33/34/37 weekly sets, above the 28-set cap", although the plan itself totalled ~26 arm sets. Even a pressdn that *replaced* the existing pressdn on ufUpperA was rejected. Shoulders: OHP rejected at 21 vs cap 20 with a planned ~16.
- Goblet Squat was listed in the brief as "already gate-compliant" but Gate 2 rejected it (squat_depth below_parallel).
- The apply was partial: bench, machrow, dbohp, latpd, pullup, cablerow were applied while all arm work was rejected, leaving a mixed program.
- RDL, pin squat and chest-supported row appear in program_days / training_metrics but not in the live exercise library sent in the brief.

## P0 — Apply correctness

1. **Gate 6 netting (weeklyGroupSetCaps).** Projected weekly sets = current week − sets of any row a prescription replaces − bonusForDay sets and adjustSets uplift for any (day, group) that has coach prescriptions + new prescription sets. When a day has prescriptions for a group, suppress bonus injections and focus multipliers for that group on that day — prescriptions define that group's volume there.
   Tests: re-applying an identical prescription = net 0 and passes; a replacement with fewer sets lowers the projected total.

2. **Atomic apply with preview.** Run all gates on the full plan first. If any prescription is rejected, apply nothing. Show a preview: per-group weekly sets before → after, each day's final ordered list, every rejection with its reason, and Apply / Cancel. No partial states.

3. **Truthful exercise library in the coach brief.** Include gating tags (squat_depth, hinge_rom, hip_flexion, etc.) for every listed exercise. Only label an exercise "gate-compliant" if it passes the same gates the apply step runs. Every exercise in program_days and training_metrics must appear in the library or be flagged "not in live library" (rdl, pinsquat, csrow).
   Test: the brief's compliant list ⊆ the set of exercises that pass the apply gates.

4. **Current weekly sets per group in the brief.** Add `weeklySets` by group (as the app currently generates the week) to training_metrics, so the coach plans against the real baseline.

## P1 — Exercise order engine (deterministic; replaces index-based ordering)

5. **Order key per day:**
   a. Specialization-day override: if one "specialize" group holds ≥40% of the day's sets, all of that group's exercises go first (compound then isolation), then the rest of the day by b–e.
   b. Compounds before isolation.
   c. Within each class, rank by focus: specialize > emphasize > normal > maintain.
   d. Tie-break 1: a regressing lift (trendPct ≤ −5% over ≥3 weeks) goes earlier.
   e. Tie-break 2: stable exercise tag (exerciseId). Never array index.
   f. Lower day: rehab-tagged lifts (hip thrust, RDL mid-shin, leg curl) keep their template order; focus rules don't reorder them.
   g. A coach `order` is honored only if it doesn't violate (a) or "specialized isolation before non-focus isolation". Otherwise reject that day with a reason — never silently re-sort.
   Tests: arms day → EZ curl/skullcrusher before machine shoulder press; Upper A → bench, then the regressing machine row before the shoulder press; no tie depends on insertion order.

6. **Time-fit trimming.** Trim in sessionRules.trimPriority order (non-focus isolation first). Never cut a specialize group below its prescribed sets; never cut a compound below 2 sets. Within a tier, cut from the end of the ordered list.
   Test: a 60-minute fit of the arms day keeps all arm sets and trims delts first.

7. **Max sets per movement.** Enforce sessionRules.maxSetsPerMovement; split excess into the next compatible alternate for the same muscle rather than stacking.

## P2 — Data quality (warnings, never silent fixes)

8. **Load-sanity flags.** Flag a prescribed load >2× or <0.5× the last logged load as "unverified" (e.g., reverse pec-deck prescribed 40 vs logged 10). Flag an e1RM drop >30% in <3 weeks as "possible data error" and exclude it from the stall count until confirmed.

9. **Assisted pull-up e1RM.** Compute from effective load = bodyweight − assistance; verify that more assistance reads as lower e1RM. Re-check the current −25% trend after the fix.

10. **Back-off tagging.** When load drops mid-exercise (e.g., 30, 30, 25, 25), prompt the user to tag those sets as backoff/drop; untagged drops remain readable as fatigue.

11. **Stall % denominator.** Exclude lifts with <3 logged weeks and maintain/rehab-group lifts from the deload stall %. Show the denominator in the UI.

## P3 — Coach context

12. **Corpus retrieval.** When the brief requests prescriptions, always include entries tagged order, volume and rest, not just the single most phase-relevant entry. Add *proposed* research_notes for exercise order (Simão et al. 2012) and energy balance during hypertrophy blocks — human approval only, never auto-ingested.

13. **Nutrition context.** If bwSlopePerWeek is null, the brief says so, and the coach card prompts for daily weigh-ins before accepting calorieDelta > +150.

## Testing
- esbuild bundle check; headless Node tests for every item above.
- Replay the rejected plan (goblet removed): it must pass Gate 6 with arms ≈ 26 and shoulders ≈ 16 weekly sets.
- Report per-group weekly sets for all four upperFocus days after apply.
