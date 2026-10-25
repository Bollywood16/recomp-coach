# Recomp Coach — project guide for Claude Code

Personal fitness PWA for one user (Sean). Goal: "superhero" physique (capped shoulders, bigger arms, visible abs) while recovering from a left hip labral tear and proximal hamstring tendinosis.

## Architecture
- Single `index.html`: React 18 + Recharts + supabase-js loaded from unpkg CDN, in-browser Babel transpilation. No build step in production.
- `sw.js` service worker for offline use. **Bump the cache name on every deploy** — updates land on the *second* open with network.
- Hosted on GitHub Pages. Pages serves `index.html` at the repo root only; files in subfolders 404.
- Supabase backend (auth + data). Sync on `main` is a **single `app_data` blob per user** with merge-on-push: `safeCloudSync` pulls the cloud copy, unions it with local via `mergeData`, then upserts the whole blob. Never push a near-empty dataset if the pull failed.
- An event-sourced rework (separate `sessions` / `weights` / `settings` tables, additive-only push, dual-write to `app_data`) exists **only** on `origin/event-sourced-sync-wip` and is **NOT deployed**. It is held back pending schema verification: an earlier migration ran against the wrong Supabase project (the forecasting app, not the fitness project), so the tables' existence in the fitness project is unconfirmed. See `docs/bucket-b-plan.md` on that branch.
- Do not touch sync code, Supabase tables, or that branch unless explicitly asked.
- AI Coach card (Insights tab): builds an XML coach brief → user gets a reply from Claude → pastes it into "Apply pasted plan" → app parses one ```json block and runs the gates.

## Governing principles (do not violate)
1. **Claude proposes, the app disposes.** The LLM interprets and narrates; deterministic code decides. Safety gates run in code, after the model output.
2. **Injury constraints are clinician-defined data.** Never modify `injuryProfile` values or injury-gate thresholds. `clinicianReviewed` is false; leave it false.
3. **Reject with reason, never silently drop.** Conservative failure modes over permissive ones. Structural enforcement over convention.
4. **Tie-breaks use stable tags (exerciseId), never array index.**
5. Movement constraints: no loaded deep hip flexion; squat depth above parallel (safety pins); hinge ROM to mid-shin. Pain rule: >3/10 within 24h → reduce load 20%.

## Key modules
- `PROGRAMS` split templates: balanced, upperFocus (dayKeys ufUpperA, ufLower, ufUpperB, ufArms), superhero.
- `adjustSets` / `bonusForDay` focus multipliers (0.55/1.0/1.4/1.85) and bonus-lift injection.
- `fitDayToTime` session time budget (sessionMin − 8 min warm-up).
- `MUSCLE_GROUPS` MEV/MAV constants.
- `phaseInfo` / `stallScore` phase engine (re-entry, building, deload, rotation).
- `computeNutrition` (Mifflin-St Jeor; target = TDEE − 350 + calorieDelta).
- Coach gates (Gate 2 injury tags, Gate 4 pain, Gate 6 weekly set caps, etc.).
- Coach apply (coach-apply-overhaul): `applyCoachGates` → `buildPlanPreview` → Apply only if `preview.ok` (all-or-nothing). `planUpdateFrom` is the single builder of the persisted plan. Gate 6 nets against `ctx.projectWeek`; cap = `weeklyGroupSetCaps[g] ?? mav`.
- `orderDay`: deterministic day order (specialize ≥40% block, compound, focus, regressing, exerciseId; rehab pins; coach `order` validated).
- `fitDayToTime`: hard floors (specialize 100%, emphasize 65%, compound ≥2); `overBudgetMin` → Gate 7 rejection at apply, banner on the day.
- Data quality: `trustedSeries` / `dataQualityFlags` (e1RM drops, assisted input errors, no-bodyweight rows) excluded from trends until confirmed (`dataQualityConfirmations`); `loadSessions` for load decisions.
- Bodyweight lifts: `effectiveLoad`, per-set modes (assist / bw / added) via `storedSetFromEntry`; never a default bodyweight.

## Known limitations
- **Sync is last-writer-wins for everything except sessions and weights** (`mergeData`). Sessions (by id) and weights (by date) are unioned. `swaps`, `focus`, `plan`, `phase`, `nutrition`, `injuryProfile` take whichever device's copy has the newer `_updatedAt`; any other top-level key (e.g. `dataQualityConfirmations`, `planVersions`) is local-wins on every sync. Accepted for now because Sean logs on one device (phone). To be fixed in the separate sync project — not in feature branches.

## Known iOS/PWA gotchas
- Home-screen PWA storage ≠ Safari-tab storage for the same URL.
- iOS evicts web storage after ~7 days unused — Supabase sync is the real persistence; export/import is the fallback.

## Workflow
- Always work on a branch; never commit directly to main.
- **Start non-trivial work in plan mode and STOP at architectural decision points** for Sean's review before implementing.
- Test locally before pushing: `npx serve .` (or `python3 -m http.server`) and open on localhost.
- **Never sign in to Supabase or sync when testing on localhost.** Use local test data only (synthetic fixtures / a fresh browser profile with no saved Supabase config). Because `plan` is last-writer-wins, a localhost test paste that syncs would overwrite Sean's real plan in the cloud.
- Testing conventions: `npm test` runs every `scripts/check-*.js` (headless Node; `scripts/lib/load-app.js` Babel-transpiles the app's script block, which doubles as the bundle check); unit tests on pure functions (merge semantics, fit budgets, gate timing, assist conversion, gate netting, ordering). Every new check script must be added to `scripts/run-tests.js`.
- Real data for tests lives only in `scripts/fixtures/local/` (gitignored). Committed tests use `scripts/fixtures/synthetic-*.json`; local-only cases skip with a notice. Run `git status` before every commit.
- Never commit secrets. The Supabase anon key is public by design; never add a service-role key or an Anthropic API key to the repo.

## Open items
- **FIX_SPEC.md (coach-apply-overhaul): all 13 items implemented** on branch `coach-apply-overhaul`, not yet merged/deployed. Sean's decisions recorded there: uplift-only suppression (maintain's reduction kept), emphasize 65% hard floor, whole-paste atomic apply, rehab = hipthrust/rdl/legcurl.
- RDL / pin squat / chest-supported row "missing from the library": resolved by truthful flagging — the brief lists each day as it renders (swaps applied) and marks logged-history lifts `inLibrary=N`.
- Real-data replay done (`scripts/fixtures/local/rejected-coach-reply.md`, goblet removed; checked in `check-coach-apply-replay.js`, local-only): all 25 prescriptions pass every prescription gate; weekly sets arms 37 → 26, shoulders 15 → 17 (the plan's 16 + 1 unprescribed lateral raise left on Delts & Arms by the reardelt → latraise swap), chest 4 → 6, back 8 → 12, legs 10 → 12, core 3 → 2. The only blocker is the plan's calorieDelta +300 (P3-13: 3 weigh-ins, no trend); at +150 or less it applies.
- From the replay — decide: Gate 3's fallback can RAISE a load above the coach's prescription (rear delt prescribed 7.5, last logged 5 → falls back to recommend()'s 10). Pre-existing; a `min(prescribed, recommended)` fallback would be the conservative fix.
- From the replay — decide: `sessionRules.trimPriority` sent as muscle-group names (`"core","chest",…`) is silently ignored (it expects focus levels); per principle 3 it should be noted or rejected.
- From the replay: goblet stays on the Lower day through the legpress → goblet swap even with no goblet prescription (flagged "fails Gate 2" in the brief) — undo that swap in the app.
- Pending from Sean: verification of `docs/proposed-research-notes.md` (exercise order, energy balance) before any corpus ingest.
- Real-data follow-ups (Sean's log): confirm/correct the flagged weeks on the Progress card (2 pull-up input errors, 1 rear-delt e1RM drop); 4th weigh-in to unlock calorie increases > +150; Delts & Arms is ~1 min over at 60 min (banner).
- Decide: Gate 11 (authored days) still caps at `max(mav, baseline)` via `defaultGroupCap`; Gate 6 now uses `?? mav`.
- Decide: stall check still counts lifts swapped out of the current program (e.g. csrow's old history).
- Known gap: the coach-order check only sees prescriptions that passed Gate 6, so a second rejection can surface only after the first is fixed.
- Older checks look for `recomp-coach-backup-2026-09-06.json` in the repo root; their real-data cases skip without it.
- Check-in brief is ~14K chars, over the 7,500-char "Open in Claude" link limit (clipboard fallback works).
- Previously listed as deferred — Gate 13 maintain floor, deferred test cases 4/7/8/9, pain-pattern grouping for hip-dominant patterns — appear implemented on main (`gate13MaintainFloor`, `check-deferred-tests-4-7-8-9.js`, `check-pain-pattern-migration.js`); confirm and drop from this list.
