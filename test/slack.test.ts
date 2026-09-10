import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSlackMessage,
  parseSlackEventCallback,
  slackEventForStorage,
  slackTestOverride,
  verifySlackRequest,
} from "../src/slack.js";

const callback = {
  type: "event_callback",
  event_id: "Ev123",
  api_app_id: "A123",
  team_id: "T_INTERNAL",
  event: {
    type: "message",
    channel: "C_CONNECT",
    user: "U_EXTERNAL",
    text: "Production is unavailable",
    ts: "1789000000.001",
  },
};

test("normalizes an ordinary Slack message", () => {
  const parsed = parseSlackEventCallback(callback);
  assert.ok(parsed);
  assert.deepEqual(normalizeSlackMessage(parsed), {
    eventId: "Ev123",
    installationTeamId: "T_INTERNAL",
    channelId: "C_CONNECT",
    threadTs: "1789000000.001",
    messageTs: "1789000000.001",
    userId: "U_EXTERNAL",
    text: "Production is unavailable",
  });
});

test("applies test direction only for an allowlisted user and channel", () => {
  const parsed = parseSlackEventCallback({
    ...callback,
    event: { ...callback.event, text: "customer: Production is unavailable" },
  });
  assert.ok(parsed);
  const message = normalizeSlackMessage(parsed);
  assert.ok(message);
  const config = {
    enabled: true,
    channelIds: new Set(["C_CONNECT"]),
    userIds: new Set(["U_EXTERNAL"]),
  };
  assert.deepEqual(slackTestOverride(message, config), {
    direction: "external",
    message: { ...message, text: "Production is unavailable" },
  });
  assert.equal(
    slackTestOverride({ ...message, userId: "U_SOMEONE_ELSE" }, config),
    null,
  );
});

test("supports a team reply from the same allowlisted test user", () => {
  const parsed = parseSlackEventCallback({
    ...callback,
    event: { ...callback.event, text: "team: I own this investigation" },
  });
  assert.ok(parsed);
  const message = normalizeSlackMessage(parsed);
  assert.ok(message);
  assert.equal(
    slackTestOverride(message, {
      enabled: true,
      channelIds: new Set(["C_CONNECT"]),
      userIds: new Set(["U_EXTERNAL"]),
    })?.direction,
    "internal",
  );
});

test("stores only bounded message fields", () => {
  const parsed = parseSlackEventCallback({
    ...callback,
    event: {
      ...callback.event,
      text: "x".repeat(9_000),
      blocks: [{ type: "rich_text", sensitive: "not retained" }],
    },
  });
  assert.ok(parsed);
  const stored = slackEventForStorage(parsed);
  assert.equal((stored.text as string).length, 8_000);
  assert.equal("blocks" in stored, false);
});

test("ignores bot messages and message subtypes", () => {
  for (const extra of [{ bot_id: "B1" }, { subtype: "message_changed" }]) {
    const parsed = parseSlackEventCallback({
      ...callback,
      event: { ...callback.event, ...extra },
    });
    assert.ok(parsed);
    assert.equal(normalizeSlackMessage(parsed), null);
  }
});

test("verifies Slack HMAC signatures and rejects stale requests", async () => {
  const body = JSON.stringify(callback);
  const timestamp = 1_789_000_000;
  const secret = "test-signing-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`v0:${timestamp}:${body}`),
    ),
  );
  const signature = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const headers = new Headers({
    "x-slack-request-timestamp": String(timestamp),
    "x-slack-signature": `v0=${signature}`,
  });
  assert.equal(
    await verifySlackRequest(body, headers, secret, timestamp * 1_000),
    true,
  );
  assert.equal(
    await verifySlackRequest(
      body,
      headers,
      secret,
      timestamp * 1_000 + 301_000,
    ),
    false,
  );
});
