import { NextResponse } from 'next/server'
import type { ZodError } from 'zod'
import { getValidationErrorMessage, serializeZodIssues } from '@/lib/api/server'
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
  | 'INTERNAL_ERROR'

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
  INTERNAL_ERROR: 500,
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
  return { ...rateLimitHeaders(options.rateLimit), ...options.headers }
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
    { status: options.status ?? STATUS_BY_CODE[code], headers: options.headers }
  )
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
