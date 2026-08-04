"use strict";
// Same require-cache-injection technique as mock-firebase-admin.js — see
// that file's header comment for why this works.
function installFakeWebPush(sendNotificationImpl) {
  const webPushPath = require.resolve("web-push");
  const fakeWebPush = {
    setVapidDetails: () => {},
    sendNotification: (subscription, payload) => sendNotificationImpl(subscription, payload),
  };
  require.cache[webPushPath] = {
    id: webPushPath,
    filename: webPushPath,
    loaded: true,
    exports: fakeWebPush,
  };
  return fakeWebPush;
}

module.exports = { installFakeWebPush };
