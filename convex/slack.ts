import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  normalizeSlackMessage,
  parseSlackEventCallback,
  slackEventForStorage,
} from "../src/slack.js";
import {
  appendEvidence,
  candidateKey,
  deadlineAt,
  notificationKey,
  POLICY_VERSION,
} from "../src/sla.js";

export const ingest = internalMutation({
  args: {
    body: v.any(),
    receivedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const callback = parseSlackEventCallback(args.body);
    if (!callback) return { accepted: false, reason: "unsupported_callback" };
    const existing = await ctx.db
      .query("slackEvents")
      .withIndex("by_event_id", (query) =>
        query.eq("eventId", callback.event_id),
      )
      .unique();
    if (existing) return { accepted: true, duplicate: true };
    await ctx.db.insert("slackEvents", {
      eventId: callback.event_id,
      installationTeamId: callback.team_id,
      apiAppId: callback.api_app_id,
      receivedAt: args.receivedAt,
      event: slackEventForStorage(callback),
    });
    await ctx.scheduler.runAfter(0, internal.slack.hydrate, {
      eventId: callback.event_id,
    });
    return { accepted: true, duplicate: false };
  },
});

export const eventById = internalQuery({
  args: { eventId: v.string() },
  handler: (ctx, args) =>
    ctx.db
      .query("slackEvents")
      .withIndex("by_event_id", (query) => query.eq("eventId", args.eventId))
      .unique(),
});

async function slackApi<T>(
  token: string,
  method: string,
  params: URLSearchParams,
) {
  const response = await fetch(`https://slack.com/api/${method}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!response.ok || !body.ok) {
    throw new Error(`Slack ${method} failed: ${body.error ?? response.status}`);
  }
  return body;
}

export const hydrate = internalAction({
  args: { eventId: v.string() },
  handler: async (ctx, args) => {
    const stored = await ctx.runQuery(internal.slack.eventById, args);
    if (!stored) return;
    const callback = parseSlackEventCallback({
      type: "event_callback",
      event_id: stored.eventId,
      api_app_id: stored.apiAppId,
      team_id: stored.installationTeamId,
      event: stored.event,
    });
    const message = callback ? normalizeSlackMessage(callback) : null;
    if (!message) {
      await ctx.runMutation(internal.slack.ignore, {
        eventId: args.eventId,
        reason: "unsupported_message",
      });
      return;
    }
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error("SLACK_BOT_TOKEN is not configured");
    const [conversation, user] = await Promise.all([
      slackApi<{
        channel: {
          id: string;
          name?: string;
          is_ext_shared?: boolean;
          is_private?: boolean;
          is_member?: boolean;
        };
      }>(
        token,
        "conversations.info",
        new URLSearchParams({ channel: message.channelId }),
      ),
      slackApi<{ user: { id: string; team_id?: string } }>(
        token,
        "users.info",
        new URLSearchParams({ user: message.userId }),
      ),
    ]);
    const enrolledIds = new Set(
      (process.env.SLACK_CONNECT_CHANNEL_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    const enrolled = enrolledIds.has("*") || enrolledIds.has(message.channelId);
    const responseMinutes = Number(process.env.SLA_RESPONSE_MINUTES ?? "60");
    if (!Number.isSafeInteger(responseMinutes) || responseMinutes < 1) {
      throw new Error("SLA_RESPONSE_MINUTES must be a positive integer");
    }
    await ctx.runMutation(internal.slack.recordHydratedMessage, {
      eventId: args.eventId,
      message,
      channel: {
        name: conversation.channel.name,
        isExternalShared: conversation.channel.is_ext_shared === true,
        isPrivate: conversation.channel.is_private === true,
        isMember: conversation.channel.is_member === true,
        enrolled,
      },
      userTeamId: user.user.team_id ?? "unknown",
      responseMinutes,
      now: Date.now(),
    });
  },
});

export const ignore = internalMutation({
  args: { eventId: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("slackEvents")
      .withIndex("by_event_id", (query) => query.eq("eventId", args.eventId))
      .unique();
    if (event && event.normalizedAt === undefined) {
      await ctx.db.patch(event._id, {
        normalizedAt: Date.now(),
        ignoredReason: args.reason,
      });
    }
  },
});

export const recordHydratedMessage = internalMutation({
  args: {
    eventId: v.string(),
    message: v.object({
      eventId: v.string(),
      installationTeamId: v.string(),
      channelId: v.string(),
      threadTs: v.string(),
      messageTs: v.string(),
      userId: v.string(),
      text: v.string(),
    }),
    channel: v.object({
      name: v.optional(v.string()),
      isExternalShared: v.boolean(),
      isPrivate: v.boolean(),
      isMember: v.boolean(),
      enrolled: v.boolean(),
    }),
    userTeamId: v.string(),
    responseMinutes: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("slackEvents")
      .withIndex("by_event_id", (query) => query.eq("eventId", args.eventId))
      .unique();
    if (!event || event.normalizedAt !== undefined) return;

    const currentChannel = await ctx.db
      .query("slackChannels")
      .withIndex("by_installation_channel", (query) =>
        query
          .eq("installationTeamId", args.message.installationTeamId)
          .eq("channelId", args.message.channelId),
      )
      .unique();
    const channelRecord = {
      installationTeamId: args.message.installationTeamId,
      channelId: args.message.channelId,
      ...args.channel,
      checkedAt: args.now,
    };
    if (currentChannel) await ctx.db.patch(currentChannel._id, channelRecord);
    else await ctx.db.insert("slackChannels", channelRecord);

    const currentUser = await ctx.db
      .query("slackUsers")
      .withIndex("by_installation_user", (query) =>
        query
          .eq("installationTeamId", args.message.installationTeamId)
          .eq("userId", args.message.userId),
      )
      .unique();
    const userRecord = {
      installationTeamId: args.message.installationTeamId,
      userId: args.message.userId,
      userTeamId: args.userTeamId,
      isInternal: args.userTeamId === args.message.installationTeamId,
      checkedAt: args.now,
    };
    if (currentUser) await ctx.db.patch(currentUser._id, userRecord);
    else await ctx.db.insert("slackUsers", userRecord);

    if (
      !args.channel.isExternalShared ||
      !args.channel.isMember ||
      !args.channel.enrolled
    ) {
      await ctx.db.patch(event._id, {
        normalizedAt: args.now,
        ignoredReason: "conversation_not_enrolled",
      });
      return;
    }

    const currentCandidate = await ctx.db
      .query("slaCandidates")
      .withIndex("by_thread_state", (query) =>
        query
          .eq("installationTeamId", args.message.installationTeamId)
          .eq("channelId", args.message.channelId)
          .eq("threadTs", args.message.threadTs)
          .eq("state", "pending"),
      )
      .unique();
    const sentAt = Math.floor(Number(args.message.messageTs) * 1_000);
    if (!Number.isFinite(sentAt)) {
      throw new Error("Invalid Slack message timestamp");
    }
    const evidence = {
      messageTs: args.message.messageTs,
      sentAt,
      withinDeadline: currentCandidate
        ? sentAt <= currentCandidate.deadlineAt
        : true,
      userId: args.message.userId,
      direction: userRecord.isInternal
        ? ("internal" as const)
        : ("external" as const),
      text: args.message.text,
    };
    if (currentCandidate) {
      await ctx.db.patch(currentCandidate._id, {
        evidence: appendEvidence(currentCandidate.evidence, evidence),
      });
    } else if (!userRecord.isInternal) {
      const openedAt = sentAt;
      const key = candidateKey({
        installationTeamId: args.message.installationTeamId,
        channelId: args.message.channelId,
        threadTs: args.message.threadTs,
        openedAt,
      });
      await ctx.db.insert("slaCandidates", {
        candidateKey: key,
        notificationKey: notificationKey(key),
        installationTeamId: args.message.installationTeamId,
        channelId: args.message.channelId,
        threadTs: args.message.threadTs,
        openedAt,
        deadlineAt: deadlineAt(openedAt, args.responseMinutes),
        policyVersion: POLICY_VERSION,
        state: "pending",
        evidence: [evidence],
      });
    }
    await ctx.db.patch(event._id, { normalizedAt: args.now });
  },
});
