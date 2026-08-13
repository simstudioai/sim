import { NextResponse } from 'next/server'
import type { ZodError } from 'zod'
import { REFILTERED_CURSOR_MESSAGE, UNREADABLE_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { type CursorKey, INVALID_CURSOR_MESSAGE } from '@/lib/api/list-query'
import { getValidationErrorMessage, serializeZodIssues } from '@/lib/api/server'
import { ADMISSION_RETRY_AFTER_SECONDS } from '@/lib/core/admission/transient-failure'
import { forbiddenErrorDetails } from '@/lib/core/application'
import {
  asOrchestrationError,
  OrchestrationError,
  type OrchestrationErrorCode,
} from '@/lib/core/orchestration/types'
import type { HttpError } from '@/lib/core/utils/http-error'
import type { RateLimitResult, WorkspaceAccessError } from '@/app/api/v1/middleware'

/**
 * Runtime response helpers for the v2 API surface. Every v2 route renders its
 * output through these so the envelope, error shape, and rate-limit headers stay
 * identical across the whole surface. v2 routes reuse the v1 auth/rate-limit
 * middleware and the platform domain services — these helpers only standardize
 * the HTTP envelope.
 */

export type V2ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'USAGE_LIMIT_EXCEEDED'
  | 'LOCKED'
  | 'RATE_LIMITED'
  | 'CLIENT_CLOSED_REQUEST'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'

const STATUS_BY_CODE: Record<V2ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  USAGE_LIMIT_EXCEEDED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  LOCKED: 423,
  RATE_LIMITED: 429,
  CLIENT_CLOSED_REQUEST: 499,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
}

const V2_CODE_BY_HTTP_STATUS: Partial<Record<number, V2ErrorCode>> = Object.fromEntries(
  Object.entries(STATUS_BY_CODE).map(([code, status]) => [status, code as V2ErrorCode])
)

/**
 * Every v2 response is authed, per-caller data (ids/filters appear in query
 * strings) — keep it out of shared HTTP caches unconditionally.
 */
const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' } as const

/**
 * Seconds a caller should wait before retrying a transient v2 failure, for the
 * statuses whose response carries no other timing signal.
 *
 * Keyed on the response status rather than the v2 error code because
 * `Retry-After` is defined against the status, and the status is the only half
 * of the pair a client actually sees. `v2Error` lets a caller override the
 * status independently of the code, so keying on the code would let the two
 * disagree.
 *
 * RFC 9110 §10.2.3 singles out 503 as the status whose `Retry-After` means "how
 * long the service is expected to be unavailable to the client", and §15.6.4
 * permits one. Note the requirement level is `MAY`, so this is a deliberate
 * improvement on the baseline rather than a conformance fix: without it a
 * client's only defensible policy on a 503 is an immediate retry, which is
 * exactly the traffic a degraded dependency cannot absorb. Sim raises 503 when
 * the API-key store, the rollout gate, the rate-limit backend, or
 * execution-identity allocation is briefly unavailable, and all four are made
 * worse by an unthrottled retry storm.
 *
 * 429 is deliberately absent because every 429 already knows its own wait: the
 * throttle path measures it from the caller's token bucket
 * ({@link v2RateLimitError}), and an admission denial carries the descriptor's
 * declared `retryAfterSeconds` through to the route. Defaulting it here would
 * paper over a path that had simply dropped its value — which is exactly the
 * bug that used to leave a concurrency denial with no `Retry-After` at all.
 *
 * The value is Sim's one transient-failure floor, shared with the admission
 * descriptors so the execute route's capacity 429 and every other surface's 503
 * cannot drift apart. It is a floor, not a schedule: a fleet that retries at
 * exactly this offset re-converges into a single burst, so callers should still
 * add jitter — `backoffWithJitter` from `@sim/utils/retry` is what Sim's own
 * clients use.
 */
const RETRY_AFTER_SECONDS_BY_STATUS: Partial<Record<number, number>> = {
  503: ADMISSION_RETRY_AFTER_SECONDS,
}

type RateLimitHeaderSource = Pick<RateLimitResult, 'limit' | 'remaining' | 'resetAt'>

export function rateLimitHeaders(rateLimit?: RateLimitHeaderSource): Record<string, string> {
  if (!rateLimit) return {}
  return {
    'X-RateLimit-Limit': rateLimit.limit.toString(),
    'X-RateLimit-Remaining': rateLimit.remaining.toString(),
    'X-RateLimit-Reset': rateLimit.resetAt.toISOString(),
  }
}

interface V2SuccessOptions {
  rateLimit?: RateLimitHeaderSource
  status?: number
  headers?: Record<string, string>
}

function successHeaders(options: V2SuccessOptions): Record<string, string> {
  return { ...PRIVATE_NO_STORE, ...rateLimitHeaders(options.rateLimit), ...options.headers }
}

/**
 * The bodiless 200 a `HEAD` receives from a route whose `GET` is not safe, once
 * that `HEAD` has been authorized.
 *
 * RFC 9110 §9.3.2 lets Next alias `HEAD` onto `GET` only because §9.2.1 defines
 * `HEAD` as safe — "essentially read-only". A `GET` that opens an outbound
 * connection or writes a row breaks that assumption, and an uptime monitor or
 * link checker walking the documented URL list would drive those effects
 * invisibly on every probe. Such a route runs everything the `GET` runs up to
 * and including resource authorization, then stops before the business phase.
 *
 * The 200 here is unconditional **by construction**: the v2 route builders only
 * reach this function after `useCase.authorize` has resolved, and render every
 * rejection through the route's own error policy. Calling it before that check —
 * as the builders originally did, straight after admission — turns it into an
 * existence oracle, because a valid API key for any workspace then draws a 200
 * for a resource that same key's `GET` answers 403 or 404 for.
 */
export function v2HeadNoEffect(options: V2SuccessOptions = {}): NextResponse {
  return new NextResponse(null, { status: options.status ?? 200, headers: successHeaders(options) })
}

/** `{ data }` (+ rate-limit headers). */
export function v2Data<T>(data: T, options: V2SuccessOptions = {}): NextResponse {
  return NextResponse.json(
    { data },
    { status: options.status ?? 200, headers: successHeaders(options) }
  )
}

/** `{ data, nextCursor }` (+ rate-limit headers). */
export function v2CursorList<T>(
  data: T[],
  nextCursor: string | null,
  options: V2SuccessOptions = {}
): NextResponse {
  return NextResponse.json(
    { data, nextCursor },
    { status: options.status ?? 200, headers: successHeaders(options) }
  )
}

interface V2ErrorOptions {
  status?: number
  details?: unknown
  headers?: Record<string, string>
  /**
   * Suppresses the code's default `Retry-After` for a failure whose outcome is
   * *unknown* rather than *absent*.
   *
   * A 503 normally means the work did not happen, so "come back in 5 seconds"
   * is safe advice. The async enqueue that could not be confirmed
   * (`ASYNC_ENQUEUE_AMBIGUOUS`) is the exception: it deliberately retains its
   * execution-ID claim because a job may already exist. Telling that caller to
   * retry invites a client with no `X-Run-Id` to start a second run of the same
   * workflow, which bills twice. It must reconcile against the run id the
   * response returns instead, so the response stays silent on retrying.
   */
  omitRetryAfter?: boolean
}

/** `{ error: { code, message, details? } }`. */
export function v2Error(
  code: V2ErrorCode,
  message: string,
  options: V2ErrorOptions = {}
): NextResponse {
  const error: { code: V2ErrorCode; message: string; details?: unknown } = { code, message }
  if (options.details !== undefined) error.details = options.details
  const status = options.status ?? STATUS_BY_CODE[code]
  const retryAfterSeconds = options.omitRetryAfter
    ? undefined
    : RETRY_AFTER_SECONDS_BY_STATUS[status]
  return NextResponse.json(
    { error },
    {
      status,
      headers: {
        ...PRIVATE_NO_STORE,
        ...(retryAfterSeconds === undefined ? {} : { 'Retry-After': retryAfterSeconds.toString() }),
        ...options.headers,
      },
    }
  )
}

/** Renders a trusted typed HTTP error without changing the v2 envelope. */
export function v2HttpError(error: HttpError): NextResponse {
  const code = V2_CODE_BY_HTTP_STATUS[error.statusCode]
  if (!code) return v2Error('INTERNAL_ERROR', 'Internal server error')
  return v2Error(code, error.message)
}

/**
 * The 500 of the local-storage upload data plane, in the canonical envelope.
 *
 * `PUT /api/v2/uploads/{uploadId}` and its `/parts/{partNumber}` sibling are
 * deliberately outside the public OpenAPI documents (see
 * `UNDOCUMENTED_V2_ROUTES`), but they are still v2 routes a caller reaches
 * through a URL a documented operation handed it. Being undocumented is a
 * reason not to publish them; it was never a reason to answer in a different
 * error shape. They do not run `admitV2Request`, so they cannot reuse the JSON
 * builder's handler — this is the one piece of it they need.
 */
export function v2UploadDataPlaneError(): NextResponse {
  return v2Error('INTERNAL_ERROR', 'Internal server error')
}

/** Render a contract `ZodError` as the v2 error envelope. */
export function v2ValidationError(error: ZodError): NextResponse {
  return v2Error('BAD_REQUEST', getValidationErrorMessage(error, 'Invalid request'), {
    details: serializeZodIssues(error),
  })
}

/** Render a shared {@link WorkspaceAccessError} as the v2 error envelope. */
export function v2WorkspaceAccessError(failure: WorkspaceAccessError): NextResponse {
  return v2Error(failure.code, failure.message, { status: failure.status })
}

/**
 * Render a v1 rate-limit/auth failure (`checkRateLimit` result) as the v2 error
 * envelope: an auth failure becomes 401, a throttle becomes 429 with
 * `Retry-After`.
 */
export function v2RateLimitError(rateLimit: RateLimitResult): NextResponse {
  const headers = rateLimitHeaders(rateLimit)
  if (rateLimit.error) {
    return v2Error('UNAUTHORIZED', rateLimit.error, { headers })
  }
  const retryAfterSeconds = rateLimit.retryAfterMs
    ? Math.ceil(rateLimit.retryAfterMs / 1000)
    : Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000)
  return v2Error('RATE_LIMITED', 'API rate limit exceeded', {
    headers: { ...headers, 'Retry-After': retryAfterSeconds.toString() },
    details: { retryAfter: rateLimit.resetAt.toISOString() },
  })
}

/** Opaque base64-JSON keyset cursor codec shared by all v2 cursor lists. */
export function encodeCursor(data: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(data)).toString('base64')
}

export function decodeCursor<T = Record<string, unknown>>(cursor: string): T | null {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString()) as T
  } catch {
    return null
  }
}

interface OffsetCursorPayload {
  /** The ordering the offset counts positions within. */
  sort: string
  /** Fingerprint of the filters the offset counts positions within. */
  filter?: string
  offset: number
}

/** An offset cursor stamped with the sort and filters that produced it. */
export function encodeOffsetCursor(
  sort: string,
  filter: string | undefined,
  offset: number
): string {
  return encodeCursor({
    sort,
    ...(filter ? { filter } : {}),
    offset,
  } satisfies OffsetCursorPayload)
}

/**
 * Reads back an offset cursor, refusing one minted under a different sort or
 * different filters.
 *
 * An absent cursor means page one. A cursor that is not valid base64-JSON, or
 * that does not carry a non-negative integer `offset`, is rejected rather than
 * coerced to 0: silently restarting at page one while the caller believes it is
 * paging forward makes a paging client loop over the first page forever.
 *
 * An offset is the weaker of the two schemes here: unlike a keyset it names an
 * ordinal, not a position, so replaying it against a re-filtered or re-sorted
 * sequence lands at an unrelated point in it — skipping rows, repeating them, or
 * landing past the end and returning an empty page the caller reads as "no more
 * matches". The v2 error policies render the thrown validation error as the
 * canonical 400.
 */
export function decodeOffsetCursor(
  cursor: string | undefined,
  sort: string,
  filter?: string | undefined
): number {
  if (!cursor) return 0
  const decoded = decodeCursor<Partial<OffsetCursorPayload>>(cursor)
  if (!decoded || decoded.sort !== sort) {
    throw new OrchestrationError('validation', INVALID_CURSOR_MESSAGE)
  }
  if ((decoded.filter ?? undefined) !== (filter || undefined)) {
    throw new OrchestrationError('validation', REFILTERED_CURSOR_MESSAGE)
  }
  const { offset } = decoded
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    throw new OrchestrationError('validation', 'Invalid cursor')
  }
  return offset
}

/**
 * The sort a keyset cursor was minted under, as it is written into the cursor
 * payload. Comparing the whole string is what makes a mid-pagination sort
 * change detectable.
 */
export function cursorSortKey(sortBy: string, sortOrder: string): string {
  return `${sortBy}:${sortOrder}`
}

interface SortedCursorPayload {
  sort: string
  keys: CursorKey[]
  /** Fingerprint of the filters the page was read under; absent = unfiltered. */
  filter?: string
}

/**
 * A keyset cursor stamped with the sort AND the filters that produced it. The
 * keys are only meaningful under that exact ordering, and only name a useful
 * position within that exact row set, so both stamps travel with them.
 */
export function encodeSortedCursor(
  sort: string,
  keys: CursorKey[],
  filter?: string | undefined
): string {
  return encodeCursor({ sort, keys, ...(filter ? { filter } : {}) } satisfies SortedCursorPayload)
}

export type DecodedSortedCursor =
  | { status: 'absent' }
  | { status: 'ok'; keys: CursorKey[] }
  /** Malformed, or minted under a different sort — the page cannot be resumed. */
  | { status: 'invalid' }
  /** Minted under different filters — the position names another sequence. */
  | { status: 'refiltered' }

/**
 * Reads a keyset cursor back, refusing one that does not belong to the
 * requested query.
 *
 * Resuming a `name`-ordered cursor under `createdAt` would compare the wrong
 * column and silently duplicate or skip rows, so a sort mismatch is a client
 * error rather than a best-effort page. A cursor that isn't valid base64-JSON
 * is rejected for the same reason: ignoring it would restart from page one
 * while the caller believes it is paging forward.
 *
 * A filter mismatch is rejected too, and it is worth being precise about why,
 * because a keyset does not corrupt the way an offset does. `(sortKey, id)`
 * names an absolute position, so replaying it under a narrower filter still
 * returns a coherent, duplicate-free page — of everything matching the NEW
 * filter that happens to sort after that position. Every match before it is
 * silently absent. The cursor is documented as opaque, so a caller has no way
 * to tell that truncated page from a complete one, and the client that most
 * plausibly does this (narrow the search box, keep paging) is exactly the one
 * that will believe its filter matched almost nothing. Restarting pagination is
 * the only correct response, so the API says so instead of guessing.
 *
 * This checks the envelope only. The key VALUES are caller-controlled too, and
 * are type-checked against the sort's keys by `keysetAfter`, which is where a
 * bad arity or an unparseable timestamp is caught.
 */
export function decodeSortedCursor(
  cursor: string | undefined,
  sort: string,
  filter?: string | undefined
): DecodedSortedCursor {
  if (!cursor) return { status: 'absent' }
  const decoded = decodeCursor<Partial<SortedCursorPayload>>(cursor)
  if (!decoded || decoded.sort !== sort || !Array.isArray(decoded.keys)) {
    return { status: 'invalid' }
  }
  if ((decoded.filter ?? undefined) !== (filter || undefined)) return { status: 'refiltered' }
  return { status: 'ok', keys: decoded.keys }
}

/**
 * The keyset a paged list should resume from, or `undefined` for page one.
 *
 * This is the `mapInput` half of every keyset list: it stamps the request's
 * sort and filters, reads the cursor back under them, and turns a cursor minted
 * under a different query into the canonical 400 rather than letting mismatched
 * keys reach `keysetAfter` or a stale position reach a re-filtered read. Sharing
 * it is what keeps "a bad cursor is a 400" from being re-decided per route.
 *
 * Build `filter` with `cursorScopeKey` from the same params on both
 * sides of the request. A list with no filters at all passes nothing.
 */
export function readSortedCursor(
  cursor: string | undefined,
  sortBy: string,
  sortOrder: string,
  filter?: string | undefined
): CursorKey[] | undefined {
  const decoded = decodeSortedCursor(cursor, cursorSortKey(sortBy, sortOrder), filter)
  if (decoded.status === 'invalid') {
    throw new OrchestrationError('validation', INVALID_CURSOR_MESSAGE)
  }
  if (decoded.status === 'refiltered') {
    throw new OrchestrationError('validation', REFILTERED_CURSOR_MESSAGE)
  }
  return decoded.status === 'ok' ? decoded.keys : undefined
}

interface ScopedCursorPayload {
  /** Fingerprint of the filters and sort the inner token was minted under. */
  scope?: string
  /** The domain codec's own opaque token, passed through untouched. */
  inner: string
}

/**
 * Binds a cursor minted by a domain codec to the query it was minted under.
 *
 * `GET /logs`, `GET /audit-logs`, and `GET /billing/logs` page through readers
 * that predate the shared v2 codecs and mint their own tokens, so the stamp
 * cannot live inside the payload the way it does for {@link encodeSortedCursor}.
 * Wrapping keeps the domain token opaque and untouched while still giving those
 * lists the same binding as the rest of the surface — one rule for v2 callers
 * rather than "some lists notice, some don't".
 */
export function encodeScopedCursor(scope: string | undefined, inner: string): string {
  return encodeCursor({ ...(scope ? { scope } : {}), inner } satisfies ScopedCursorPayload)
}

/**
 * Unwraps a {@link encodeScopedCursor} token, yielding the domain codec's own
 * cursor, or `undefined` for page one. A token that is malformed or was minted
 * under a different query is the canonical 400 — the domain codec never sees it.
 *
 * An empty inner token is malformed, not "page one". Only an absent `cursor`
 * param means page one; a present-but-empty inner passed the old
 * `typeof === 'string'` envelope check and then read as falsy in every domain
 * reader downstream, so no cursor condition was applied and the caller was
 * handed page one again — with a `nextCursor` telling it to keep going. That is
 * exactly the loop `UNKNOWN_CURSOR_MESSAGE` describes on the billing ledger,
 * reached through the wrapper instead of through the token, and it slipped past
 * the unresolvable-cursor 400 that exists to stop it.
 */
export function readScopedCursor(
  cursor: string | undefined,
  scope: string | undefined
): string | undefined {
  if (!cursor) return undefined
  const decoded = decodeCursor<Partial<ScopedCursorPayload>>(cursor)
  if (!decoded || typeof decoded.inner !== 'string' || decoded.inner.length === 0) {
    throw new OrchestrationError('validation', UNREADABLE_CURSOR_MESSAGE)
  }
  if ((decoded.scope ?? undefined) !== (scope || undefined)) {
    throw new OrchestrationError('validation', REFILTERED_CURSOR_MESSAGE)
  }
  return decoded.inner
}

const V2_CODE_BY_ORCHESTRATION_ERROR: Record<OrchestrationErrorCode, V2ErrorCode> = {
  validation: 'BAD_REQUEST',
  unauthorized: 'UNAUTHORIZED',
  forbidden: 'FORBIDDEN',
  not_found: 'NOT_FOUND',
  conflict: 'CONFLICT',
  locked: 'LOCKED',
  payload_too_large: 'PAYLOAD_TOO_LARGE',
  internal: 'INTERNAL_ERROR',
}

/**
 * Renders a `lib/[resource]/orchestration` failure in the v2 envelope, so every
 * v2 route maps a given failure class to the same status without restating the
 * mapping. Mirrors `statusForOrchestrationError` for the v1/UI surfaces.
 */
export function v2ErrorForOrchestration(
  code: OrchestrationErrorCode | undefined,
  message: string,
  /** Structured context for the failure — e.g. which lock rejected a write. */
  details?: unknown
): NextResponse {
  const v2Code = code ? V2_CODE_BY_ORCHESTRATION_ERROR[code] : 'INTERNAL_ERROR'
  return v2Error(v2Code, v2Code === 'INTERNAL_ERROR' ? 'Internal server error' : message, {
    ...(details !== undefined ? { details } : {}),
  })
}

/**
 * Renders a thrown domain failure in the v2 envelope, or `null` when the error
 * carries no classification and the caller should log it and return its own
 * generic 500. The v2 counterpart of `orchestrationErrorResponse`.
 *
 * A refusal that names its cause carries it through as `error.details.code`.
 * That projection lives here, on the one function every v2 error policy
 * ultimately falls through to, rather than at each throw site — a route cannot
 * then forget it, and the code cannot be attached to a status other than the
 * one its failure class maps to.
 */
export function v2CaughtOrchestrationError(error: unknown): NextResponse | null {
  const classified = asOrchestrationError(error)
  if (!classified) return null
  return v2ErrorForOrchestration(
    classified.code,
    classified.message,
    forbiddenErrorDetails(classified)
  )
}
