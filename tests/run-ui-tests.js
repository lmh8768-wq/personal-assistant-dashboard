"use strict";
// Runs just the browser-based UI suite with RUN_UI_TESTS set, so its tests
// stop skipping themselves. A plain "RUN_UI_TESTS=1 node --test ..." npm
// script would only work on POSIX shells — Windows' cmd.exe doesn't support
// that inline env-var syntax — so this sets it in-process instead, via
// node:test's programmatic run() API, which any `node` invocation can call
// the same way on every platform.
const path = require("node:path");
const { run } = require("node:test");
const { spec } = require("node:test/reporters");

process.env.RUN_UI_TESTS = "1";

run({ files: [path.join(__dirname, "ui-smoke.test.js")] })
  .on("test:fail", () => {
    process.exitCode = 1;
  })
  .compose(spec)
  .pipe(process.stdout);
