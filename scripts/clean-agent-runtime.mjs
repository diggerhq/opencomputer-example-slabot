import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const generatedRuntime = fileURLToPath(
  new URL("../opencomputer/agents/sla-monitor/.opencomputer", import.meta.url),
);

await rm(generatedRuntime, { recursive: true, force: true });
