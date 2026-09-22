# Workflow-backed HTML Sim files

Implemented in the Sim worktree based on staging `7de662eee7c25998e777a4dab3f69e039d69833b` and a separate Mothership worktree based on its staging branch, September 22, 2026. These changes have not been deployed, and no shared database migration or domain configuration has been applied.

## Decisions from the discussion

- HTML only: ordinary `text/html` and the existing `text/x-sim-page` source format.
- Flexible HTML, CSS, JavaScript, and HTTPS dependencies/network calls. Reuse the Sim document compiler, stylesheet, and interaction shell; its widget grammar does not constrain custom page code.
- Saved file metadata contains `workflowIds`, using actual workflow IDs. No aliases, separate grants, or grant-management screen.
- Follow the latest active deployment when execution starts. A deployment changing while the HTTP request is being prepared is fine. Input preparation and execution then use the same loaded graph; later runs select the then-current deployment.
- Retain normal workflow authority and server-side API/tool access. No new file principal, read-only workflow profile, or workflow block restrictions.
- Private callers retain their own principal and workspace access. Shared calls authenticate against the file share and use the existing workflow-scoped `public_api` system principal. The workflow's general public API need not be enabled.
- Calls accept JSON input declared by the current deployed workflow. Cache identity includes canonical input, file, workflow, and audience. A zero-input workflow has exactly one input key, so callers cannot fragment its cache with arbitrary arguments.
- Each input key admits at most one attempt per 300 seconds, with only one in flight. An additional file/workflow budget admits at most 20 runs across all inputs and audiences per five-minute window. Button clicks and headless API requests use the same gates.
- File calls execute synchronously and appear in workflow logs with the `File` trigger label. The executor still selects the deployed API input block.
- The HTML runs on a different site, selected by the `HTML_CONTENT_ORIGIN` environment variable for each deployment. `https://file.simstudio.ai` is the production hostname, not a hostname in application code.

## Metadata and authorization

File creation accepts optional metadata:

```json
{"workflowIds": ["workflow_123"]}
```

`PATCH /api/v2/files/{fileId}/metadata` replaces the list, with body:

```json
{"workspaceId": "workspace_123", "workflowIds": ["workflow_123"]}
```

There is a corresponding session-authenticated internal endpoint under `/api/workspaces/{id}/files/{fileId}/metadata`. Workflows must be deployed, in the same workspace, and accessible to the acting principal. Lists contain at most ten unique IDs. Non-HTML documents cannot acquire workflow dependencies.

Private invocation checks current file and workflow access. Reading a cached result checks current read access; it never executes a workflow. HTML messages and HTTP bodies may supply only declared JSON inputs, never an execution principal, deployment override, draft state, or arbitrary execution options. The 16 KiB input limit is checked before schema validation. No-input workflows accept only `{}`.

Sharing an HTML file exposes its configured workflow calls to the share audience. Publication requires workspace-admin authority and the existing `public_api.use` capability, in addition to the file-sharing checks. Updating dependencies on an already-shared file applies that same publication policy. The sharing and metadata operations lock the same file row to serialize their checks and writes. Normal collaborators can configure private files using their existing access.

Public, password, email, and SSO file-share gates remain in force. Unsharing, removing a dependency, archiving a resource, or losing access prevents subsequent delivery. Access is checked again before execution and before returning results. Public-share changes rotate the result audience, without resetting the execution gate.

## Execution, caching, and notifications

The original `workspace_file_workflow_run` table remains for rolling-deployment compatibility. The new `workspace_file_workflow_input_run` table holds one durable admission row per file/workflow/audience/input hash: execution ID, deployment version, start/finish times, and status. A conditional PostgreSQL upsert enforces the five-minute per-input gate and in-flight exclusion atomically. `workspace_file_workflow_budget` caps new attempts across keys. Both changes commit in one transaction; a rejected per-input claim rolls back its budget increment. Completion updates are fenced by execution ID.

Redis stores successful output envelopes for 300 seconds after completion, limited to 1 MiB including the envelope. Cache keys include the audience and execution ID. Private audiences are per human user or workspace API key; a human's session and Copilot delegation share the same audience. Public results use a distinct share/configuration audience. Other audiences can consume the shared budget, but cannot read each other's execution IDs or output.

Redis is required. Missing Redis or cache corruption fails explicitly. Cache expiration/eviction, metadata edits, redeployment, and failed attempts do not reset the durable gate. An expired or evicted result returns `empty` until another eligible run produces output. Previous results remain labeled with their actual deployment and generation time.

The viewer reads each configured workflow's empty-input result once when the document opens. A `run` or explicit `read` returns its snapshot directly; an empty-input response also notifies that workflow's subscribers. There is no periodic workflow-result poll. Private viewers invalidate the initial result query through the existing workspace-file Socket.IO event after an external run finishes. Public HTML viewers still poll file metadata for edits and dependency changes, but an external run does not notify an already-open public document; its code can call `read` or the viewer can reload. A dedicated public result notification channel would be needed to update those viewers automatically without polling results. Streaming edits retain the existing two-second preview batching. The GET paths do not execute or mutate admissions.

The first version executes synchronously. A workflow that pauses remains in flight and resumes through the existing workflow machinery. Status reads detect terminal resumed runs, but output completed after the original request is not republished into this HTML cache; inspect the normal workflow run for that output. A subsequent eligible POST can reconcile the terminal admission and run again. This remains intentionally out of scope for the rare paused-run case.

An interrupted process with an admission but no terminal execution log fails closed. Do not expire its admission merely because time passed: that could overlap an execution still performing side effects. Operational recovery requires confirming the execution is stopped before clearing that specific admission.

## Browser API and isolation

The trusted viewer creates a sandboxed iframe with `allow-scripts` on the content site. `/html-frame` serves only a fixed bootstrap. The viewer sends the document and a private MessagePort after checking the iframe instance; the bootstrap accepts initialization only from its configured app origin and parent. No session, share token, API key, or workflow credential enters the document.

The page API returns a result envelope, not just raw workflow output:

```js
const workflowId = 'workflow_123'

function render(result) {
  if (result.status === 'completed') {
    document.querySelector('#output').textContent = JSON.stringify(result.output, null, 2)
  }
  document.querySelector('#status').textContent = result.error ?? result.status
}

sim.workflows.subscribe(workflowId, render)
render(await sim.workflows.read(workflowId))

document.querySelector('#run').addEventListener('click', async () => {
  try {
    render(await sim.workflows.run(workflowId))
  } catch (error) {
    document.querySelector('#status').textContent = error.message
  }
})
```

`run(id, input)` and `read(id, input)` accept an optional JSON object. For example, `await sim.workflows.run(workflowId, { incidentId: '123' })` targets that input's cache. `subscribe` and automatic result notifications currently observe only the empty-input cache; input-specific callers use `read` after `run` to refresh their own view.

Envelopes contain `status`, `executionId`, `deploymentVersionId`, `generatedAt`, `nextRunAt`, `output`, and `error`. Status is `empty`, `running`, `completed`, or `failed`. Subscriptions return an unsubscribe function; the page also receives `sim:workflow-result` DOM events. A new document gets a new bridge. Requests for unconfigured IDs fail explicitly.

The sandbox excludes same-origin access, forms, popups, top navigation, and privileged browser permissions. The content response sets its own sandbox CSP. HTTPS scripts, styles, images, frames, fetches, and secure WebSockets are permitted. Page code can therefore transmit data it receives: isolation protects the Sim session and broader application, not data intentionally delivered to arbitrary page code. The workflow itself retains its normal server-side networking and credentials.

This bridge is a viewer feature. Downloaded standalone HTML does not acquire credentials or a working Sim workflow bridge.

## Headless API and Mothership

Use the file-specific endpoints to populate the cache watched by the document:

| Operation | Endpoint |
| --- | --- |
| Configure dependencies | `PATCH /api/v2/files/{fileId}/metadata` |
| Run or reuse the current result | `POST /api/v2/files/{fileId}/workflows/{workflowId}` |
| Read the empty-input status/output without executing | `GET /api/v2/files/{fileId}/workflows/{workflowId}?workspaceId=...` |
| Read one input's status/output without executing | `POST /api/v2/files/{fileId}/workflows/{workflowId}/result` |

POST run bodies include `workspaceId` and optional `input`; POST result-read bodies include `workspaceId` and the input to inspect. These endpoints use the existing API-key/OAuth authentication and normal acting-principal rules. Session endpoints power the trusted viewer. Input-specific reads use POST bodies rather than URL query strings. Shared viewer endpoints live under `/api/files/public/{token}/workflows/{workflowId}` and apply the share's authentication.

Generated CLI commands (with the workspace configured or supplied using the global workspace option):

```sh
sim files metadata update FILE_ID --workflow-ids '["WORKFLOW_ID"]'
sim files workflows create FILE_ID WORKFLOW_ID --input '{"incidentId":"123"}'
sim files workflows get FILE_ID WORKFLOW_ID
sim files result create FILE_ID WORKFLOW_ID --input '{"incidentId":"123"}'
```

The generated Sim MCP registry exposes the same operations. Calling the general workflow-run API does not populate this file cache. Browser clicking is unnecessary for these headless calls.

The native Mothership `file_workflow` tool in the separate copilot worktree supports `configure`, `run`, and `read` using a canonical file path. `configure` replaces `workflowIds` metadata through the same authorized operation as the API. `run` and `read` accept optional `input` and use the file-specific application operations, so they share the PostgreSQL gates, Redis cache, and viewer change notifications. The default private audience shares results with that user's session. Set `audience: "share"` for an active public share: the member is reauthorized on every delivery, then the run uses the existing public-share workflow principal and populates the public viewers' cache. The native general `run_workflow` tool remains separate and does not refresh a file.

## Proposed direct table query API

The full design is in [Read-only table queries from HTML Sim files](workflow-backed-html-table-query-design.md). It specifies `sim.tables.query(tableId, options)`, explicit `tableIds` file metadata, private and public-share authority, read-only cursor pagination, limits, revocation behavior, UI disclosure, Mothership configuration, and staged verification. No table-query code or schema migration has been implemented yet.

Mothership's HTML writing guidance now describes workflow-backed pages and uses the existing page template. The raw HTML writing skill remains available when styled Sim pages are enabled, so a live dashboard can use arbitrary HTML and JavaScript while ordinary Sim-page documents keep their source compiler.

## Deployment setup

1. Apply the additive migrations `packages/db/migrations/0376_petite_sue_storm.sql` and `packages/db/migrations/0377_flaky_quicksilver.sql` using the normal migration/release process. The first adds the original admission table and file metadata; the second adds per-input admission and budget tables. They change no existing row semantics.
2. Configure Redis and set `HTML_CONTENT_ORIGIN` independently at build and runtime for each environment. Use `https://file.simstudio.ai` in production; staging could use `https://file.staging.simstudio.ai`. `NEXT_PUBLIC_APP_URL` must identify that environment's trusted viewer origin. Neither hostname is hardcoded in the runtime.
3. Route the content hostname's `/html-frame` to this app with TLS and preserve the Host header. Block other content-host paths at ingress. The app proxy also rejects application/API paths on that host; its static-asset exclusions are why ingress should enforce the narrow route.
4. Keep authentication cookies off the content domain. The apex `simstudio.ai` redirect does not determine how its `file` hostname is routed. No DNS, ingress, certificate, or redirect changes are included here.

Deploy Sim's application operations, tool handler, and database migration before enabling the Mothership `file_workflow` catalog entry. Otherwise Mothership can advertise a tool that the current Sim server does not recognize. Both changes target staging first; neither PR is merge approval.

Configuration rejects the app host, sibling hosts on the same registrable domain, paths/credentials in the origin, and non-HTTPS production origins. Local development can use the app on `http://localhost:3000` and the content host on `http://127.0.0.1:3000`. Changing only the port on the same hostname is rejected because cookies are not port-scoped. The bootstrap currently trusts one configured viewer origin; custom-domain viewer support needs explicit additional trusted-origin configuration.

## Validation

- File/storage/sharing suites: 940 passing tests; an additional OAuth read/write-scope regression also passes; the opt-in PostgreSQL suite is run separately.
- Executor and core suites: 100 passing tests, including selection at execution start and graph consistency across a mid-run redeployment.
- Disposable local PostgreSQL: nine passing tests for the per-input migration and admission path, including concurrent claims, distinct-input isolation, the cross-input budget, cooldown retention, old-completion fencing, and paused-run reconciliation. No shared database used.
- Chromium with separate localhost hosts: arbitrary scripts, run/read RPC, subscriptions, cookie and parent-DOM isolation, source-bound handshake, and document replacement.
- App and database type checks; API contract/boundary, application graph, permission enforcement, migration, OpenAPI, CLI, and MCP generation checks. Focused Mothership catalog, prompt, and skill tests pass on both encrypted and authored prompt paths; native file-tool and share-audience application tests pass.

Full production workflow execution and deployed-domain routing have not been exercised. The native Mothership tool is validated at the handler and contract levels, without a running Mothership service.
