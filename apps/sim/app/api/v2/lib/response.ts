import { NextResponse } from 'next/server'
import type { ZodError } from 'zod'
import { type CursorKey, INVALID_CURSOR_MESSAGE } from '@/lib/api/list-query'
import { getValidationErrorMessage, serializeZodIssues } from '@/lib/api/server'
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
}

/** `{ error: { code, message, details? } }`. */
export function v2Error(
  code: V2ErrorCode,
  message: string,
  options: V2ErrorOptions = {}
): NextResponse {
  const error: { code: V2ErrorCode; message: string; details?: unknown } = { code, message }
  if (options.details !== undefined) error.details = options.details
  return NextResponse.json(
    { error },
    {
      status: options.status ?? STATUS_BY_CODE[code],
      headers: { ...PRIVATE_NO_STORE, ...options.headers },
    }
  )
}

/** Renders a trusted typed HTTP error without changing the v2 envelope. */
export function v2HttpError(error: HttpError): NextResponse {
  const code = V2_CODE_BY_HTTP_STATUS[error.statusCode]
  if (!code) return v2Error('INTERNAL_ERROR', 'Internal server error')
  return v2Error(code, error.message)
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

/**
 * Reads back an offset cursor minted by `encodeCursor({ offset })`.
 *
 * An absent cursor means page one. A cursor that is not valid base64-JSON, or
 * that does not carry a non-negative integer `offset`, is rejected rather than
 * coerced to 0: silently restarting at page one while the caller believes it is
 * paging forward makes a paging client loop over the first page forever. The v2
 * error policies render the thrown validation error as the canonical 400.
 */
export function decodeOffsetCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  const offset = decodeCursor<{ offset?: unknown }>(cursor)?.offset
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
}

/**
 * A keyset cursor stamped with the sort that produced it. The keys are only
 * meaningful under that exact ordering, so the stamp travels with them.
 */
export function encodeSortedCursor(sort: string, keys: CursorKey[]): string {
  return encodeCursor({ sort, keys } satisfies SortedCursorPayload)
}

export type DecodedSortedCursor =
  | { status: 'absent' }
  | { status: 'ok'; keys: CursorKey[] }
  /** Malformed, or minted under a different sort — the page cannot be resumed. */
  | { status: 'invalid' }

/**
 * Reads a keyset cursor back, refusing one that does not belong to the
 * requested sort. Resuming a `name`-ordered cursor under `createdAt` would
 * compare the wrong column and silently duplicate or skip rows, so a mismatch
 * is a client error rather than a best-effort page. A cursor that isn't valid
 * base64-JSON is rejected for the same reason: ignoring it would restart from
 * page one while the caller believes it is paging forward.
 *
 * This checks the envelope only. The key VALUES are caller-controlled too, and
 * are type-checked against the sort's keys by `keysetAfter`, which is where a
 * bad arity or an unparseable timestamp is caught.
 */
export function decodeSortedCursor(cursor: string | undefined, sort: string): DecodedSortedCursor {
  if (!cursor) return { status: 'absent' }
  const decoded = decodeCursor<Partial<SortedCursorPayload>>(cursor)
  if (!decoded || decoded.sort !== sort || !Array.isArray(decoded.keys)) {
    return { status: 'invalid' }
  }
  return { status: 'ok', keys: decoded.keys }
}

/** The 400 for a cursor that cannot be resumed under the request's sort. */
export function v2CursorSortError(): NextResponse {
  return v2Error('BAD_REQUEST', INVALID_CURSOR_MESSAGE)
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
 */
export function v2CaughtOrchestrationError(error: unknown): NextResponse | null {
  const classified = asOrchestrationError(error)
  if (!classified) return null
  return v2ErrorForOrchestration(classified.code, classified.message)
}
