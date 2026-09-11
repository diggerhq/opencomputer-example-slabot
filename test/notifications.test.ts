import assert from "node:assert/strict";
import test from "node:test";
import { buildSlackAlert } from "../src/notifications.js";

test("builds a readable Slack SLA alert with localized dates and thread link", () => {
  const alert = buildSlackAlert({
    channelName: "customer-acme",
    permalink: "https://example.slack.com/archives/C123/p1700000000000000",
    openedAt: 1_700_000_000_000,
    deadlineAt: 1_700_000_120_000,
    detectedAt: 1_700_000_300_000,
    summary: "Checkout requests are failing & need investigation.",
  });

  assert.match(alert.text, /#customer-acme/);
  assert.match(alert.text, /https:\/\/example\.slack\.com\/archives/);
  assert.deepEqual(alert.blocks[0], {
    type: "header",
    text: {
      type: "plain_text",
      text: "🚨 Slack response SLA breached",
      emoji: true,
    },
  });
  assert.match(JSON.stringify(alert.blocks), /Response SLA.*2 minutes/);
  assert.match(JSON.stringify(alert.blocks), /<!date\^1700000000\^/);
  assert.match(
    JSON.stringify(alert.blocks),
    /Checkout requests are failing &amp; need investigation/,
  );
  assert.match(JSON.stringify(alert.blocks), /Open Slack thread/);
});
