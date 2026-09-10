import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
  deadlineAt,
  notificationKey,
  POLICY_VERSION,
  type SlaEvidence,
} from "../src/sla.js";

export const seedOverdue = internalMutation({
  args: {
    fixtureId: v.string(),
    scenario: v.union(v.literal("answered"), v.literal("unanswered")),
  },
  handler: async (ctx, args) => {
    const fixtureId = args.fixtureId.trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(fixtureId)) {
      throw new Error("fixtureId must contain 1-64 letters, numbers, _ or -");
    }

    const openedAt = Date.now() - 65 * 60_000;
    const threadTs = String(openedAt / 1_000);
    const key = `slack-sla:T_FIXTURE:C_FIXTURE:${fixtureId}:${POLICY_VERSION}`;
    const existing = await ctx.db
      .query("slaCandidates")
      .withIndex("by_candidate_key", (query) => query.eq("candidateKey", key))
      .unique();
    if (existing) {
      return { id: existing._id, state: existing.state, duplicate: true };
    }

    const deadline = deadlineAt(openedAt, 60);
    const evidence: SlaEvidence[] = [
      {
        messageTs: threadTs,
        sentAt: openedAt,
        withinDeadline: true,
        userId: "U_EXTERNAL_FIXTURE",
        direction: "external",
        text: "Can someone help? Our production integration is returning errors.",
      },
    ];
    if (args.scenario === "answered") {
      const sentAt = openedAt + 10 * 60_000;
      evidence.push({
        messageTs: String(sentAt / 1_000),
        sentAt,
        withinDeadline: sentAt <= deadline,
        userId: "U_INTERNAL_FIXTURE",
        direction: "internal",
        text: "I own this investigation and will post the next update within 30 minutes.",
      });
    }

    const id = await ctx.db.insert("slaCandidates", {
      candidateKey: key,
      notificationKey: notificationKey(key),
      installationTeamId: "T_FIXTURE",
      channelId: "C_FIXTURE",
      threadTs: `${threadTs}-${fixtureId}`,
      openedAt,
      deadlineAt: deadline,
      policyVersion: POLICY_VERSION,
      state: "pending",
      evidence,
    });
    return { id, state: "pending" as const, duplicate: false };
  },
});
