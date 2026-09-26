/**
 * Mock request utilities for API testing
 */
import { NextRequest } from 'next/server'
import { vi } from 'vitest'

type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>

const DEFAULT_REQUEST_URL = 'http://localhost:3000/api/test'

/** Options form of {@link createMockRequest}. */
export interface MockRequestOptions {
  /** HTTP method. Defaults to `GET`. */
  method?: string
  /** Absolute URL, or a path resolved against `http://localhost:3000`. Defaults to `/api/test`. */
  url?: string
  /** JSON-serialized body; sets `Content-Type: application/json` unless `headers` sets one. */
  body?: unknown
  /** Body sent verbatim (signed webhook payloads, form data, malformed JSON). Wins over `body`. */
  rawBody?: string
  /** Request headers. No `Content-Type` is added unless a `body` is given. */
  headers?: Record<string, string>
  /** Query parameters appended to the URL. */
  searchParams?: Record<string, string>
}

/**
 * Creates a `NextRequest` for API route and webhook tests.
 *
 * Returning `NextRequest` (not plain `Request`) keeps `request.nextUrl`
 * available for routes that go through `parseRequest` and similar helpers
 * that read query params via `request.nextUrl.searchParams`.
 *
 * Two call forms:
 * - Positional (legacy): `(method, body?, headers?, url?)` — always sends
 *   `Content-Type: application/json`, JSON-stringifies `body` when present.
 * - Options: `({ method, url, body, rawBody, headers, searchParams })` — `url`
 *   may be a path; `Content-Type: application/json` is added only for `body`.
 *
 * @example
 * ```ts
 * const req = createMockRequest('POST', { name: 'test' })
 * const res = await POST(req)
 *
 * const hook = createMockRequest({
 *   method: 'POST',
 *   url: '/api/webhooks/trigger/abc',
 *   rawBody: payload,
 *   headers: { 'x-signature': signature },
 * })
 * ```
 */
export function createMockRequest(options: MockRequestOptions): NextRequest
export function createMockRequest(
  method?: string,
  body?: unknown,
  headers?: Record<string, string>,
  url?: string
): NextRequest
export function createMockRequest(
  methodOrOptions: string | MockRequestOptions = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
  url = DEFAULT_REQUEST_URL
): NextRequest {
  if (typeof methodOrOptions === 'object') {
    return createRequestFromOptions(methodOrOptions)
  }

  const init: NextRequestInit = {
    method: methodOrOptions,
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

function createRequestFromOptions(options: MockRequestOptions): NextRequest {
  const url = new URL(options.url ?? DEFAULT_REQUEST_URL, 'http://localhost:3000')
  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    url.searchParams.set(key, value)
  }
  const headers = new Headers(options.headers)
  const init: NextRequestInit = { method: options.method ?? 'GET', headers }
  if (options.rawBody !== undefined) {
    init.body = options.rawBody
  } else if (options.body !== undefined) {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    init.body = JSON.stringify(options.body)
  }
  return new NextRequest(url, init)
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
  mockGetClientIp: vi.fn(
    (_request: { headers: { get(name: string): string | null } }): string | null => '127.0.0.1'
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
  getClientIp: requestUtilsMockFns.mockGetClientIp,
  trustedProxies: [],
  noop: () => {},
}
