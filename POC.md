# POC: Per-workspace API reference doc for publicly hittable workflows

Branch: `feat/workspace-api-reference` (off `origin/staging`).
Feature flag: `api-reference-doc` (env fallback `API_REFERENCE_DOC`). Everything below is behind it.

## The idea in one line

**Workspace = service. Deployed workflow = endpoint. Deploy = version.** A workspace emits an API
reference doc for the workflows it chooses to expose, so any org member (or their agent) can learn
how to call the service and reason about failures - without gaining any access to the provider
workspace's data, files, KBs, logs, or unpublished workflows.

## What I built

### Data model (additive, non-destructive)
- New table `workflow_publication` (migration `packages/db/migrations/0273_fixed_micromacro.sql`),
  modeled on `custom_block`. It stores **only prose + exposure toggles**; the request/response
  **structure is never stored** - it is derived live from the workflow's active
  `workflow_deployment_version`. Every column defaults to its safe value (`published=false`,
  `expose_trace='off'`, `expose_blocks=false`, `visibility='org'`).

### Derivation layer (`apps/sim/lib/workflows/api-reference/`)
Rides entirely on existing primitives - no parallel machinery:
- `schema.ts` - input schema from `extractInputFieldsFromBlocks` (the deployed Start block); output
  schema from the deployed Response block's structured `builderData` via
  `parseResponseFormatSafely`/`extractFieldsFromSchema`. Overlay prose is layered on but can never
  invent a field that isn't in the deployment.
- `changelog.ts` - shallow, honest diff between consecutive `workflow_deployment_version` snapshots;
  marks an entry **breaking** when a required input is removed/retyped or an output field disappears.
  Computed on-read; nothing is stored.
- `redact.ts` - block introspection redaction by an **allowlist** of non-secret selector subblock
  types (`dropdown`, `combobox`, `switch`, `slider`, `checkbox-list`, `router-input`, …). Everything
  else - `short-input`, `long-input`, `code`, `oauth-input` credentials, `messages-input` prompts,
  every resource `*-selector`, `table`, `webhook-config` - is dropped. Fails closed for unknown blocks.
- `access.ts` - the authz core. `resolveReadablePublication` / `listReadablePublications` return
  `null` for **every** denial (unknown/archived workflow, unpublished, reader not in the org,
  allowlist miss) so routes answer **404, never 403** and never leak existence.
- `derive.ts`, `markdown.ts`, `openapi.ts` - assembly + `?format=markdown|openapi` renders.

Because structure comes from `loadDeployedWorkflowState` (the `is_active` deployment row), **editing
the draft never changes the doc until the next deploy** - the "versioned with the deployment"
requirement falls out for free, exactly as custom blocks get it.

### Routes (all `withRouteHandler` + contract-bound `parseRequest`)
Reader-facing (auth = any org member, **not** workspace member):
- `GET /api/workspaces/{id}/api-reference` (`?format=json|markdown|openapi`)
- `GET /api/workspaces/{id}/api-reference/{workflowId}`
- `GET /api/workspaces/{id}/api-reference/{workflowId}/blocks` and `.../blocks/{blockId}` - only when `exposeBlocks`
- `GET /api/workspaces/{id}/api-reference/{workflowId}/executions/{executionId}/trace` - only when `exposeTrace='traceId'`

Provider-facing (auth = workflow **admin**, same gate as deploy):
- `GET` / `PUT /api/workflows/{id}/publication`

Contract: `apps/sim/lib/api/contracts/api-reference.ts`. Client hooks
(`usePublicationSettings`, `useUpdatePublication`) added to `hooks/queries/deployments.ts`.

### Settings surface
A "Publication" panel in the deploy modal's API tab
(`.../deploy-modal/components/general/components/publication-modal.tsx`): published toggle,
display name / summary / description, `exposeTrace`, `exposeBlocks`, `visibility` - all defaulting
to the safe value.

### Tests (33, all passing)
`schema` (input/output derivation + overlay-can't-invent), `redact` (secrets never leak, allowlist
only, fail-closed), `changelog` (breaking detection), the contract conformance guard, and route
tests for the entry / blocks / trace routes covering **404-not-403**, default-off exposures, trace
scoping, and feature-flag gating.

## End-to-end curl transcript

Live against a seeded scenario on a dev server: org `Acme Org` with two workspaces; **provider** =
workspace `4cea3e21…` (owner `mzxchandra@gmail.com`); **reader** = `marcus@sim.ai`, an org member
who has **no permission on the provider workspace**. Workflow `Ask Biz` deployed twice (v2 removed
input `selectedApps`).

```
# 1. Reader is NOT yet an org member -> workspace doc 404s (no existence leak, not 403)
$ curl -s -H "cookie: <reader>" .../api/workspaces/4cea3e21…/api-reference
{"error":"Not found"}                                                    [HTTP 404]

# 2. Org admin adds the reader as a PLAIN ORG MEMBER (still not a provider-workspace member)

# 3. Same reader now reads the whole-workspace doc -> 200 (the unlock)
$ curl -s -H "cookie: <reader>" .../api/workspaces/4cea3e21…/api-reference
{"workspaceId":"4cea3e21…","name":"Marcus's Workspace","generatedAt":"…","entries":[
  {"workflowId":"wf-askbiz-poc","name":"Ask Biz","summary":"Answers business questions…",
   "version":2,"deployedAt":"…","invokeUrl":"…/api/workflows/wf-askbiz-poc/execute",
   "auth":{"type":"api_key","header":"x-api-key","description":"Send a Sim API key…"},
   "input":{"type":"object","properties":{"question":{"type":"string","description":"The user question"},
                                           "context":{"type":"string"}}},
   "output":{"type":"object","properties":{"answer":{"type":"string","description":"The answer"},
                                            "confidence":{"type":"number"}}},
   "exposure":{"trace":"off","blocks":false},
   "versions":[{"version":2,"breaking":true,"changes":["removed input field `selectedApps`"]},
               {"version":1,"breaking":false,"changes":["initial version"]}]}]}   [HTTP 200]

# 4a. Single entry as markdown (?format=markdown) -> renders the same contract as docs
### Ask Biz … ### Input - `question` (string) … ### Version history - **v2** **(breaking)**: removed input field `selectedApps`

# 4b. ?format=openapi -> OpenAPI 3.1 with POST /api/workflows/wf-askbiz-poc/execute, operationId invoke_wf-askbiz-poc

# 5. Exposures are OFF by default -> blocks and trace both 404
$ curl … /blocks                                                        {"error":"Not found"} [HTTP 404]
$ curl … /executions/exec-askbiz-001/trace                             {"error":"Not found"} [HTTP 404]

# 6. Provider (workspace admin) enables trace + blocks via the settings API
$ curl -s -X PUT -H "cookie: <provider>" -d '{"exposeTrace":"traceId","exposeBlocks":true}' .../api/workflows/wf-askbiz-poc/publication
{"publication":{…,"exposeTrace":"traceId","exposeBlocks":true,…}}       [HTTP 200]

# 7. The READER (not a workflow admin) is refused the settings API
$ curl -s -X PUT -H "cookie: <reader>" -d '{"published":false}' .../publication
{"error":"Unauthorized: Access denied to admin this workflow"}          [HTTP 403]

# 8/9/10. Redacted block introspection - secrets never appear
$ curl … /blocks/agent-1
{"block":{"id":"agent-1","type":"agent","name":"Answer Agent","outgoing":["response-1"],
          "config":{"model":"gpt-4o","reasoningEffort":"high"}}}         [HTTP 200]
# The agent's seeded system prompt ("…api key sk-SECRET-123…"), messages, and maxTokens are all
# dropped; grep for "sk-SECRET-123" over the full /blocks output => "OK: secret absent".

# 11/12. Trace fetch, scoped to the execution id (capability-based)
$ curl … /executions/exec-askbiz-001/trace
{"executionId":"exec-askbiz-001","workflowId":"wf-askbiz-poc","status":"completed",
 "totalDurationMs":1234,"trace":{"traceSpans":[{"name":"Workflow Execution",…,
   "children":[{"name":"Answer Agent","status":"success","duration":1100}]}],
   "finalOutput":{"answer":"42","confidence":0.9}}}                      [HTTP 200]
$ curl … /executions/exec-does-not-exist/trace                          {"error":"Not found"} [HTTP 404]

# 13. Provider flips exposeTrace back OFF -> the same trace fetch immediately 404s
$ curl -s -X PUT -H "cookie: <provider>" -d '{"exposeTrace":"off"}' .../publication         [HTTP 200]
$ curl … /executions/exec-askbiz-001/trace                             {"error":"Not found"} [HTTP 404]
```

Every property the brief asked for is demonstrated: the org-member unlock, 404-not-403,
default-off exposures, provider-admin-only settings, allowlist-based redaction with no secret leak,
and caller-scoped trace with a working on/off toggle.

## What I'd do differently at production scale

1. **Trace attribution is the weakest link.** `workflow_execution_logs` has no
   triggering-caller column, so trace access here is **capability-based**: the `executionId` is an
   unguessable UUID returned only to whoever invoked the run, additionally bound to the published
   workflow + workspace. That blocks enumeration and cross-caller reads, but a caller who is *handed*
   an id could read a run they didn't trigger. Production should record explicit caller attribution
   (invoking user/workspace/api-key id) on the execution and match against it.
2. **Redaction allowlist needs a governance process.** It is currently a hard-coded set of subblock
   *types*. Any new secret-bearing subblock type is safe-by-default (dropped), but a new *selector*
   type that happens to carry user text would be missed. At scale this wants a per-subblock
   `sensitivity` flag declared on the subblock definition itself, plus a CI check.
3. **Schema derivation depth.** Output derivation handles the structured Response block and falls
   back to a permissive object for free-form JSON mode or missing Response blocks. Production should
   derive richer nested schemas and handle multiple Response blocks on branches.
4. **Changelog is shallow by design.** It diffs top-level input/output field names + types. Nested
   shape changes and enum narrowing aren't flagged. Deliberate for the POC ("dumb and honest").
5. **Allowlist visibility** stores workspace ids and checks the reader's workspace permissions; a
   real deployment likely wants group/role-based allowlists and an audit trail on doc reads.
6. **Caller-side consumption** (the mothership integration) is intentionally not built - see below.

## Open questions

- **Where does org membership come from for personal/grandfathered workspaces?** Workspaces with
  `organization_id = NULL` can't expose a doc (no org to read it). Is that acceptable, or do we need
  a single-workspace "org of one"?
- **Should the invoke path surface the trace id automatically when `exposeTrace='traceId'`?** Today
  the doc documents it and the existing `executionId` in the invoke response is the link; we did not
  modify the execute route. Confirm that's the right seam.
- **OpenAPI fidelity** - is a thin OpenAPI (one POST per workflow, no auth scheme wiring) enough, or
  should we invest in a spec consumers can codegen against?
- **Publish lifecycle** - should publishing require a fresh deploy (so the doc can never reference a
  since-changed draft), or is deriving from the active deployment enough (current choice)?

## Caller-side consumption / mothership (not built; designed for)

The doc JSON is shaped to feed a mothership tool trivially (stable `workflowId`, pinned `version`,
`versions[]` changelog, `input`/`output` JSON Schema to diff a call against). Key constraint found in
exploration: the agent's system prompt, skills, and named-tool catalog live in a **separate Go repo**,
not `apps/sim`.
- **Zero-harness demo path:** the agent already has a generic `http_request` tool and these routes
  already enforce org-member 404-not-403 authz, so it can read a sibling doc today; the only gap is
  discovery (surface doc endpoints in `WORKSPACE.md` workspace-context - an `apps/sim`-only change).
- **Production path:** a dedicated read-only `get_api_reference` server tool + a Go-side skill. Worth
  it because - unlike `http_request` - a dedicated tool can *only* ever return doc / redacted-block /
  own-trace data, making it the enforcement boundary. Do **not** ship the mothership integration on
  generic `http_request`: that generic fetch is the cross-workspace read escape hatch this design
  exists to contain.

## Verify locally

```
# DB (worktree shares the local Docker Postgres):
cd packages/db && bunx drizzle-kit push --config=./drizzle.config.ts   # adds workflow_publication
# App (port 3000 was taken by another worktree during this POC, hence 3100):
cd apps/sim && API_REFERENCE_DOC=true bunx next dev --port 3100
# Tests:
cd apps/sim && bunx vitest run lib/workflows/api-reference lib/api/contracts/api-reference.test.ts app/api/workspaces
```
The realtime Socket.IO server is not needed for these HTTP API routes and was not run for this
verification.
