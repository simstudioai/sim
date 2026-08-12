---
description: The response, error, pagination, and validation contract every `/api/v2` endpoint must satisfy. Use when adding or changing a route under `apps/sim/app/api/v2/`, or when auditing one for conformance.
argument-hint: <route-path>
---

# v2 API Conventions

The v2 surface makes one promise: **every response is the same two shapes, and a caller-supplied value can never produce a 500.**

```
success (single)      { "data": {...} }
success (collection)  { "data": [...], "nextCursor": "..." | null }
failure (always)      { "error": { "code": "...", "message": "...", "details"?: ... } }
```

Nothing else at the top level. No `success: true`, no bare `{ "error": "string" }`, no HTML.

That promise is worth stating as a rule because it has been broken four separate ways, each time by a route or a builder taking a shortcut that looked local:

- `GET /workflows?limit=1.5` returned **500**. The contract was copied from a sibling and lost its `.int()`, so a fractional limit passed validation and reached Postgres as `LIMIT 2.5`.
- A malformed JSON body returned **`{"error":"Request body must be valid JSON"}`** — a bare string. The envelope was a per-route opt-in that only 8 of 77 routes remembered.
- `GET /api/v2/nonexistent` returned a **full HTML 404 document**, because no route file matched and the request fell through to the app's global not-found page.
- Four collections returned `nextCursor` while **silently discarding** any `limit` the caller sent, because Zod strips unknown keys unless the schema is `.strict()`.

Each was one line. The rules below are the generalisations.

## Where the machinery lives

| Concern | File |
|---|---|
| Envelope + error codes + cursor codecs | `apps/sim/app/api/v2/lib/response.ts` |
| Rollout gate (`v2-api` flag) | `apps/sim/app/api/v2/lib/gate.ts` |
| Cross-tenant concealment | `apps/sim/lib/api/server/routes/resource-concealment.ts` |
| Route builder | `apps/sim/lib/api/server/routes/v2-json-route.ts` |
| Contracts | `apps/sim/lib/api/contracts/v2/**` |
| Shared list/keyset helpers | `apps/sim/lib/api/list-query.ts` |

## Rule 1 — the envelope is produced by helpers, never by hand

`v2Data`, `v2CursorList`, and `v2Error` in `response.ts` are the only things that build a v2 body. They also set `Cache-Control: private, no-store`, which every v2 response needs because every v2 response is authed per-caller data.

A route built with `defineV2JsonRoute` gets this for free: its `present` returns the *body shape* and the builder renders it. Never call `NextResponse.json` from a v2 route.

**The envelope must hold for every failure mode, including the ones that happen before your handler runs.** That is what the four bugs above have in common. Defaults for the transport-level failures live on the builder — `v2PayloadTooLargeResponse` (413) and `v2InvalidJsonResponse` (400) — precisely so a route cannot forget them.

## Rule 2 — status codes mean specific things

| Status | `code` | Meaning |
|---|---|---|
| 200 / 201 | — | Success. 201 only for a created resource. |
| 400 | `BAD_REQUEST` | Contract validation. Carries field-level `details` from `serializeZodIssues`. |
| 401 | `UNAUTHORIZED` | No/!valid API key. **Runs before the rollout gate.** |
| 403 | `FORBIDDEN` | Authenticated, same tenant, insufficient rights. Carry a machine-readable `details.code` (e.g. `WORKFLOW_NOT_DEPLOYED`). |
| 404 | `NOT_FOUND` | Not found, **and** cross-tenant concealment, **and** the rollout gate, **and** an unknown path. |
| 409 | `CONFLICT` | Uniqueness/state conflict, human-readable message. |
| 413 | `PAYLOAD_TOO_LARGE` | Body over the route's `maxBodyBytes`. |
| 429 | `RATE_LIMITED` | With `Retry-After` and `X-RateLimit-*`. |
| 500 | `INTERNAL_ERROR` | Genuine server fault only. Message is always generic. |

Two of these carry real design weight:

**404 is deliberately overloaded.** A workspace the caller cannot reach answers `404 "Workspace not found"`, never 403 — a 403 would confirm the resource exists. `createV2ResourceConcealmentPolicy` does this by mapping a cross-tenant authorization failure to `v2Error('NOT_FOUND', ...)`. The rollout gate answers the same way for the same reason (`gate.ts`: "an ungated caller cannot distinguish 'not in the rollout cohort' from 'no such endpoint'"), and so does the unknown-path catch-all at `app/api/v2/[[...segments]]/route.ts` — its body is byte-identical to the gate's on purpose.

**500 is never caller-reachable.** Any input a caller can send must be rejected at the contract boundary with a 400. If you can construct a query string or body that produces a 500, that is a bug in the contract, not something to wrap in a `try`/`catch`. `v2ErrorForOrchestration` also replaces the message on an unclassified failure with a generic one, so internal detail never leaks.

## Rule 3 — a collection that returns `nextCursor` must accept `limit` + `cursor`, and must apply them

Every list returns `{ data, nextCursor }`. Whether it *pages* is a separate, pinned decision — see `lib/api/contracts/v2/__tests__/list-pagination.test.ts`, which enumerates both sets and fails when a new list is in neither.

Build the query slice from the shared helper, never by hand:

```ts
...v2PaginationFields({ description: 'Maximum widgets to return per page.' })
```

That gives `limit` (integer, 1..`V2_MAX_PAGE_SIZE`, defaulting to `V2_DEFAULT_PAGE_SIZE` = 50) and an opaque `cursor`. Re-declaring `limit: z.coerce.number()...` inline is how the 500 happened; there is one schema so the family cannot drift again.

Two cursor schemes exist, both opaque base64-JSON from `response.ts`. Which one you use is decided by what the read can express, not by taste:

- **Keyset** (`readSortedCursor` in, `encodeSortedCursor` out) — the default. Requires the page to come from one ordered SQL read. The sort is stamped into the cursor and re-checked on replay, so changing `sortBy` mid-pagination is a 400, not a silently skipped page.
- **Offset** (`decodeOffsetCursor` / `encodeOffsetCursor`) — only when a keyset is impossible. Two lists qualify: `GET /skills` merges a static in-code registry with DB rows and re-sorts in JS, and `GET /knowledge/{id}/documents` sits on a limit/offset query. An offset cursor **must** be stamped with `offsetCursorScope(...)` covering every param that filters or orders the sequence (not `limit`, which only selects how much of it to return). A bare offset replayed against a re-sorted or re-filtered sequence names a different row, which skips or repeats results — the exact failure the keyset's sort stamp already prevents.

**A keyset's key list must end in a unique column (`id`).** A non-unique trailing key cannot separate tied rows, so the page boundary either repeats or drops them. `lib/api/list-keyset-paging.test.ts` demonstrates the failure.

Return `nextCursor: null` on the last page and only then. Never construct a cursor client-side.

## Rule 4 — reject what you do not implement

Query and body schemas are **`.strict()`**. Zod strips unknown keys by default, so a non-strict schema answers `?limit=1` with 200 and the whole set — the caller believes it bounded the response and it did not. That is a contract lie, and on an uncapped list it is also an unbounded-response risk.

Error messages name the field and, where there is one, the escape hatch:

```
limit must be a whole number
limit cannot exceed 100
search cannot be empty
sortBy: expected one of "name" | "createdAt" | "updatedAt"
Limit cannot exceed 1000; use limit=0 to stream all rows, or create an export
```

That last one is the standard to aim for. A message that only says `Invalid input` fails this rule — the caller cannot act on it.

## Rule 5 — contract first, then use case, then route

Order matters because each layer is checked against the one before it.

1. **Contract** in `lib/api/contracts/v2/<domain>.ts` via `defineRouteContract`. Response schemas are `.parse`d on the way out, so a field the producer does not actually emit becomes a 500 on a successful read — assert only what you can prove.
2. **Application use case** owns canonical loading, authorization, business behavior, and audit. The route's `present` receives **only the use-case result**, so anything the presenter needs (e.g. the active `sortBy`/`sortOrder` to stamp a cursor) must be returned by the use case.
3. **Route** with `defineV2JsonRoute`, declaring `contract`, `auth: v2ApiKeyAuth`, `operation`, `rateLimit`, `errorPolicy`, `mapInput`, `useCase`, `present`. Auth and rate limiting run before parsing.
4. **OpenAPI description** in `lib/api/contracts/v2/openapi/<domain>.ts`, then `bun run generate:openapi`. A description that claims behaviour the route does not have is the same class of bug as a wrong schema.

## Checklist

Run this against any new or changed v2 endpoint.

- [ ] Success body is exactly `{data}` or `{data, nextCursor}`; failures are exactly `{error:{code,message,details?}}`.
- [ ] Route uses a shared builder; no hand-built `NextResponse.json`.
- [ ] Query and body schemas are `.strict()`.
- [ ] No caller-supplied value can produce a 500 — check every numeric param reaches SQL as a validated integer.
- [ ] `limit` comes from `v2PaginationFields`, not a hand-written `z.coerce.number()`.
- [ ] If the response carries `nextCursor`, the query accepts `limit` + `cursor` and the query actually applies them.
- [ ] Keyset sorts end in a unique `id` key.
- [ ] The list is classified in `list-pagination.test.ts`.
- [ ] Cross-tenant access answers 404, never 403.
- [ ] 403s carry a machine-readable `details.code`.
- [ ] Validation messages name the field and echo the valid set.
- [ ] Response schema matches every field the route actually emits.
- [ ] OpenAPI description regenerated and truthful about pagination.
- [ ] `bun run type-check`, `bun run check:api-validation`, `bun run check:openapi` pass.

## Known gap

A 405 on a path that *does* have a route file but does not export that verb is generated by Next.js before any Sim code runs: zero-byte body, no `content-type`, and no `Allow` header, which RFC 9110 §15.5.6 requires. Fixing it means either exporting explicit rejecting handlers from all 77 v2 route files or intercepting in `apps/sim/proxy.ts` with a static path→methods table. Neither is done. Unknown *paths* are handled — the catch-all covers those.
