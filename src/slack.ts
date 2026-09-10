export type SlackEventCallback = {
  type: "event_callback";
  event_id: string;
  api_app_id: string;
  team_id: string;
  event: Record<string, unknown>;
};

export type SlackMessage = {
  eventId: string;
  installationTeamId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  userId: string;
  text: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseSlackEventCallback(
  value: unknown,
): SlackEventCallback | null {
  const body = record(value);
  const event = record(body?.event);
  const eventId = nonEmptyString(body?.event_id);
  const appId = nonEmptyString(body?.api_app_id);
  const teamId = nonEmptyString(body?.team_id);
  if (
    body?.type !== "event_callback" ||
    !event ||
    !eventId ||
    !appId ||
    !teamId
  ) {
    return null;
  }
  return {
    type: "event_callback",
    event_id: eventId,
    api_app_id: appId,
    team_id: teamId,
    event,
  };
}

export function normalizeSlackMessage(
  callback: SlackEventCallback,
): SlackMessage | null {
  const event = callback.event;
  if (
    event.type !== "message" ||
    event.bot_id !== undefined ||
    event.subtype !== undefined
  ) {
    return null;
  }
  const channelId = nonEmptyString(event.channel);
  const messageTs = nonEmptyString(event.ts);
  const userId = nonEmptyString(event.user);
  const text = nonEmptyString(event.text);
  if (!channelId || !messageTs || !userId || !text) return null;
  return {
    eventId: callback.event_id,
    installationTeamId: callback.team_id,
    channelId,
    threadTs: nonEmptyString(event.thread_ts) ?? messageTs,
    messageTs,
    userId,
    text: text.slice(0, 8_000),
  };
}

export function slackEventForStorage(
  callback: SlackEventCallback,
): Record<string, unknown> {
  const event = callback.event;
  const stored: Record<string, unknown> = {};
  for (const key of [
    "type",
    "channel",
    "user",
    "ts",
    "thread_ts",
    "subtype",
    "bot_id",
  ] as const) {
    if (event[key] !== undefined) stored[key] = event[key];
  }
  if (typeof event.text === "string") stored.text = event.text.slice(0, 8_000);
  return stored;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  const size = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < size; index += 1) {
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function verifySlackRequest(
  rawBody: string,
  headers: Headers,
  signingSecret: string,
  now = Date.now(),
): Promise<boolean> {
  const timestamp = headers.get("x-slack-request-timestamp");
  const signature = headers.get("x-slack-signature");
  if (!timestamp || !signature?.startsWith("v0=")) return false;
  const timestampSeconds = Number(timestamp);
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(now - timestampSeconds * 1_000) > 5 * 60 * 1_000
  ) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v0:${timestamp}:${rawBody}`),
  );
  return constantTimeEqual(
    signature.slice(3),
    bytesToHex(new Uint8Array(digest)),
  );
}
