import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const claimDue = internalMutation({
  args: {
    lookbackHours: v.number(),
    limit: v.number(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (!Number.isFinite(args.lookbackHours) || args.lookbackHours < 1) {
      throw new Error("lookbackHours must be a positive number");
    }
    if (!Number.isFinite(args.limit) || args.limit < 1) {
      throw new Error("limit must be a positive number");
    }
    if (!args.leaseToken) throw new Error("leaseToken is required");
    const limit = Math.max(1, Math.min(25, Math.floor(args.limit)));
    const lookbackHours = Math.max(
      1,
      Math.min(168, Math.floor(args.lookbackHours)),
    );
    const openedSince = now - lookbackHours * 60 * 60_000;
    const rows = await ctx.db
      .query("slaCandidates")
      .withIndex("by_state_opened_at", (query) =>
        query.eq("state", "pending").gte("openedAt", openedSince),
      )
      .take(100);
    const eligible = rows
      .filter(
        (row) =>
          row.deadlineAt <= now &&
          (row.leaseExpiresAt === undefined || row.leaseExpiresAt <= now),
      )
      .sort((left, right) => left.deadlineAt - right.deadlineAt)
      .slice(0, limit);
    const leaseExpiresAt = now + 5 * 60_000;
    for (const row of eligible) {
      await ctx.db.patch(row._id, {
        leaseToken: args.leaseToken,
        leaseExpiresAt,
      });
    }
    return eligible.map((row) => ({
      id: row._id,
      candidateKey: row.candidateKey,
      notificationKey: row.notificationKey,
      leaseToken: args.leaseToken,
      channelId: row.channelId,
      threadTs: row.threadTs,
      openedAt: row.openedAt,
      deadlineAt: row.deadlineAt,
      evidence: row.evidence,
    }));
  },
});

async function claimedCandidate(
  ctx: MutationCtx,
  candidateId: string,
  leaseToken: string,
) {
  const candidate = await ctx.db.get(candidateId as Id<"slaCandidates">);
  if (
    !candidate ||
    candidate.state !== "pending" ||
    candidate.leaseToken !== leaseToken ||
    candidate.leaseExpiresAt === undefined ||
    candidate.leaseExpiresAt < Date.now()
  ) {
    throw new Error("Candidate lease is missing or expired");
  }
  return candidate;
}

export const dismiss = internalMutation({
  args: {
    candidateId: v.string(),
    leaseToken: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const candidate = await claimedCandidate(
      ctx,
      args.candidateId,
      args.leaseToken,
    );
    const now = Date.now();
    await ctx.db.patch(candidate._id, {
      state: "dismissed",
      decisionReason: args.reason.slice(0, 1_000),
      decidedAt: now,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
    });
    await ctx.db.insert("slaDecisions", {
      candidateId: candidate._id,
      outcome: "dismissed",
      reason: args.reason.slice(0, 1_000),
      createdAt: now,
    });
    return { status: "dismissed" };
  },
});
