---
name: v2-api-conventions
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

That promise is worth stating as a rule because it has been broken five separate ways, each time by a route or a builder taking a shortcut that looked local:

- `GET /workflows?limit=1.5` returned **500**. The contract was copied from a sibling and lost its `.int()`, so a fractional limit passed validation and reached Postgres as `LIMIT 2.5`.
- A malformed JSON body returned **`{"error":"Request body must be valid JSON"}`** — a bare string. The envelope was a per-route opt-in that only 8 routes remembered.
- `GET /api/v2/nonexistent` returned a **full HTML 404 document**, because no route file matched and the request fell through to the app's global not-found page.
- Four collections returned `nextCursor` while **silently discarding** any `limit` the caller sent, because Zod strips unknown keys unless the schema is `.strict()`.
- Handing back a `nextCursor` from any timestamp-sorted list and passing it straight in returned **500**. The value was validated and bound — but bound with no SQL type, into `date_trunc`, which is overloaded, so Postgres could resolve no overload. Validation was never the missing half; the type was.

Each was one line. The rules below are the generalisations.

## Where the machinery lives

| Concern | File |
|---|---|
| Envelope + error codes + cursor codecs | `apps/sim/app/api/v2/lib/response.ts` |
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
| 401 | `UNAUTHORIZED` | No/!valid API key. |
| 403 | `FORBIDDEN` | Authenticated, same tenant, insufficient rights. Where the cause is one a caller can act on it is named in `details.code`, from the closed set in `lib/core/application/forbidden.ts` (e.g. `INSUFFICIENT_WORKSPACE_ROLE`, `PERSONAL_API_KEYS_DISABLED`). A few domain refusals still reach the wire without one. |
| 404 | `NOT_FOUND` | Not found, **and** cross-tenant concealment, **and** an unknown path. |
| 409 | `CONFLICT` | Uniqueness/state conflict, human-readable message. |
| 413 | `PAYLOAD_TOO_LARGE` | Body over the route's `maxBodyBytes` — **and** a collection the response must materialize that is over *its* ceiling. Fourteen bodyless `GET`/`DELETE` operations publish it for the folder-tree cap (`FolderCollectionLimitExceededError`) or the rendered-artifact cap. |
| 429 | `RATE_LIMITED` | With `Retry-After` and `X-RateLimit-*`. |
| 500 | `INTERNAL_ERROR` | Genuine server fault only. Message is always generic. |

Two of these carry real design weight:

**404 is deliberately overloaded.** A workspace the caller cannot reach answers `404 "Workspace not found"`, never 403 — a 403 would confirm the resource exists. `createV2ResourceConcealmentPolicy` does this by mapping a cross-tenant authorization failure to `v2Error('NOT_FOUND', ...)`. The unknown-path catch-all at `app/api/v2/[[...segments]]/route.ts` answers with the same body on purpose.

**500 is never caller-reachable.** Any input a caller can send must be rejected at the contract boundary with a 400. If you can construct a query string or body that produces a 500, that is a bug in the contract, not something to wrap in a `try`/`catch`. `v2ErrorForOrchestration` also replaces the message on an unclassified failure with a generic one, so internal detail never leaks. A caller-reachable 500 has shipped three times — a fractional `limit` reaching `LIMIT 2.5`, a plain `HEAD` tripping the builder's method guard, and a keyset cursor's timestamp reaching `date_trunc` as an untyped placeholder — so treat "a well-formed request produced a 500" as the highest-severity class of defect on this surface.

**Validating a value is only half of it; the value also has to reach SQL with a type.** A bound parameter arrives as `unknown` and takes its type from context. Against a typed column (`sort_order > $1`) that inference always succeeds, which is why the gap stays invisible almost everywhere — but as an argument to an overloaded function it can resolve to nothing at all. So: **if a bound value is an argument to a SQL function rather than one side of a comparison, write its type down** (`lib/api/list-query.ts`, `timestampKey`, casts from the column).

And this class survives a green test suite — `keysetAfter` returned well-formed SQL and every assertion passed; only Postgres's parser rejected it. When a change alters the *shape* of generated SQL rather than its values, execute it somewhere before believing the suite.

**Which of 403 and 404 an operation documents follows from its authorization, not from whether it is a read.** `requirePermission` throws two different failures: no workspace access at all is `NoWorkspaceAccessError`, which `createV2ResourceConcealmentPolicy` conceals as 404; access below the operation's `minimumRole` is `InsufficientWorkspacePermissionsError`, which stays a 403. So:

- An operation whose `minimumRole` is `write` or `admin` can always 403 — a member with a lower role hits it. Document 403.
- An operation whose `minimumRole` is `read` cannot 403 *that* way, because `read` is the floor of the `read < write < admin` ordering and anyone without access is concealed as 404 instead. It can still 403 through `PersonalApiKeysDisabledError` (a personal API key against a workspace whose organization disabled them) or `WorkspaceApiKeyAuthorizationError` (`workspaceApiKey: 'deny'`), and every v2 operation is reachable by a personal API key. **So in practice every workspace-scoped v2 operation documents 403**, and the reads that omitted it were wrong, not principled.

**A 403 a caller can act on names its cause in `error.details.code` — but not every 403 does yet.** One status covers several different remedies — raise a member's role, issue a personal key instead of a workspace-scoped one, re-point a workspace key, buy an enterprise plan, delete a resource to get under a quota — and prose is not branchable, so a client that must tell them apart was string-matching messages, which turns every reword into a silent break. A handful of domain refusals still throw a bare `OrchestrationError('forbidden', …)` and reach the wire with no code, so **write client code that treats `details.code` as optional**, and read `openapi/shared.ts`'s `FORBIDDEN_DESCRIPTION` for the current position rather than assuming the sweep is finished. For code you are *writing*, the rule below is unconditional.

The vocabulary is a closed set, `FORBIDDEN_DETAIL_CODES` in `lib/core/application/forbidden.ts`, with a `Record` of descriptions beside it that the generated OpenAPI 403 description is built from. Adding a member fails to compile until it is documented, so a code cannot reach the wire unpublished. Do not invent a code at a route: throw `ForbiddenOperationError(code, message)` from the domain and let `v2CaughtOrchestrationError` — the function every v2 error policy falls through to — attach it. `InsufficientWorkspacePermissionsError`, `PersonalApiKeysDisabledError`, `WorkspaceApiKeyAuthorizationError`, and `PrincipalKindAuthorizationError` already carry theirs.

The cross-tenant refusals (`NoWorkspaceAccessError`, `WorkspaceApiKeyScopeAuthorizationError`, `DelegatedWorkspaceAuthorizationError`) deliberately carry **no** code. They are concealed as 404, and naming their cause would hand back the resource-existence signal the concealment exists to withhold.

Use the shared sets in `contracts/v2/openapi/shared.ts` — `RESOURCE_ERRORS`, `RESOURCE_CONFLICT_ERRORS`, `RESOURCE_MUTATION_ERRORS` — rather than assembling a per-operation list; all three already include `Forbidden`, and hand-assembled lists are how three knowledge reads and three upload operations quietly lost it.

**HEAD is answered by the `GET` handler, not rejected.** Next aliases a missing `HEAD` export onto `GET` and drops the body when sending, so a route's `GET` legitimately runs with `request.method === 'HEAD'`. The builders' method guard accepts that pairing via `methodMatchesContract`; any other mismatch stays a hard error. Never hand-write a `HEAD` export to "fix" this.

**A `GET` with side effects must declare `headSafe: false`.** The aliasing above is only sound because RFC 9110 §9.2.1 defines `HEAD` as safe. A `GET` that writes a row or opens an outbound connection is not, and an uptime monitor or link checker walking the documented URL list would drive those effects on every probe — `GET /files/{fileId}` records a `FILE_DOWNLOADED` audit event, so without `headSafe: false` a `HEAD` would fabricate a download that never happened. Both the JSON and binary builders take `headSafe`: a route that sets it `false` still authenticates and rate-limits a `HEAD`, then answers `v2HeadNoEffect()` — a bodiless 200 — before parsing or executing. Nothing observable is lost, because `HEAD` carries no body either way. Audit this whenever a read acquires an audit projection or an outbound call.

## Rule 3 — a collection that returns `nextCursor` must accept `limit` + `cursor`, and must apply them

Every list returns `{ data, nextCursor }`. Whether it *pages* is a separate, pinned decision — see `lib/api/contracts/v2/__tests__/list-pagination.test.ts`, which enumerates both sets and fails when a new list is in neither.

Build the query slice from the shared helper, never by hand:

```ts
...v2PaginationFields({ description: 'Maximum widgets to return per page.' })
```

That gives `limit` (integer, 1..`V2_MAX_PAGE_SIZE`, defaulting to `V2_DEFAULT_PAGE_SIZE` = 50) and an opaque `cursor`. Re-declaring `limit: z.coerce.number()...` inline is how the 500 happened; there is one schema so the family cannot drift again.

Three cursor schemes exist. Two are the shared codecs in `response.ts`, both opaque base64-JSON, and which of them you use is decided by what the read can express, not by taste:

- **Keyset** (`readSortedCursor` in, `encodeSortedCursor` out) — the default. Requires the page to come from one ordered SQL read. The sort AND the filters are stamped into the cursor and re-checked on replay, so changing `sortBy` or any filter mid-pagination is a 400, not a silently skipped page.
- **Offset** (`decodeOffsetCursor` / `encodeOffsetCursor`) — only when a keyset is impossible. Two lists qualify: `GET /skills` merges a static in-code registry with DB rows and re-sorts in JS, and `GET /knowledge/{id}/documents` sits on a limit/offset query. A bare offset replayed against a re-sorted or re-filtered sequence names a different row, which skips or repeats results.

Both take the same two stamps: `cursorSortKey(sortBy, sortOrder)` for the ordering, and `cursorScopeKey(cursorRoute(contract, pathParams), { ... })` for every param that filters the sequence — the route identity is the first argument, the filter parts the second. **`limit` is never a stamp** — it selects how much of the sequence to return, not what the sequence is, and binding it strands every cursor the moment a caller changes page size. Params that only shape the response body are out for the same reason.

The third is **per-domain**: a list whose read predates the shared codecs, or whose page boundary is not expressible as one, mints its own — a bare `encodeCursor({ version })` on `GET /workflows/{id}/versions` and `encodeCursor({ email })` on the workspace member list, the local codecs in `lib/audit-logs/query.ts`, `lib/logs/list-logs.ts`, and `lib/table/rows/cursor.ts`, and a usage-event id passed straight through by `GET /billing/logs`. Those tokens stay opaque and untouched, but a domain-minted cursor on a list a caller can re-filter is wrapped at the surface with `encodeScopedCursor(cursorScopeKey(cursorRoute(contract, pathParams), {...}), token)` and unwrapped with `readScopedCursor`, so it carries the same binding as the shared schemes. **A new list picks one of the two shared schemes.** Do not add a fourth.

Every paged list's binding is declared in `lib/api/contracts/v2/__tests__/list-pagination.test.ts` and checked against what the contract actually accepts, in both directions. A new list, or a new filter on an existing one, fails that test until its binding is declared or the param is explicitly recorded as unable to change the sequence.

**A keyset's key list must end in a unique column (`id`).** A non-unique trailing key cannot separate tied rows, so the page boundary either repeats or drops them. `lib/api/list-keyset-paging.test.ts` demonstrates the failure.

Return `nextCursor: null` on the last page and only then. Never construct a cursor client-side.

**Ordering is `sortBy` + `sortOrder`, except where there is nothing to sort by.** Nearly every paged list takes the pair; `CURSOR_BINDINGS` in `contracts/v2/__tests__/list-pagination.test.ts` is the authoritative set. Exactly one — `GET /workflows/{workflowId}/runs` — has a single sortable column (start time), so there is no `sortBy` to pair with and the direction rides on a single `order` param; `sortBy`/`sortOrder` are not accepted there. That is the *only* sanctioned deviation, and it is documented in its contract. A new list picks the pair. Do not "fix" it by accepting `sortOrder` as an alias: an alias is a second spelling of one thing with undefined precedence when both arrive, which is its own inconsistency.

Before documenting a second `order`-style exception, check every other endpoint on the same collection: if one of them already sorts those rows more than one way, the "exactly one sortable column" premise is false — fix the premise rather than documenting the exception.

**A boolean query param is a real boolean**, declared with `booleanQueryFlagSchema` from `contracts/primitives.ts`; it coerces `'true'`/`'1'` and `'false'`/`'0'`/`''`. Reusing an internal `.shape.x` inherits the internal spelling (often a `z.enum(['true','false'])`); re-declare instead when the internal one is not the v2 convention.

## Rule 4 — reject what you do not implement

**Every contract declares a `query`, even when the endpoint takes none** — `query: noInputSchema` (`z.object({}).strict()`), never omission. `parseRequest` validates the query slice only when the contract declares one, so an omitted `query` means "never look at the query string", not "takes no query params". The two were indistinguishable, which is how 69 contracts ended up accepting anything without anyone deciding they should: `GET /workflows/{id}?bogus=1` answered 200 while every list answered 400 for the same shape. `query-declaration.test.ts` sweeps the tree so contract 70 fails at authoring time rather than shipping unvalidated.

Unknown query params are a 400. That is safe for first-party callers — the two SDKs send only `includeOutput`/`selectedOutputs`, both declared; the UI makes no v2 calls; `requestJson` appends nothing implicitly and there is no v2 cache buster — and it matches the already-strict body slice. Third-party callers appending a tracking tag or cache buster do break, which is why `api-reference/getting-started.mdx` documents the behavior rather than leaving it to be discovered from a 400.

Query and body schemas are **`.strict()`** — and `.strict()` binds the **top level only**. A strict body containing a non-strict nested object still drops unknown keys one level down, which is the headline `filter` bug at a smaller scale: `sort: [{ field, direction, nulls: 'last' }]` answered 200 and ordered by the default. Strictness belongs on the shared nested schema (`sortSpecSchema`'s element, `tableViewConfigSchema`), not restated per body.

Before tightening a schema that is **also** a response or a stored blob, make the read canonical first. `table_views.config` is schemaless JSONB, so a legacy row carrying a retired key would fail a newly strict response parse and become a 500; `normalizeStoredViewConfig` projects the stored blob onto the declared keys so the tightening is safe in both directions. Zod strips unknown keys by default, so a non-strict schema answers `?limit=1` with 200 and the whole set — the caller believes it bounded the response and it did not. That is a contract lie, and on an uncapped list it is also an unbounded-response risk.

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
2. **Application use case** owns canonical loading, authorization, business behavior, and audit. The route's `present` receives the use-case result **and the parsed request**, so a presenter reads request params (the active `sortBy`/`sortOrder` and filters it stamps into a cursor) straight from `query`/`params` rather than making the use case carry an HTTP concern back out.
3. **Route** with `defineV2JsonRoute`, declaring `contract`, `auth: v2ApiKeyAuth`, `operation`, `rateLimit`, `errorPolicy`, `mapInput`, `useCase`, `present`. Auth and rate limiting run before parsing.
4. **OpenAPI description** in `lib/api/contracts/v2/openapi/<domain>.ts`, then `bun run generate:openapi`. A description that claims behaviour the route does not have is the same class of bug as a wrong schema.

### Public descriptions

Use the [API description conventions](../../../apps/sim/lib/api/contracts/v2/openapi/README.md) when writing or auditing endpoint and field descriptions. Keep a short action-and-resource summary; use the description for behavior that changes the caller's choice, input, interpretation, or next action. Ordinary operations usually need one to three sentences, with no mandatory minimum.

Keep archive versus permanent-delete behavior, replacement versus partial-update semantics, partial success, retry safety, redaction, and asynchronous completion explicit. Verify these claims against the implementation. Describe observable behavior without exposing storage formats, locking mechanisms, internal identifiers, deployment architecture, or implementation history unless that detail changes how the caller must use the API.

Reuse wording across resource families when behavior matches: “Omitted fields remain unchanged,” “Archive,” and “permanently delete.” Prefer “during the request” or “asynchronously” to “settled inline.” Preserve real semantic differences; do not standardize them away.

Put field-specific rules in the source schema and reuse shared authentication and pagination wording. Shared schema descriptions also feed CLI help, so refer to related operation names rather than HTTP paths. Regenerate OpenAPI, CLI metadata, and CLI docs after changing their source descriptions; never hand-edit generated output.

## Rule 6 — a transient failure says when to come back

A response the caller is *expected* to retry must say how long to wait. Two statuses qualify, and both are wired:

| Status | Source of the value | Where |
|---|---|---|
| 429 | The caller's own token bucket (`retryAfterMs`, else `resetAt - now`) | `v2RateLimitError` |
| 503 | A fixed floor, `RETRY_AFTER_SECONDS_BY_STATUS` | `v2Error`, applied automatically |

The 503 default is applied by `v2Error` keyed on the response *status* — `Retry-After` is defined against the status, and the status is the only half of the code/status pair a client sees — so every 503 the surface can emit carries it — the three route builders' `unhandledErrorResponse`, the execute and resume routes, and `serviceFailureResponse`'s `infra` failures. A route with a better number passes `headers: { 'Retry-After': … }` and wins.

Do not add a default for any other code. 400/403/404/409 are not fixed by waiting, and 402 (`USAGE_LIMIT_EXCEEDED`) is resolved by a billing change, not by time.

**Where a policy already knows the wait, carry it — do not re-guess it at the transport.** The admission descriptors in `lib/core/admission/transient-failure` declare `retryAfterSeconds` per denial. Carry it the whole way: `descriptor.retryAfterSeconds → PreprocessExecutionError.retryAfterMs → ExecuteWorkflowServiceFailure.retryAfterMs → serviceFailureResponse`; a mapping that drops it turns a concurrency denial into a bare 429 with no `Retry-After` even though the policy named the wait. The `v2Error` default is the floor for paths with *no* policy signal, not the source of truth.

**A failure whose outcome is unknown must not advise a retry.** `ASYNC_ENQUEUE_AMBIGUOUS` is a 503 whose enqueue may have succeeded — it deliberately retains its execution-ID claim. Telling that caller to come back in 5 seconds invites a client with no `X-Run-Id` to start and bill a second run. It passes `omitRetryAfter: true` and returns the run id so the caller reconciles instead. Any future "we don't know if it happened" failure does the same.

RFC 9110 §10.2.3 gives 503 this field's clearest meaning — "how long the service is expected to be unavailable to the client". Note the requirement level is only `MAY`, on 503 (§15.6.4) and, via RFC 6585 §4, on 429. It is `SHOULD` on exactly one status, 413, and only when the condition is temporary; none of Sim's 413s are temporary — they are fixed ceilings, on the request body and on the collections a response must materialize — so it correctly sends none.

## Deliberate non-adoptions

Audited against the primary specs and against Stripe, GitHub, and Google's AIPs. Each is a considered "no", not an oversight. Re-open one only with new evidence.

| Practice | Verdict | Why |
|---|---|---|
| **RFC 9457 `application/problem+json`** | No | 9457 §4 steers APIs with an existing format toward keeping it: "Problem details are intended to avoid the necessity of establishing new 'fault' or 'error' document formats, **not to replace existing domain-specific formats**." Nothing in it is a `MUST` to adopt, and none of Stripe, GitHub, or Google use it. Our envelope is load-bearing for every client. **The default error shape does not change.** |
| **`RateLimit`/`RateLimit-Policy` (IETF draft)** | No | Still an unpublished IETF draft whose wire format has changed incompatibly across revisions — anything built against an earlier revision is already broken. None of the three surveyed APIs emit it; GitHub uses `x-ratelimit-*`, as we do. Re-check the draft's status before re-opening. |
| **Renaming `X-RateLimit-*` per RFC 6648** | No | 6648 is a `SHOULD NOT` binding *creators of new* parameters, and §1 item 4 "**makes no recommendation as to whether existing 'X-' parameters ought to remain in use or be migrated**". Appendix B argues the migration is itself the interoperability harm. A rename is a client-visible break bought with nothing. |
| **`X-RateLimit-Reset` as delta-seconds** | No | It is an absolute ISO 8601 timestamp, so it is clock-skew sensitive — but the response where timing actually decides behaviour (429) also carries `Retry-After`, which is skew-free. The absolute value stays useful for scheduling. |
| **422 for semantic validation** | No | RFC 9110 §15.5.21 defines 422, but Appendix B.3 records that 9110 **deleted** RFC 4918's clause saying 400 was inappropriate. 400 covers "cannot or will not process… perceived to be a client error". The split is convention, not requirement — GitHub splits, Stripe and Google do not. Our machine-readable `error.code` already carries the distinction, and restatusing now breaks clients. |
| **`Location` on 201** | No | §9.3.3 makes this a `SHOULD` **for POST**; the status code itself (§15.3.2) requires nothing and defines the fallback — absent `Location`, the target URI identifies the resource. Declined knowingly: several 201 responses (signed upload sessions, table exports, knowledge folders) have no canonical single-resource GET, so a `Location` would 404, and adopting it on some of the 19 is worse for a client than on none. Every 201 returns the full representation including its `id`. Revisit per-route if one gains a canonical GET. |
| **ETag / `If-None-Match` / `If-Match`** | No | Every v2 response is `Cache-Control: private, no-store` per-caller data, so `If-None-Match` buys nothing. For writes, `If-Match` needs a **strong** validator: §8.8.3.2's strong comparison fails if *either* tag is weak, so a weak ETag silently makes every `If-Match` fail. None of the three surveyed APIs does HTTP optimistic concurrency — Google does the semantics via a resource `etag` **field** (AIP-154), deliberately not the header. If Sim needs optimistic concurrency, do it that way. |
| **`Deprecation` / `Sunset` on v1** | Not yet | RFC 9745 (Standards Track) and RFC 8594 (Informational) both apply, and GitHub emits both. But `Sunset` is a timestamp and 9745 §4 makes `Sunset >= Deprecation` a `MUST`, so emitting either commits Sim to a v1 retirement date — a product decision, not an engineering one. When that date exists: `Deprecation` is an RFC 9651 Structured Field **Date** (`@1688169599`); `Sunset` is an **HTTP-date** (`Sat, 31 Dec 2033 23:59:59 GMT`). Two encodings in one response — the most common implementation error here. |
| **`application/merge-patch+json`** | No | v2 PATCH bodies are merge-patch *shaped* — absent means unchanged, `null` clears — but they are `.strict()`, so unknown members are rejected where RFC 7396 §2 would merge them, and nested objects are replaced wholesale rather than merged. Advertising the media type would over-claim. Document the semantics per contract instead. |

## Idempotency: at-most-once, not replay

`POST /workflows/{id}/execute` accepts `X-Run-Id` from API-key and OAuth callers; anonymous requests ignore it. It is a **uniqueness claim, not an idempotency key**:

- An available ID is claimed before execution starts.
- An already claimed ID returns **409** with `error.details.code: "RUN_ID_CONFLICT"`, the run id in `error.details.runId`, and an `X-Run-Id` response header. It never replays the earlier run's result. Get Workflow Run can retrieve an existing run, but a claim does not guarantee a retrievable run.
- IDs of runs that started remain reserved after their execution logs are deleted.
- An ambiguous enqueue can retain the claim indefinitely without creating a retrievable run. A **409** followed by **404** is an unresolved outcome, not proof that execution never started or that the ID will become reusable.

For an uncertain execution outcome, reuse the same run ID if retrying and check Get Workflow Run. Do not promise polling will eventually find a run. If the outcome cannot be verified, do not automatically restart with a fresh ID or an omitted header: either can start another execution. Failures before a run starts can release the claim, so phrase the conflict rule as an ID that is already claimed.

That makes the money path safe against double-execution **for callers that opt in**. What it is not: a Stripe-style `Idempotency-Key` that stores and replays the original status and body. Building that means a request fingerprint, a retention window, an in-flight-vs-completed distinction (the expired IETF draft would have these be 422 and 409 respectively), and somewhere to put a large synchronous execution body. It is a designed piece of work, not an increment — do not half-build it by aliasing the header name, which would invite clients written against Stripe semantics to treat our 409 as a hard failure.

## Cursors are opaque, not trusted

The base64-JSON cursor is **not signed**, and does not need to be. Tampering is bounded by construction, and that is a property to preserve:

- Every key value is re-validated by its `KeysetKey.bind`, which returns `null` for a wrong-typed or unparseable value and becomes a 400. A forged cursor cannot reach SQL as `NaN` or an `Invalid Date`.
- The sort and a fingerprint of the filters are stamped into the cursor and re-checked (`decodeSortedCursor`), so a cursor from a differently-sorted or differently-filtered query is a 400, not a silently skipped page. The filters are hashed (SHA-256, via `lib/api/cursor-binding.ts`) rather than embedded, so the token stays short and a caller cannot cheaply construct a filter that collides with another sequence's stamp.
- The offset codec rejects anything that is not a non-negative integer.
- Authorization is **never** carried in the cursor. Every list re-derives its workspace scope from the authenticated principal, so a cursor lifted from another query — or another tenant — can only move the caller within their own authorized result set.

The consequence to keep true: **never put a resource id, filter, or scope into a cursor and then trust it on the way back.** A cursor is a position hint, never an input to an access decision.

## Checklist

Run this against any new or changed v2 endpoint.

- [ ] Success body is exactly `{data}` or `{data, nextCursor}`; failures are exactly `{error:{code,message,details?}}`.
- [ ] Route uses a shared builder; no hand-built `NextResponse.json`.
- [ ] Query and body schemas are `.strict()`.
- [ ] The contract declares a `query` — `noInputSchema` when the endpoint takes no query params, never omission.
- [ ] No caller-supplied value can produce a 500 — check every numeric param reaches SQL as a validated integer, and that any bound value passed as an argument to a SQL function carries an explicit type.
- [ ] `limit` comes from `v2PaginationFields`, not a hand-written `z.coerce.number()`.
- [ ] If the response carries `nextCursor`, the query accepts `limit` + `cursor` and the query actually applies them.
- [ ] The cursor is bound to every param that filters or orders the sequence, and to none that do not (never `limit`), with the binding declared in `list-pagination.test.ts`.
- [ ] Keyset sorts end in a unique `id` key.
- [ ] The list is classified in `list-pagination.test.ts`.
- [ ] Cross-tenant access answers 404, never 403 — and carries `Cache-Control: private, no-store`, because RFC 9110 §15.5.5 makes 404 heuristically cacheable and an authorization-dependent 404 must never be stored. `v2Error` sets this unconditionally; do not build a v2 response any other way.
- [ ] A retryable failure says when: 429 and 503 carry `Retry-After`. No other status invents one.
- [ ] 403s carry a machine-readable `details.code` from `FORBIDDEN_DETAIL_CODES`, thrown as `ForbiddenOperationError` in the domain rather than attached at the route.
- [ ] Nested objects inside a `.strict()` body are strict too — `.strict()` does not recurse.
- [ ] Ordering uses `sortBy` + `sortOrder`; boolean query params use `booleanQueryFlagSchema`.
- [ ] Validation messages name the field and echo the valid set.
- [ ] Response schema matches every field the route actually emits.
- [ ] OpenAPI description regenerated and truthful about pagination.
- [ ] `bun run type-check`, `bun run check:api-validation`, `bun run check:openapi` pass.

## Known gap

A 405 on a path that *does* have a route file but does not export that verb is generated by Next.js before any Sim code runs: zero-byte body, no `content-type`, and no `Allow` header, which RFC 9110 §15.5.6 requires. Fixing it means either exporting explicit rejecting handlers from every v2 route file or intercepting in `apps/sim/proxy.ts` with a static path→methods table. Neither is done. Unknown *paths* are handled — the catch-all covers those.
