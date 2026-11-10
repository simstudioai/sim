import type { AdminApiKeyPrincipal } from '@sim/auth/principal'
import type { NextRequest, NextResponse } from 'next/server'
import { authenticateAdminRequest } from '@/app/api/v1/admin/auth'
import { adminNotConfiguredResponse, adminUnauthorizedResponse } from '@/app/api/v1/admin/responses'

type AdminRouteHandler = (request: NextRequest) => Promise<NextResponse>

type AdminRouteHandlerWithParams<TParams> = (
  request: NextRequest,
  context: { params: Promise<TParams> }
) => Promise<NextResponse>

/** An authenticated handler; it receives the principal to pass to an application use case. */
type AuthenticatedAdminRouteHandler = (
  request: NextRequest,
  principal: AdminApiKeyPrincipal
) => Promise<NextResponse>

type AuthenticatedAdminRouteHandlerWithParams<TParams> = (
  request: NextRequest,
  context: { params: Promise<TParams> },
  principal: AdminApiKeyPrincipal
) => Promise<NextResponse>

/**
 * Wrap a route handler with admin authentication.
 * Returns early with an error response if authentication fails.
 */
export function withAdminAuth(handler: AuthenticatedAdminRouteHandler): AdminRouteHandler {
  return async (request: NextRequest) => {
    const auth = authenticateAdminRequest(request)

    if (!auth.authenticated) {
      if (auth.notConfigured) {
        return adminNotConfiguredResponse()
      }
      return adminUnauthorizedResponse(auth.error)
    }

    return handler(request, auth.principal)
  }
}

/**
 * Wrap a route handler with params with admin authentication.
 * Returns early with an error response if authentication fails.
 */
export function withAdminAuthParams<TParams>(
  handler: AuthenticatedAdminRouteHandlerWithParams<TParams>
): AdminRouteHandlerWithParams<TParams> {
  return async (request: NextRequest, context: { params: Promise<TParams> }) => {
    const auth = authenticateAdminRequest(request)

    if (!auth.authenticated) {
      if (auth.notConfigured) {
        return adminNotConfiguredResponse()
      }
      return adminUnauthorizedResponse(auth.error)
    }

    return handler(request, context, auth.principal)
  }
}
