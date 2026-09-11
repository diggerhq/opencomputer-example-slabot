import { defineTool } from "@opencomputer/agent";
import convex from "../connections/convex.js";

type Candidate = {
  id: string;
  candidateKey: string;
  notificationKey: string;
  leaseToken: string;
  channelId: string;
  threadTs: string;
  openedAt: number;
  deadlineAt: number;
  responseMinutes: number;
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
    const result = await post<{
      candidates: Omit<Candidate, "responseMinutes">[];
    }>(
      "/internal/sla/claim-due",
      {
        lookbackHours: 24,
        limit: 25,
        leaseToken: crypto.randomUUID(),
      },
      signal,
    );
    return {
      candidates: result.candidates.map((candidate) => ({
        ...candidate,
        responseMinutes: Math.round(
          (candidate.deadlineAt - candidate.openedAt) / 60_000,
        ),
      })),
    };
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

export const queueSlaBreach = defineTool({
  name: "queue_sla_breach",
  description:
    "Durably queue one internal Slack breach alert in Convex for reliable delivery.",
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
    return post<{ status: string; notificationId: string }>(
      "/internal/sla/queue-notification",
      {
        candidateId: String(input.candidateId),
        leaseToken: String(input.leaseToken),
        notificationKey: String(input.notificationKey),
        summary: String(input.summary),
        rationale: String(input.rationale),
      },
      signal,
    );
  },
});
