import { createLogger, runWithRequestContext } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('RouteHandler')

type RouteHandler<T = unknown> = (
  request: NextRequest,
  context: T
) => Promise<NextResponse | Response> | NextResponse | Response

function defaultMessageForStatus(status: number): string {
  if (status >= 500) return 'Internal server error'
  if (status === 401) return 'Unauthorized'
  if (status === 403) return 'Forbidden'
  if (status === 404) return 'Not Found'
  if (status === 409) return 'Conflict'
  return 'Request failed'
}

/**
 * Reads a numeric `statusCode` (4xx or 5xx) off an Error so typed domain errors
 * (e.g. `WorkspaceAccessDeniedError`) can map to the correct HTTP status when
 * they bubble up unhandled instead of defaulting to 500. Returns both the
 * status and a client-safe message: the error's own `publicMessage` if it
 * opted in, otherwise a generic per-status string. The raw `error.message` is
 * never exposed by this fallback — domain errors must explicitly mark their
 * message as safe to expose, preventing accidental leakage of internal details
 * from typed errors that didn't intend to be user-facing.
 */
function readTypedErrorResponse(error: unknown): { status: number; message: string } | undefined {
  if (!(error instanceof Error)) return undefined
  const typed = error as { statusCode?: unknown; publicMessage?: unknown }
  const status = typed.statusCode
  if (typeof status !== 'number') return undefined
  if (status < 400 || status >= 600) return undefined
  const message =
    typeof typed.publicMessage === 'string' && typed.publicMessage.length > 0
      ? typed.publicMessage
      : defaultMessageForStatus(status)
  return { status, message }
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
        const rawMessage = getErrorMessage(error, 'Unknown error')
        const typed = readTypedErrorResponse(error)
        if (typed !== undefined) {
          if (typed.status >= 500) {
            logger.error('Unhandled route error', {
              duration,
              status: typed.status,
              error: rawMessage,
            })
          } else {
            logger.warn('Typed route error', {
              duration,
              status: typed.status,
              error: rawMessage,
            })
          }
          response = NextResponse.json(
            { error: typed.message, requestId },
            { status: typed.status }
          )
        } else {
          logger.error('Unhandled route error', { duration, error: rawMessage })
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
