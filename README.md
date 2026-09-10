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
ENABLE_TEST_FIXTURES=true # Development only; omit from Production
SLACK_TEST_OVERRIDES=true # Development only; omit from Production
SLACK_TEST_CHANNEL_IDS=C0123
SLACK_TEST_ACTOR_USER_IDS=U0123
```

Use `SLACK_CONNECT_CHANNEL_IDS=*` only when the app should monitor every
externally shared conversation of which it is a member. The app cannot observe
Slack Connect conversations to which it has not been invited.

For a non-Connect Development channel, the three `SLACK_TEST_*` variables let
exact users in exact channels simulate both sides. Post `customer: ...` as a
top-level message, then reply in its thread with `team: ...`. Unprefixed
messages and all non-allowlisted users or channels retain their real Slack
identity. Never enable these overrides in Production.

Configure the Slack app with the Convex site URL as its Events API request URL:

```text
https://<your-deployment>.convex.site/slack/events
```

Subscribe to `message.channels` and `message.groups`. Grant the bot
`channels:history`, `groups:history`, `channels:read`, `groups:read`, and
`users:read`, then invite it to each monitored Slack Connect conversation.

## Connect the OpenComputer agent

Copy the `CONVEX_SITE_URL` written to `.env.local` by `npx convex dev` into
`opencomputer/agents/sla-monitor/connections/convex.ts`. It must be the
`.convex.site` HTTP Actions origin, not the `.convex.cloud` client URL.
OpenComputer resolves this configuration when it builds the immutable
deployment.

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

## Test your agent before connecting Slack

First use an authenticated fixture to verify the personal Convex deployment,
OpenComputer connection, scheduled session, and persisted decision. This does
not require Slack ingestion or a Slack alert destination.

Copy `CONVEX_SITE_URL` from the ignored `.env.local` created by
`npx convex dev`; it must end in `.convex.site`. Seed an overdue request that
was answered within its SLA:

```bash
read -r "CONVEX_SITE_URL?Convex site URL: "
read -rs "OC_CONVEX_TOKEN?Shared service token: "; echo
curl --fail-with-body \
  -H "Authorization: Bearer $OC_CONVEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fixtureId":"answered-1","scenario":"answered"}' \
  "$CONVEX_SITE_URL/internal/sla/testing/seed-overdue"
```

Open the Development project dashboard, select the `scan-slack-slas` schedule,
and choose **Run now**, or run the exact Development smoke-test command:

```bash
npm run session -- scan-slack-slas --agent opencomputer-example-slack-sla --keep --verbose
```

The resulting session should call `claim_sla_candidates`, then
`dismiss_sla_candidate`; the Convex candidate should become `dismissed`.

After connecting the Development Slack channel and binding the `sla-alerts`
destination, seed an unanswered request with a new fixture ID:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $OC_CONVEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fixtureId":"unanswered-1","scenario":"unanswered"}' \
  "$CONVEX_SITE_URL/internal/sla/testing/seed-overdue"
```

Run the schedule again. This time the session should call
`publish_sla_breach`, one message should appear in the configured internal
Slack conversation, and Convex should record the candidate as `notified` with
the OpenComputer outbox item ID. Re-running the schedule must not publish a
second message.

For breach delivery, put the internal conversation ID in
`opencomputer/agents/sla-monitor/config.ts`. Give the Slack app `chat:write`,
invite it to that conversation, and store its bot token in OpenComputer:

```bash
npx opencomputer secrets set SLACK_ALERT_BOT_TOKEN \
  --environment development --agent current
```

The destination is code-pinned and the token is released only to Slack's
`chat.postMessage` endpoint. This direct connection is the current shipped
fallback while code-defined OpenComputer outboxes are not available in the
managed runtime.

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
