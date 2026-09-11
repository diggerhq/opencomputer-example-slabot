import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "recover pending Slack SLA notifications",
  { minutes: 1 },
  internal.notifications.recover,
  {},
);

export default crons;
