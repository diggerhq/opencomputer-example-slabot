import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const evidence = v.object({
  messageTs: v.string(),
  sentAt: v.number(),
  withinDeadline: v.boolean(),
  userId: v.string(),
  direction: v.union(v.literal("external"), v.literal("internal")),
  text: v.string(),
});

export default defineSchema({
  slackEvents: defineTable({
    eventId: v.string(),
    installationTeamId: v.string(),
    apiAppId: v.string(),
    receivedAt: v.number(),
    event: v.any(),
    normalizedAt: v.optional(v.number()),
    ignoredReason: v.optional(v.string()),
  }).index("by_event_id", ["eventId"]),

  slackChannels: defineTable({
    installationTeamId: v.string(),
    channelId: v.string(),
    name: v.optional(v.string()),
    isExternalShared: v.boolean(),
    isPrivate: v.boolean(),
    isMember: v.boolean(),
    enrolled: v.boolean(),
    checkedAt: v.number(),
  }).index("by_installation_channel", ["installationTeamId", "channelId"]),

  slackUsers: defineTable({
    installationTeamId: v.string(),
    userId: v.string(),
    userTeamId: v.string(),
    isInternal: v.boolean(),
    checkedAt: v.number(),
  }).index("by_installation_user", ["installationTeamId", "userId"]),

  slaCandidates: defineTable({
    candidateKey: v.string(),
    notificationKey: v.string(),
    installationTeamId: v.string(),
    channelId: v.string(),
    threadTs: v.string(),
    openedAt: v.number(),
    deadlineAt: v.number(),
    policyVersion: v.string(),
    state: v.union(
      v.literal("pending"),
      v.literal("dismissed"),
      v.literal("notified"),
    ),
    evidence: v.array(evidence),
    leaseToken: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    decisionReason: v.optional(v.string()),
    outboxItemId: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
  })
    .index("by_candidate_key", ["candidateKey"])
    .index("by_thread_state", [
      "installationTeamId",
      "channelId",
      "threadTs",
      "state",
    ])
    .index("by_state_deadline", ["state", "deadlineAt"])
    .index("by_state_opened_at", ["state", "openedAt"]),

  slaDecisions: defineTable({
    candidateId: v.id("slaCandidates"),
    outcome: v.union(v.literal("dismissed"), v.literal("notified")),
    reason: v.string(),
    notificationKey: v.optional(v.string()),
    outboxItemId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_candidate", ["candidateId"]),
});
