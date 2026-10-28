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
`apps/sim/lib/billing/core/usage-log.integration.ts` tests real ESM/CommonJS driver
closure and reconnection, rollback after billing INSERT/UPDATE, and exact retry
accounting. CI runs it against PostgreSQL 17 and 16. Set `TEST_DATABASE_URL` to a
disposable local PostgreSQL 15+ database and run
`bun run --cwd apps/sim test --mode integration lib/billing/core/usage-log.integration.ts`.

Remove this patch when the pinned driver includes equivalent transaction-scope
closure handling. Keep the reconnect regression tests when upgrading.

# Drizzle development push policy

`drizzle-kit@0.31.10` prompts when it sees both additions and removals, even with
`--force`. Its PostgreSQL push path also catches errors and exits successfully,
which lets post-push work run against a schema that was not applied.

The pinned CLI patch adds an opt-in create/drop policy to the existing rename
resolvers and makes PostgreSQL push failures and cancellations return nonzero.
`packages/db/scripts/push.ts` enables the policy only in its Drizzle subprocess
using `SIM_DB_PUSH_RENAME_MODE=create`. `--interactive-renames` selects the native
chooser and requires a terminal. Normal migration generation keeps its rename
prompts. Data-loss confirmations, table filters, introspection, and generated SQL
remain owned by Drizzle; `--force` still controls data-loss approval.

`packages/db/scripts/push.test.ts` covers argument forwarding and stopping before
reconciliation on failure. `packages/db/scripts/push.integration.ts` exercises
the installed CLI against PostgreSQL, including multiple column changes, table
and enum replacement, schema replacement, preservation of the excluded script
ledger, and database errors. Set `TEST_DATABASE_URL` to a disposable local
PostgreSQL database and run these tests with
`bun run --cwd packages/db test --mode integration`.

Remove the patch when Drizzle provides an explicit noninteractive create/drop
policy and propagates push failures. Keep Drizzle pinned until the replacement
passes these regression tests.

# ECharts rich-text tooltip fonts

`echarts@6.1.0` omits the configured font from its rich-text tooltip container
and the font family from generated name/value tokens. Custom formatter strings
therefore use the renderer's default font, and built-in tooltips lose the app's
font family. The patch applies the configured font and line height to the
container and preserves the family/style on generated tokens, so sizing and
drawing use the same typography. Authored font overrides still take precedence.

The patch covers the package's ESM source entry point and its full CommonJS and
ESM bundles. Sim uses the ESM source entry point; the optional common/simple and
minified distributions are not used or patched. It keeps tooltips in canvas
rich-text mode, preserving the chart document's untrusted-markup boundary.

`apps/sim/lib/charts/tooltip.test.ts` exercises actual ECharts tooltip rendering,
font overrides, generated tokens, and box sizing. Remove this patch when an
upstream release provides equivalent font handling and these tests pass.

# Next.js application Vary preservation

`next@16.4.1` replaces application `Vary` values when the Node App Page handler
sets its router cache dimensions. The docs proxy's `Vary: Accept` therefore
vanishes from the final HTML response, allowing downstream caches to confuse
HTML with negotiated Markdown.

The pinned patch applies the merging semantics of [upstream PR #98104](https://github.com/vercel/next.js/pull/98104)
at Next's native Node outgoing-header merger, which is used before the bundled
App Page handler. Both published CommonJS and ESM entry points preserve existing
Vary fields and add later fields without case-sensitive duplicates. Wildcards
remain intact, and native header validation still rejects invalid values.

Vary writes become cumulative across Node server responses in both the docs and
Sim workspaces; explicit header removal, cookie handling, other headers, router
selection, cache lifetimes, and authentication are unchanged. Edge SSR and direct
handlers outside Next's Node server are outside this patch's scope.

The `docs content negotiation` CI workflow builds and serves the actual docs,
then runs `apps/docs/scripts/test-negotiation-e2e.ts`. Its HTTP checks verify
HTML → Markdown → HTML at one URL, `Vary: Accept` on both representations, and
preservation of Next's router dimensions. It uploads a JSON report and server
log. The HTML checks fail with the unpatched dependency even when the proxy
already sets `Vary: Accept`. `test:headers:e2e` exercises the actual CommonJS and
ESM mergers over loopback HTTP for string/array fields, mixed casing, wildcards,
invalid values, other-header replacement, and middleware cookies. Its checks
fail independently when the merge or validation guard is removed. CI uploads
both reports.

To repeat against a running production docs server:

```bash
DOCS_E2E_BASE_URL=http://127.0.0.1:3001 \
DOCS_NEGOTIATION_REPORT_PATH=/tmp/docs-negotiation.json \
bun run --cwd apps/docs test:negotiation:e2e
```

Remove the patch when upgrading to a release with equivalent Vary preservation,
and retain the HTTP regression check.

# Zod collection size bounds

`zod@4.3.6` runs an array's `.max()`/`.length()` (and a set's or map's `.max()`/`.size()`)
only after it has parsed every element, so a small body against a bounded schema builds an
issue per malformed element before the bound is reported. An unauthenticated request to the
public chat endpoint can turn under a megabyte of JSON into gigabytes of issues
(GHSA-mrhx-c7xc-m3w5).

The version-pinned patch backports the leading size gate from
[upstream PR #6652](https://github.com/colinhacks/zod/pull/6652), released in 4.6.6, to the
ESM and CommonJS builds. A container larger than its leading upper bound skips its elements
and returns unchanged; its own size check then reports the single `too_big` issue. Any input
within its bounds parses exactly as before. The bound check is skipped, as upstream, for
`skipChecks` and backward (encode) parses.

Zod 4.6 is not a drop-in upgrade: it rejects absent `unknown`/`any` object keys, requires
seconds in ISO datetimes, and emits root `$ref` JSON Schema for schemas with an `id`.
`@trigger.dev/core`, which the root override puts on this zod, relies on the first.
Remove this patch when upgrading zod to 4.6.6 or later.
