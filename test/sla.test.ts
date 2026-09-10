import assert from "node:assert/strict";
import test from "node:test";
import {
  appendEvidence,
  candidateKey,
  deadlineAt,
  notificationKey,
} from "../src/sla.js";

test("builds stable candidate and notification identities", () => {
  const key = candidateKey({
    installationTeamId: "T1",
    channelId: "C1",
    threadTs: "10.1",
    openedAt: 10_000,
  });
  assert.equal(key, "slack-sla:T1:C1:10.1:10000:wall-clock-60m-v1");
  assert.equal(notificationKey(key), `${key}:breach`);
});

test("calculates a wall-clock deadline", () => {
  assert.equal(deadlineAt(10_000, 60), 3_610_000);
  assert.throws(() => deadlineAt(10_000, 0), /positive integer/);
});

test("deduplicates and bounds chronological evidence", () => {
  const evidence = appendEvidence(
    [
      {
        messageTs: "2.0",
        sentAt: 2_000,
        withinDeadline: true,
        userId: "U2",
        direction: "internal",
        text: "old",
      },
      {
        messageTs: "1.0",
        sentAt: 1_000,
        withinDeadline: true,
        userId: "U1",
        direction: "external",
        text: "ask",
      },
    ],
    {
      messageTs: "2.0",
      sentAt: 2_000,
      withinDeadline: true,
      userId: "U2",
      direction: "internal",
      text: "answer",
    },
    2,
  );
  assert.deepEqual(
    evidence.map((item) => item.text),
    ["ask", "answer"],
  );
});
