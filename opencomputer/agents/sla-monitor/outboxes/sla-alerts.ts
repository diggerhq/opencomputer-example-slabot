import { registerOutbox } from "@opencomputer/agent";
import slaAlerts from "../../../outboxes/sla-alerts.js";

export default registerOutbox(slaAlerts);
