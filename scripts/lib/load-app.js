/* Loads index.html's <script type="text/babel"> block into a Node vm
 * sandbox and hands back a plain object of whichever top-level bindings the
 * caller asks for. No browser, no jsdom — this app has no module system, so
 * the only way to reach its top-level functions/data from outside is to run
 * the actual script text and grab bindings before the sandbox is discarded.
 *
 * Why not Playwright: DEFERRED-TESTS.md's "Also worth knowing" note records
 * that page.evaluate() in a real browser can't reach this app's top-level
 * const/let bindings — Babel Standalone transforms <script type="text/babel">
 * content inside a function scope, so nothing lands on window. The same is
 * true here; the fix is the same one that note suggests: inject an explicit
 * export line INSIDE the script's own text before transpiling it, so the
 * export statement runs in the same closure as the bindings it's reading.
 * This loader does that with plain Node + @babel/core instead of a browser,
 * which is faster and has no DOM dependency for the pure-function tests that
 * use it (scripts/check-day-resolution.js).
 *
 * The app is a React app; we never render it. We stub just enough of
 * React/ReactDOM/Recharts/the browser globals that the script's top-level
 * code (mostly declarations, plus one `ReactDOM.createRoot(...).render(...)`
 * call at the very end) executes without throwing. Component functions
 * (App, DayPage, ExerciseCard, ...) are never invoked, so their hooks
 * (useState/useEffect/...) never actually run — the stubs for those only
 * need to exist, not behave like React.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const babel = require("@babel/core");

const INDEX_HTML = path.join(__dirname, "..", "..", "index.html");

function extractBabelScript(html) {
  const m = html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("Could not locate the app's <script type=\"text/babel\"> block.");
  return m[1];
}

/* Loads the app and returns an object exposing exactly the top-level names
 * listed in `exportNames`. Throws (with a clear message naming which export
 * is missing) if any requested name never got declared — that's the guard
 * against a rename silently going unnoticed by whatever test called this. */
function loadApp(exportNames) {
  const html = fs.readFileSync(INDEX_HTML, "utf8");
  const src = extractBabelScript(html);

  // Injected at the end of the script's own text, so it runs in the same
  // top-level closure as every const/function declared above it and can
  // read them directly — this is the "explicit test hook" DEFERRED-TESTS.md
  // flagged as the way around Babel Standalone's scoping, adapted to a
  // sandbox global instead of `window`.
  const exportLine = `\ntry { globalThis.__TEST_EXPORTS__ = { ${exportNames.join(", ")} }; } catch (e) { globalThis.__TEST_EXPORT_ERROR__ = e; }\n`;
  const instrumented = src + exportLine;

  const { code } = babel.transformSync(instrumented, {
    presets: [["@babel/preset-react", { runtime: "classic" }]],
    filename: "index.html.babel-block.js",
  });

  const noop = () => {};
  const fakeElement = () => ({
    style: {}, addEventListener: noop, removeEventListener: noop,
    appendChild: noop, removeChild: noop, classList: { add: noop, remove: noop, toggle: noop },
  });
  const documentStub = {
    getElementById: () => fakeElement(),
    createElement: () => fakeElement(),
    addEventListener: noop, removeEventListener: noop,
    body: fakeElement(),
  };
  const localStorageStub = (() => {
    const store = {};
    return {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      get length() { return Object.keys(store).length; },
      key: (i) => Object.keys(store)[i] || null,
    };
  })();
  const windowStub = {
    addEventListener: noop, removeEventListener: noop,
    localStorage: localStorageStub,
    open: noop,
  };
  const reactStub = {
    createElement: (...args) => ({ __reactStub: true, args }),
    useState: () => [undefined, noop],
    useEffect: noop,
    useMemo: (fn) => (typeof fn === "function" ? undefined : undefined),
    useRef: () => ({ current: undefined }),
  };
  const reactDomStub = { createRoot: () => ({ render: noop }) };
  const rechartsStub = new Proxy({}, { get: () => (() => null) });

  const sandbox = {
    console,
    React: reactStub,
    ReactDOM: reactDomStub,
    Recharts: rechartsStub,
    PropTypes: new Proxy({}, { get: () => undefined }),
    document: documentStub,
    window: windowStub,
    localStorage: localStorageStub,
    navigator: { clipboard: { writeText: async () => {} }, serviceWorker: undefined },
    fetch: async () => { throw new Error("fetch is stubbed out in the test sandbox"); },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
    Map, Set, Promise,
  };
  // vm.createContext makes `sandbox` itself the context's global object, so
  // `globalThis` inside the run code already resolves to `sandbox` — no
  // separate wiring needed for the injected export line to land back on it.
  const context = vm.createContext(sandbox);
  vm.runInContext(code, context, { filename: "index.html.babel-block.js" });

  if (sandbox.__TEST_EXPORT_ERROR__) {
    throw new Error(
      "load-app.js: one or more requested exports don't exist at top level " +
      `(${exportNames.join(", ")}). Underlying error: ${sandbox.__TEST_EXPORT_ERROR__.message}`
    );
  }
  const exported = sandbox.__TEST_EXPORTS__ || {};
  exportNames.forEach((name) => {
    if (!(name in exported)) {
      throw new Error(`load-app.js: "${name}" was requested but never declared at the app's top level.`);
    }
  });
  return exported;
}

module.exports = { loadApp };
