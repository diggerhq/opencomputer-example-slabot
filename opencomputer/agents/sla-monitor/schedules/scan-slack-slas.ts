import { defineSchedule } from "@opencomputer/agent";

export default defineSchedule({
  id: "scan-slack-slas",
  cron: "*/5 * * * *",
  timezone: "UTC",
  enabled: ["production"],
  overlap: "skip",
  dispatch: {
    text: "Scan Slack Connect conversations for breached response SLAs.",
    payload: {
      operation: "scan-slack-slas",
      lookbackHours: 24,
    },
  },
});
