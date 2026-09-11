# Slack SLA example setup protocol

This repository is a reusable Development-first demo of a Slack Connect
response-SLA monitor. Convex owns Slack ingestion, deterministic SLA state,
notification delivery, and retries. OpenComputer owns the scheduled semantic
review session. Preserve that boundary.

## Default scope

- Work against explicitly named Development targets unless the user names an
  exact Production target in a new request.
- Never reuse Development Slack apps, Convex deployments, destinations, or
  service credentials in Production.
- Keep the OpenComputer schedule manual-only in Development. Use **Run now** or
  `npm run session -- scan-slack-slas --agent <agent> --keep --verbose` for a
  demo. Development recurrence was observed creating duplicate rapid sessions;
  do not enable it until that platform behavior is fixed and reverified.
- Do not change `enabled: ["production"]` merely to make a recording easier.
- Never force-push, overwrite unrelated work, or deploy Production implicitly.

## Credential rules

- Never print, commit, log, broadly load, or paste a credential into a command
  argument. Do not read workspace `.env*` files wholesale.
- Ask the user to copy one secret at a time, then pipe it through stdin:

  ```bash
  pbpaste | npx convex env set SLACK_SIGNING_SECRET
  pbpaste | npx convex env set SLACK_BOT_TOKEN
  pbpaste | npx opencomputer secrets set CONVEX_SERVICE_TOKEN \
    --value-stdin --environment development --agent current
  ```

- For the shared OpenComputer-to-Convex credential, create a mode-0600
  temporary file with `mktemp`, write a new random value without displaying it,
  pipe that same value into Convex as `OPENCOMPUTER_SERVICE_TOKEN` and
  OpenComputer as `CONVEX_SERVICE_TOKEN`, verify only the secret names, then
  delete the exact temporary file.
- Slack credentials belong only in Convex. OpenComputer must never receive
  `SLACK_BOT_TOKEN` or `SLACK_SIGNING_SECRET`.
- Channel IDs, SLA minutes, and the Convex site origin are configuration, not
  secrets. Still validate them before writing them.

## Required tools and authentication

Before mutating anything, verify:

```bash
node --version
npx convex --version
npx opencomputer whoami
slack version
slack auth list
```

Use the installed Slack CLI for app/project inspection and Slack Web API
operations. Run `slack <command> --help` immediately before relying on syntax;
the CLI changes independently of this example. If Slack authentication is
missing, run `slack auth login` and let the user complete Slack's authorization
step. Never extract or display the resulting token.

Slack may require a human approval, workspace-admin approval, OAuth install,
or manual retrieval of the app signing secret. Treat these as expected secure
handoffs, not reasons to scrape a browser session or credentials.

## Setup sequence

### 1. Prepare the source and Convex Development deployment

1. Confirm the worktree is clean or preserve existing user changes.
2. Run `npm install`.
3. Run `npx convex dev --once` and record the generated `.convex.site` origin.
   Do not confuse it with the `.convex.cloud` URL.
4. Replace the literal origin in
   `opencomputer/agents/sla-monitor/connections/convex.ts` with that exact
   `.convex.site` origin.

### 2. Create or reconcile the Slack app

Prefer a manifest-driven Slack CLI workflow. Inspect the current commands with
`slack project init --help`, `slack app install --help`,
`slack manifest validate --help`, and `slack api --help`. Do not guess flags.

The resulting app configuration must contain:

```yaml
display_information:
  name: SLA Bot
features:
  bot_user:
    display_name: SLA Bot
oauth_config:
  scopes:
    bot:
      - channels:history
      - channels:read
      - groups:history
      - groups:read
      - users:read
      - chat:write
settings:
  socket_mode_enabled: false
  event_subscriptions:
    request_url: https://REPLACE.convex.site/slack/events
    bot_events:
      - message.channels
      - message.groups
```

Use a two-phase app setup because Slack verifies the Events API URL:

1. Create or link the app with its bot identity and OAuth scopes, initially
   omitting event subscriptions if URL verification cannot yet succeed.
2. Install the app to the selected Development workspace and let the user
   approve OAuth.
3. Ask the user to securely copy the app's signing secret and bot OAuth token
   one at a time into the stdin-based Convex commands. Slack does not expose
   the signing secret through ordinary Web API calls; do not attempt to scrape
   it.
4. Deploy Convex again so `/slack/events` can verify Slack's challenge.
5. Apply or reconcile the full manifest with the exact `.convex.site` request
   URL and the two bot events. Confirm Slack reports the URL as verified.
6. If scopes changed, reinstall the app and obtain the current bot token before
   continuing.

If the installed Slack CLI cannot create this classic externally hosted app
from a manifest, use it to validate and inspect the manifest, open the app
settings with `slack app settings`, and pause for the minimum required human
creation/approval step. Do not silently switch to Socket Mode or a Slack-hosted
workflow app; this example requires HTTP Events API delivery to Convex.

### 3. Create the alert channel and enroll Slack Connect channels

Use `slack api` with the selected Development workspace to call current Slack
Web API methods. Inspect each method's current help or Slack documentation
before invocation.

1. Create or find a dedicated internal alert channel, preferably public for a
   low-friction demo and private for a real deployment.
2. Resolve its stable channel ID with `conversations.list` or
   `conversations.info`; never persist only a channel name.
3. Ensure the bot is a member. For a public channel, use the supported
   `conversations.join`/invite flow. For a private channel, a current member or
   admin must invite `@SLA Bot`.
4. Resolve every monitored conversation to an ID and verify with
   `conversations.info` that:
   - `is_ext_shared` is true for a real Slack Connect conversation;
   - `is_member` is true for the bot; and
   - the app can read message history.
5. Use the Slack CLI/API invite operation when the authenticated user is
   allowed to invite apps. If Slack rejects it because of workspace or Slack
   Connect policy, ask the user to run `/invite @SLA Bot` in that channel.
6. Never claim coverage for a Slack Connect channel until membership and an
   actual message event have both been verified.

For a non-Connect demo channel, enable the repository's explicit test override
only for the exact channel and actor IDs. Never enable these overrides in
Production.

### 4. Configure Convex

Set secrets through stdin and non-secret values explicitly on the named
Development deployment:

```text
SLACK_SIGNING_SECRET       secret, copied through stdin
SLACK_BOT_TOKEN            secret, copied through stdin
OPENCOMPUTER_SERVICE_TOKEN secret, generated and shared with OpenComputer
SLACK_ALERT_CHANNEL_ID     one internal destination ID
SLACK_CONNECT_CHANNEL_IDS  comma-separated enrolled source IDs
SLA_RESPONSE_MINUTES       positive integer; use 2 for a recorded demo
```

Development-only simulation values:

```text
ENABLE_TEST_FIXTURES=true
SLACK_TEST_OVERRIDES=true
SLACK_TEST_CHANNEL_IDS=<exact demo channel ID>
SLACK_TEST_ACTOR_USER_IDS=<exact demo user ID>
```

Use `npx convex env set NAME VALUE` for non-secrets. Use stdin for secrets.
Verify with `npx convex env list`, but report only variable names and whether
they exist—never their values.

### 5. Configure OpenComputer

1. Run `npx opencomputer link --create-project <name>` or link the exact project
   selected by the user.
2. Upload the same generated service credential as
   `CONVEX_SERVICE_TOKEN` using `--value-stdin` in Development.
3. Run `npx opencomputer secrets list --environment development --agent current`
   and verify the name exists without exposing its value.
4. Do not add Slack credentials or a Slack connection to OpenComputer. The
   agent only calls the constrained Convex HTTPS connection.

### 6. Deploy the demo

After the one-time setup above, use the repeatable command:

```bash
npm run demo:deploy
```

This removes only the ignored generated agent runtime cache, deploys Convex
Development functions, and deploys the OpenComputer Development agent. It does
not configure secrets or Production.

### 7. Verify the complete path

1. Confirm Slack sends a new event to `/slack/events` and that Convex stores
   and hydrates it without an ignored reason.
2. In a Development override channel, post three top-level messages:
   - one actionable `customer:` request with no reply;
   - one actionable `customer:` request with a timely threaded `team:` reply;
   - one non-actionable `customer:` thank-you.
3. Wait for `SLA_RESPONSE_MINUTES`, then use **Run now** or:

   ```bash
   npm run session -- scan-slack-slas \
     --agent <agent-name> --keep --verbose
   ```

4. Expect exactly one queued and delivered notification, two dismissed
   candidates, and zero failed candidates.
5. Verify the alert shows the real source channel name, Slack-localized times,
   response window, concise summary, and a working **Open Slack thread** link.
6. Run the scan again and confirm it claims zero candidates.
7. Inspect `slaNotifications` and confirm the alert is `delivered`; if delivery
   failed after correcting configuration, run:

   ```bash
   npx convex run notifications:retryQueuedNow '{"limit":25}'
   ```

## Production promotion

Do not promote merely to record the demo. If the user explicitly requests a
named Production deployment:

1. Create a separate Production Convex deployment and Slack app/installation.
2. Configure fresh Production secrets and exact channel IDs.
3. Replace the compiled Convex connection origin with the Production
   `.convex.site` URL.
4. Upload the matching OpenComputer Production service secret.
5. Verify one real Slack Connect channel before broadening enrollment.
6. Deploy with `npm run deploy -- --alias production`.
7. Confirm the five-minute schedule creates one session per interval. Disable
   it immediately if duplicate or rapid sessions appear.

## Required handoff

Report:

- named Slack workspace and app ID, without credentials;
- enrolled source channel IDs and fixed alert channel ID;
- Convex deployment name and `.convex.site` origin;
- OpenComputer project, environment, and deployment ID;
- secret names configured in each system, never values;
- event ingestion, decision, delivery, link, and duplicate-run results; and
- any manual Slack approval or channel invitation still required.
