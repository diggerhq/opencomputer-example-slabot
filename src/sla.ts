export type SlaEvidence = {
  messageTs: string;
  sentAt: number;
  withinDeadline: boolean;
  userId: string;
  direction: "external" | "internal";
  text: string;
};

export function candidateKey(input: {
  installationTeamId: string;
  channelId: string;
  threadTs: string;
  openedAt: number;
  responseMinutes: number;
}): string {
  return [
    "slack-sla",
    input.installationTeamId,
    input.channelId,
    input.threadTs,
    String(input.openedAt),
    policyVersion(input.responseMinutes),
  ].join(":");
}

export function policyVersion(responseMinutes: number): string {
  if (!Number.isSafeInteger(responseMinutes) || responseMinutes < 1) {
    throw new Error("responseMinutes must be a positive integer");
  }
  return `wall-clock-${responseMinutes}m-v1`;
}

export function notificationKey(candidateKey: string): string {
  return `${candidateKey}:breach`;
}

export async function stableSlackClientMessageId(
  value: string,
): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function deadlineAt(openedAt: number, responseMinutes: number): number {
  if (!Number.isSafeInteger(responseMinutes) || responseMinutes < 1) {
    throw new Error("responseMinutes must be a positive integer");
  }
  return openedAt + responseMinutes * 60_000;
}

export function appendEvidence(
  current: readonly SlaEvidence[],
  next: SlaEvidence,
  maximum = 50,
): SlaEvidence[] {
  const byTimestamp = new Map(current.map((item) => [item.messageTs, item]));
  byTimestamp.set(next.messageTs, next);
  return [...byTimestamp.values()]
    .sort((left, right) => Number(left.messageTs) - Number(right.messageTs))
    .slice(-maximum);
}
