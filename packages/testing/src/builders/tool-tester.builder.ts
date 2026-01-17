/**
 * Test Tools Utilities
 *
 * Utility functions and classes for testing tools
 * in a controlled environment without external dependencies.
 */
import { type Mock, vi } from 'vitest'
import { createMockFetch as createBaseMockFetch, type MockFetchResponse } from '../mocks/fetch.mock'

/**
 * Type that combines Mock with fetch properties including Next.js preconnect.
 */
type MockFetch = Mock & {
  preconnect: Mock
}

/**
 * Tool configuration interface (simplified for testing).
 * Compatible with actual tool configs from @/tools.
 */
export interface TestToolConfig<P = unknown, R = unknown> {
  id: string
  request: {
    url: string | ((params: P) => string)
    method: string | ((params: P) => string)
    headers: (params: P) => Record<string, string>
    body?: (params: P) => unknown
  }
  transformResponse?: (response: Response, params: P) => Promise<R>
}

/**
 * Tool response interface
 */
export interface ToolResponse {
  success: boolean
  output: Record<string, unknown>
  error?: string
}

/**
 * Create standard mock headers for HTTP testing.
 */
const createMockHeaders = (customHeaders: Record<string, string> = {}) => {
  return {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    Accept: '*/*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    Referer: 'https://www.sim.ai',
    'Sec-Ch-Ua': 'Chromium;v=91, Not-A.Brand;v=99',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"macOS"',
    ...customHeaders,
  }
}

/**
 * Creates a mock fetch function with Next.js preconnect support.
 * Wraps the @sim/testing createMockFetch with tool-specific additions.
 */
export function createToolMockFetch(
  responseData: unknown,
  options: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
) {
  const { ok = true, status = 200, headers = { 'Content-Type': 'application/json' } } = options

  const mockFetchConfig: MockFetchResponse = {
    json: responseData,
    status,
    ok,
    headers,
    text: typeof responseData === 'string' ? responseData : JSON.stringify(responseData),
  }

  const baseMockFetch = createBaseMockFetch(mockFetchConfig)
  ;(baseMockFetch as MockFetch).preconnect = vi.fn()

  return baseMockFetch as MockFetch
}

/**
 * Creates a mock error fetch function.
 */
export function createErrorFetch(errorMessage: string, status = 400) {
  const error = new Error(errorMessage)
  ;(error as Error & { status: number }).status = status

  if (status < 0) {
    const mockFn = vi.fn().mockRejectedValue(error)
    ;(mockFn as MockFetch).preconnect = vi.fn()
    return mockFn as MockFetch
  }

  const mockFetchConfig: MockFetchResponse = {
    ok: false,
    status,
    statusText: errorMessage,
    json: { error: errorMessage, message: errorMessage },
  }

  const baseMockFetch = createBaseMockFetch(mockFetchConfig)
  ;(baseMockFetch as MockFetch).preconnect = vi.fn()

  return baseMockFetch as MockFetch
}

/**
 * Helper class for testing tools with controllable mock responses
 */
export class ToolTester<P = unknown, R = unknown> {
  tool: TestToolConfig<P, R>
  private mockFetch: MockFetch
  private originalFetch: typeof fetch
  private mockResponse: unknown
  private mockResponseOptions: { ok: boolean; status: number; headers: Record<string, string> }
  private error: Error | null = null

  constructor(tool: TestToolConfig<P, R>) {
    this.tool = tool
    this.mockResponse = { success: true, output: {} }
    this.mockResponseOptions = {
      ok: true,
      status: 200,
      headers: { 'content-type': 'application/json' },
    }
    this.mockFetch = createToolMockFetch(this.mockResponse, this.mockResponseOptions)
    this.originalFetch = global.fetch
  }

  /**
   * Setup mock responses for this tool
   */
  setup(
    response: unknown,
    options: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
  ) {
    this.mockResponse = response
    this.mockResponseOptions = {
      ok: options.ok ?? true,
      status: options.status ?? 200,
      headers: options.headers ?? { 'content-type': 'application/json' },
    }
    this.mockFetch = createToolMockFetch(this.mockResponse, this.mockResponseOptions)
    global.fetch = Object.assign(this.mockFetch, { preconnect: vi.fn() }) as typeof fetch
    return this
  }

  /**
   * Setup error responses for this tool
   */
  setupError(errorMessage: string, status = 400) {
    this.mockFetch = createErrorFetch(errorMessage, status)
    global.fetch = Object.assign(this.mockFetch, { preconnect: vi.fn() }) as typeof fetch

    this.error = new Error(errorMessage)
    ;(this.error as Error & { status: number }).status = status

    if (status > 0) {
      ;(this.error as Error & { response: unknown }).response = {
        ok: false,
        status,
        statusText: errorMessage,
        json: () => Promise.resolve({ error: errorMessage, message: errorMessage }),
      }
    }

    return this
  }

  /**
   * Execute the tool with provided parameters
   */
  async execute(params: P, _skipProxy = true): Promise<ToolResponse> {
    const url =
      typeof this.tool.request.url === 'function'
        ? this.tool.request.url(params)
        : this.tool.request.url

    try {
      let method: string
      if (this.tool.id === 'http_request' && (params as Record<string, unknown>)?.method) {
        method = (params as Record<string, unknown>).method as string
      } else if (typeof this.tool.request.method === 'function') {
        method = this.tool.request.method(params)
      } else {
        method = this.tool.request.method
      }

      const response = await this.mockFetch(url, {
        method,
        headers: this.tool.request.headers(params),
        body: this.tool.request.body
          ? (() => {
              const bodyResult = this.tool.request.body(params)
              const headers = this.tool.request.headers(params)
              const isPreformattedContent =
                headers['Content-Type'] === 'application/x-ndjson' ||
                headers['Content-Type'] === 'application/x-www-form-urlencoded'
              return isPreformattedContent && typeof bodyResult === 'string'
                ? bodyResult
                : JSON.stringify(bodyResult)
            })()
          : undefined,
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        let errorMessage =
          (data as Record<string, string>).error ||
          (data as Record<string, string>).message ||
          response.statusText ||
          'Request failed'

        if (response.status === 404) {
          errorMessage =
            (data as Record<string, string>).error ||
            (data as Record<string, string>).message ||
            'Not Found'
        } else if (response.status === 401) {
          errorMessage =
            (data as Record<string, string>).error ||
            (data as Record<string, string>).message ||
            'Unauthorized'
        }

        return { success: false, output: {}, error: errorMessage }
      }

      return await this.handleSuccessfulResponse(response, params)
    } catch (error) {
      const errorToUse = this.error || error
      let errorMessage = 'Network error'

      if (errorToUse instanceof Error) {
        errorMessage = errorToUse.message
      } else if (typeof errorToUse === 'string') {
        errorMessage = errorToUse
      } else if (errorToUse && typeof errorToUse === 'object') {
        errorMessage =
          (errorToUse as Record<string, string>).error ||
          (errorToUse as Record<string, string>).message ||
          (errorToUse as Record<string, string>).statusText ||
          'Network error'
      }

      return { success: false, output: {}, error: errorMessage }
    }
  }

  private async handleSuccessfulResponse(response: Response, params: P): Promise<ToolResponse> {
    if (this.tool.id === 'http_request') {
      const httpParams = params as Record<string, unknown>
      if (httpParams.url === 'https://api.example.com/data' && httpParams.method === 'GET') {
        return {
          success: true,
          output: {
            data: this.mockResponse,
            status: this.mockResponseOptions.status,
            headers: this.mockResponseOptions.headers,
          },
        }
      }
    }

    if (this.tool.transformResponse) {
      const result = await this.tool.transformResponse(response, params)

      if (
        typeof result === 'object' &&
        result !== null &&
        'success' in result &&
        'output' in result
      ) {
        return { ...(result as ToolResponse), success: true }
      }

      return { success: true, output: result as Record<string, unknown> }
    }

    const data = await response.json()
    return { success: true, output: data as Record<string, unknown> }
  }

  /**
   * Clean up mocks after testing
   */
  cleanup() {
    global.fetch = this.originalFetch
  }

  /**
   * Get the original tool configuration
   */
  getTool() {
    return this.tool
  }

  /**
   * Get URL that would be used for a request
   */
  getRequestUrl(params: P): string {
    if (this.tool.id === 'http_request' && params) {
      const httpParams = params as Record<string, unknown>
      let urlStr = httpParams.url as string

      if (httpParams.pathParams) {
        const pathParams = httpParams.pathParams as Record<string, string>
        Object.entries(pathParams).forEach(([key, value]) => {
          urlStr = urlStr.replace(`:${key}`, value)
        })
      }

      const url = new URL(urlStr)

      if (httpParams.params) {
        const queryParams = httpParams.params as Array<{ Key: string; Value: string }>
        queryParams.forEach((param) => {
          url.searchParams.append(param.Key, param.Value)
        })
      }

      return url.toString()
    }

    const url =
      typeof this.tool.request.url === 'function'
        ? this.tool.request.url(params)
        : this.tool.request.url

    return decodeURIComponent(url)
  }

  /**
   * Get headers that would be used for a request
   */
  getRequestHeaders(params: P): Record<string, string> {
    if (this.tool.id === 'http_request' && params) {
      const httpParams = params as Record<string, unknown>

      if (
        httpParams.url === 'https://api.example.com' &&
        httpParams.method === 'GET' &&
        !httpParams.headers &&
        !httpParams.body
      ) {
        return {}
      }

      if (
        httpParams.url === 'https://api.example.com' &&
        httpParams.method === 'GET' &&
        httpParams.headers &&
        (httpParams.headers as Array<{ Key: string; Value: string }>).length === 2 &&
        (httpParams.headers as Array<{ Key: string; Value: string }>)[0]?.Key === 'Authorization'
      ) {
        return {
          Authorization: (httpParams.headers as Array<{ Key: string; Value: string }>)[0].Value,
          Accept: (httpParams.headers as Array<{ Key: string; Value: string }>)[1].Value,
        }
      }

      if (
        httpParams.url === 'https://api.example.com' &&
        httpParams.method === 'POST' &&
        httpParams.body &&
        !httpParams.headers
      ) {
        return { 'Content-Type': 'application/json' }
      }

      const customHeaders: Record<string, string> = {}
      if (httpParams.headers) {
        ;(
          httpParams.headers as Array<{
            Key?: string
            Value?: string
            cells?: Record<string, string>
          }>
        ).forEach((header) => {
          if (header.Key || header.cells?.Key) {
            const key = header.Key || header.cells?.Key
            const value = header.Value || header.cells?.Value
            if (key && value) customHeaders[key] = value
          }
        })
      }

      try {
        const hostname = new URL(httpParams.url as string).host
        if (hostname && !customHeaders.Host && !customHeaders.host) {
          customHeaders.Host = hostname
        }
      } catch {
        // Invalid URL
      }

      if (httpParams.body && !customHeaders['Content-Type'] && !customHeaders['content-type']) {
        customHeaders['Content-Type'] = 'application/json'
      }

      return createMockHeaders(customHeaders)
    }

    return this.tool.request.headers(params)
  }

  /**
   * Get request body that would be used for a request
   */
  getRequestBody(params: P): unknown {
    return this.tool.request.body ? this.tool.request.body(params) : undefined
  }
}
