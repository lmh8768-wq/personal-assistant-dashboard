"use strict";
// Shared setup for the browser-based UI test layer (tests/ui-smoke.test.js):
// serves the repo root over plain HTTP (the app is a set of <script> tags
// with no bundler, so it just needs any static server) and launches a real
// Chromium page against it, with the Firebase login gate bypassed the same
// way every ad-hoc manual verification in this project has done it — there
// are no real Firebase credentials in a test environment, so the app would
// otherwise never get past the login modal.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "..");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const filePath = path.join(ROOT, urlPath === "/" ? "/index.html" : urlPath);
    // Guard against escaping ROOT via "..".
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// Launches a fresh browser + page against a freshly-started static server,
// past the login gate, with initFeatures() already run. Each call gets its
// own browser context, so localStorage never leaks between tests.
async function launchApp() {
  const server = await startStaticServer();
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  // cloud-sync.js's auth-state handling re-shows #authGate a moment after
  // the initial bypass runs (there's no real Firebase project reachable
  // here) — a CSS override alone only hides it *visually*; the underlying
  // `hidden` attribute still flips back to false, which matters for
  // anything (like the modal focus-trap's open-modal check) that reads
  // .hidden rather than computed style. Locking the property itself via
  // defineProperty makes it stick for real. Must come after goto(): neither
  // survives navigation.
  await page.addStyleTag({ content: "#authGate { display: none !important; }" });
  await page.evaluate(() => {
    const authGate = document.getElementById("authGate");
    // Locking the JS property alone isn't enough — [hidden] CSS/querySelector
    // checks (like the modal focus-trap's "is another modal open" check)
    // read the actual content attribute, which authGate doesn't carry by
    // default (it's visible-by-default markup, shown until auth resolves).
    // Set it directly, then lock the property too for code that reads
    // .hidden rather than querying the attribute.
    authGate.setAttribute("hidden", "");
    Object.defineProperty(authGate, "hidden", { get: () => true, set: () => {} });
    document.getElementById("appRoot").hidden = false;
    window.initFeatures && window.initFeatures();
  });
  await page.waitForTimeout(300);

  async function close() {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  return { page, browser, server, close };
}

module.exports = { launchApp };
