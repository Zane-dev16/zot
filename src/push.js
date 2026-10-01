"use strict";

// APNs push interface with no-op backend.
// Data shape is PushMessage { token, title, body, badge }.

async function sendPush(message) {
  return { ok: false, skipped: "apns-not-configured", token: message && message.token ? message.token : null };
}

async function sendBulk(messages) {
  const results = [];
  const list = messages || [];
  for (const m of list) results.push(await sendPush(m));
  return results;
}

function isPushConfigured() {
  return false;
}

if (require.main === module) {
  sendPush({ token: "test", title: "hi", body: "hello" }).then((r) => {
    console.log(JSON.stringify(r));
  });
}

module.exports = { sendPush, sendBulk, isPushConfigured };
