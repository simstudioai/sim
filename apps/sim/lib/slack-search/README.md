# Enterprise Search in Slack

Organization admins configure this under **Settings → Sim Search in Slack**.
Members DM the bot to use the existing organization Enterprise Search Assistant,
including its search/read tools, model policy, source permissions, and billing.
The orchestration is TypeScript application code; no saved workflow graph or
separate agent framework is involved.

## Setup

1. The wizard generates the **Sim Search** app manifest with the default
   description, “Ask questions about your organization’s knowledge and get
   answers with sources.” Create the app in your Slack workspace using the
   prepared link or copyable JSON preview.
2. Copy **Client ID**, **Client Secret**, and **Signing Secret** from Slack’s
   **Basic Information** page into the wizard.
3. Choose **Install in Slack** and complete Slack OAuth. The bot token comes from
   OAuth; it is never entered manually.
4. The callback rechecks the initiating admin’s current access, validates the
   app/workspace/bot identity and granted scopes, and atomically enables Search.

Slack source setup and Settings → Sim Search in Slack open the same
`components/integrations/slack-search-setup-wizard.tsx`. Source setup prompts
**Install Sim Search first** when the organization has no registered app. Once
installed, source setup only verifies member authorization against that app;
it never asks for a second client ID or client secret. Members then connect
their individual accounts through the existing source connection flow.

Every installation uses one code-defined app configuration. The wizard has no
feature switches and stores no per-app capabilities. The bot grants
`assistant:write`, `chat:write`, `im:history`, `im:write`, `app_mentions:read`,
`users:read`, and `users:read.email`. Agent View is enabled, with `message.im`,
`app_mention`, and `agent_session_stopped` subscriptions.

The same app supplies separate member OAuth grants for channel and DM indexing:
`users:read`, `users:read.email`, and the read/history scopes for channels,
private channels, DMs, and group DMs. Installing the bot does not authorize a
member's personal history. Members connect through the existing source flow;
connector settings choose which conversations to index. DM indexing is opt-in.
Existing member scopes are preserved when regenerating the app manifest.
Enterprise Grid deployment and token rotation remain disabled.

Organization credential groups reference the registered `slack_app` instead of
storing another copy of its client credentials. Setting up Search adopts an
existing member app only when its app and workspace identities match. Reconnect
reuses saved app credentials unless the admin supplies replacements.

`NEXT_PUBLIC_APP_URL` must be the public HTTPS origin used consistently by both:

- Events and interactivity: `/api/webhooks/slack`
- Bot OAuth callback: `/api/knowledge/slack/oauth/callback`
- Member app validation: `/api/credential-groups/slack-managed-users/callback`
- Member enrollment: `/api/credential-groups/oauth/slack/callback`

Redis is required for ten-minute, single-use OAuth state. The encrypted setup
attempt is bound to the initiating user, browser session, organization, and
expected installation revision. A different session cannot consume it. App
secrets are never included in setup read responses.

## Storage and deployment

Apply `0332_slack_search` after the existing staging migration history. Local development can use `bun run
db:push` from `packages/db`. Current staging schema requires PostgreSQL 15 or
newer; PostgreSQL 17 with pgvector is suitable.

| Table | Purpose |
| --- | --- |
| `slack_app` | Slack app ID, custom/shared ownership, client ID, encrypted client and signing secrets, and configuration revision. |
| `credential` | Organization-owned bot token with `workspace_id = NULL` and `slack_app_id` referencing the app configuration. |
| `slack_search_installation` | Verified app/workspace/bot binding to an organization and credential, enabled state, and revisions. |
| `copilot_chats` | Ordinary private Mothership chat with a unique external conversation key and Slack sender/root/Stop metadata. |
| `slack_search_turn` | External conversation key, deduplicated event, FIFO ordinal, execution lease, status, and outcome. |
| `outbox_event` | Durable wake-up delivery for pending Slack turns. |

Slack threads use the existing `copilot_chats.id` UUID in history URLs:
`/o/[organizationId]/chat/[chatId]`. `external_conversation_key` is a namespaced
JSON tuple of installation ID, DM channel ID, and root Slack timestamp, with a
unique database index. It is an external identity, not an authorization token.
`external_conversation_metadata` stores the stable Slack user ID and Stop
watermark; `user_id` owns the private chat. Email is resolved and checked against
current verified membership, never used as the conversation key. No separate
Slack thread table is needed. Forking a chat does not copy its external binding.

The first durable event binds the Slack sender even before they have a Sim
account; a chat is created only after member authorization. A changed Sim
identity or deleted chat cannot silently rebind the same conversation. Event
IDs are unique per installation, independently of the conversation key.
Installation locks and database uniqueness prevent concurrent deliveries from
creating duplicate chats or executing one turn twice.

Slack chat titles use the same `requestChatTitle` backend and organization
billing protocol as normal chats, based on the thread's first question, with
` (Slack)` appended. Naming runs alongside the response, including source-setup
replies, with a fifteen-second request deadline. Existing `Slack Search`
placeholders are eligible on the next Slack message; generated and manually
chosen titles are preserved. Saving rechecks current access and compares the
original title so an in-flight request cannot overwrite a manual rename.
Naming failures are logged separately from answer delivery and do not create a
substitute title.

The turn table remains execution bookkeeping, not a second transcript. Generic
`async_jobs` currently does not provide the required per-conversation FIFO,
installation concurrency cap, and durable execution lease. All chat messages
continue to use the existing Mothership persistence and history paths.

Only one enabled Search installation can own a Slack workspace. Reconnecting
preserves the installation and credential IDs and requires the same Slack app
and workspace. Disable, removal, and credential/configuration rotation invalidate
pending authority. Removing Search leaves the reusable credential intact.

**Register the existing platform Slack app before deploying unified ingress.**
Use its verified app ID and existing deployment credentials:

```sh
cd apps/sim
bun --env-file=.env scripts/register-platform-slack-app.ts A_VERIFIED_APP_ID
```

The script reads `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and
`SLACK_SIGNING_SECRET`, encrypts the secrets, and registers the app as shared.
It refuses to overwrite a custom app. Unknown app IDs fail authentication;
ingress does not silently substitute environment signing secrets. Resolve any
existing conflicting active workspace bindings before applying the unique index.

## Request lifecycle

1. Unified ingress uses the untrusted `api_app_id` only to select a candidate
   signing key. It verifies the raw-body Slack signature before resolving the
   app/workspace installation through an authorized application operation.
   URL verification is bounded and challenge-only; it cannot dispatch work.
2. `dispatcher.ts` accepts human DMs, channel mentions, and native Stop events. Existing platform
   workflow dispatch remains in place. The old
   `/api/webhooks/slack/custom/[credentialId]` URLs are compatibility adapters
   using the same Search dispatcher and provider primitives.
3. Intake atomically persists a deduplicated turn and outbox event. PostgreSQL
   installation locks coordinate workers: two active threads per installation,
   one active turn per thread, FIFO follow-ups, and at most twenty pending turns
   per thread. The three-minute execution deadline starts after a claim.
   Expired executions are marked failed and never replayed after an ambiguous
   external send. The shared outbox processor repairs missed wake-ups.
4. `knowledge/application/slack-search/assistant.ts` resolves the sender’s email
   through that installation’s bot credential. It requires exactly one current,
   verified Sim member of the bound organization. Email never selects the
   organization. Existing managed identity conflicts are rejected.
5. A short-lived member delegation authorizes the ordinary private organization
   Assistant conversation. The original DM timestamp becomes the thread root;
   replies reuse that conversation. Execution holds the existing chat stream
   lock and uses `buildCopilotRequestPayload` and
   `runHeadlessCopilotLifecycle` with the normal Assistant tools, environment
   projection, model configuration, permissions, and organization billing.
6. Installation revision, credential version, current member authorization,
   execution lease, and chat lock are rechecked during execution and before
   delivery. Sim history uses the existing message persistence/finalization path
   and remains private to the acting member.

A bot mention in a public or private channel starts a private DM thread for the
sender. Each mention starts its own thread; subsequent DM replies use the same
FIFO queue and private Sim conversation. The original channel, thread, and
message timestamps are retained in the chat's Slack origin metadata. The bot
posts no search results in the source channel. A failed or ambiguous DM creation
is terminal and does not replay the Assistant run.

## Member onboarding

A sender without a matching verified Sim organization membership receives a
**Get started with Sim** button in the original DM thread. The destination
offers the existing signup and login flows and preserves the return path through
authentication. Creating an account does not grant organization membership:
existing invitations, SSO, email verification, and permission policies still
apply. A wrong account or conflicting identity cannot see the original question
or organization details on the return page.

For an authorized member with no accessible indexed documents, the bot sends a
**Connect sources** button without starting an Assistant run. The return page
opens the organization's existing Integrations page directly, using the same
source list and connection dialogs as normal visits. Slack adds only indexing,
retry, and thread-return actions to its header. Shared documents that the member can already search do not
require an additional personal connection. Readiness uses the normal document
access predicate, including source approval and current source ACL evidence.

Once indexing makes documents searchable, **Retry question in Slack** explicitly
queues the original question in the same Slack thread. Opening the page never
runs a question. Repeated clicks reuse one durable retry event; the transaction
binds the current Sim user to the thread before a worker starts. Execution and
delivery recheck current membership, installation revision, and credential
version through the ordinary Assistant lifecycle. Successful member setup
notices are also saved in that member's private Sim conversation.

`slack-search/onboarding-state.ts` stores opaque navigation context in Redis for
24 hours, keyed by a hash of a random token. It references the original durable
turn, sender email, and Slack-provided thread permalink. The Slack button's link carries no
email, bot credential, or organization ID and grants no authority. Every read
and retry requires a session and re-resolves the current Slack identity. Expired
links, disabled installations, identity changes, and ambiguous failed deliveries
cannot replay the original run. No additional database tables are required.

The application behavior lives in
`knowledge/application/slack-search/onboarding.ts` and `source-status.ts`.
`/slack-search/connect/[token]` handles account setup and redirects authorized
members to `/o/[organizationId]/integrations?slack=[token]`;
`/api/knowledge/slack/onboarding` and its `/retry` endpoint use the shared route
builders and contracts.

## Streaming and Stop

`assistant-stream.ts` calls the same `chat.startStream`, `chat.appendStream`,
and `chat.stopStream` provider primitives as Slack blocks. It batches public
Assistant text, excludes reasoning and tool-scoped text, and projects secrets
before delivery. Sim-only UI payloads such as suggested follow-up options are
withheld even when their tags span multiple deltas. Text before and after a tool
call is separated into paragraphs. Answers with active secret literals are held until complete
so a secret split across deltas cannot leak.

The shared citation evidence parser accepts successful retrieval results.
Up to five source buttons use verified retrieval URLs; model-generated URLs and
incomplete citation markup are not sent. Stream failures abort execution and
record a failed outcome without switching delivery methods or replaying the run.
A confirmed Assistant failure closes an established, healthy stream with a
generic error and saves that error in private Sim history. Only a persisted
native Stop event marks the response as stopped by the user.

Slack’s native Stop cancels the active turn and pending follow-ups for the
authenticated sender’s thread. A persisted timestamp watermark also rejects
late deliveries from before Stop; a replayed Stop cannot cancel later messages.
The handler clears Slack’s processing state after cancellation.

## Verification

Focused Vitest suites cover OAuth identity/replay/authorization, signature
rejection and routing, reconnects, public streaming and citations, cancellation,
and delivery failures. `knowledge/__integration__/slack-search-turns.integration.ts`
exercises real PostgreSQL deduplication, competing claims, FIFO, concurrency and
queue bounds, expired leases, and private conversation ownership. It creates and
cleans only its own fixture rows; normal integration runs use the repository’s
disposable-database harness.

Live validation requires a reachable Assistant backend implementing
`SIM_AGENT_API_URL` + `/api/mothership`, an HTTPS tunnel to this checkout, and an
installed Slack app. Verify real streamed answers and source links, contextual
and queued follow-ups, native Stop, matching private Sim history, and
disable/reconnect behavior before declaring the live flow complete.

### Manual validation

Use a dedicated local server and one public HTTPS origin for all Slack callbacks.
Install the generated app manifest through the shared wizard, then verify:

- A bot DM streams an answer with source links and appears in the sender's
  private Sim history; a thread follow-up keeps the same conversation.
- Channel mentions start private DM threads without posting knowledge in the
  source channel.
- Queued follow-ups run FIFO, duplicate events do not execute twice, and Slack's
  native Stop control cancels the active turn and queued follow-ups.
- Account onboarding and source setup return to the original Slack question.
- Member OAuth uses the installed app; opt-in DM indexing respects each
  connected member's access.
- Disable, reconnect, removed membership, and ambiguous delivery failures stop
  stale work without replaying a response.

Live validation of the expanded member OAuth, mentions, DM indexing, and native
Stop UI is still pending. Automated coverage does not replace those checks.
Shared-app installation UX, channel-visible answers, attachment ingestion,
interactive pagination/modals, and workflow branching remain future work.
