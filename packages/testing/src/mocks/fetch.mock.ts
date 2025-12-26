import { vi } from 'vitest'

/**
 * Type for mock fetch response configuration.
 */
export interface MockFetchResponse {
  status?: number
  statusText?: string
  ok?: boolean
  headers?: Record<string, string>
  json?: any
  text?: string
  body?: any
}

/**
 * Creates a mock fetch function that returns configured responses.
 *
 * @example
 * ```ts
 * const mockFetch = createMockFetch({
 *   json: { data: 'test' },
 *   status: 200
 * })
 * global.fetch = mockFetch
 * ```
 */
export function createMockFetch(defaultResponse: MockFetchResponse = {}) {
  const mockFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    return createMockResponse(defaultResponse)
  })

  return mockFn
}

/**
 * Creates a mock Response object.
 */
export function createMockResponse(config: MockFetchResponse = {}): Response {
  const status = config.status ?? 200
  const ok = config.ok ?? (status >= 200 && status < 300)

  return {
    status,
    statusText: config.statusText ?? (ok ? 'OK' : 'Error'),
    ok,
    headers: new Headers(config.headers ?? {}),
    json: vi.fn(async () => config.json ?? {}),
    text: vi.fn(async () => config.text ?? JSON.stringify(config.json ?? {})),
    body: config.body ?? null,
    bodyUsed: false,
    arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
    blob: vi.fn(async () => new Blob()),
    formData: vi.fn(async () => new FormData()),
    clone: vi.fn(function (this: Response) {
      return createMockResponse(config)
    }),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    bytes: vi.fn(async () => new Uint8Array()),
  } as Response
}

/**
 * Creates a mock fetch that handles multiple URLs with different responses.
 *
 * @example
 * ```ts
 * const mockFetch = createMultiMockFetch({
 *   '/api/users': { json: [{ id: 1 }] },
 *   '/api/error': { status: 500, json: { error: 'Server Error' } },
 * })
 * global.fetch = mockFetch
 * ```
 */
export function createMultiMockFetch(
  routes: Record<string, MockFetchResponse>,
  defaultResponse?: MockFetchResponse
) {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const urlString = url instanceof Request ? url.url : url.toString()

    // Find matching route (exact or partial match)
    const matchedRoute = Object.keys(routes).find(
      (route) => urlString === route || urlString.includes(route)
    )

    if (matchedRoute) {
      return createMockResponse(routes[matchedRoute])
    }

    if (defaultResponse) {
      return createMockResponse(defaultResponse)
    }

    return createMockResponse({ status: 404, json: { error: 'Not Found' } })
  })
}

/**
 * Sets up global fetch mock.
 *
 * @example
 * ```ts
 * const mockFetch = setupGlobalFetchMock({ json: { success: true } })
 * // Later...
 * expect(mockFetch).toHaveBeenCalledWith('/api/test', expect.anything())
 * ```
 */
export function setupGlobalFetchMock(defaultResponse?: MockFetchResponse) {
  const mockFetch = createMockFetch(defaultResponse)
  vi.stubGlobal('fetch', mockFetch)
  return mockFetch
}

/**
 * Configures fetch to return a specific response for the next call.
 */
export function mockNextFetchResponse(response: MockFetchResponse) {
  const currentFetch = globalThis.fetch
  if (vi.isMockFunction(currentFetch)) {
    currentFetch.mockResolvedValueOnce(createMockResponse(response))
  }
}

/**
 * Configures fetch to reject with an error.
 */
export function mockFetchError(error: Error | string) {
  const currentFetch = globalThis.fetch
  if (vi.isMockFunction(currentFetch)) {
    currentFetch.mockRejectedValueOnce(error instanceof Error ? error : new Error(error))
  }
}
