/**
 * Mock request utilities for API testing
 */
import {
  type ClientIpHeaders,
  resolveClientIp,
  UNRESOLVED_CLIENT_IP_BUCKET,
} from '@sim/security/client-ip'
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
 * `generateRequestId` is stubbed for determinism. The IP helpers deliberately
 * run the REAL resolver (with no trusted proxies, as a test environment
 * declares none) so route tests see production's IP semantics — a stubbed
 * passthrough here would be a second definition of "the client IP". Override
 * per test when a specific address is needed.
 *
 * @example
 * ```ts
 * import { requestUtilsMockFns } from '@sim/testing'
 *
 * requestUtilsMockFns.mockGenerateRequestId.mockReturnValueOnce('test-req-42')
 * requestUtilsMockFns.mockResolveClientIp.mockReturnValueOnce('10.0.0.5')
 * ```
 */
export const requestUtilsMockFns = {
  mockGenerateRequestId: vi.fn(() => 'mock-request-id'),
  mockResolveClientIp: vi.fn((request: { headers: ClientIpHeaders }) => resolveClientIp(request)),
  mockGetRateLimitIpKey: vi.fn(
    (request: { headers: ClientIpHeaders }) =>
      resolveClientIp(request) ?? UNRESOLVED_CLIENT_IP_BUCKET
  ),
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
  resolveClientIp: requestUtilsMockFns.mockResolveClientIp,
  getRateLimitIpKey: requestUtilsMockFns.mockGetRateLimitIpKey,
  noop: () => {},
}
