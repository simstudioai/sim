import type { NextRequest, NextResponse } from 'next/server'
import { authenticateAdminRequest } from '@/app/api/v1/admin/auth'
import { notConfiguredResponse, unauthorizedResponse } from '@/app/api/v1/admin/responses'

export type AdminRouteHandler = (request: NextRequest) => Promise<NextResponse>

export type AdminRouteHandlerWithParams<TParams> = (
  request: NextRequest,
  context: { params: Promise<TParams> }
) => Promise<NextResponse>

/**
 * Wrap a route handler with admin authentication.
 * Returns early with an error response if authentication fails.
 */
export function withAdminAuth(handler: AdminRouteHandler): AdminRouteHandler {
  return async (request: NextRequest) => {
    const auth = authenticateAdminRequest(request)

    if (!auth.authenticated) {
      if (auth.notConfigured) {
        return notConfiguredResponse()
      }
      return unauthorizedResponse(auth.error)
    }

    return handler(request)
  }
}

/**
 * Wrap a route handler with params with admin authentication.
 * Returns early with an error response if authentication fails.
 */
export function withAdminAuthParams<TParams>(
  handler: AdminRouteHandlerWithParams<TParams>
): AdminRouteHandlerWithParams<TParams> {
  return async (request: NextRequest, context: { params: Promise<TParams> }) => {
    const auth = authenticateAdminRequest(request)

    if (!auth.authenticated) {
      if (auth.notConfigured) {
        return notConfiguredResponse()
      }
      return unauthorizedResponse(auth.error)
    }

    return handler(request, context)
  }
}
