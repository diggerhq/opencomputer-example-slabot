import {
  bearer,
  defineConnection,
  defineTool,
  useSecret,
} from "@opencomputer/agent";
import slaAlerts from "../../../outboxes/sla-alerts.js";

// Replace this literal with the .convex.site hostname printed by `convex dev`.
// OpenComputer deliberately compiles connection origins into the deployment.
const convex = defineConnection({
  id: "sla-store",
  origin: "https://replace-with-your-deployment.convex.site",
  methods: ["POST"],
  pathPrefix: "/internal/sla/",
  headers: {
    Authorization: bearer(useSecret("CONVEX_SERVICE_TOKEN")),
  },
});

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
    const publication = await slaAlerts.publish({
      type: "slack.sla.breached",
      content: {
        title: "Slack Connect response SLA breached",
        body: String(input.summary),
      },
      idempotencyKey: String(input.notificationKey),
    });
    await post(
      "/internal/sla/mark-notified",
      {
        candidateId: String(input.candidateId),
        leaseToken: String(input.leaseToken),
        notificationKey: String(input.notificationKey),
        outboxItemId: publication.id,
        rationale: String(input.rationale),
      },
      signal,
    );
    return { status: publication.status, outboxItemId: publication.id };
  },
});
