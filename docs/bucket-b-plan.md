# Bucket B (event-sourced sync) — Deployment Plan

Generated: 2026-08-22

Analysis/planning only at the time of writing — nothing in this document had been run or committed when it was drafted. Ordered by risk, cheapest/safest checks first.

## 0. Why order matters here

The root risk isn't the code (already reviewed on `event-sourced-sync-wip`) — it's that we don't know what state the `hxufyphmfkhjcetlwhgx` (fitness) Supabase project's schema is actually in. The earlier migration ran against `anzbpxqvibgpxnwgyqoc` (forecasting) by Codespace mixup, so the fitness project could be in any of three states: (a) no `sessions`/`weights`/`settings` tables at all, (b) tables also accidentally created there in a prior session, correctly shaped, or (c) something partially/incorrectly shaped. We must find out which, in a read-only way, before writing anything.

No Supabase credentials exist in the dev environment (they live in the browser's `localStorage`, not this repo) — the pre-flight steps below have to be run **by the app owner**, in the Supabase SQL editor for the `hxufyphmfkhjcetlwhgx` project specifically.

## 1. Pre-flight checklist (read-only, run first)

**1a. Confirm you're pointed at the fitness project, not forecasting.**
- Supabase dashboard → the project open must show Reference ID `hxufyphmfkhjcetlwhgx` in Project Settings → General. Not `anzbpxqvibgpxnwgyqoc`.
- Cross-check against the app itself: open Recomp Coach → Settings → the saved "Project URL" should read `https://hxufyphmfkhjcetlwhgx.supabase.co`. If it doesn't match what's in the dashboard you're looking at, stop — wrong project again.

**1b. Check whether the tables already exist, and if so, their exact shape:**
```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('sessions','weights','settings','app_data')
order by table_name, ordinal_position;
```
Compare the result against the column list in the migration SQL in §2. If `sessions`/`weights`/`settings` already exist here, **do not treat `IF NOT EXISTS` as sufficient** — it will silently no-op on a table with the wrong columns. If the existing shape disagrees with §2, that's a manual reconciliation step (ALTER TABLE, or backup+drop+recreate) before proceeding, not something to run blind.

**1c. Check RLS is enabled and policies exist:**
```sql
select schemaname, tablename, policyname, cmd, qual
from pg_policies
where tablename in ('sessions','weights','settings','app_data');

select relname, relrowsecurity
from pg_class
where relname in ('sessions','weights','settings','app_data');
```
`relrowsecurity` must be `true` for each, and each should have an "own data"-style policy scoping rows to `auth.uid() = user_id`.

**1d. If tables exist, sanity-check the data actually looks like fitness data, not leftover forecasting data:**
```sql
select * from sessions limit 5;
```
`exercise_id` values should look like `"bench"`, `"csrow"`, etc. — not forecasting-shaped fields. If you see anything that looks like forecast rows, that confirms cross-project contamination and this needs cleanup before backfill, separate from this plan.

**1e. Confirm the existing `app_data` blob is intact** (this is the current source of truth and the backfill source):
```sql
select user_id, jsonb_array_length(coalesce(payload->'sessions','[]'::jsonb)) as session_count,
       jsonb_array_length(coalesce(payload->'weights','[]'::jsonb)) as weight_count,
       updated_at
from app_data;
```
Record these numbers — they're what the backfill verification in §3 checks against.

**Gate: don't proceed to §2 until 1a–1e are confirmed against the fitness project specifically.**

## 2. Idempotent migration SQL

Safe to run whether or not the tables exist — `CREATE TABLE IF NOT EXISTS` no-ops if present (but see the §1b caveat: if present-with-wrong-shape, this won't fix it, so 1b must be clean first). Policies are dropped and recreated each run since Postgres doesn't support `CREATE POLICY IF NOT EXISTS`.

```sql
-- sessions: one row per logged workout session
create table if not exists public.sessions (
  user_id     uuid not null references auth.users(id) on delete cascade,
  id          bigint not null,              -- client-generated Date.now() ms timestamp
  date        date not null,
  exercise_id text not null,
  sets        jsonb not null default '[]'::jsonb,  -- [{w, r}, ...]
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.sessions enable row level security;
drop policy if exists "own data" on public.sessions;
create policy "own data" on public.sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- weights: one row per weigh-in date
create table if not exists public.weights (
  user_id    uuid not null references auth.users(id) on delete cascade,
  date       date not null,
  lbs        numeric not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);
alter table public.weights enable row level security;
drop policy if exists "own data" on public.weights;
create policy "own data" on public.weights
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- settings: one row per user
create table if not exists public.settings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  swaps       jsonb not null default '{}'::jsonb,
  nutrition   jsonb,
  focus       jsonb,
  plan        jsonb,
  phase       jsonb,
  goal_profile jsonb,
  coach_note  jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.settings enable row level security;
drop policy if exists "own data" on public.settings;
create policy "own data" on public.settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Note on `sessions.id`: it's `Date.now()` (a JS millisecond timestamp, not a UUID) — that's why the primary key is composite `(user_id, id)` rather than `id` alone; matches the app code's `onConflict: "user_id,id"`. Column shapes here were derived directly from what `cloudPull`/`cloudPush` on `event-sourced-sync-wip` actually read and write — this SQL isn't guessed, it's reverse-engineered from that branch's code.

## 3. Backfill from `app_data` + verification

Run after §2 succeeds. Unpacks the existing JSONB blob into rows, `on conflict do nothing` so it's safe to re-run.

```sql
-- sessions
insert into public.sessions (user_id, id, date, exercise_id, sets, updated_at)
select
  ad.user_id,
  (elem->>'id')::bigint,
  (elem->>'date')::date,
  elem->>'exerciseId',
  elem->'sets',
  coalesce((ad.payload->>'_updatedAt')::timestamptz, now())
from public.app_data ad,
     jsonb_array_elements(coalesce(ad.payload->'sessions','[]'::jsonb)) as elem
on conflict (user_id, id) do nothing;

-- weights
insert into public.weights (user_id, date, lbs, updated_at)
select
  ad.user_id,
  (elem->>'date')::date,
  (elem->>'lbs')::numeric,
  coalesce((ad.payload->>'_updatedAt')::timestamptz, now())
from public.app_data ad,
     jsonb_array_elements(coalesce(ad.payload->'weights','[]'::jsonb)) as elem
on conflict (user_id, date) do nothing;

-- settings (one row per user)
insert into public.settings (user_id, swaps, nutrition, focus, plan, phase, goal_profile, coach_note, updated_at)
select
  ad.user_id,
  coalesce(ad.payload->'swaps','{}'::jsonb),
  ad.payload->'nutrition', ad.payload->'focus', ad.payload->'plan', ad.payload->'phase',
  ad.payload->'goalProfile', ad.payload->'coachNote',
  coalesce((ad.payload->>'_updatedAt')::timestamptz, now())
from public.app_data ad
on conflict (user_id) do update set
  swaps = excluded.swaps, nutrition = excluded.nutrition, focus = excluded.focus,
  plan = excluded.plan, phase = excluded.phase,
  goal_profile = excluded.goal_profile, coach_note = excluded.coach_note,
  updated_at = excluded.updated_at;
```

**Verification (must match the numbers recorded in §1e):**
```sql
select
  ad.user_id,
  jsonb_array_length(coalesce(ad.payload->'sessions','[]'::jsonb)) as blob_sessions,
  (select count(*) from public.sessions s where s.user_id = ad.user_id) as table_sessions,
  jsonb_array_length(coalesce(ad.payload->'weights','[]'::jsonb)) as blob_weights,
  (select count(*) from public.weights w where w.user_id = ad.user_id) as table_weights
from public.app_data ad;
```
`blob_sessions` must equal `table_sessions`, and same for weights. Any mismatch — stop and diagnose before touching code.

## 4. Code deploy sequence

Only after §1–3 are green on the **fitness** project:

1. `git checkout main && git pull`
2. `git merge event-sourced-sync-wip --no-ff` (or cherry-pick just the sync-related commit if `main` has moved since the branch point)
3. **Keep `cloudPushBlob`** — the dual-write to `app_data` stays in place for this initial deploy. It's the revert switch: if the event-sourced path misbehaves, reverting `index.html` alone (no DB change) restores the old sync path, same as it did for the Bucket A/B split. Don't remove it until the new path has run clean for a while — that's a separate future cleanup, not part of this deploy.
4. Bump `sw.js` cache: `main` is currently at `recomp-coach-v15` (shipped with Bucket A) — bump to `recomp-coach-v16` so clients actually fetch the new sync code instead of serving a stale cached shell.
5. Run the esbuild JSX check again on the merged result (same method as the Bucket A verification) before pushing.
6. Push `main`, confirm GitHub Pages build succeeds.

## 5. What to verify on your phone afterward

In order of how badly a failure would hurt:

1. **Reload the app fresh (force-quit, reopen) and confirm your existing sessions/weigh-ins are all still there** — this is the one that matters most given the prior data-loss incident. Count should match what you had before.
2. Log out and log back in — forces a `cloudPull` from the new tables — confirm data reappears identically.
3. Log a new set → confirm it shows up in the "LAST TIME" panel next time you open that exercise, and check Supabase dashboard that a new row landed in `sessions`.
4. Log a new body-weight entry → confirm a row lands in `weights`.
5. Delete a session from the app → confirm it disappears from the phone AND the corresponding row is actually gone from `sessions` in the dashboard (this exercises the new direct-delete code path).
6. Change something in Focus/Plan/Phase/Nutrition → confirm the `settings` row's `updated_at` changes and the value round-trips after a reload.
7. Check the `app_data` blob's `updated_at` also moved (confirms dual-write is still active as your safety net).
8. Confirm the app actually picked up the new service worker (e.g. reload twice, or check that new-feature behavior — not just cache — is present), since browsers can hold onto an old cached shell for a bit even after a version bump.

## 6. HANDOFF.md reconciliation

Applied directly to `HANDOFF.md` on this branch (see that file's "v14 addendum" section) — the stale "Paused" bullet has been replaced with text reflecting that event-sourced sync is implemented here and held back from `main` pending schema verification on the fitness Supabase project.

## Status

As of this commit: pre-flight checks (§1) have not yet been run against the real `hxufyphmfkhjcetlwhgx` project. Sections 2–4 (schema creation, backfill, merge to `main`) wait on those results.
