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
SLACK_ALERT_CHANNEL_ID=C0123
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

For iterative agent development, the optional watcher is:

```bash
npm run dev
```

After the one-time Convex, Slack, OpenComputer link, and secret configuration,
deploy both Development components with one command:

```bash
npm run demo:deploy
```

The Development schedule remains manual-only, so use **Run now** while
recording. This avoids waiting for an interval and prevents unattended demo
sessions from consuming model usage.

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

After connecting the Development Slack channel and configuring the internal
alert conversation, seed an unanswered request with a new fixture ID:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $OC_CONVEX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fixtureId":"unanswered-1","scenario":"unanswered"}' \
  "$CONVEX_SITE_URL/internal/sla/testing/seed-overdue"
```

Run the schedule again. This time the session should call `queue_sla_breach`.
Convex atomically moves the candidate to `notification_pending`, creates one
durable notification, and schedules its Slack delivery. After delivery, one
message should appear in the configured internal conversation and Convex
should record the candidate as `notified`. Re-running the agent schedule must
not create another notification.

The Slack alert uses Block Kit to show the source channel name, the response
window, Slack-localized opened and deadline times, the agent's concise summary,
and a button linked to Slack's canonical thread permalink.

For breach delivery, give the Slack app `chat:write`, invite it to the internal
conversation, and set that conversation's ID as `SLACK_ALERT_CHANNEL_ID` in
Convex. Convex uses the same installation-scoped `SLACK_BOT_TOKEN` for message
hydration and fixed-destination delivery. OpenComputer receives neither the
Slack credential nor permission to select the destination.

Slack delivery and the following Convex state update cannot be one
transaction. Delivery therefore uses a stable Slack `client_msg_id`, a
five-minute delivery lease, exponential retry backoff, and a one-minute
recovery job. This is at-least-once delivery with provider-assisted
deduplication, not a claim of mathematically exact-once external effects.

After correcting a failed Development delivery configuration, an operator can
bypass the existing backoff window without running another agent session:

```bash
npx convex run notifications:retryQueuedNow '{"limit":25}'
```

Development is the recommended target for the recorded demo. **Run now** uses
the same schedule dispatch as recurrence without requiring a second Slack app
and Convex deployment.

For a real Production promotion, first create and configure a separate
Production Convex deployment and Slack installation, replace the literal
Convex site origin with that Production `.convex.site` URL, and set the
Production OpenComputer service secret. Then deploy:

```bash
npm run deploy -- --alias production
```

Repeat Convex, OpenComputer service-secret, Slack app, and destination
configuration for Production. Do not share credentials or operational state
between environments.

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
5. an unanswered request past its deadline queues and delivers one alert;
6. agent retries reuse one notification record and delivery retries reuse the
   same Slack client message ID; and
7. Convex records the Slack channel and message timestamp after delivery.

The Slack app token is used only by Convex to establish conversation and
workspace identity and to deliver alerts to the configured internal channel.
