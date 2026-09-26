---
description: API contracts, route builders, boundary annotations, and the requestJson client boundary
paths:
  - "apps/sim/app/api/**"
  - "apps/sim/lib/api/**"
  - "apps/sim/lib/**/application/**"
  - "apps/sim/hooks/queries/**"
  - "apps/sim/hooks/selectors/**"
---

# API Contracts and Routes

Boundary HTTP request and response shapes for all routes under `apps/sim/app/api/**` live in `apps/sim/lib/api/contracts/**` (one file per resource family — `folders.ts`, `chats.ts`, `knowledge.ts`, etc.). Routes never define route-local boundary Zod schemas, and clients never define ad-hoc wire types — both sides consume the same contract.

- Each contract is built with `defineRouteContract({ method, path, params?, query?, body?, headers?, response: { mode: 'json', schema } })` from `@/lib/api/contracts`.
- Contracts export named schemas (e.g., `createFolderBodySchema`) AND named TypeScript type aliases (e.g., `export type CreateFolderBody = z.input<typeof createFolderBodySchema>`). Clients (hooks, utilities, components) import the named aliases; they never write `z.input<...>` / `z.output<...>` themselves.
- Shared identifier schemas live in `apps/sim/lib/api/contracts/primitives.ts` (e.g., `workspaceIdSchema`, `workflowIdSchema`). Reuse these instead of redefining string-based ID schemas.
- Domain validators that are not HTTP boundaries — tools, blocks, triggers, connectors, realtime handlers, and internal helpers — may still use Zod directly. The contract rule is boundary-only.

## Enforcement

`bun run check:api-validation` enforces boundary policy and prints ratchet metrics (route Zod imports, route-local schema constructors, route `ZodError` references, client hook Zod imports, and related counters). `bun run check:api-validation:strict` is the CI gate: it additionally fails on annotations with empty reasons. Both must pass on PRs.

Whole-file allowlists for routes that legitimately import Zod for non-boundary reasons go through `INDIRECT_ZOD_ROUTES` in `scripts/check-api-validation-contracts.ts`, not per-line annotations.

## Boundary annotations

A small number of legitimate exceptions are tolerated when annotated. The audit recognizes four forms:

- `// boundary-raw-fetch: <reason>` — directly above a raw `fetch(` inside `apps/sim/hooks/queries/**`, `apps/sim/hooks/selectors/**`, or any other source under `apps/sim/**` (outside an API route handler) that targets a same-origin `/api/...` URL. Only for streaming responses, binary downloads, multipart uploads, signed-URL flows, OAuth redirects, and external-origin requests.
- `// double-cast-allowed: <reason>` — directly above an `as unknown as X` cast outside test files.
- `// boundary-raw-json: <reason>` — directly above a raw `await request.json()` / `await req.json()` read (or the multi-line `await request.clone().json()` shim variant) in a route handler. Only when the body is a JSON-RPC envelope, a tolerant `.catch(() => ({}))` parse, or otherwise cannot go through `parseRequest`.
- `// untyped-response: <reason>` — directly above a `schema: z.unknown()` / `schema: z.object({}).passthrough()` / `schema: z.record(z.string(), z.unknown())` response declaration (or a simple alias to one of those) in a contract file. Only when the response body is genuinely opaque (user-supplied data, third-party passthrough).

Placement: the annotation must immediately precede the call or cast; up to three non-empty preceding comment lines are tolerated, so context comments above it are fine. The reason must be non-empty after trimming (`annotationsMissingReason` in strict mode). Never add an annotation to silence a fixable finding — adopt the contract and `requestJson`, or narrow the type.

```ts
// boundary-raw-fetch: streaming SSE chunks must be processed as they arrive
const response = await fetch(`/api/copilot/chat/stream?chatId=${chatId}`, { signal })
```

```ts
// double-cast-allowed: legacy provider type lacks the discriminator field we need
const provider = config as unknown as LegacyProvider
```

```ts
// boundary-raw-json: shim pre-validates the mothership envelope before delegating to the copilot handler that consumes the body
const body = await request
  .clone()
  .json()
  .catch(() => undefined)
```

```ts
// untyped-response: forwards firecrawl /v2/parse response unchanged for downstream tool consumers
output: z.unknown(),
```

## Route pattern

Every route method runs inside `withRouteHandler`. Ordinary internal and v2 JSON/binary routes use `defineInternalJsonRoute`, `defineV2JsonRoute`, or the matching binary/stream builder; these already apply `withRouteHandler`, so never wrap them again. Use raw `withRouteHandler` only for explicit protocol or lifecycle exceptions such as streaming, multipart control, large-body admission, OAuth, or public execution. Never export a bare `async function GET/POST/...`.

Routes never `import { z } from 'zod'` and never define route-local boundary schemas. Declarative builders consume contracts and own authentication, admission, parsing, use-case execution, response validation, and error projection. A raw special route consumes the same contracts and validates with the canonical helpers from `@/lib/api/server`, after authentication and cheap admission:

- `parseRequest(contract, request, context, options?)` — parses params, query, body, and headers in one call. Pass `{}` for `context` on routes without route params, or the route's `context` argument when they exist. Returns a discriminated union; check `parsed.success` and return `parsed.response` on failure.
- `validationErrorResponse(error)` and `getValidationErrorMessage(error, fallback)` — produce 400 responses from a `ZodError`.
- `validationErrorResponseFromError(error)` — for unknown caught errors that may or may not be a `ZodError`.
- `isZodError(error)` — type guard. Routes never use `instanceof z.ZodError`.

### Ordinary authorized JSON route

```typescript
export const PATCH = defineInternalJsonRoute({
  contract: renameWidgetContract,
  auth: internalSessionAuth,
  operation: widgetOperations.rename,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal behavior' }),
  errorPolicy: internalWidgetErrorPolicy,
  mapInput: ({ params, body }) => ({
    widgetId: params.widgetId,
    assertedWorkspaceId: params.workspaceId,
    name: body.name,
  }),
  useCase: renameWidget,
  present: ({ widget }) => ({ success: true, widget }),
})
```

The contract, operation, and use case must agree at definition time. Authentication and request-rate admission happen before parsing; canonical loading and authorization happen in the application use case. The presenter returns only the surface success body.

Routes under `apps/sim/app/api/v1/**` use the shared middleware in `apps/sim/app/api/v1/middleware.ts` for auth, rate-limit, and workspace access. Compose contract validation inside that middleware — never reimplement auth/rate-limit per route. `/api/v2` conventions are in the `v2-api-conventions` skill.

## Client boundary

Every same-origin JSON call goes through `requestJson(contract, ...)` from `@/lib/api/client/request` instead of raw `fetch`. It parses params, query, body, and headers against the contract on the way out and validates the JSON response on the way back; callers always forward `signal`. Client code never imports `zod`. React Query hook patterns are in `.claude/rules/sim-queries.md`.

## Adding a boundary feature end-to-end

Follow this order; each step has one place it lives.

1. **Author the contract first** in `apps/sim/lib/api/contracts/<domain>.ts` (or a subdirectory for large domains: `knowledge/`, `selectors/`, `tools/`). One schema per request slice (`params`, `query`, `body`, `headers`) and one for the response, wrapped with `defineRouteContract`. Export named type aliases (`z.input` for inputs, `z.output` for outputs).
2. **Define the semantic operation and application use case** under `apps/sim/lib/<domain>/application/`. The use case owns canonical loading, asserted-scope checks, current authorization, business behavior, semantic audit, and shared domain effects. Use the `migrate-application-operation` skill.
3. **Implement the route adapter** in `apps/sim/app/api/<path>/route.ts` with the appropriate shared builder: auth, operation, rate policy, error policy, input mapping, use case, and presenter. Auth always runs **before** parsing.
4. **Add the React Query hook** in `apps/sim/hooks/queries/<domain>.ts`, calling `requestJson(contract, input)` with a hierarchical key factory.
5. **Use the hook in the component.** The mutation's `data` and `error` are typed from the contract; surface `error.message` (already extracted from the response body's `error` or `message` field by `requestJson`).

## Schema review checklist

Read a contract diff like a DB migration. CI catches structural violations (Zod imports in routes, raw `request.json()`, double casts, missing annotations), not these judgments:

- **`required` vs `optional` vs `nullable` is correct.** `optional()` allows omission; `nullable()` allows `null`; chaining both creates a tri-state that's almost never wanted.
- **The response schema matches the route's actual JSON output.** The most common drift bug — the route emits a field the schema doesn't declare, or omits a required one. Walk every `NextResponse.json(...)` callsite against the schema.
- **Error messages are descriptive.** `'fileName cannot be empty'` beats `'Required'`. Use the second arg of `min(1, '...')`, `nonempty('...')`, etc. For cross-field refines, use `superRefine` with a `path` and a message that names the failing field.
- **Bounds are set** on arrays (`.min(1)`, `.max(N)`), strings (`.min(1).max(N)` for IDs/names), and numbers (`.min().max()` for limits/sizes).
- **`z.unknown()` is a smell** unless the data is genuinely arbitrary (provider passthrough, user-defined tool result, JSON-RPC envelope); when kept, it carries `// untyped-response: <specific reason>`.
- **Discriminated unions over plain unions** when the wire has a discriminant field — clients get exhaustive narrowing.
