// Flat config (ESLint 9+). Three environments in this repo need different
// globals: scripts/*.js + sw.js run in the browser (scripts/*.js as plain
// <script> tags — no bundler, no import/export, each file is its own IIFE
// that shares state via window.*), api/*.js runs as a Vercel serverless
// function under Node/CommonJS. ios-widget/*.js runs inside Scriptable (an
// iOS automation app) with its own globals (Keychain, Script, ...) that
// don't fit either bucket, so it's excluded rather than modeled.
//
// Deliberately just eslint:recommended — no stylistic/formatting rules
// here, that's Prettier's job (see .prettierrc.json) — and deliberately
// not run across the existing codebase yet (see commit history); this is
// the baseline for code written from here on.
const browserGlobals = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  location: "readonly",
  history: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  console: "readonly",
  fetch: "readonly",
  Request: "readonly",
  Response: "readonly",
  Headers: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  Blob: "readonly",
  FileReader: "readonly",
  atob: "readonly",
  btoa: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  Notification: "readonly",
  Uint8Array: "readonly",
  CustomEvent: "readonly",
  Event: "readonly",
  MutationObserver: "readonly",
  getComputedStyle: "readonly",
  firebase: "readonly", // loaded from the Firebase compat <script> CDN tags
};

const serviceWorkerGlobals = {
  self: "readonly",
  caches: "readonly",
  fetch: "readonly",
  clients: "readonly",
  Request: "readonly",
  Response: "readonly",
  URL: "readonly",
  console: "readonly",
};

const nodeGlobals = {
  require: "readonly",
  module: "writable",
  exports: "writable",
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  __dirname: "readonly",
};

module.exports = [
  {
    ignores: ["ios-widget/**", "node_modules/**", ".vercel/**"],
  },
  {
    files: ["scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: browserGlobals,
    },
    rules: {
      // ignoreRestSiblings: this codebase destructures keys specifically to
      // omit them from a ...rest object (e.g. `const { date, ...patch } =
      // x`) in several places — that's the point of the pattern, not an
      // unused variable.
      "no-unused-vars": ["warn", { ignoreRestSiblings: true }],
      "no-undef": "error",
    },
  },
  {
    files: ["sw.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: serviceWorkerGlobals,
    },
  },
  {
    files: ["api/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: nodeGlobals,
    },
  },
];
