export type SlackAlertInput = {
  channelName: string;
  permalink: string;
  openedAt: number;
  deadlineAt: number;
  detectedAt: number;
  summary: string;
};

function escapeMrkdwn(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function slackDateTime(timestampMs: number): string {
  const seconds = Math.floor(timestampMs / 1_000);
  const fallback = new Date(timestampMs).toISOString();
  return `<!date^${seconds}^{date_short_pretty} at {time}|${fallback}>`;
}

function minutesBetween(start: number, end: number): number {
  return Math.max(1, Math.round((end - start) / 60_000));
}

export function buildSlackAlert(input: SlackAlertInput) {
  const channelName = escapeMrkdwn(input.channelName.replace(/^#/, ""));
  const summary = escapeMrkdwn(input.summary.trim());
  const responseMinutes = minutesBetween(input.openedAt, input.deadlineAt);
  const overdueMinutes = minutesBetween(input.deadlineAt, input.detectedAt);
  const text = `Slack response SLA breached in #${input.channelName.replace(/^#/, "")}: ${input.summary.trim()} ${input.permalink}`;

  return {
    text,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🚨 Slack response SLA breached",
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Channel*\n<${input.permalink}|#${channelName}>`,
          },
          {
            type: "mrkdwn",
            text: `*Response SLA*\n${responseMinutes} minutes`,
          },
          {
            type: "mrkdwn",
            text: `*Request opened*\n${slackDateTime(input.openedAt)}`,
          },
          {
            type: "mrkdwn",
            text: `*Deadline*\n${slackDateTime(input.deadlineAt)}`,
          },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*What needs attention*\n${summary}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Detected ${overdueMinutes} minutes after the response deadline.`,
          },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Open Slack thread",
              emoji: true,
            },
            style: "primary",
            url: input.permalink,
          },
        ],
      },
    ],
  };
}
