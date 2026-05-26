import { createLogger, runWithRequestContext } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { HttpError } from '@/lib/core/utils/http-error'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('RouteHandler')

type RouteHandler<T = unknown> = (
  request: NextRequest,
  context: T
) => Promise<NextResponse | Response> | NextResponse | Response

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
function readTypedErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof HttpError)) return undefined
  const status = error.statusCode
  if (status < 400 || status >= 600) return undefined
  return status
}

/**
 * Wraps a Next.js API route handler with centralized error reporting.
 *
 * - Generates a unique request ID and stores it in AsyncLocalStorage so every
 *   logger in the request lifecycle automatically includes it
 * - Logs all 4xx and 5xx responses with method, path, status, duration
 * - Catches unhandled errors, logs them, and returns a 500 with the request ID
 * - Attaches `x-request-id` response header
 */
export function withRouteHandler<T>(handler: RouteHandler<T>): RouteHandler<T> {
  return async (request: NextRequest, context: T) => {
    const requestId = generateRequestId()
    const startTime = Date.now()
    const method = request?.method ?? 'UNKNOWN'
    const path =
      request?.nextUrl?.pathname ?? new URL(request?.url ?? '/', 'http://localhost').pathname

    return runWithRequestContext({ requestId, method, path }, async () => {
      let response: NextResponse | Response
      try {
        response = await handler(request, context)
      } catch (error) {
        const duration = Date.now() - startTime
        const message = getErrorMessage(error, 'Unknown error')
        const typedStatus = readTypedErrorStatus(error)
        if (typedStatus !== undefined) {
          if (typedStatus >= 500) {
            logger.error('Unhandled route error', { duration, status: typedStatus, error: message })
          } else {
            logger.warn('Typed route error', { duration, status: typedStatus, error: message })
          }
          response = NextResponse.json({ error: message, requestId }, { status: typedStatus })
        } else {
          logger.error('Unhandled route error', { duration, error: message })
          response = NextResponse.json(
            { error: 'Internal server error', requestId },
            { status: 500 }
          )
        }
        response?.headers?.set('x-request-id', requestId)
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

      response?.headers?.set('x-request-id', requestId)
      return response
    })
  }
}
