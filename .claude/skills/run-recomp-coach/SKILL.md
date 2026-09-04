---
description: Launch recomp-coach (static index.html, no build step) in headless Chromium via Playwright, serve it locally, and drive it to verify a change actually works in the app.
---

# Running recomp-coach

Single-file React PWA (`index.html`), no build step, no framework CLI.
React/ReactDOM/Recharts/Supabase/Babel all load from `unpkg.com` at
runtime and are JSX-compiled in-browser by Babel standalone — the app
needs network access to those CDN URLs to render at all, even locally.
`window.storage` (used for all persistence) is a `localStorage` wrapper
defined at the top of the script itself — nothing to mock or configure.

## Dev server

No dev command — it's static files. Serve the repo root and poll:

```bash
python3 -m http.server 8811 > /tmp/httpserver.log 2>&1 &
timeout 15 bash -c 'until curl -sf http://localhost:8811/index.html >/dev/null; do sleep 0.5; done'
```

Stop with `lsof -ti:8811 -sTCP:LISTEN | xargs -r kill` before relaunching.

## Drive it

`chromium-cli` was not available in this environment when this skill was
written. Fall back to Playwright directly (installs a real headless
Chromium the first time, ~300MB, takes a minute):

```bash
mkdir -p /tmp/pwtest && cd /tmp/pwtest
npm init -y >/dev/null 2>&1
npm install --no-audit --no-fund playwright
npx playwright install chromium --with-deps   # skip if ~/.cache/ms-playwright already has chromium-*
```

Minimal driver (adapt the interaction to what you're verifying):

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

  await page.goto('http://localhost:8811/index.html', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('nav >> text=Workout', { timeout: 15000 });
  await page.screenshot({ path: '/tmp/pwtest/01.png' });

  console.log('console errors:', errs.length ? errs : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
```

Run with `node /tmp/pwtest/test.js`.

## Seeding app state (localStorage)

The whole app's persisted state lives in one `localStorage` key,
`recompcoach:v2`, as a single JSON blob (see `STORAGE_KEY` in
`index.html`). To test a specific state (a migration path, aged
sessions, an injury profile, etc.) without clicking through the UI:

```js
const STORAGE_KEY = 'recompcoach:v2';
await page.goto('http://localhost:8811/'); // any same-origin page first
await page.evaluate(({ key, payload }) => localStorage.setItem(key, JSON.stringify(payload)),
  { key: STORAGE_KEY, payload: { sessions: [], weights: [], swaps: {}, nutrition: {}, focus: null, plan: null, phase: null, /* ... */ } });
await page.goto('http://localhost:8811/index.html', { waitUntil: 'networkidle' });
```

**Do not use `page.addInitScript` to seed storage if the test also
reloads the page.** `addInitScript` re-runs before *every* navigation in
that browsing context, including `page.reload()` — it will silently
re-clobber whatever the app just wrote, and a "does X persist across
reload" test will falsely fail. Seed once via a plain `goto` +
`evaluate` (above), then navigate/reload normally so reloads only see
what the app itself persisted.

## Gotchas hit building this

- **React controlled inputs**: use Playwright's `fill`/`click`, not
  `el.value = …` — matches the general Playwright guidance.
- **Ambiguous text selectors**: bare `page.click('text=Workout')` can
  silently resolve to the wrong element (or no-op) when that word
  appears in more than one place on the page (e.g. a tab label *and*
  body copy). Prefer a scoped locator: `page.locator('nav button', {
  hasText: 'Workout' })`.
- **Multiple exercise inputs on one page**: `input[placeholder="lbs"]`
  matches every set's weight field — use `.nth(i)` per set rather than
  a single `.fill()`.
- **No console errors ≠ correct behavior.** This app renders its shell
  fine even when a data path is subtly wrong (e.g. a stale-cache issue
  from `addInitScript` above produced zero console errors while still
  showing the wrong screen). Always assert on the actual visible state
  (`locator(...).count()`/`.textContent()`), not just absence of errors.
