import {
  bearer,
  defineConnection,
  useSecret,
} from "@opencomputer/agent";

/**
 * Copy CONVEX_SITE_URL from the .env.local written by `npx convex dev`.
 * This must end in `.convex.site`, not `.convex.cloud`.
 */
export default defineConnection({
  id: "sla-store",
  origin: "https://fastidious-raccoon-894.convex.site",
  methods: ["POST"],
  pathPrefix: "/internal/sla/",
  headers: {
    Authorization: bearer(useSecret("CONVEX_SERVICE_TOKEN")),
  },
});
