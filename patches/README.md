# Better Auth OAuth resource preservation

`@better-auth/oauth-provider@1.6.27` strips the OAuth `resource` parameter from
its authorization endpoint's query schema. This loses the audience before the
provider signs the consent request and stores the authorization code.

The version-pinned patch adds one optional string field to that schema. It does
not change signature verification, consent, PKCE, token validation, or any other
provider behavior. Sim validates the canonical Search MCP URL at its authorization
and token boundaries, then binds it to the stored opaque tokens after the provider
verifies the code and PKCE.

The PostgreSQL token-route test exercises the native signed-consent flow, including
resource tampering, and verifies issuance, refresh, audience enforcement, and the
existing API OAuth flow. Run it when changing this patch.

Remove this patch when upgrading to a provider version with native authorization
resource preservation. Review its persisted resource model and migrate Sim's
opaque-token audience binding at the same time; preserving the query alone does
not enforce an access token's audience.

# PostgreSQL transaction closure

`postgres@3.4.9` lets a transaction callback keep using its connection object after
PostgreSQL closes that transaction's session. Resuming the callback can crash on a
null socket or execute statements on a replacement session outside the transaction.

The version-pinned patch carries the transaction-scope closure guard from
[upstream PR #1155](https://github.com/porsager/postgres/pull/1155). It records the
connection closure in `begin()` and rejects subsequent queries from that scope,
including its implicit COMMIT/ROLLBACK, before they reach the connection or pool.
The guard is applied to all published ESM, CommonJS, and Cloudflare entry points.
It does not change connection establishment, retries, or healthy transactions.

This is required for cumulative billing's server-enforced holder deadline:
PostgreSQL 17+ uses `transaction_timeout`; older supported servers use
`idle_in_transaction_session_timeout` alongside the statement timeout. Both release
a stalled idle holder; the older fallback limits each idle interval and statement,
not the total elapsed transaction time.
`apps/sim/lib/billing/core/usage-log.postgres.test.ts` tests real ESM/CommonJS driver
closure and reconnection, rollback after billing INSERT/UPDATE, and exact retry
accounting. CI runs it against PostgreSQL 17 and 16. Set
`BILLING_USAGE_TEST_DATABASE_URL` to a disposable local PostgreSQL 15+ database to
run it manually.

Remove this patch when the pinned driver includes equivalent transaction-scope
closure handling. Keep the reconnect regression tests when upgrading.
