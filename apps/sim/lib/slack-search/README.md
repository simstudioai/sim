# Sim Search in Slack

Organization admins configure this under **Settings → Sim Search in Slack**. Apply
the `0330_slack_search_installations` migration before deploying. Existing bots are
not enabled automatically.

The custom bot wizard's Search manifest subscribes to `message.im`, enables the
Messages tab and interactivity, and requests `chat:write`, `im:history`, `users:read`,
and `users:read.email`. Existing bots need these scopes and the event subscription;
reinstall the app after changing its scopes.

## Request lifecycle

- `/api/webhooks/slack/custom/[credentialId]` verifies the raw Slack signature with
  that credential's signing secret. URL verification can run before a credential
  exists; it cannot execute searches.
- `dispatcher.ts` accepts new human DMs and calls the installation intake use case.
  The application validates the stored app/team binding and exact credential
  version before submitting a bounded `slack-search` job. Ingress acknowledges
  only after enqueue succeeds. Existing workflow dispatch runs alongside Search.
- `handlers/search-message.ts` runs on both queue backends, with a per-sender rate
  bucket, 60-second deadline, and installation concurrency of two. The database
  backend's concurrency limit is per process. Event IDs provide deduplication;
  whole jobs are never automatically retried after a potentially ambiguous send.
- `knowledge/application/slack-search/process-message.ts` resolves the sender via
  `users.info`. One verified Sim email match and current organization membership
  are required. A personal Slack enrollment is optional; conflicting active
  managed identities are rejected.
- A short-lived `slack-search` member delegation calls `searchScopedKnowledge` with
  the same query, retrieval defaults, billing, source approval, and ACL rules as
  organization Search. No AI answer is generated.
- `messages.ts` formats the first five distinct documents with bounded plain-text
  snippets and link buttons. It replies only to the originating DM, preserving an
  existing thread. Long URLs use canonical Sim destinations to fit Slack's limits.
  Installation, credential version, and member access are checked again before send.

Disable, removal, or credential rotation invalidates queued work. Reconnecting a
bound credential must retain its Slack app and workspace; enabling it again
revalidates permissions. Removing Search leaves the reusable credential intact.

## Extending the Slack app

This behavior is implemented in TypeScript application handlers. There is no saved
Sim workflow or hidden workflow graph. Shared Slack provider primitives live under
`lib/internal/slack`; workflow tools and Search use the same message API primitive.

A future shared Sim app can authenticate with one app signing secret, select the
organization installation by verified app/team, and enter the same dispatcher.
Bot tokens belong to installations; signing secrets belong to Slack apps. The
current unique app/team binding prevents one installation serving two Sim orgs.

Future action handlers should use namespaced `action_id`s, resolve and authorize
the clicking user afresh, and bind stored action state to installation, org,
conversation, and expiry. Acknowledge interactions and open modals before their
Slack deadlines; queue only work that can run afterward. Link-button clicks are
acknowledged today. Mentions, slash commands, interactive pagination, modals,
streaming, shared-app OAuth, and Enterprise Grid-wide installs are not implemented.
