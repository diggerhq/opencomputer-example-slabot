import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { stableSlackClientMessageId } from "../src/sla.js";

const DELIVERY_LEASE_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;

function retryDelayMs(attemptCount: number): number {
  return Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** Math.min(6, attemptCount - 1));
}

async function dispatch(
  ctx: MutationCtx,
  notification: Doc<"slaNotifications">,
  now: number,
) {
  const deliveryToken = `${notification._id}:${notification.attemptCount + 1}:${now}`;
  const leaseExpiresAt = now + DELIVERY_LEASE_MS;
  await ctx.db.patch(notification._id, {
    state: "delivering",
    attemptCount: notification.attemptCount + 1,
    nextAttemptAt: leaseExpiresAt,
    leaseToken: deliveryToken,
    leaseExpiresAt,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, {
    notificationId: notification._id,
    deliveryToken,
  });
}

export const queue = internalMutation({
  args: {
    candidateId: v.string(),
    leaseToken: v.string(),
    notificationKey: v.string(),
    summary: v.string(),
    rationale: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("slaNotifications")
      .withIndex("by_notification_key", (query) =>
        query.eq("notificationKey", args.notificationKey),
      )
      .unique();
    if (existing) {
      if (String(existing.candidateId) !== args.candidateId) {
        throw new Error("Notification key belongs to another candidate");
      }
      return { status: existing.state, notificationId: existing._id };
    }

    const candidate = await ctx.db.get(args.candidateId as Id<"slaCandidates">);
    if (
      !candidate ||
      candidate.state !== "pending" ||
      candidate.leaseToken !== args.leaseToken ||
      candidate.leaseExpiresAt === undefined ||
      candidate.leaseExpiresAt < Date.now()
    ) {
      throw new Error("Candidate lease is missing or expired");
    }
    if (candidate.notificationKey !== args.notificationKey) {
      throw new Error("Notification key does not match the claimed candidate");
    }
    const summary = args.summary.trim().slice(0, 2_000);
    const rationale = args.rationale.trim().slice(0, 1_000);
    if (!summary || !rationale) {
      throw new Error("summary and rationale are required");
    }

    const now = Date.now();
    const notificationId = await ctx.db.insert("slaNotifications", {
      candidateId: candidate._id,
      notificationKey: args.notificationKey,
      summary,
      rationale,
      state: "queued",
      attemptCount: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(candidate._id, {
      state: "notification_pending",
      decisionReason: rationale,
      decidedAt: now,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
    });
    const notification = await ctx.db.get(notificationId);
    if (!notification) throw new Error("Failed to create notification");
    await dispatch(ctx, notification, now);
    return { status: "queued", notificationId };
  },
});

export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [queued, expired] = await Promise.all([
      ctx.db
        .query("slaNotifications")
        .withIndex("by_state_next_attempt", (query) =>
          query.eq("state", "queued").lte("nextAttemptAt", now),
        )
        .take(25),
      ctx.db
        .query("slaNotifications")
        .withIndex("by_state_next_attempt", (query) =>
          query.eq("state", "delivering").lte("nextAttemptAt", now),
        )
        .take(25),
    ]);
    for (const notification of [...queued, ...expired].slice(0, 25)) {
      await dispatch(ctx, notification, now);
    }
    return { scheduled: Math.min(25, queued.length + expired.length) };
  },
});

export const deliveryContext = internalQuery({
  args: {
    notificationId: v.id("slaNotifications"),
    deliveryToken: v.string(),
  },
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);
    if (
      !notification ||
      notification.state !== "delivering" ||
      notification.leaseToken !== args.deliveryToken ||
      notification.leaseExpiresAt === undefined ||
      notification.leaseExpiresAt < Date.now()
    ) {
      return null;
    }
    return {
      notificationKey: notification.notificationKey,
      summary: notification.summary,
    };
  },
});

export const recordFailure = internalMutation({
  args: {
    notificationId: v.id("slaNotifications"),
    deliveryToken: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);
    if (
      !notification ||
      notification.state !== "delivering" ||
      notification.leaseToken !== args.deliveryToken
    ) {
      return { status: "stale" };
    }
    const now = Date.now();
    await ctx.db.patch(notification._id, {
      state: "queued",
      nextAttemptAt: now + retryDelayMs(notification.attemptCount),
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      lastError: args.error.slice(0, 1_000),
      updatedAt: now,
    });
    return { status: "retry_scheduled" };
  },
});

export const recordDelivered = internalMutation({
  args: {
    notificationId: v.id("slaNotifications"),
    deliveryToken: v.string(),
    slackChannelId: v.string(),
    slackMessageTs: v.string(),
  },
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);
    if (
      !notification ||
      notification.state !== "delivering" ||
      notification.leaseToken !== args.deliveryToken
    ) {
      return { status: "stale" };
    }
    const candidate = await ctx.db.get(notification.candidateId);
    if (!candidate || candidate.state !== "notification_pending") {
      throw new Error("Notification candidate is not pending delivery");
    }
    const now = Date.now();
    const outboxItemId = `slack:${args.slackChannelId}:${args.slackMessageTs}`;
    await ctx.db.patch(notification._id, {
      state: "delivered",
      nextAttemptAt: now,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      lastError: undefined,
      slackChannelId: args.slackChannelId,
      slackMessageTs: args.slackMessageTs,
      updatedAt: now,
    });
    await ctx.db.patch(candidate._id, {
      state: "notified",
      outboxItemId,
      decidedAt: now,
    });
    await ctx.db.insert("slaDecisions", {
      candidateId: candidate._id,
      outcome: "notified",
      reason: notification.rationale,
      notificationKey: notification.notificationKey,
      outboxItemId,
      createdAt: now,
    });
    return { status: "delivered", outboxItemId };
  },
});

export const deliver = internalAction({
  args: {
    notificationId: v.id("slaNotifications"),
    deliveryToken: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: string; outboxItemId?: string }> => {
    const delivery = await ctx.runQuery(
      internal.notifications.deliveryContext,
      args,
    );
    if (!delivery) return { status: "stale" };

    try {
      const token = process.env.SLACK_BOT_TOKEN;
      const channel = process.env.SLACK_ALERT_CHANNEL_ID;
      if (!token) throw new Error("SLACK_BOT_TOKEN is not configured");
      if (!channel || !/^([CGD])[A-Z0-9]+$/.test(channel)) {
        throw new Error("SLACK_ALERT_CHANNEL_ID is not configured");
      }
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          channel,
          text: `*Slack Connect response SLA breached*\n${delivery.summary}`,
          client_msg_id: await stableSlackClientMessageId(
            delivery.notificationKey,
          ),
          unfurl_links: false,
          unfurl_media: false,
        }),
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
      return await ctx.runMutation(internal.notifications.recordDelivered, {
        ...args,
        slackChannelId: result.channel,
        slackMessageTs: result.ts,
      });
    } catch (error) {
      await ctx.runMutation(internal.notifications.recordFailure, {
        ...args,
        error:
          error instanceof Error ? error.message : "Unknown delivery error",
      });
      return { status: "retry_scheduled" };
    }
  },
});
