import { defineChannel } from "@opencomputer/agent";

export default defineChannel({
  id: "team-slack",
  type: "slack",
  displayName: "Internal Slack alerts",
  scopes: {
    bot: ["groups:read", "chat:write"],
  },
  destinations: {
    "sla-alerts": {
      type: "conversation",
      visibility: "private",
    },
  },
});
