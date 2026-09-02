---
name: migrate-application-operation
description: Create or migrate a protected Sim resource operation in the shared Principal and application-use-case architecture across internal APIs, public or versioned APIs, Copilot, and other trusted tool adapters. Use when adding a protected endpoint, tool command, or CRUD method; removing route- or tool-local authorization and business logic; consolidating resource reads or writes behind semantic operation policies; or adding another surface to an existing application operation while preserving contracts, identity, errors, rate limits, audit, analytics, and compatibility behavior. Treat v1, uploads, streams, large bodies, bulk recursion, and polymorphic tools as explicitly scoped special cases.
---

# Create Or Migrate Application Operation

Create or migrate one bounded semantic operation at a time. Share authorization and business behavior without forcing internal APIs, public APIs, Copilot, and other tools to share authentication, input schemas, or response shapes.

## Enforce the application boundary

Apply this invariant:

> Every real operation on persisted or protected data enters through an authorized application use case.

This includes mutations, content and metadata reads, canonical resource lookup, and reference-to-resource resolution when the lookup is authorization-sensitive.

Surface helpers may:

- Normalize an already-authenticated surface context into a `Principal`.
- Translate aliases or wire arguments into application input.
- Select a code-defined operation and application use case.
- Call the application use case.
- Translate typed results and errors into the surface contract.

Surface helpers must not:

- Query databases or storage.
- Decide workspace or resource authorization.
- Implement business transactions.
- Record semantic audit or shared domain notifications.
- Infer authoritative identity, workspace, audience, or scope from untrusted arguments.
- Substitute billing attribution for identity.

A helper that resolves a path is valid only when the actual protected lookup runs through an authorized application resolver. If a helper begins doing real data work, move that work into an application use case.

## Read the foundation first

Read these files completely before editing:

- `packages/auth/src/principal.ts`
- `apps/sim/lib/core/application/operation.ts`
- `apps/sim/lib/core/application/workspace-operation.ts`
- `apps/sim/lib/core/application/workspace-authorization.ts`
- `apps/sim/lib/core/application/authorized-workspace-use-case.ts`
- `apps/sim/lib/api/server/routes/definition.ts`
- `apps/sim/lib/api/server/routes/internal-json-route.ts`
- `apps/sim/lib/api/server/routes/v2-json-route.ts`
- `apps/sim/lib/auth/internal-delegation.ts`
- `apps/sim/lib/copilot/application/application-adapter.ts`
- `apps/sim/lib/copilot/auth/application-delegation.ts`

Use the file domain only as a representative golden slice:

- `apps/sim/lib/workspace-files/application/operations.ts`
- `apps/sim/lib/workspace-files/application/authorized-workspace-file-use-case.ts`
- `apps/sim/lib/workspace-files/application/rename-workspace-file.ts`
- `apps/sim/lib/copilot/application/execute-file-use-case.ts`
- `apps/sim/lib/copilot/auth/file-delegation.ts`

Then read the target domain's operation registry, application code, repositories, contracts, adapters, aliases, resume paths, and focused tests. Fail immediately if the shared foundation is absent. Do not recreate it inside the domain.

## Bound the migration

Inventory every entry point for the behavior before editing:

- Internal HTTP routes and contracts.
- Public or versioned API routes and contracts.
- Copilot tools, aliases, resume paths, and polymorphic branches.
- Other tool servers, workflow executors, jobs, or service callers.
- Current authentication, authorization, workspace assertions, and concealment.
- Manager or orchestration call chains.
- Audit, notification, analytics, and billing side effects.
- Error/status/result behavior.
- Rate-limit identity, rollout gates, quota, and concurrency admission.

Classify each as `migrate`, `defer`, or `non-goal`. Do not migrate adjacent operations merely because they share a module. Do not modify v1 unless the request explicitly includes it.

Preserve behavior unless the task explicitly changes it. Stop and report a decision when surfaces currently disagree on security or compatibility behavior; do not silently choose one.

## Freeze observable behavior before editing

Treat the legacy route or tool as an ordered program, not merely a bag of business logic. Before moving code, write a compact baseline for every in-scope entry point and add focused characterization tests for behavior not already pinned down.

Capture all of these when they apply:

- Accepted inputs, including trimming, blank omission, duplicate query keys, aliases, defaults, and bounds.
- Authentication and authorization order, minimum roles, resource membership, concealment, and exact error/status mapping.
- Exact success bodies, optional fields, status codes, redirects, cookies, headers, and binary or stream behavior.
- Mutation ordering, transaction boundaries, idempotency, no-ops, and observable state after each possible partial failure.
- Audit, notification, analytics, and billing timing plus exact semantic dimensions and attribution.
- Browser or protocol state ownership, concurrency isolation, expiry, callback ordering, and cleanup behavior.
- Every value newly crossing into HTML, JavaScript, SQL, URLs, logs, provider payloads, or another encoding context.

Compare the old statement order with the proposed application lifecycle explicitly:

```text
legacy parse/normalize
  -> legacy authorization checks
  -> branch-specific canonical lookup
  -> mutation(s)
  -> per-step side effects
  -> response or redirect catch
```

Moving those steps under a wrapper may change behavior even when each individual call is reused. In particular:

- `projectAudit` and `afterSuccess` run only after `execute` returns. They cannot describe earlier committed mutations when a later step throws. Make the compound mutation atomic or define explicit partial-result/failure projection semantics before migrating it.
- Operation metadata is executable policy. Adding a resource role to a workspace-only legacy read is an authorization change, not an architectural cleanup.
- A shared error policy does not automatically preserve route-local concealment, subclass ordering, browser redirects, or branch-specific messages.
- A shared contract does not automatically preserve manual `URLSearchParams` normalization or exact legacy response unions.
- A shared use case may own domain behavior while separate surface presenters still preserve different wire shapes.
- Per-flow identity is insufficient when another part of the flow remains in browser-global state such as one cookie.
- Passing a newly supported parameter through old rendering code creates a new security boundary even when the renderer itself is unchanged.

Fail fast if the baseline cannot be established from code, tests, or an explicit product decision. Do not infer that behavior is unimportant because it was previously implicit.

## Keep the layers distinct

Use these responsibilities:

1. Authentication adapter: verify the surface credential or trusted execution context and construct a `Principal`.
2. Route or tool adapter: select rate policy, parse its contract, translate input, call the application use case, and render its own result.
3. Application use case: load canonical context, compare asserted scope, authorize the semantic operation, execute business behavior, project semantic audit, and trigger shared domain effects.
4. Manager or repository: perform database and storage reads or writes using canonical identifiers and scope. Never accept credentials or principals.
5. Presenter: return only the surface success body or typed binary descriptor. Never construct auth, rate, or error behavior.

For ordinary public JSON routes, preserve this order:

```text
IP abuse limit
  -> authenticate
  -> build Principal
  -> operation rate limit
  -> parse surface contract
  -> application use case
      -> canonical load
      -> asserted-scope concealment
      -> current authorization
      -> manager read or mutation
      -> semantic audit
      -> shared domain effects
  -> surface presenter
```

Internal routes may omit the IP bucket or operation limit only through an explicit policy with a reason. Usage billing, storage quota, cost admission, and concurrency are separate from request-rate limiting.

Never query API keys or sessions from the application layer. Never add fallback identity or authorization behavior. Propagate infrastructure failures instead of turning them into not-found or forbidden results.

## Define the semantic operation once

Add one stable entry to the target domain's operation registry:

```ts
rename: defineWorkspaceOperation({
  id: 'widgets.rename',
  minimumRole: 'write',
  workspaceApiKey: 'allow',
  capability: 'widgets.use',
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot'],
})
```

Do not create internal-, public-, or Copilot-specific versions of the same semantic operation. If two callers have materially different business or transactional semantics, define separate semantic operations and use cases and explain the distinction.

Choose principal kinds from actual behavior. Do not accept every principal merely because the use case is shared. Workspace API keys have a write ceiling and cannot satisfy admin operations. The operation definition must fail fast when its role, workspace-key policy, and principal kinds disagree.

`capability` is required — name the permission-group capability that governs the operation, or `'none'` with a `// permission-group-exempt: <reason>` comment directly above it. `defineWorkspaceOperation` throws at definition time when it is absent. See `add-permission-group-item`.

Route declarations, tool adapters, and use cases must use the same literal operation. Runtime operation selection is permitted only from a trusted, code-defined registry. Never accept an operation ID or permission tag from an HTTP body, model argument, or other untrusted input.

### Unified selector execution is one operation

Dynamic selector dispatch is the deliberate instance of trusted runtime selection. Define and
authorize `selectors.execute` once: it means "enumerate options while configuring a workflow or
workspace resource." The browser supplies only a selector key from the exhaustive browser-safe
manifest, scope, allowlisted context, and list/detail request. After canonical scope authorization,
the application use case selects the matching attachment from the exhaustive server-only registry.

Provider and internal attachments are trusted implementation adapters under that semantic operation,
not separate application operations. Do not create one operation per selector, provider, or listing
endpoint. Attachments may choose only code-defined credential/service binding, destination policy,
provider primitive, and projection behavior; they must not accept a module, provider, service,
operation kind, origin, or permission tag from the request. The `selectors.execute` use case owns
reference resolution, credential authorization, provider invocation, sanitization, and safe result
projection end to end.

## Implement the application use case

Use `defineAuthorizedWorkspaceUseCase` directly or a thin domain binding that supplies domain-specific authorization options:

```ts
export const renameWidget = defineAuthorizedWorkspaceUseCase({
  operation: widgetOperations.rename,
  resolveContext: ({ input }: { input: RenameWidgetInput }) =>
    loadCanonicalWidgetContext(input.id, input.assertedWorkspaceId),
  authorizationOptions: { delegation: widgetDelegationPolicy },
  execute: async ({ input, context }) => renameWidgetRecord({
    workspaceId: context.workspaceId,
    widgetId: context.resourceId,
    name: input.name,
  }),
  projectAudit: ({ result }) => ({
    action: AuditAction.WIDGET_UPDATED,
    resourceType: AuditResourceType.WIDGET,
    resourceId: result.id,
    resourceName: result.name,
  }),
  afterSuccess: ({ context }) => notifyWidgetsChanged(context.workspaceId),
})
```

Adapt the example to the domain's real authorization options; do not copy invented field names.

The wrapper must own this lifecycle:

1. Reject disallowed principal kinds before protected loading.
2. Load canonical context and conceal asserted-scope mismatches as required.
3. Authorize the operation using current policy state.
4. Execute the manager or repository primitive.
5. Project audit from authoritative results.
6. Await shared post-success effects.

Do not call shared authorization, principal audit attribution, or `recordAudit` manually from an ordinary migrated use-case body. Use `projectAudit` only when the operation has semantic audit. Return no audit entries for authoritative no-ops. Keep product analytics such as `captureServerEvent` surface-specific through the adapter's success hook.

Inspect legacy orchestration before reusing it. If it already authorizes, audits, notifies, or captures analytics, call a lower-level primitive or remove duplicate responsibility for migrated callers.

Application code must remain surface-neutral. It must not import `app/api/**`, `next/server`, internal/v1/v2 contracts or presenters, or Copilot tool handlers. Return domain values and let each surface presenter project its own wire result.

## Adapt internal APIs

Use `defineInternalJsonRoute` for ordinary JSON routes. Explicitly declare the contract, authentication policy, semantic operation, rate policy, error policy, input mapping, use case, and presenter when the wire result differs.

Use `internalSessionAuth` for session-only routes. Use `createInternalSessionOrExecutorAuth` only when the endpoint genuinely supports signed executor delegation; the semantic operation must then allow `delegated` principals from the `executor` service. Never turn an actorless legacy JWT into a fake session, owner, or user principal.

The internal adapter owns authentication and internal response envelopes. It must not implement workspace authorization. Preserve internal-only analytics through `onSuccess` after application success.

Keep the route module declarative. If several internal routes repeat authentication, parsing, error rendering, or response construction, improve the shared internal route builder instead of adding a domain-specific route wrapper.

## Adapt public or versioned APIs

Use the appropriate public/versioned route builder, such as `defineV2JsonRoute`, with API-key authentication, explicit semantic operation and rate policy, external error projection, input mapping, application use case, and an external presenter.

Authentication and HTTP formatting may differ from internal APIs; authorization and business behavior must not. Rate-limit using the credential or principal subject, never a billed owner. Resolve billing attribution only for billing, quota, or legacy required-user fields.

Keep surface contracts separate when their wire shapes differ. Reuse shared primitive schemas and domain validators for invariants such as IDs, names, bounds, and formats. Do not maintain duplicate internal and external schemas merely because the routes are separate; import the same schema when the wire shape is genuinely identical. Never cast one surface response into another.

Keep v1 middleware and routes unchanged unless explicitly included.

## Adapt Copilot

Copilot is a surface adapter, not a separate application layer. If an HTTP or other surface already uses an application use case, Copilot must call that exact use case rather than reimplementing protected business behavior under `lib/copilot`.

Create one domain-level Copilot application adapter with `createCopilotApplicationAdapter` instead of constructing delegated principals in every tool:

```ts
executeCopilotWidgetUseCase(context, renameWidget, input, { resourceId })
```

That adapter must:

- Require a trusted server-authored Copilot execution marker.
- Require the authenticated subject, canonical workspace, tool-call or execution identity, and required audience or lifecycle scope.
- Construct the shared delegated `Principal` in one place.
- Optionally bind the canonical resource scope after trusted resolution.
- Verify that the use case exposes a registered code-defined operation.
- Use the domain's exact immutable operation registry so operation-object membership and identity are checked centrally.
- Call the application use case directly.

Never construct authoritative delegation from model-provided workspace IDs, user IDs, operation IDs, resource scope, or permission tags. Model arguments are requested targets only and must be checked against trusted execution context and canonical data.

Tool handlers own argument aliases, resumable legacy names, abort checks, tool-call reporting, and tool-specific presentation. They must not query managers directly for protected operations, manually authorize, or implement protected business behavior. If a Copilot-only compound action expresses real domain behavior, define a surface-neutral domain operation and application use case for it.

A Copilot reference helper may translate a path to a resource only by calling an authorized application resolver under the intended semantic operation. Passing a code-defined operation object is acceptable; passing a model-provided operation string is not. An immediate same-request resolver followed by the operation may reuse one trusted principal, though the application operation still performs its own canonical authorization. Fresh authentication and authorization are required across lifecycle boundaries such as resumed tool calls, executor callbacks, queued or background work, upload control legs and finalization, durable completion, and long-running provider operations. When resolution and execution form one business operation, need a consistent snapshot, or appear repeatedly together, prefer a top-level application use case such as `renameWidgetByReference`.

Surface adapters must not compose protected mutations. An atomic compound action requires one top-level semantic domain operation and application use case that owns the transaction and authoritative result. An explicitly best-effort application command may coordinate multiple operations only when it defines hard input and expansion caps, cancellation checkpoints, partial-result semantics, audit behavior, and rate/quota policy. Keep composition exceptional and explicit; ordinary tools should use the shared execution adapter.

Map expected typed errors to safe tool results. Unknown errors must become generic system/retryable messages while retaining full causes in server logs. Never return raw database or storage errors to the model.

## Adapt other internal or external tools

Treat every tool runtime as a surface adapter:

- Normalize its already-authenticated execution context into an existing `Principal` through one shared adapter for that runtime or domain.
- Call the same application use case used by HTTP and Copilot surfaces.
- Preserve the tool protocol's input, output, retry, and cancellation semantics.
- Keep authoritative workspace and subject scope server-authored.

An internal caller is not automatically trusted to bypass authorization. It must supply an explicit principal or use a deliberately designed service/delegation principal. If the current principal model cannot express its authority, stop and extend the identity model intentionally; do not fall back to an owner, uploader, creator, or arbitrary user ID.

External tool endpoints authenticate at their adapter exactly like public APIs. Do not authenticate again inside the application use case.

## Preserve identity and attribution

- Session and personal-key principals authorize through current human workspace permission.
- Personal API keys also respect the workspace's personal-key policy.
- Workspace keys authorize as the workspace under explicit operation policy and the write ceiling, independent of creator membership.
- Delegated principals re-check the current subject and their workspace, audience, expiry, execution, and resource scope.
- Billing owners are attribution for billing or legacy required columns only, never authorization, rate identity, delegated identity, audit actor, or human analytics identity.
- Preserve structured `PrincipalActor` metadata in semantic audit.

If a required legacy user column cannot represent the real actor, label the compatibility attribution explicitly. Never pretend it is the acting human.

## Handle special operations explicitly

Do not force these through an ordinary JSON migration:

- Upload or multipart lifecycles: bind immutable credential identity, reauthorize control legs and finalization, and make durable completion idempotent.
- Large bodies: authenticate and perform cheap admission before bounded buffering.
- Binary or streaming responses: use binary/stream builders and typed descriptors.
- Bulk or recursive operations: deduplicate and cap inputs and expansion, load all resources canonically, and define atomic versus best-effort behavior.
- Polymorphic tools: select the semantic operation only after trusted target-kind resolution; do not route unrelated branches through one domain registry.
- Multi-resource transactions: keep canonical scope predicates and derive audit from authoritative affected rows.

Stop and report a missing design rather than weakening identity, authorization, limits, or errors.

## Test the complete matrix

Add focused tests for every migrated surface and principal kind allowed by the operation:

- Application: allowed and disallowed roles, principal-kind rejection before canonical loading, workspace assertion mismatch, delegated scope, not found, conflict, no-op, and infrastructure propagation.
- Operation registry: role/workspace-key/principal-kind/delegated-service consistency and fail-fast rejection of invalid definitions.
- Repository: canonical active lookup, workspace-predicated writes, archived resources, authoritative affected rows, and database error propagation.
- Internal API: authentication before parsing, exact contract, typed errors, and surface analytics only after success.
- Public API: personal and workspace keys, rate behavior, concealment, exact external envelope, and rate headers.
- Copilot or tools: trusted context, exact registered operation membership, rejected forged scope, aliases and resume paths, permission re-check, safe errors, and unchanged tool result shapes.
- Side effects: audit derives from authoritative results; shared notifications follow audit; neither occurs for rejection or no-op.
- Compatibility characterization: legacy normalization, exact response/redirect/cookie behavior, concealment, error subclass precedence, and branch-specific output.
- Failure sequencing: inject a failure after each independently committing step and assert persisted state plus audit, analytics, and notification effects.
- Concurrency: overlap stateful browser or provider flows and prove each callback consumes only its own state and return destination.
- Rendering boundaries: exercise hostile values for every newly connected input that reaches HTML, inline JavaScript, URLs, logs, or provider requests.

Run at minimum:

```bash
bunx vitest run <focused test files>
bunx biome check <changed source and test files>
bunx turbo run type-check --filter=@sim/app --filter=@sim/auth
bun run check:api-validation:strict
git diff --check
```

Do not claim a check passed unless it completed successfully.

## Work safely in parallel

- Assign non-overlapping route modules and caller sets. Two methods in one route file are one ownership unit.
- Treat operation registries, contract families, route policies, and shared surface adapters as merge hotspots.
- Keep shared core foundations owned by one task; ordinary domain migrations should consume them without modifying them.
- Preserve unrelated working-tree changes. Never stage proposal docs, lockfile drift, or another agent's edits.
- Do not commit, push, or open a PR unless requested.

## Hand off

Report:

1. Semantic operation, role, workspace-key policy, and principal kinds.
2. Migrated, deferred, and non-goal entry points.
3. Behavior preserved per internal, public, Copilot, and other tool surface.
4. Identity construction and authoritative scope source for each surface.
5. Files changed and shared merge hotspots.
6. Tests and checks run with results.
7. Remaining risks or blockers. Fail fast when an invariant could not be implemented.
