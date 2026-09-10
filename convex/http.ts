import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { verifySlackRequest } from "../src/slack.js";

const http = httpRouter();

function serviceAuthorized(request: Request): boolean {
  const expected = process.env.OPENCOMPUTER_SERVICE_TOKEN;
  return Boolean(
    expected && request.headers.get("authorization") === `Bearer ${expected}`,
  );
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object");
  }
  return value as Record<string, unknown>;
}

http.route({
  path: "/slack/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (
      !signingSecret ||
      !(await verifySlackRequest(rawBody, request.headers, signingSecret))
    ) {
      return new Response("Unauthorized", { status: 401 });
    }
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    if (
      body.type === "url_verification" &&
      typeof body.challenge === "string"
    ) {
      return Response.json({ challenge: body.challenge });
    }
    const result = await ctx.runMutation(internal.slack.ingest, {
      body,
      receivedAt: Date.now(),
    });
    return Response.json(result);
  }),
});

http.route({
  path: "/internal/sla/claim-due",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!serviceAuthorized(request)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const body = await jsonBody(request);
    const candidates = await ctx.runMutation(internal.sla.claimDue, {
      lookbackHours: Number(body.lookbackHours),
      limit: Number(body.limit),
      leaseToken: String(body.leaseToken ?? ""),
    });
    return Response.json({ candidates });
  }),
});

http.route({
  path: "/internal/sla/testing/seed-overdue",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (process.env.ENABLE_TEST_FIXTURES !== "true") {
      return new Response("Not found", { status: 404 });
    }
    if (!serviceAuthorized(request)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const body = await jsonBody(request);
    const scenario = body.scenario;
    if (scenario !== "answered" && scenario !== "unanswered") {
      return new Response("scenario must be answered or unanswered", {
        status: 400,
      });
    }
    return Response.json(
      await ctx.runMutation(internal.fixtures.seedOverdue, {
        fixtureId: String(body.fixtureId ?? ""),
        scenario,
      }),
    );
  }),
});

http.route({
  path: "/internal/sla/dismiss",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!serviceAuthorized(request)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const body = await jsonBody(request);
    return Response.json(
      await ctx.runMutation(internal.sla.dismiss, {
        candidateId: String(body.candidateId ?? ""),
        leaseToken: String(body.leaseToken ?? ""),
        reason: String(body.reason ?? ""),
      }),
    );
  }),
});

http.route({
  path: "/internal/sla/mark-notified",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!serviceAuthorized(request)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const body = await jsonBody(request);
    return Response.json(
      await ctx.runMutation(internal.sla.markNotified, {
        candidateId: String(body.candidateId ?? ""),
        leaseToken: String(body.leaseToken ?? ""),
        notificationKey: String(body.notificationKey ?? ""),
        outboxItemId: String(body.outboxItemId ?? ""),
        rationale: String(body.rationale ?? ""),
      }),
    );
  }),
});

export default http;
