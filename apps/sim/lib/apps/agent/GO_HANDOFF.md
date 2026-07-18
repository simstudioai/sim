# Full-stack agent Go handoff

Sim owns the runtime handlers in `fullstack-tools.ts`. The Go repository lives at
`../copilot` with generated contracts under `copilot/contracts/`.

**Status (Phase 1):** Go routing, seven `app_*` tools (route `sim`), Full-stack
prompt/allowlist, typed `app` stream envelopes, and `CopilotSurface.fullstack`
are implemented. Sim regenerates via `bun run mship:generate` / `mship:check`.

## Request routing

- Accept `chatType: "fullstack"` on `POST /api/mothership`.
- Select a Full-stack-specific prompt and tool catalog for that immutable chat type.
- Expose only the seven tools below.
- Never expose `create_workflow`, `edit_workflow`, or `delete_workflow`.
- Sim independently rejects every non-allowlisted tool when `requestMode === "fullstack"`.

## Tool contracts

All IDs and field names are stable.

- `app_bind_action`
  - `{ projectId, actionId?: "main", workflowId, deploymentVersionId, outputAllowlist?: [{ key, blockId, path }] }`
- `app_refresh_binding`
  - `{ projectId, actionId? }`
- `app_detach_action`
  - `{ projectId, actionId }`
- `app_write_files`
  - `{ projectId, expectedRevisionId?, mode?: "merge" | "replace", files: [{ path, content }] }`
- `app_build`
  - `{ projectId, revisionId? }`
- `app_prepare_publish`
  - `{ projectId, revisionId?, buildId?, publish?: false }`
- `app_list_callable_releases`
  - `{ projectId }`

Handlers require the existing Sim tool context to include `userId`, `workspaceId`, `chatId`,
`userPermission`, and `requestMode: "fullstack"`.

`app_prepare_publish` prepares only by default. The agent must obtain explicit user confirmation
before calling it with `publish: true`; authorization and prompt intent are separate gates.

## Stream contract

`mothership-stream-v1` includes typed `type: "app"` envelopes. Go emits:

- `app.build.started` when `app_build` is called
- lifecycle events mirrored from Sim tool results' `{ event: { type, payload } }`

Stable event names:

- `app.revision.created`
- `app.build.started`
- `app.build.finished`
- `app.release.prepared`
- `app.release.published`
- `app.release.revoked` (producer: `revokeRelease`)
- `app.binding.drift` (producer: `app_refresh_binding` when schemaHash changes)
- `app.preview.ready` (producer: `activatePreviewPins`)

Home dispatches `app` events via `handle-app-event.ts` and invalidates App/chat caches.

## Go PR checklist

- [x] Add immutable `fullstack` chat routing and prompt.
- [x] Add the seven schemas to `tool-catalog-v1.json` with route `sim`.
- [x] Apply the Full-stack allowlist before model invocation.
- [x] Require explicit user confirmation before invoking `app_prepare_publish` with `publish: true`.
- [x] Accept and preserve `chatType` across initial requests and resume/checkpoint requests.
- [x] Add App lifecycle events to the stream schema and emit them around tool calls.
- [x] Add `fullstack` to generated trace/surface enums.
- [x] Regenerate contracts and verify Sim's generated files have no drift.
- [ ] Run bind → write → build → prepare/publish against local Sim with a live Go agent
      and confirm no workflow mutation tool is visible or executable (manual UI +
      `bun run test:apps-live-smoke`).

## Local verification

```bash
# From sim/
bun run mship:check
bun run test:apps-live-smoke
APPS_LIVE_E2E=1 bun run test:apps-live-smoke   # also probes Go /healthz when running

# From copilot/copilot/
go test ./internal/tools/catalog/apps/... ./internal/chat/... ./internal/http/handlers/...
go run ./cmd/generate-contracts/
```
