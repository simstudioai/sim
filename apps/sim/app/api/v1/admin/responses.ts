/**
 * Admin API Response Helpers
 *
 * Consistent response formatting for all Admin API endpoints.
 */

import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { getValidationErrorMessage, serializeZodIssues } from '@/lib/api/server'
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
function errorResponse(
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

// Common Error Responses

export function adminUnauthorizedResponse(message = 'Authentication required'): NextResponse {
  return errorResponse('UNAUTHORIZED', message, 401)
}

export function adminForbiddenResponse(message = 'Access denied'): NextResponse {
  return errorResponse('FORBIDDEN', message, 403)
}

export function adminNotFoundResponse(resource: string): NextResponse {
  return errorResponse('NOT_FOUND', `${resource} not found`, 404)
}

export function adminBadRequestResponse(message: string, details?: unknown): NextResponse {
  return errorResponse('BAD_REQUEST', message, 400, details)
}

/** The request is well-formed but conflicts with the resource's current state. */
export function adminConflictResponse(message: string, details?: unknown): NextResponse {
  return errorResponse('CONFLICT', message, 409, details)
}

export function adminValidationErrorResponse(error: z.ZodError): NextResponse {
  return adminBadRequestResponse(
    getValidationErrorMessage(error, 'Invalid request body'),
    serializeZodIssues(error)
  )
}

export function adminInvalidJsonResponse(): NextResponse {
  return adminBadRequestResponse('Request body must be valid JSON')
}

export function adminInternalErrorResponse(message = 'Internal server error'): NextResponse {
  return errorResponse('INTERNAL_ERROR', message, 500)
}

export function adminNotConfiguredResponse(): NextResponse {
  return errorResponse(
    'NOT_CONFIGURED',
    'Admin API is not configured. Set ADMIN_API_KEY environment variable.',
    503
  )
}
