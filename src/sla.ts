export const POLICY_VERSION = "wall-clock-60m-v1";

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
}): string {
  return [
    "slack-sla",
    input.installationTeamId,
    input.channelId,
    input.threadTs,
    String(input.openedAt),
    POLICY_VERSION,
  ].join(":");
}

export function notificationKey(candidateKey: string): string {
  return `${candidateKey}:breach`;
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
