# Read-only table queries from HTML Sim files

Status: design only. This document specifies the first implementation; the table bridge, grants, routes, and migration have not been built.

## Decision and user experience

An HTML Sim file may read a table that its file metadata explicitly names. This works in a private workspace view and through every existing file-share mode, including a public link. The first version only queries rows. It cannot insert, update, delete, run table enrichments, read row-run state, execute SQL, or enumerate the workspace's tables.

An author attaches up to ten table IDs to the file, beside its existing workflow IDs:

```json
{
  "workflowIds": ["wf_123"],
  "tableIds": ["tbl_incidents"]
}
```

The HTML calls a narrow bridge, without receiving a Sim credential or share token:

```js
const page = await sim.tables.query('tbl_incidents', {
  predicate: { field: 'status', op: 'eq', value: 'open' },
  sort: [{ field: 'created_at', direction: 'desc' }],
  limit: 50,
})

for (const row of page.data) {
  console.log(row.id, row.data.status, row.createdAt)
}
if (page.nextCursor) {
  const next = await sim.tables.query('tbl_incidents', {
    predicate: { field: 'status', op: 'eq', value: 'open' },
    sort: [{ field: 'created_at', direction: 'desc' }],
    limit: 50,
    cursor: page.nextCursor,
  })
}
```

The response matches the existing v2 named-row shape: `{ data: [{ id, data, createdAt, updatedAt }], nextCursor }`. Column references use names. The page is a live query, with no five-minute workflow-result cache. Each page sees current table state; pagination does not promise a frozen snapshot when rows change between requests. A script can refresh on a button or timer within rate limits. A separate `subscribe` or table-change push API is outside this first version.

## Grant semantics

`tableIds` is a whole-table read grant for this HTML file. It includes all current and future rows and all ordinary row-data columns, with arbitrary supported predicates and sorts. The UI must say this plainly when an author attaches a table or publishes an already configured file. A table containing data that should not be public must not be attached to a public file. Column- or row-scoped grants are a future design, not an implicit restriction or a silent partial result.

Grant creation and replacement require permission to update the file and to query each named table in the same active workspace (`tables.rows.query` / `tables.use`). Lists have at most ten distinct IDs; a non-HTML file cannot hold table grants. A private file can be configured by a collaborator with those permissions. Enabling a share, or adding a table to an already shared file, also requires the existing file-publishing authority: workspace admin plus `public_api.use`, matching workflow dependency publication. The table need not expose its general v2 API publicly.

An active share plus the file's `tableIds` becomes the public read capability. It is not a saved owner session, API key, or a fabricated table principal. Public access persists until the grant or share is removed, the file/workspace/table becomes inactive, or the share's authentication gate denies the viewer. A publisher later losing personal access does not silently revoke a workspace-level published grant; an administrator must remove it or disable the share. Private callers must still have current permission to read both the file and table on each request.

The metadata endpoint should accept an atomic partial replacement: `PATCH /api/workspaces/{workspaceId}/files/{fileId}/metadata` and its v2 counterpart accept `workflowIds?` and `tableIds?`, with at least one present. Omitted lists stay unchanged, so an existing `file_workflow.configure` call cannot erase table grants and a table edit cannot erase workflow dependencies. An empty array explicitly clears that list. The response returns both current lists. Create/upload paths may accept optional `tableIds`; content overwrite may not change grants. Duplication copies private metadata but not a public share.

Keep the existing file-row lock around metadata changes and share publication. Under that lock, validate the final combined metadata and the requested share state before committing. This closes the metadata/share race already handled for workflows. A new additive `workspace_files.table_ids` JSONB column with `NOT NULL DEFAULT '[]'` needs a migration. The table-query bridge remount key and public file-metadata response include `tableIds`; workflow admission/cache keys do not change when only table grants change.

## Request paths and authority

The document's `sim.tables.query` sends `{ tableId, options, requestId }` over its existing private MessagePort. The trusted parent checks the locally loaded allowlist as an early rejection and makes a typed same-origin POST. The parent never forwards the session, share token, API key, or other credential into the iframe. The iframe remains on the separate `HTML_CONTENT_ORIGIN` site with opaque sandbox origin and unrestricted HTTPS page code.

Two route adapters expose the same semantic operation:

| Viewer | Route | Transport authentication |
| --- | --- | --- |
| Private workspace | `POST /api/workspaces/[id]/files/[fileId]/tables/[tableId]/query` | Current session and workspace access |
| File share | `POST /api/files/public/[token]/tables/[tableId]/query` | Active share plus existing public/password/email/SSO share gate |

The route contract owns params, strict body, and response schemas under `apps/sim/lib/api/contracts/file-tables.ts`. The body accepts only `predicate?`, `sort?`, `limit?`, and `cursor?`. Default `limit` is 50; permitted limits are integers 1–100. `limit: 0` is invalid. Cursor length and request body are bounded (2 KiB and 32 KiB respectively). Reuse `predicateInputSchema` and `sortSpecSchema`, including their complexity bounds, rather than create a second filter language. Both routes answer with `Cache-Control: private, no-store` and the existing table error conventions: bad input 400, missing/inactive/ungranted resources 404, failed share authentication 401/403, and rate limit 429 with `Retry-After`. An oversized request body is 413. No route accepts an asserted principal, workspace, grant list, or query mode in its body.

Create one protected `files.tables.query` application operation. Its use case reloads the canonical active file and active table, proves they share the same workspace, verifies HTML type and current `tableIds`, and checks private file-plus-table read authority or the active share capability. The public adapter applies `validateDeploymentAuth` before the query. Authorization runs again immediately before result delivery, so a grant/share revoked during a slow query does not deliver rows. Cursor scope binds file ID, table ID, query shape, and share identity/configuration for shared calls. A changed grant or share invalidates a cursor; the client restarts pagination.

The current `queryTableRows` use case cannot simply be called with the file owner as principal: that would substitute a stored user for the viewer and violate the application's acting-principal boundary. Instead, extract its predicate/sort/cursor validation and bounded `queryRows` projection into a shared table-domain function taking an already authorized canonical table. Both `queryTableRows` and `files.tables.query` call that function. The file operation alone decides file/share authority; the table domain still enforces table schema, query planning, and row-size limits. Never call raw table storage from a route or browser bridge.

The existing table service already limits query page materialization to 5 MiB. Keep that ceiling and disable `includeRunState` and persisted secret-provenance sidecars for this surface. A bounded page may contain fewer than its requested row limit when the byte budget is reached; `nextCursor` continues it. Use the existing name-keyed row mapper and `toApiRow` projection. There is no unbounded export form. The first version returns ordinary row values exactly as a permitted table read would; attaching a table to a public file deliberately makes those values public through that share.

## Admission and failure behavior

Table reads do not spend workflow admission or invoke a workflow. Add a dedicated fail-closed public table-query rate limit, keyed by both share and client IP; start at 120 requests/minute per share and 60/minute per IP, then tune from staging load. Private calls use an authenticated read rate policy. The existing eight-outstanding-call cap on the iframe bridge should include workflow and table calls together. A canceled frame closes its pending MessagePort calls; the parent forwards abort signals so abandoned reads stop promptly.

No server-side table-result cache is introduced. Caching would risk returning a stale row after access or data changes and is not needed to meet the workflow cache requirement. HTTP responses remain `no-store`. The HTML may keep data in its own memory; arbitrary page JavaScript can send delivered rows to external HTTPS endpoints. The separate domain protects the Sim session and broad APIs, not data explicitly granted to the page.

Log request ID, file ID, table ID, audience kind, row count, latency, and denial reason without row values, predicates, share tokens, or credentials. Audit metadata/grant publication and removal with old/new table IDs. Normal row reads need no per-page semantic mutation audit. Surface a clear authoring warning that sharing a configured file grants its viewers current and future table rows.

## UI, Mothership, and compatibility

Show attached tables beside attached workflows in the file metadata UI, with a searchable workspace-table selector and a clear public exposure notice. The public viewer receives the table IDs only to configure the bridge; the server remains authoritative. Pages without `tableIds` keep the existing HTML preview behavior. A file with tables but no workflows must still use the isolated HTML runtime rather than the older plain preview path.

Mothership should set `tableIds` through the file metadata operation. For the current native catalog, extend `file_workflow.configure` to accept optional `tableIds` as a compatibility step, with at least one dependency list required; `run` and `read` remain workflow-only. The ordinary Mothership table tool already queries tables for the agent and does not populate a special HTML cache. Update the HTML-writing skill to use `sim.tables.query` and disclose the public whole-table grant. A later tool rename can make dependency configuration more generic without altering persisted metadata.

## Verification and rollout

Tests should cover cross-workspace IDs, archived tables/files, non-HTML files, no grant, private caller without table permission, all share-auth modes, public grant creation by an unauthorized publisher, concurrent metadata/share edits, revocation while a query is in flight, stale cursors, invalid predicates, `limit: 0`, oversized rows, rate-limit storage failure, and an HTML file with only table grants. Browser coverage should confirm the iframe can query a granted table while it cannot read parent cookies, the share token, or a non-granted table. A public-link test should prove that a future inserted row becomes visible, since that is the promised grant scope.

Ship an additive schema migration and server use case/routes first, then the browser bridge/UI and Mothership guidance. Target staging and verify private and public shares there. The design does not authorize a production deployment or PR merge.
