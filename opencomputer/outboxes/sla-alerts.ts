import { defineOutbox } from "@opencomputer/agent";
import teamSlack from "../channels/team-slack.js";

export default defineOutbox({
  id: "sla-alerts",
  delivery: {
    channel: teamSlack,
    destination: "sla-alerts",
  },
});
