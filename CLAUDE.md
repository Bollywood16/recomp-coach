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
- Testing conventions: esbuild bundle check on every change; headless Node tests with stubbed React/Recharts/localStorage; unit tests on pure functions (merge semantics, fit budgets, gate timing, assist conversion, gate netting, ordering).
- Never commit secrets. The Supabase anon key is public by design; never add a service-role key or an Anthropic API key to the repo.

## Open items
- Comprehensive fix spec (Gate 6 netting, atomic apply with preview, truthful library tags in brief, focus-based exercise order engine, trim rules, data-quality flags, assisted pull-up e1RM, corpus retrieval) — see the spec Sean pastes in.
- Deferred: Gate 13 per-movement maintain floor; test cases 4, 7, 8, 9; pain-pattern taxonomy grouping for hip-dominant patterns.
- RDL, pin squat and chest-supported row exist in the template/metrics but are missing from the live exercise library — reconcile.
