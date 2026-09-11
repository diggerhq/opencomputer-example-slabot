import { defineSchedule } from "@opencomputer/agent";

export default defineSchedule({
  id: "scan-slack-slas",
  cron: "*/5 * * * *",
  timezone: "UTC",
  enabled: ["development", "production"],
  overlap: "skip",
  dispatch: {
    text: "scan-slack-slas",
    payload: {
      operation: "scan-slack-slas",
      lookbackHours: 24,
    },
  },
});
