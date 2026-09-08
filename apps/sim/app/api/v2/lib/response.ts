import { NextResponse } from 'next/server'
import type { ZodError } from 'zod'
import {
  V2_ERROR_CODE_BY_STATUS,
  V2_ERROR_STATUS_BY_CODE,
  type V2ErrorCode,
} from '@/lib/api/contracts/v2/error-codes'
import { REFILTERED_CURSOR_MESSAGE, UNREADABLE_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { type CursorKey, INVALID_CURSOR_MESSAGE } from '@/lib/api/list-query'
import { getValidationErrorMessage, serializeZodIssues } from '@/lib/api/server'
import { ADMISSION_RETRY_AFTER_SECONDS } from '@/lib/core/admission/transient-failure'
import {
  forbiddenErrorDetails,
  InsufficientScopeError,
  OAuthAccessTokenExpiredError,
} from '@/lib/core/application'
import {
  asOrchestrationError,
  OrchestrationError,
  type OrchestrationErrorCode,
} from '@/lib/core/orchestration/types'
import type { HttpError } from '@/lib/core/utils/http-error'
import type { RateLimitResult } from '@/app/api/v1/middleware'

/**
 * Runtime response helpers for the v2 API surface. Every v2 route renders its
 * output through these so the envelope, error shape, and rate-limit headers stay
 * identical across the whole surface. v2 routes reuse the v1 auth/rate-limit
 * middleware and the platform domain services — these helpers only standardize
 * the HTTP envelope.
 */

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
 * the API-key store, the rate-limit backend, or execution-identity allocation
 * is briefly unavailable, and all three are made
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

/**
 * The API-key half of every v2 `401` challenge.
 *
 * The scheme name is deliberately Sim-specific rather than a registered one.
 * An API key travels in `x-api-key`, not in `Authorization`, so `Basic` would
 * be false advertising — and worse than false: a browser reacts to it by
 * opening a native credential prompt that cannot produce an API key. An
 * unregistered scheme is legal (RFC 9110 §11.6.1's grammar requires *an*
 * `auth-scheme` token, not a registered one) and is chosen so no client has a
 * built-in handler for it: the challenge surfaces to a human, and the real
 * channel is named outright in the `header` parameter beside it.
 */
const V2_API_KEY_CHALLENGE = 'SimApiKey realm="Sim API", header="x-api-key"'

/**
 * The `WWW-Authenticate` value for a v2 `401`, so a 401 is a complete one.
 *
 * RFC 9110 §11.6.1 makes the header a MUST on 401 — a 401 without it is a
 * refusal that never says what would have been accepted. v2 reads two
 * credentials, so the header lists two challenges (§11.6.1 allows a list):
 * `Bearer`, which is a registered scheme because Sim's OAuth access tokens
 * really do travel as `Authorization: Bearer`, and the API-key scheme above.
 *
 * The one the caller tried leads, and only a bearer that was presented and
 * refused carries `error="invalid_token"` (RFC 6750 §3.1): a request that sent
 * nothing is told what would work, not what was wrong with a token it never
 * offered.
 */
function v2AuthChallenge(tried: 'api_key' | 'bearer' = 'api_key'): string {
  const bearer =
    tried === 'bearer' ? 'Bearer realm="Sim API", error="invalid_token"' : 'Bearer realm="Sim API"'
  return tried === 'bearer'
    ? `${bearer}, ${V2_API_KEY_CHALLENGE}`
    : `${V2_API_KEY_CHALLENGE}, ${bearer}`
}

/**
 * The `403` for a bearer token that authenticated but was not granted the scope
 * the request needs. The challenge names the scope to ask for (RFC 6750 §3.1)
 * and the detail code lets a client branch without parsing prose.
 */
export function v2InsufficientScope(error: InsufficientScopeError): NextResponse {
  return v2Error('FORBIDDEN', error.message, {
    details: { code: error.detailCode },
    headers: {
      'WWW-Authenticate': `Bearer realm="Sim API", error="insufficient_scope", scope="${error.requiredScope}"`,
    },
  })
}

type RateLimitHeaderSource = Pick<RateLimitResult, 'limit' | 'remaining' | 'resetAt'>

function rateLimitHeaders(rateLimit?: RateLimitHeaderSource): Record<string, string> {
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
 * connection or writes a row breaks that assumption, and an uptime monitor
 * walking the documented URL list would drive those effects on every probe.
 *
 * The 200 is unconditional **by construction**: callers must only reach this
 * after `useCase.authorize` has resolved, or it becomes the existence oracle
 * the `headSafe` option on the v2 route builders documents.
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

interface V2ErrorOptions {
  status?: number
  details?: unknown
  headers?: Record<string, string>
  /** For a 401: which credential the caller presented, so its challenge leads. */
  authChallenge?: 'api_key' | 'bearer'
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
  const status = options.status ?? V2_ERROR_STATUS_BY_CODE[code]
  const retryAfterSeconds = options.omitRetryAfter
    ? undefined
    : RETRY_AFTER_SECONDS_BY_STATUS[status]
  return NextResponse.json(
    { error },
    {
      status,
      headers: {
        ...PRIVATE_NO_STORE,
        ...(status === 401 ? { 'WWW-Authenticate': v2AuthChallenge(options.authChallenge) } : {}),
        ...(retryAfterSeconds === undefined ? {} : { 'Retry-After': retryAfterSeconds.toString() }),
        ...options.headers,
      },
    }
  )
}

/** Renders a trusted typed HTTP error without changing the v2 envelope. */
export function v2HttpError(error: HttpError): NextResponse {
  const code = V2_ERROR_CODE_BY_STATUS[error.statusCode]
  if (!code) return v2Error('INTERNAL_ERROR', 'Internal server error')
  return v2Error(code, error.message)
}

/**
 * The 500 of the local-storage upload data plane, in the canonical envelope.
 *
 * `PUT /api/v2/uploads/{uploadId}` and its `/parts/{partNumber}` sibling are
 * undocumented but still v2 routes, and they do not run `admitV2Request`, so
 * they cannot reuse the JSON builder's handler — this is the one piece of it
 * they need.
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
  /** Fingerprint of the list and filters the offset counts positions within. */
  filter: string
  offset: number
}

/** An offset cursor stamped with the sort and scope that produced it. */
export function encodeOffsetCursor(sort: string, filter: string, offset: number): string {
  return encodeCursor({ sort, filter, offset } satisfies OffsetCursorPayload)
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
  filter: string
): number {
  if (!cursor) return 0
  const decoded = decodeCursor<Partial<OffsetCursorPayload>>(cursor)
  if (!decoded) throw new OrchestrationError('validation', UNREADABLE_CURSOR_MESSAGE)
  if (decoded.sort !== sort) {
    throw new OrchestrationError('validation', INVALID_CURSOR_MESSAGE)
  }
  if ((decoded.filter ?? undefined) !== filter) {
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
  /** Fingerprint of the list and filters the page was read under. */
  filter: string
}

/**
 * A keyset cursor stamped with the sort AND the scope that produced it. The
 * keys are only meaningful under that exact ordering, and only name a useful
 * position within that exact row set, so both stamps travel with them.
 */
export function encodeSortedCursor(sort: string, keys: CursorKey[], filter: string): string {
  return encodeCursor({ sort, keys, filter } satisfies SortedCursorPayload)
}

type DecodedSortedCursor =
  | { status: 'absent' }
  | { status: 'ok'; keys: CursorKey[] }
  /** Not a pagination cursor at all — it does not decode into one. */
  | { status: 'unreadable' }
  /** Minted under a different sort — the keys compare the wrong column. */
  | { status: 'invalid' }
  /** Minted under a different list or different filters — another sequence. */
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
 * A filter mismatch is rejected too, even though a keyset does not corrupt the
 * way an offset does: `(sortKey, id)` names an absolute position, so replaying
 * it under a narrower filter returns a coherent, duplicate-free page that is
 * silently missing every new match sorting before that position. The token is
 * opaque, so a caller cannot tell that truncated page from a complete one.
 *
 * This checks the envelope only. The key VALUES are caller-controlled too, and
 * are type-checked against the sort's keys by `keysetAfter`, which is where a
 * bad arity or an unparseable timestamp is caught.
 */
export function decodeSortedCursor(
  cursor: string | undefined,
  sort: string,
  filter: string
): DecodedSortedCursor {
  if (!cursor) return { status: 'absent' }
  const decoded = decodeCursor<Partial<SortedCursorPayload>>(cursor)
  if (!decoded || typeof decoded.sort !== 'string' || !Array.isArray(decoded.keys)) {
    return { status: 'unreadable' }
  }
  if (decoded.sort !== sort) return { status: 'invalid' }
  if ((decoded.filter ?? undefined) !== filter) return { status: 'refiltered' }
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
  filter: string
): CursorKey[] | undefined {
  const decoded = decodeSortedCursor(cursor, cursorSortKey(sortBy, sortOrder), filter)
  if (decoded.status === 'unreadable') {
    throw new OrchestrationError('validation', UNREADABLE_CURSOR_MESSAGE)
  }
  if (decoded.status === 'invalid') {
    throw new OrchestrationError('validation', INVALID_CURSOR_MESSAGE)
  }
  if (decoded.status === 'refiltered') {
    throw new OrchestrationError('validation', REFILTERED_CURSOR_MESSAGE)
  }
  return decoded.status === 'ok' ? decoded.keys : undefined
}

/**
 * The next page's cursor, or `null` on the last page.
 *
 * The `present` half of the pair {@link readSortedCursor} opens: it stamps the
 * response token with the same sort and filters the request was read under, so
 * a list cannot mint a token its own reader would reject. Pass the identical
 * `sortBy`/`sortOrder`/`filter` triple both sides.
 */
export function writeSortedCursor(
  keys: CursorKey[] | null | undefined,
  sortBy: string,
  sortOrder: string,
  filter: string
): string | null {
  return keys ? encodeSortedCursor(cursorSortKey(sortBy, sortOrder), keys, filter) : null
}

interface ScopedCursorPayload {
  /** Fingerprint of the list, filters, and sort the inner token was minted under. */
  scope: string
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
export function encodeScopedCursor(scope: string, inner: string): string {
  return encodeCursor({ scope, inner } satisfies ScopedCursorPayload)
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
export function readScopedCursor(cursor: string | undefined, scope: string): string | undefined {
  if (!cursor) return undefined
  const decoded = decodeCursor<Partial<ScopedCursorPayload>>(cursor)
  if (!decoded || typeof decoded.inner !== 'string' || decoded.inner.length === 0) {
    throw new OrchestrationError('validation', UNREADABLE_CURSOR_MESSAGE)
  }
  if ((decoded.scope ?? undefined) !== scope) {
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
  if (classified instanceof InsufficientScopeError) return v2InsufficientScope(classified)
  if (classified instanceof OAuthAccessTokenExpiredError) {
    return v2Error('UNAUTHORIZED', classified.message, { authChallenge: 'bearer' })
  }
  return v2ErrorForOrchestration(
    classified.code,
    classified.message,
    forbiddenErrorDetails(classified)
  )
}
