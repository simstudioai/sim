import { createLogger, runWithRequestContext } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('RouteHandler')

type RouteHandler<T = unknown> = (
  request: NextRequest,
  context: T
) => Promise<NextResponse | Response> | NextResponse | Response

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
        const message = error instanceof Error ? error.message : 'Unknown error'
        logger.error('Unhandled route error', { duration, error: message })
        response = NextResponse.json({ error: 'Internal server error', requestId }, { status: 500 })
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
