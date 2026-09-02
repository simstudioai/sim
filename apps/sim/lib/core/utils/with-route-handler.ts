import { createLogger, runWithRequestContext } from '@sim/logger'
import { describeError, getErrorMessage, redactBoundParameters } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getRateLimitHeaders } from '@/lib/api/server/rate-limit-context'
import { HttpError } from '@/lib/core/utils/http-error'
import { generateRequestId } from '@/lib/core/utils/request'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'

const logger = createLogger('RouteHandler')

type RouteHandler<T = unknown> = (
  request: NextRequest,
  context: T
) => Promise<NextResponse | Response> | NextResponse | Response

interface RouteHandlerErrorContext {
  error: unknown
  requestId: string
}

interface RouteHandlerTypedErrorContext {
  error: HttpError
  requestId: string
  status: number
}

interface RouteHandlerOptions {
  clientAbortResponse?: (context: RouteHandlerErrorContext) => NextResponse | Response
  typedErrorResponse?: (context: RouteHandlerTypedErrorContext) => NextResponse | Response
  unhandledErrorResponse?: (context: RouteHandlerErrorContext) => NextResponse | Response
}

/**
 * Reads a numeric `statusCode` (4xx or 5xx) off an `HttpError` so typed domain
 * errors (e.g. `WorkspaceAccessDeniedError`, `InvalidFieldError`) map to the
 * correct HTTP status when they bubble up unhandled instead of defaulting to
 * 500.
 *
 * Uses an `instanceof HttpError` check (not duck-typing on `statusCode`) so
 * third-party errors that happen to carry a `statusCode`-shaped field cannot
 * trigger this path and leak their internal `message` to the client.
 *
 * When a typed status is returned, the error's `message` is sent to the client
 * verbatim — matching the NestJS `HttpException` / Spring `ResponseStatusException`
 * convention. Subclasses of `HttpError` are responsible for keeping `message`
 * safe to expose to clients (no stack traces, secrets, file paths, ORM
 * internals).
 */
function readTypedError(error: unknown): RouteHandlerTypedErrorContext['error'] | undefined {
  if (!(error instanceof HttpError)) return undefined
  const status = error.statusCode
  if (!Number.isInteger(status) || status < 400 || status >= 600) return undefined
  return error
}

/**
 * Stamps the request id, plus the rate-limit trio when the route consulted a
 * bucket for this request. Applied on both the success and the unhandled-error
 * path so a caller can read its quota from any response — including the 4xx and
 * 5xx ones, which are exactly the responses worth retrying.
 */
function applyResponseHeaders(
  response: NextResponse | Response | undefined,
  request: NextRequest,
  requestId: string
): void {
  if (!response?.headers) return
  response.headers.set('x-request-id', requestId)
  const rateLimit = getRateLimitHeaders(request)
  if (!rateLimit) return
  for (const [name, value] of Object.entries(rateLimit)) {
    response.headers.set(name, value)
  }
}

/**
 * Extracts the 32-hex trace id from a W3C `traceparent` header
 * (`00-<trace-id>-<span-id>-<flags>`) so cross-service log lines can be
 * grepped by the same trace id the Go copilot logs. Returns undefined for
 * absent or malformed headers and the all-zero (invalid) trace id.
 */
function traceIdFromTraceparent(header: string | null | undefined): string | undefined {
  if (!header) return undefined
  const match = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(header.trim())
  if (!match || match[1] === '00000000000000000000000000000000') return undefined
  return match[1]
}

/**
 * What a wrapped error hides: a query failure from the database client carries
 * the driver's reason and the Postgres code on its cause, and only the outer
 * message names the query. The shared describer reads the deepest cause and
 * strips bound parameter values, so user data never reaches the log.
 */
function errorDetail(error: unknown): { cause?: string; code?: string } {
  if (!(error instanceof Error) || error.cause === undefined) return {}
  const described = describeError(error)
  return {
    cause: `${described.name}: ${described.message}`,
    ...(described.code ? { code: described.code } : {}),
  }
}

/**
 * Wraps a Next.js API route handler with centralized error reporting.
 *
 * - Generates a unique request ID and stores it in AsyncLocalStorage so every
 *   logger in the request lifecycle automatically includes it
 * - Logs all 4xx and 5xx responses with method, path, status, duration
 * - Classifies errors after a client disconnect as a normal 499 cancellation
 * - Catches unhandled errors, logs them, and returns a 500 with the request ID
 * - Supports a route-family-specific client-abort response envelope
 * - Supports a route-family-specific unhandled-error response envelope
 * - Attaches `x-request-id`, plus the rate-limit headers when the route
 *   recorded a snapshot for the request
 */
export function withRouteHandler<T>(
  handler: RouteHandler<T>,
  options: RouteHandlerOptions = {}
): RouteHandler<T> {
  return async (request: NextRequest, context: T) => {
    const requestId = generateRequestId()
    const startTime = Date.now()
    const method = request?.method ?? 'UNKNOWN'
    const path =
      request?.nextUrl?.pathname ?? new URL(request?.url ?? '/', 'http://localhost').pathname
    const traceId = traceIdFromTraceparent(request?.headers?.get?.('traceparent'))

    return runWithRequestContext({ requestId, method, path, traceId }, async () => {
      let response: NextResponse | Response
      try {
        response = await withPermissionGroupScope(() => handler(request, context))
      } catch (error) {
        const duration = Date.now() - startTime
        /** A query failure names its bound values in the message; they are user data. */
        const message = redactBoundParameters(getErrorMessage(error, 'Unknown error'))
        const detail = errorDetail(error)
        if (request.signal.aborted) {
          logger.info('Client closed request', { duration, status: 499 })
          response = options.clientAbortResponse
            ? options.clientAbortResponse({ error, requestId })
            : new Response(null, { status: 499 })
          applyResponseHeaders(response, request, requestId)
          return response
        }

        const typedError = readTypedError(error)
        if (typedError) {
          const typedStatus = typedError.statusCode
          if (typedStatus >= 500) {
            logger.error('Unhandled route error', {
              duration,
              status: typedStatus,
              error: message,
              ...detail,
            })
          } else {
            logger.warn('Typed route error', { duration, status: typedStatus, error: message })
          }
          response = options.typedErrorResponse
            ? options.typedErrorResponse({ error: typedError, requestId, status: typedStatus })
            : NextResponse.json({ error: message, requestId }, { status: typedStatus })
          applyResponseHeaders(response, request, requestId)
          return response
        }

        if (options.unhandledErrorResponse) {
          logger.error('Unhandled route error', { duration, error: message, ...detail })
          response = options.unhandledErrorResponse({ error, requestId })
          applyResponseHeaders(response, request, requestId)
          return response
        }

        logger.error('Unhandled route error', { duration, error: message, ...detail })
        response = NextResponse.json({ error: 'Internal server error', requestId }, { status: 500 })
        applyResponseHeaders(response, request, requestId)
        return response
      }

      const status = response?.status ?? 0
      const duration = Date.now() - startTime

      if (status >= 500) {
        logger.error('Server error response', { status, duration })
      } else if (status >= 400) {
        logger.warn('Client error response', { status, duration })
      } else if (status > 0) {
        logger.info('OK', { status, duration })
      }

      applyResponseHeaders(response, request, requestId)
      return response
    })
  }
}
