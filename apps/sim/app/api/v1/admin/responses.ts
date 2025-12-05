/**
 * Admin API Response Helpers
 *
 * Consistent response formatting for all Admin API endpoints.
 */

import { NextResponse } from 'next/server'
import type {
  AdminErrorResponse,
  AdminListResponse,
  AdminSingleResponse,
  PaginationMeta,
} from '@/app/api/v1/admin/types'

/**
 * Create a successful list response with pagination
 */
export function listResponse<T>(
  data: T[],
  pagination: PaginationMeta
): NextResponse<AdminListResponse<T>> {
  return NextResponse.json({ data, pagination })
}

/**
 * Create a successful single resource response
 */
export function singleResponse<T>(data: T): NextResponse<AdminSingleResponse<T>> {
  return NextResponse.json({ data })
}

/**
 * Create an error response
 */
export function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: unknown
): NextResponse<AdminErrorResponse> {
  const body: AdminErrorResponse = {
    error: { code, message },
  }

  if (details !== undefined) {
    body.error.details = details
  }

  return NextResponse.json(body, { status })
}

// =============================================================================
// Common Error Responses
// =============================================================================

export function unauthorizedResponse(message = 'Authentication required'): NextResponse {
  return errorResponse('UNAUTHORIZED', message, 401)
}

export function forbiddenResponse(message = 'Access denied'): NextResponse {
  return errorResponse('FORBIDDEN', message, 403)
}

export function notFoundResponse(resource: string): NextResponse {
  return errorResponse('NOT_FOUND', `${resource} not found`, 404)
}

export function badRequestResponse(message: string, details?: unknown): NextResponse {
  return errorResponse('BAD_REQUEST', message, 400, details)
}

export function internalErrorResponse(message = 'Internal server error'): NextResponse {
  return errorResponse('INTERNAL_ERROR', message, 500)
}

export function notConfiguredResponse(): NextResponse {
  return errorResponse(
    'NOT_CONFIGURED',
    'Admin API is not configured. Set ADMIN_API_KEY environment variable.',
    503
  )
}
