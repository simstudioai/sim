# Freebuff agentic attribution

This flow implements https://freebuff.com/docs/advertisers/agentic-attribution and is separate from the existing display conversion API.

## Rollout

1. Deploy the additive attribution migration and application together through the normal pipeline. The old application ignores the new table.
2. Publish the CLI containing this change. The proposed command-scoped carrier is `SIM_FREEBUFF_CONVERSION_TOKEN`; it is supported only for `sim login --method api-key`. It is removed from the CLI environment before browser launch and is never written into CLI configuration. The browser URL only opens the existing approval page; attribution is claimed by the authenticated approval action, pinned to that account, and deleted from Redis only after persistence succeeds.
3. Have Freebuff review the exact runtime carrier and login procedure before placing it into a sponsored procedure. This repository change does not approve or alter an existing reviewed procedure or consent hash.
4. For browser-only handoffs, use `/api/attribution/freebuff` as the landing destination and let Freebuff append its signed `bfcid`. This dedicated endpoint captures the opaque token and redirects to signup before client scripts run. Do not send agentic tokens through the display tag's `bfcid` cookie.
5. Verify the canonical HTTPS app origin before activation. The CLI sends tokens only to `https://www.sim.ai`, with redirects disabled. The browser cookie is Secure, HttpOnly, SameSite=Lax, host-only, and encrypted.
6. Obtain a Freebuff-issued signed test token. Exercise the real new-account and returning-account flows, complete a deployed workflow run, verify accepted and deduplicated postbacks, and confirm test classification and zero charge with Freebuff. Then verify a real accepted-proposal handoff; a generic test token cannot prove the proposal/run join.

No advertiser API key is used by the agentic endpoint. Existing display signup reporting stays separate and still requires its configured server key.

## Outcomes and delivery

- `account_created:<user-id>` records a new human account created after token capture. Returning users retain attribution for product use without becoming new signups.
- `tool_used:<execution-id>` records completed deployed workflow executions by their execution actor. Failed, pending, cancelled, and undeployed preview executions are excluded. Each execution can be reported once; recurring executions have distinct IDs.
- Attribution is scoped to the human actor, not every member of their workspace. Latest captured attribution wins; replaying an older cookie cannot replace it.
- The outbox stores encrypted token snapshots with original event IDs and timestamps. One request is sent per lease, with at most three attempts. Network, 429, and 5xx failures retry; other HTTP failures are terminal. Delivery status and HTTP status remain available in the outbox payload. No raw response or token is logged.
- The association expires 30 days after capture; Freebuff enforces its authoritative 30-day window after Accept. Expiry cleanup removes the stored association. Terminal deliveries erase the encrypted token from their outbox payload.
- Authentication attribution failures emit a token-free warning without blocking sign-in. Failed signed-in browser captures retain an account-bound encrypted cookie and return a retryable response. Workflow completion isolates attribution writes in a savepoint; on failure it commits a durable marker with the completed log. The outbox worker drains that indexed marker queue in bounded batches, atomically enqueuing events and clearing their markers.

## Verification

`bun run test:integration freebuff-agentic completion-ledger-order` uses disposable PostgreSQL and Redis and writes `apps/sim/test-results/integration.json`. It verifies encryption, expiry, token-free redirects, authenticated CLI approval, auth hooks, billed completion during attribution failure, recovery, idempotency, retry identity, and terminal rejection. The auth session in the landing fixture is simulated; this is not evidence that deployed OAuth callbacks or the Freebuff partner handoff have been verified.

Do not enable the broad v2 site pixel as part of this rollout. It is a separate telemetry decision and is unnecessary for these server events.
