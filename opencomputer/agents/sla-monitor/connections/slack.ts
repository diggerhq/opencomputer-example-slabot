import { bearer, defineConnection, useSecret } from "@opencomputer/agent";

export default defineConnection({
  id: "slack-alerts",
  origin: "https://slack.com",
  methods: ["POST"],
  pathPrefix: "/api/chat.postMessage",
  headers: {
    Authorization: bearer(useSecret("SLACK_ALERT_BOT_TOKEN")),
  },
});
