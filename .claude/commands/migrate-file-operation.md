---
description: Migrate one existing Sim workspace-file operation to the shared Principal, operation policy, application use-case, internal route, v2 route, and Copilot delegation architecture. Use when consolidating file auth or moving a file read/write/delete/move operation away from route-local authorization while preserving each surface's contracts, errors, analytics, and compatibility behavior. Do not use for v1 routes; treat uploads, large bodies, bulk recursion, and binary streaming as special cases.
---

# Migrate File Operation

Migrate one bounded semantic operation at a time. Share authorization and business behavior without forcing internal, v2, and Copilot surfaces to share authentication or response shapes.

## Start from the golden slice

Read these files before editing:

- `packages/auth/src/principal.ts`
- `apps/sim/lib/core/application/operation.ts`
- `apps/sim/lib/core/application/workspace-operation.ts`
- `apps/sim/lib/core/application/workspace-authorization.ts`
- `apps/sim/lib/workspace-files/application/operations.ts`
- `apps/sim/lib/workspace-files/application/authorization.ts`
- `apps/sim/lib/workspace-files/application/rename-workspace-file.ts`
- `apps/sim/lib/api/server/routes/internal-json-route.ts`
- `apps/sim/lib/api/server/routes/v2-json-route.ts`
- `apps/sim/lib/workspace-files/api/route-policies.ts`
- `apps/sim/lib/copilot/auth/file-delegation.ts`
- The internal, v2, manager, contract, Copilot, and test files for the requested operation

Fail immediately if the shared principal or route foundation is absent. Do not recreate a parallel framework.

## Bound the slice

Before editing, inventory every current entry point for the requested behavior:

- HTTP method and route module
- Internal and v2 contracts and response envelopes
- Manager/orchestration call chain
- Copilot tools, aliases, resume paths, and polymorphic branches
- Permission checks and workspace assertions
- Audit, notification, product analytics, and other side effects
- Error/status behavior and resource-concealment behavior
- Rate-bucket identity, endpoint label, response headers, and rollout-gate behavior

Record each entry point as `migrate`, `defer`, or `non-goal` in the handoff. Do not modify v1. Do not migrate adjacent methods merely because they share a route module.

Preserve existing behavior unless the assigned migration explicitly changes it. If the target architecture conflicts with a current contract or test—such as 403 versus concealed 404, a legacy rate-bucket label, or a surface-specific event—stop and report the decision instead of silently choosing one.

Use one semantic operation for all migrated surfaces. Never create internal-, v2-, or Copilot-specific copies of the same operation. If two paths have materially different transactional semantics, keep separate use cases and explain why.

## Preserve the boundary

Keep responsibilities in these layers:

1. Route/tool adapter: authenticate, construct a `Principal`, select the operation and rate policy, parse the surface contract, call the use case, and render the surface response.
2. Application use case: load the canonical resource, compare any asserted workspace, authorize the operation, run the business operation, record semantic audit, and trigger shared domain notifications.
3. Manager/repository: execute storage and database reads/writes. Accept canonical IDs and workspace scope, not credentials or principals.
4. Presenter: return the contract success body only. Omit it when the use-case result already matches the contract. Never return `NextResponse`, rate metadata, or errors.

Use this order for ordinary JSON routes:

```text
IP abuse limit, when public
  -> authenticate
  -> build Principal
  -> operation rate limit
  -> parse contract
  -> application use case
      -> canonical load by resource ID
      -> asserted-workspace concealment
      -> current authorization
      -> manager mutation/read
      -> audit and shared notification
  -> surface presenter
```

Never query API keys or sessions from the application use case. Authentication freshness belongs to the adapter. Never implement raw database transactions in the application use case when a manager primitive exists; add a narrow throwing manager primitive when needed.

Do not add API-key rechecks, row locks, or transaction-wide authorization solely for a theoretical race. Use the authenticated principal and canonical resource snapshot unless the business operation itself requires atomic multi-row behavior or the task explicitly asks for stronger race semantics.

## Define the operation once

Add exactly one entry to `fileOperations` with a stable semantic ID, minimum workspace role, explicit workspace-key policy, and accepted principal kinds.

```ts
operationName: defineWorkspaceOperation({
  id: 'files.operation_name',
  minimumRole: 'read' satisfies PermissionType,
  workspaceApiKey: 'allow',
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
})
```

Do not accept every principal merely because a use case is shared. An internal-only operation can declare `['session']`; a shared internal/Copilot operation can declare `['session', 'delegated']`. The definition fails immediately when `principalKinds` and the workspace-key policy disagree. The authorized-use-case wrapper rejects disallowed kinds before canonical loading and narrows the business callback's principal type.

Choose policy from behavior, not from the calling surface:

- Reads normally require `read`.
- Content or metadata mutations normally require `write`.
- Workspace API keys have a fixed `write` ceiling and cannot satisfy admin operations.
- Use `deny` when a workspace key must not perform the operation.

The route declaration and use case must expose the same literal operation. Let route-definition initialization fail on mismatches.

## Implement the application use case

Define the use case with `defineAuthorizedWorkspaceFileUseCase`, the file-domain binding over the resource-agnostic application foundation.

```ts
export const operationWorkspaceFile = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.operationName,
  resolveContext: ({ input }: { input: OperationWorkspaceFileInput }) =>
    loadCanonicalOperationContext(input),
  execute: executeOperationWorkspaceFile,
  projectAudit: ({ result }) => ({
    action: AuditAction.FILE_UPDATED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.file.id,
    resourceName: result.file.name,
  }),
  afterSuccess: ({ context }) => notifyWorkspaceFilesChanged(context.workspaceId),
})
```

The wrapper owns this lifecycle:

1. Reject principal kinds not declared by the operation.
2. Resolve the canonical context and authorize it with file delegation scope.
3. Execute the business callback.
4. Resolve audit attribution and record projected semantic entries.
5. Await declared post-success domain effects.

`resolveContext` loads canonical resources, derives workspace policy state, and conceals asserted-workspace mismatches. It does not authorize. `execute` receives an already-authorized, operation-narrowed principal and calls manager/repository primitives. `projectAudit` derives zero, one, or several entries from the authoritative mutation result; return `[]` for a no-op and never infer affected resources from requested IDs. The wrapper injects workspace, operation, actor, and request metadata. `afterSuccess` owns shared notifications.

Do not call `authorizeWorkspaceFileAccess`, `authorizeWorkspaceFileOperation`, `resolvePrincipalAuditAttribution`, or `recordAudit` from an ordinary migrated use-case body. Resolve `PrincipalAttribution` only when a required legacy user field needs it. Upload lifecycle code and other explicitly deferred special cases may retain their dedicated flow until separately migrated.

Propagate infrastructure failures. Use existing typed orchestration errors for expected not-found, forbidden, validation, and conflict outcomes. Do not turn database failures into not-found or authorization failures, and never add fallback behavior.

Inspect legacy orchestration before reusing it. If it already records audit, sends notifications, or emits analytics, call a lower-level manager primitive or remove the duplicated responsibility for migrated callers. Never wrap a side-effecting orchestration helper and then emit the same side effects again.

### Principal and attribution rules

- Session and personal-key principals authorize through the current human workspace permission.
- Personal API keys must also respect the workspace's `allowPersonalApiKeys` setting.
- Workspace-key principals authorize as the workspace itself under the operation's explicit allow/deny policy and write ceiling. Do not use creator membership for authorization.
- Delegated Copilot principals re-check the current subject user's permission and their workspace, audience, expiry, and resource scope.
- Use the current billing owner only where a legacy required user ID or billing attribution requires one. Never use that owner for authorization, rate-limit identity, delegated identity, or human product analytics.
- Preserve `PrincipalActor` metadata in audit records so a workspace key is not represented as a human actor.

Audit is shared semantic behavior declared through `projectAudit`; the wrapper records it after successful execution using the real `PrincipalActor`. Product analytics are surface behavior: preserve an existing internal `captureServerEvent` with the internal route's optional `onSuccess`; do not move it into the shared use case or manufacture a human distinct ID for workspace keys or Copilot.

## Adapt each surface independently

### Internal JSON

Use `defineInternalJsonRoute` and explicitly declare:

- `contract`
- `auth: internalSessionAuth`
- `operation`
- `rateLimit`, including a reason for `none`
- `errorPolicy`
- `mapInput`
- `useCase`
- optional `onSuccess` only to preserve surface-specific behavior
- `present` when the surface wire body differs from the use-case result

Keep the existing internal success and error envelope. Error policies project typed status/body descriptors rather than constructing responses. The builder owns `withRouteHandler`, authentication-before-parse ordering, response validation, and `NextResponse` creation.

### V2 JSON

Use `defineV2JsonRoute` with `v2ApiKeyAuth`, the explicit operation rate policy, the v2 error policy, and a v2-only presenter. Keep v2 schemas in `apps/sim/lib/api/contracts/v2/files.ts` and internal schemas in the workspace-file contract family. Never import Zod or declare boundary schemas in a route.

For resource-ID operations, the target v2 policy normally conceals absence, cross-workspace assertions, and unauthorized access. If the current contract or tests expose 403, flag that compatibility decision before changing it. Keep v1 middleware and v1 routes untouched.

### Copilot

Resolve path/name aliases only within the trusted execution workspace, then call the same application use case with `createCopilotFilePrincipal`. Never construct authoritative workspace, subject, audience, or resource scope from model-provided tool arguments. Preserve each tool's existing result shape and resumable aliases.

Map typed failures to a safe Copilot message. Unknown failures must become a generic retryable/system message; never return raw database or storage error messages to the model.

## Handle special operations explicitly

Do not force these through the ordinary JSON pipeline:

- Upload/multipart: use a lifecycle-specific design with immutable credential binding, fresh authorization on control legs and finalization, current billing attribution at durable registration, and idempotent completion. Do not add a database migration unless explicitly authorized; under the no-migration design, store a versioned server-authored `authBinding` in existing upload-session metadata, reject missing or invalid new-format bindings, and explicitly drain or version legacy in-flight sessions.
- Large JSON bodies: perform cheap authenticated admission before bounded body buffering.
- Binary/download/streaming: use a binary or streaming route builder and a typed response descriptor.
- Bulk/recursive operations: deduplicate and cap requested IDs, cap expanded rows/bytes, load every resource canonically, preserve workspace predicates, and decide atomic versus best-effort behavior explicitly.

Stop and report the missing design instead of weakening limits, authorization, or error handling.

## Test the complete behavior matrix

Add focused tests proportional to the migrated surfaces:

- Use case: session admin/writer/reader, personal key enabled/disabled, allowed/wrong-workspace workspace key, delegated current/stale/out-of-scope principal, asserted-workspace mismatch, not found, conflict, and infrastructure failure.
- Manager: canonical active lookup, workspace-predicated mutation, archived resources, and propagated database errors.
- Internal route: authentication before parsing, exact response contract, typed errors, and any preserved `onSuccess` event only after success.
- V2 route: personal and workspace keys, rollout/rate behavior, concealment, exact v2 envelope, and rate headers after charging.
- Copilot: trusted delegation, aliases/resume paths, permission re-check, safe errors, and unchanged tool response shape.
- Side effects: audit is projected from authoritative results, notifications follow audit projection, and neither occurs for rejected operations or zero-row results. Do not claim exactly-once delivery across independent client retries without durable idempotency/outbox support.

Run at minimum:

```bash
bunx vitest run <focused test files>
bunx biome check <changed source and test files>
bunx turbo run type-check --filter=sim --filter=@sim/auth
bun run check:api-validation:strict
git diff --check
```

Do not claim a check passed unless it was run successfully.

## Work safely in parallel

- Assign one agent a non-overlapping route-module and caller set. Two methods in one route file are not safe parallel assignments.
- Start every agent from the same foundation commit in its own branch/worktree when possible.
- Treat the file `operations.ts` registry, contract family files, and file route policies as merge hotspots. The core application primitives and shared route builders should not change for an ordinary file-operation migration.
- Do not refactor shared principal, authorization, rate limiting, or error foundations unless the task explicitly assigns that ownership.
- Preserve unrelated working-tree changes. Never stage architecture docs, lockfile drift, or another agent's edits.
- Do not commit, push, or open a PR unless the task explicitly asks for it.

## Hand off

Report:

1. The semantic operation and policy.
2. Every migrated, deferred, and non-goal entry point.
3. Behavior preserved per surface, including analytics and response differences.
4. Files changed and any shared merge hotspots.
5. Tests and checks run with results.
6. Remaining risks or blockers. Fail fast if any required invariant could not be implemented.
