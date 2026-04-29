/**
 * Mock request utilities for API testing
 */
import { NextRequest } from 'next/server'
import { vi } from 'vitest'

/**
 * Creates a mock NextRequest for API route testing.
 * This is a general-purpose utility for testing Next.js API routes.
 *
 * Returning `NextRequest` (not plain `Request`) keeps `request.nextUrl`
 * available for routes that go through `parseRequest` and similar helpers
 * that read query params via `request.nextUrl.searchParams`.
 *
 * @param method - HTTP method (GET, POST, PUT, DELETE, etc.)
 * @param body - Optional request body (will be JSON stringified)
 * @param headers - Optional headers to include
 * @param url - Optional custom URL (defaults to http://localhost:3000/api/test)
 * @returns NextRequest instance
 *
 * @example
 * ```ts
 * const req = createMockRequest('POST', { name: 'test' })
 * const response = await POST(req)
 * ```
 */
type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>

export function createMockRequest(
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
  url = 'http://localhost:3000/api/test'
): NextRequest {
  const init: NextRequestInit = {
    method,
    headers: new Headers({
      'Content-Type': 'application/json',
      ...headers,
    }),
  }

  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }

  return new NextRequest(new URL(url), init)
}

/**
 * Creates a mock NextRequest with form data for file upload testing.
 *
 * @param formData - FormData instance
 * @param method - HTTP method (defaults to POST)
 * @param url - Optional custom URL
 * @returns Request instance
 */
export function createMockFormDataRequest(
  formData: FormData,
  method = 'POST',
  url = 'http://localhost:3000/api/test'
): Request {
  return new Request(new URL(url), {
    method,
    body: formData,
  })
}

/**
 * Controllable mock functions for `@/lib/core/utils/request`.
 *
 * @example
 * ```ts
 * import { requestUtilsMockFns } from '@sim/testing'
 *
 * requestUtilsMockFns.mockGenerateRequestId.mockReturnValueOnce('test-req-42')
 * requestUtilsMockFns.mockGetClientIp.mockReturnValueOnce('10.0.0.5')
 * ```
 */
export const requestUtilsMockFns = {
  mockGenerateRequestId: vi.fn(() => 'mock-request-id'),
  mockGetClientIp: vi.fn(() => '127.0.0.1'),
}

/**
 * Static mock module for `@/lib/core/utils/request`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/utils/request', () => requestUtilsMock)
 * ```
 */
export const requestUtilsMock = {
  generateRequestId: requestUtilsMockFns.mockGenerateRequestId,
  getClientIp: requestUtilsMockFns.mockGetClientIp,
  noop: () => {},
}
