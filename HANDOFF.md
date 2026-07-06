# Recomp Coach — Project Handoff Brief

**Purpose of this document:** complete context for Claude Code (or any developer) taking over this project. Everything here was built iteratively in Claude chat; this captures architecture, history, design principles, and roadmap.

## What this is

A personal fitness app for one user: 5'7", ~146 lb, returning from a hip labral tear + proximal hamstring tendinosis after a 6-month layoff. Goal: "superhero" physique (capped shoulders, big arms, visible abs) without re-injury. Prior bests: 200 lb deadlift, 175 lb squat. Protein target 120 g/day, creatine user.

Two components:
1. **Tracker PWA** — GitHub Pages-hosted, offline-capable, installed on iPhone home screen. The daily gym tool.
2. **Coach Brain** — a Claude artifact on claude.ai that analyzes exported tracker data against stated goals and emits an updated plan file. The periodic (2–4 week) coaching layer.

**Data bridge between them:** the tracker's backup-file export/import. The coach reads a backup, writes a modified backup (plan/focus/goalProfile/coachNote updated, logs untouched).

## Repository contents (GitHub Pages root)

| File | Role |
|---|---|
| `index.html` | The entire tracker app: React 18 + Recharts + supabase-js via unpkg CDN, JSX transpiled in-browser by Babel standalone. ~110 KB. |
| `sw.js` | Service worker: caches app shell + CDN libs. Cache name `recomp-coach-vN` — **bump N on every deploy** or clients serve stale code. |
| `manifest.json` | PWA manifest, standalone display. |
| `icon-192/512.png`, `apple-touch-icon.png` | Icons (blue dumbbell). |

The app is one file by design (no build step; user uploads via GitHub web UI). Claude Code may restructure into a real project with a bundler — if so, keep the deploy artifact compatible with plain GitHub Pages.

## Architecture

- **State:** single `data` object: `{ sessions[], weights[], swaps{}, nutrition{}, focus{}, plan{}, phase{}, _updatedAt }`
  - `sessions`: `{id: epoch-ms, date: 'YYYY-MM-DD', exerciseId, sets: [{w, r, assist?, bw?}]}` — `w` is always **effective** weight (assisted pull-ups store bodyweight−assist).
  - `weights`: `{date, lbs}` (one per day, latest wins)
  - `swaps`: slotId → exerciseId (exercise substitutions)
  - `focus`: per muscle group: maintain|normal|emphasize|specialize
  - `plan`: `{template: balanced|upperFocus|superhero, sessionMin: 45|60|75, templateSince}`
  - `phase`: `{deloadUntil}` when a deload is active
- **Persistence:** localStorage (key `recompcoach:v2`) + Supabase cloud sync.
- **Supabase:** free tier. Table `app_data(user_id uuid PK → auth.users, payload jsonb, updated_at)`, RLS "own data" policy. Email/password auth, email confirmation disabled. Client config (project URL + anon key) stored in localStorage key `recompcoach:sbcfg`; supabase-js UMD from CDN. Sync = whole-blob upsert, debounced 1.2 s after each persist. On login: pull → `mergeData` → push.
- **mergeData semantics (critical, tested):** sessions union by id, weights union by date, settings taken from the side with newer `_updatedAt`. Logs can never be lost by sync.

## Engines (all deterministic, all in index.html)

1. **Progression (`recommend`)** — double progression: all sets ≥ repMax → +inc (5 lb upper / 10 lb lower compounds); any set < repMin → hold; else add reps. Cross-lift estimation for never-logged exercises via `basedOn: {ex, ratio}`. Deload mode: 90% of last weight.
2. **Split templates (`PROGRAMS`)** — balanced (2 upper/2 lower), upperFocus (3 upper/1 consolidated lower), superhero (Push/Pull/Delts+Arms/maintenance Lower). Canonical exercise defs in `D`; same lift id everywhere so history transfers across templates. All hip-safe: pin squats above parallel, reduced-ROM RDL, no floor deadlifts (trap-bar in swap library flagged PT-clearance-only).
3. **Rules engine (`recommendTemplate`)** — sliders → template recommendation with rationale. KNOWN GAP: context-blind (see roadmap #1).
4. **Emphasis (`adjustSets`, `bonusForDay`)** — multipliers 0.55/1.0/1.4/1.85 on base sets, clamped; bonus lifts injected at emphasize (more at specialize), distributed across days containing that muscle's categories.
5. **Time fitting (`fitDayToTime`)** — fits day to sessionMin−8 warm-up; trims sets from non-focused isolation first; compounds floor 2 sets; drops trailing non-focused isolation last. Est: sets × (40 s + rest). Rest by cat: squat/hinge/glute 180 s, presses/pulls 120 s, isolation 90 s.
6. **Muscle-group volume model (`MUSCLE_GROUPS`)** — per group mev/mav (e.g., shoulders 8–22, arms 8–24, legs 8–20). Focus tab shows live weekly sets vs range. These constants are the "research parameters" — roadmap #3 moves them to Supabase.
7. **Phase engine (`phaseInfo`, `stallScore`)** — re-entry ramp (<4 logged weeks), building block, deload suggestion (≥6 weeks AND ≥3 eligible lifts AND ≥60% stalled over 3 weeks; stall = last weekly e1RM ≤ 1.005× value 2 weeks prior), block rotation suggestion at ≥10 weeks on a specialization template. Suggestions are one-tap, never silent.
8. **Nutrition (`computeNutrition`)** — Mifflin-St Jeor BMR × occupational base (desk 1.1 / active 1.28) + steps×0.045×(bw/150) + workouts×300/7; target = TDEE − 350; scale-trend auto-adjust ±150 suggestions.

## Coach Brain artifact (CoachBrain.jsx)

Runs on claude.ai (native `fetch` to `https://api.anthropic.com/v1/messages`, model `claude-sonnet-4-6`, no key — subscription-funded). Flow: upload backup → `computeMetrics` (weeks, per-lift e1RM trends, stalls, bw slope) → goal chat → single structured-JSON model call → **`applyGates` enforces hard rules in code post-response** (injury gate: <8 logged weeks + injuryRecovery flag ⇒ template forced to balanced; focus values validated; calorieDelta clamped ±300) → renders pushback/assessment/nutrition → downloads updated backup for tracker import.

**Core design principle (do not violate): the LLM interprets and narrates; deterministic rules decide. Safety gates live in code, after the model.**

## Version history (features by version)

v1 program+tracker → v2 swaps+estimation+nutrition tab → v3 day-picker flow, inline logging, rest timers → v4 focus sliders + MEV/MAV → v5 emphasize-tier bonuses + visibility badges → v6 split templates + rules engine + time fitting → v7 phase engine (deload/rotation) → v8 assisted pull-up mode + export/import backup → v9 Supabase sync + merge → v10 Progress redesign (Overview table + searchable charts) + Coach Brain artifact.

## Known iOS/PWA gotchas (hard-won)

- Home-screen container storage ≠ Safari-tab storage for the same URL. Never tell the user to "open in a fresh tab" to check data.
- iOS evicts web storage after ~7 days unused; Supabase sync is the real fix, export/import the fallback.
- claude.ai links intercepted by the Claude app → paste into Safari address bar.
- Service worker: update lands on the *second* open with network. Always bump cache name.
- GitHub Pages serves `index.html` at root only; files in subfolders 404.

## Roadmap (agreed with user, in priority order)

1. **Context-aware pushback in the tracker itself** (free, no LLM): gate `recommendTemplate` on injury/phase state — during re-entry (<8 logged weeks with injury flag), recommend balanced regardless of sliders, with an explanatory card and auto-flip when earned. Add a persistent goal profile (injury history, target, timeline) in `data.goalProfile` (the coach artifact already writes this key).
2. **Monthly check-in controller** (free): compare priority-muscle e1RM growth + scale trend vs goal; redistribute sets within mev/mav; narrative card.
3. **Research parameters → Supabase** (free): `parameters` table (mev/mav, rest, thresholds) read at load; `research_notes` table of structured findings; human-in-the-loop approval for changes — never LLM auto-ingest into live parameters.
4. **Optional tighter LLM integration:** Supabase Edge Function proxy holding an Anthropic API key so the tracker gets in-app chat (pennies/month), replacing the manual backup-file bridge.
5. **Later:** per-muscle dose-response regression on the user's own logs (needs ~3–6 months of data) to individualize mev/mav.

## Testing conventions used so far

esbuild bundle check on every change; headless Node load tests with stubbed React/Recharts/localStorage; unit tests on pure functions (merge semantics, fit budgets, gate timing, assist conversion). Keep pure logic separable from components so this stays possible.

## v12 addendum (free intelligence layer)

- **Research corpus:** 21 structured findings (`RESEARCH_CORPUS`) embedded in-app with `phase_tags`; `researchForPhase(data)` tag-matches against the phase engine state and sorts by specificity (injury/deload/stall findings first, then template-specific, then generic) before an 8-slot cap. Decision: kept in-app, NOT in Supabase (YAGNI at 21 rows; migrate past ~100 entries).
- **Coach brief builder (`buildCoachBrief`)**: assembles an XML-tagged prompt per Anthropic prompt-engineering practice — role, then `<goal_profile>/<constraints>/<training_metrics>/<research_context>` data sections, then numbered `<instructions>` with a strict output contract (one fenced json block: template/focus/sessionMin/calorieDelta). Injury hard-constraint stated in `<constraints>` AND enforced in code on paste-back.
- **Free loop:** Copy coach prompt (clipboard, primary) / Open in Claude (`claude.ai/new?q=`, guarded at 7500 URL chars, falls back to copy) → user pastes Claude's reply → `extractPlanJson` → `applyCoachGates` → applied. Zero API cost.
- **3-week unlock:** coach actions gated behind `trainingWeeks >= 3` with a progress bar; goal text editable before unlock. In-app API-key path retained as optional.
- Supabase: no schema changes in v12 (deliberate — see corpus decision).

## v13 addendum (sync incident postmortem + fix)

**Incident (Jul 2026):** iOS evicted the home-screen container's localStorage; the app opened signed-in with default-empty state; a background auto-push uploaded the empty blob over the user's cloud row. Root cause: `persist()` pushed raw local state — the union merge only ran at sign-in. Recovery: user's exported backup file re-imported.

**Fix:** all uploads now route through `safeCloudSync(client, uid, local)` — pull → `mergeData` union → push. A device that lost its data now *recovers* from the cloud on its next push instead of destroying it. If the pre-push pull fails while local has zero sessions, the push is refused outright. `onSignedIn` also re-reads freshest local state from storage before syncing (stale-closure guard). Incident replayed in tests: v12 behavior = cloud wiped to 0 sessions; v13 = cloud retains 3, device adopts merged copy.

**Standing advice encoded in UX:** periodic Export backup remains the last-resort layer; recommend export before any app update.
