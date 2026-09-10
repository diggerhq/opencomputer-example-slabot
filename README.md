# OpenComputer Slack Connect SLA monitor

This example ingests messages from explicitly enrolled Slack Connect channels
into Convex. Every five minutes, a fresh OpenComputer session reviews overdue
conversation candidates, suppresses answered or non-actionable requests, and
publishes one idempotent escalation to a configured internal Slack channel.

Convex owns event authenticity, deduplication, workspace identity, timestamps,
leases, and decision state. The model interprets conversational evidence and
writes a concise escalation; it does not own clocks, credentials, or delivery
identity.

## Status

This is a source example awaiting end-to-end Development verification. Do not
use it as an SLA system of record until its Slack installation and recovery
tests have been completed in your environment.

## Prerequisites

- Node.js 22 or newer
- a Convex project
- an OpenComputer project
- a Slack app installed in your workspace and invited to the Slack Connect
  conversations you intend to monitor
- an internal private Slack conversation for alerts

## Install

```bash
npm install
npx convex dev
```

Configure these Convex environment variables:

```text
SLACK_SIGNING_SECRET
SLACK_BOT_TOKEN
SLACK_CONNECT_CHANNEL_IDS=C0123,C0456
SLA_RESPONSE_MINUTES=60
OPENCOMPUTER_SERVICE_TOKEN=<random service credential>
```

Use `SLACK_CONNECT_CHANNEL_IDS=*` only when the app should monitor every
externally shared conversation of which it is a member. The app cannot observe
Slack Connect conversations to which it has not been invited.

Configure the Slack app with the Convex site URL as its Events API request URL:

```text
https://<your-deployment>.convex.site/slack/events
```

Subscribe to `message.channels` and `message.groups`. Grant the bot
`channels:history`, `groups:history`, `channels:read`, `groups:read`, and
`users:read`, then invite it to each monitored Slack Connect conversation.

## Connect the OpenComputer agent

Replace `https://replace-with-your-deployment.convex.site` in
`opencomputer/agents/sla-monitor/tools/convex.ts` with your literal Convex site
origin. OpenComputer connection origins are compiled into immutable
deployments and cannot come from a runtime variable.

Set the same service credential as a managed OpenComputer secret:

```bash
npx --package @opencomputer/cli opencomputer link
npx --package @opencomputer/cli opencomputer secrets set \
  CONVEX_SERVICE_TOKEN --environment development --agent current
```

Start the Development watcher:

```bash
npm run dev
```

In the project dashboard, connect Slack for Development, bind the `sla-alerts`
destination to an internal private conversation, and send an explicit test
message. Slack credentials and destination bindings are environment-specific.

Development displays the schedule as manual-only because recurrence is enabled
only for Production. Use **Run now** to test with fixture Slack events before
promoting:

```bash
npm run deploy -- --alias production
```

Repeat Convex, secret, Slack connection, and destination configuration for
Production. Do not share credentials or operational state between environments.

## Verify

```bash
npm test
npm run typecheck
```

Before using a real customer conversation, verify:

1. invalid and stale Slack signatures are rejected;
2. repeating one Slack `event_id` creates no duplicate candidate;
3. non-Connect and unenrolled conversations are ignored;
4. an external request followed by a substantive internal response is
   dismissed;
5. an unanswered request past its deadline publishes one alert;
6. retry after publication reuses the same outbox idempotency key; and
7. the Convex decision records the accepted OpenComputer outbox item.

The Slack app token is used by Convex to establish conversation and workspace
identity. OpenComputer separately owns the credential used by its Slack outbox.
Whether one Slack app can serve both roles cleanly is an end-to-end verification
gate, not an assumption of this source example.
