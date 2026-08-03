"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCloudSyncModule } = require("./helpers/load-cloud-sync");

function merge(existing, incoming) {
  const window = loadCloudSyncModule();
  const existingRaw = existing === undefined ? null : JSON.stringify(existing);
  const incomingRaw = incoming === undefined ? null : JSON.stringify(incoming);
  const result = window.__mergeStoredValueForTest(existingRaw, incomingRaw);
  return result == null ? result : JSON.parse(result);
}

test("array union by id: an id only on one side is kept, not dropped — this is the actual bug fix", () => {
  // This is exactly the two-devices-edit-different-things scenario: device A
  // (existing/local) added id 1, device B (incoming/remote) added id 3 —
  // neither device's edit should erase the other's.
  const existing = [
    { id: 1, title: "device A added this" },
    { id: 2, title: "shared, unchanged" },
  ];
  const incoming = [
    { id: 2, title: "shared, unchanged" },
    { id: 3, title: "device B added this" },
  ];

  const merged = merge(existing, incoming);
  const byId = Object.fromEntries(merged.map((item) => [item.id, item]));

  assert.equal(merged.length, 3);
  assert.equal(byId[1].title, "device A added this");
  assert.equal(byId[3].title, "device B added this");
});

test("array merge: a same-id conflict resolves to the incoming (remote) version", () => {
  const existing = [{ id: 1, title: "local edit" }];
  const incoming = [{ id: 1, title: "remote edit" }];

  const merged = merge(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, "remote edit");
});

test("plain-object values merge per field (shallow), incoming wins per key", () => {
  const existing = { naverBlogUrl: "https://a", profileName: "로컬" };
  const incoming = { naverBlogUrl: "https://b", instagramUrl: "https://insta" };

  const merged = merge(existing, incoming);
  assert.deepEqual(merged, {
    naverBlogUrl: "https://b", // incoming wins on the shared key
    profileName: "로컬", // kept — incoming didn't have this key at all
    instagramUrl: "https://insta", // new from incoming
  });
});

test("mismatched shapes (array vs object, or one side unparseable) fall back to the incoming value", () => {
  const window = loadCloudSyncModule();
  assert.equal(window.__mergeStoredValueForTest("not json {{{", '"fallback"'), '"fallback"');
  assert.equal(window.__mergeStoredValueForTest(JSON.stringify([1, 2]), JSON.stringify({ a: 1 })), JSON.stringify({ a: 1 }));
});

test("existing side missing entirely just takes the incoming value as-is", () => {
  const window = loadCloudSyncModule();
  const incomingRaw = JSON.stringify([{ id: 1 }]);
  assert.equal(window.__mergeStoredValueForTest(null, incomingRaw), incomingRaw);
});
