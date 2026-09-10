import { defineTool } from "@opencomputer/agent";
import { SLACK_ALERT_CHANNEL_ID } from "../config.js";
import convex from "../connections/convex.js";
import slack from "../connections/slack.js";

type Candidate = {
  id: string;
  candidateKey: string;
  notificationKey: string;
  leaseToken: string;
  channelId: string;
  threadTs: string;
  openedAt: number;
  deadlineAt: number;
  evidence: Array<{
    messageTs: string;
    sentAt: number;
    withinDeadline: boolean;
    userId: string;
    direction: "external" | "internal";
    text: string;
  }>;
};

async function post<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await convex.fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `SLA store ${response.status}: ${(await response.text()).slice(0, 1_000)}`,
    );
  }
  return response.json() as Promise<T>;
}

async function stableClientMessageId(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export const claimSlaCandidates = defineTool({
  name: "claim_sla_candidates",
  description:
    "Claim a bounded batch of overdue, not-yet-decided Slack Connect SLA candidates. Call once per scheduled scan.",
  input: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async run({ signal }) {
    return post<{ candidates: Candidate[] }>(
      "/internal/sla/claim-due",
      {
        lookbackHours: 24,
        limit: 25,
        leaseToken: crypto.randomUUID(),
      },
      signal,
    );
  },
});

export const dismissSlaCandidate = defineTool({
  name: "dismiss_sla_candidate",
  description:
    "Record that a claimed candidate does not require an SLA alert because the request was answered or was not actionable.",
  input: {
    type: "object",
    properties: {
      candidateId: { type: "string", minLength: 1 },
      leaseToken: { type: "string", minLength: 1 },
      reason: { type: "string", minLength: 1, maxLength: 1_000 },
    },
    required: ["candidateId", "leaseToken", "reason"],
    additionalProperties: false,
  },
  async run({ input, signal }) {
    return post<{ status: string }>(
      "/internal/sla/dismiss",
      {
        candidateId: String(input.candidateId),
        leaseToken: String(input.leaseToken),
        reason: String(input.reason),
      },
      signal,
    );
  },
});

export const publishSlaBreach = defineTool({
  name: "publish_sla_breach",
  description:
    "Publish one internal Slack breach alert for a claimed candidate and record the durable outbox publication in Convex.",
  input: {
    type: "object",
    properties: {
      candidateId: { type: "string", minLength: 1 },
      leaseToken: { type: "string", minLength: 1 },
      notificationKey: { type: "string", minLength: 1 },
      summary: { type: "string", minLength: 1, maxLength: 2_000 },
      rationale: { type: "string", minLength: 1, maxLength: 1_000 },
    },
    required: [
      "candidateId",
      "leaseToken",
      "notificationKey",
      "summary",
      "rationale",
    ],
    additionalProperties: false,
  },
  async run({ input, signal }) {
    if (!/^([CGD])[A-Z0-9]+$/.test(SLACK_ALERT_CHANNEL_ID)) {
      throw new Error(
        "Set SLACK_ALERT_CHANNEL_ID in the agent config before publishing alerts.",
      );
    }
    const notificationKey = String(input.notificationKey);
    const response = await slack.fetch("/api/chat.postMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        channel: SLACK_ALERT_CHANNEL_ID,
        text: `*Slack Connect response SLA breached*\n${String(input.summary)}`,
        client_msg_id: await stableClientMessageId(notificationKey),
        unfurl_links: false,
        unfurl_media: false,
      }),
      signal,
    });
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      channel?: string;
      ts?: string;
    };
    if (!response.ok || !result.ok || !result.channel || !result.ts) {
      throw new Error(
        `Slack chat.postMessage failed: ${result.error ?? response.status}`,
      );
    }
    const outboxItemId = `slack:${result.channel}:${result.ts}`;
    await post(
      "/internal/sla/mark-notified",
      {
        candidateId: String(input.candidateId),
        leaseToken: String(input.leaseToken),
        notificationKey,
        outboxItemId,
        rationale: String(input.rationale),
      },
      signal,
    );
    return { status: "delivered", outboxItemId };
  },
});
