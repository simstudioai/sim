/**
 * @vitest-environment jsdom
 *
 * HTTP Request Tool Unit Tests
 *
 * This file contains unit tests for the HTTP Request tool, which is used
 * to make HTTP requests to external APIs and services.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest'
import { mockHttpResponses } from '@/tools/__test-utils__/mock-data'
import { ToolTester } from '@/tools/__test-utils__/test-tools'
import { requestTool } from '@/tools/http/request'

process.env.VITEST = 'true'

describe('HTTP Request Tool', () => {
  let tester: ToolTester

  beforeEach(() => {
    tester = new ToolTester(requestTool)
    // Set base URL environment variable
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  })

  afterEach(() => {
    tester.cleanup()
    vi.resetAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = undefined
  })

  describe('URL Construction', () => {
    it.concurrent('should construct URLs correctly', () => {
      // Base URL
      expect(tester.getRequestUrl({ url: 'https://api.example.com/data' })).toBe(
        'https://api.example.com/data'
      )

      // With path parameters
      expect(
        tester.getRequestUrl({
          url: 'https://api.example.com/users/:userId/posts/:postId',
          pathParams: { userId: '123', postId: '456' },
        })
      ).toBe('https://api.example.com/users/123/posts/456')

      // With query parameters - note that spaces are encoded as + in URLs
      expect(
        tester.getRequestUrl({
          url: 'https://api.example.com/search',
          params: [
            { Key: 'q', Value: 'test query' },
            { Key: 'limit', Value: '10' },
          ],
        })
      ).toBe('https://api.example.com/search?q=test+query&limit=10')

      // URL with existing query params + additional params
      expect(
        tester.getRequestUrl({
          url: 'https://api.example.com/search?sort=desc',
          params: [{ Key: 'q', Value: 'test' }],
        })
      ).toBe('https://api.example.com/search?sort=desc&q=test')

      // Special characters in path parameters (encoded differently by different engines)
      const url = tester.getRequestUrl({
        url: 'https://api.example.com/users/:userId',
        pathParams: { userId: 'user name+special&chars' },
      })
      expect(url.startsWith('https://api.example.com/users/user')).toBe(true)
      // Just check for user name regardless of exact encoding
      expect(url.includes('name')).toBe(true)
      expect(url.includes('special')).toBe(true)
      expect(url.includes('chars')).toBe(true)
    })
  })

  describe('Headers Construction', () => {
    it.concurrent('should set headers correctly', () => {
      // Default headers
      expect(tester.getRequestHeaders({ url: 'https://api.example.com', method: 'GET' })).toEqual(
        {}
      )

      // Custom headers
      expect(
        tester.getRequestHeaders({
          url: 'https://api.example.com',
          method: 'GET',
          headers: [
            { Key: 'Authorization', Value: 'Bearer token123' },
            { Key: 'Accept', Value: 'application/json' },
          ],
        })
      ).toEqual({
        Authorization: 'Bearer token123',
        Accept: 'application/json',
      })

      // Headers with body (should add Content-Type)
      expect(
        tester.getRequestHeaders({
          url: 'https://api.example.com',
          method: 'POST',
          body: { key: 'value' },
        })
      ).toEqual({
        'Content-Type': 'application/json',
      })
    })

    it.concurrent('should respect custom Content-Type headers', () => {
      // Custom Content-Type should not be overridden
      const headers = tester.getRequestHeaders({
        url: 'https://api.example.com',
        method: 'POST',
        body: { key: 'value' },
        headers: [{ Key: 'Content-Type', Value: 'application/x-www-form-urlencoded' }],
      })
      expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')

      // Case-insensitive Content-Type should not be overridden
      const headers2 = tester.getRequestHeaders({
        url: 'https://api.example.com',
        method: 'POST',
        body: { key: 'value' },
        headers: [{ Key: 'content-type', Value: 'text/plain' }],
      })
      expect(headers2['content-type']).toBe('text/plain')
    })

    it('should set dynamic Referer header correctly', async () => {
      const originalWindow = global.window
      Object.defineProperty(global, 'window', {
        value: {
          location: {
            origin: 'https://app.simstudio.dev',
          },
        },
        writable: true,
      })

      // Setup mock response
      tester.setup(mockHttpResponses.simple)

      // Execute with real request to check Referer header
      await tester.execute({
        url: 'https://api.example.com',
        method: 'GET',
      })

      // Verify the Referer header was set
      const fetchCall = (global.fetch as any).mock.calls[0]
      expect(fetchCall[1].headers.Referer).toBe('https://app.simstudio.dev')

      // Reset window
      global.window = originalWindow
    })

    it('should set dynamic Host header correctly', async () => {
      // Setup mock response
      tester.setup(mockHttpResponses.simple)

      // Execute with real request to check Host header
      await tester.execute({
        url: 'https://api.example.com/endpoint',
        method: 'GET',
      })

      // Verify the Host header was set
      const fetchCall = (global.fetch as any).mock.calls[0]
      expect(fetchCall[1].headers.Host).toBe('api.example.com')

      // Test user-provided Host takes precedence
      await tester.execute({
        url: 'https://api.example.com/endpoint',
        method: 'GET',
        headers: [{ cells: { Key: 'Host', Value: 'custom-host.com' } }],
      })

      // Verify the user's Host was used
      const userHeaderCall = (global.fetch as any).mock.calls[1]
      expect(userHeaderCall[1].headers.Host).toBe('custom-host.com')
    })
  })

  describe('Body Construction', () => {
    it.concurrent('should handle JSON bodies correctly', () => {
      const body = { username: 'test', password: 'secret' }

      expect(
        tester.getRequestBody({
          url: 'https://api.example.com',
          body,
        })
      ).toEqual(body)
    })

    it.concurrent('should handle FormData correctly', () => {
      const formData = { file: 'test.txt', content: 'file content' }

      const result = tester.getRequestBody({
        url: 'https://api.example.com',
        formData,
      })

      expect(result).toBeInstanceOf(FormData)
    })
  })

  describe('Request Execution', () => {
    it('should apply default and dynamic headers to requests', async () => {
      // Setup mock response
      tester.setup(mockHttpResponses.simple)

      // Set up browser-like environment
      const originalWindow = global.window
      Object.defineProperty(global, 'window', {
        value: {
          location: {
            origin: 'https://app.simstudio.dev',
          },
        },
        writable: true,
      })

      // Execute the tool with method explicitly set to GET
      await tester.execute({
        url: 'https://api.example.com/data',
        method: 'GET',
      })

      // Verify fetch was called with expected headers
      const fetchCall = (global.fetch as any).mock.calls[0]
      const headers = fetchCall[1].headers

      // Check specific header values
      expect(headers.Host).toBe('api.example.com')
      expect(headers.Referer).toBe('https://app.simstudio.dev')
      expect(headers['User-Agent']).toContain('Mozilla')
      expect(headers.Accept).toBe('*/*')
      expect(headers['Accept-Encoding']).toContain('gzip')
      expect(headers['Cache-Control']).toBe('no-cache')
      expect(headers.Connection).toBe('keep-alive')
      expect(headers['Sec-Ch-Ua']).toContain('Chromium')

      // Reset window
      global.window = originalWindow
    })

    it('should handle successful GET requests', async () => {
      // Setup mock response
      tester.setup(mockHttpResponses.simple)

      // Execute the tool
      const result = await tester.execute({
        url: 'https://api.example.com/data',
        method: 'GET',
      })

      // Check results
      expect(result.success).toBe(true)
      expect(result.output.data).toEqual(mockHttpResponses.simple)
      expect(result.output.status).toBe(200)
      expect(result.output.headers).toHaveProperty('content-type')
    })

    it('should handle POST requests with body', async () => {
      // Setup mock response
      tester.setup({ result: 'success' })

      // Create test body
      const body = { name: 'Test User', email: 'test@example.com' }

      // Execute the tool
      await tester.execute({
        url: 'https://api.example.com/users',
        method: 'POST',
        body,
      })

      // Verify the body was included in the request
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/users',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.any(String),
        })
      )

      // Verify the stringified body matches our original data
      const fetchCall = (global.fetch as any).mock.calls[0]
      const bodyArg = JSON.parse(fetchCall[1].body)
      expect(bodyArg).toEqual(body)
    })

    it('should handle POST requests with URL-encoded form data', async () => {
      // Setup mock response
      tester.setup({ result: 'success' })

      // Create test body
      const body = { username: 'testuser123', password: 'testpass456', email: 'test@example.com' }

      // Execute the tool with form-urlencoded content type
      await tester.execute({
        url: 'https://api.example.com/oauth/token',
        method: 'POST',
        body,
        headers: [{ cells: { Key: 'Content-Type', Value: 'application/x-www-form-urlencoded' } }],
      })

      // Verify the request was made with correct headers
      const fetchCall = (global.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toBe('https://api.example.com/oauth/token')
      expect(fetchCall[1].method).toBe('POST')
      expect(fetchCall[1].headers['Content-Type']).toBe('application/x-www-form-urlencoded')

      // Verify the body is URL-encoded (should not be JSON stringified)
      expect(fetchCall[1].body).toBe(
        'username=testuser123&password=testpass456&email=test%40example.com'
      )
    })

    it('should handle OAuth client credentials requests', async () => {
      // Setup mock response for OAuth token endpoint
      tester.setup({ access_token: 'token123', token_type: 'Bearer' })

      // Execute OAuth client credentials request
      await tester.execute({
        url: 'https://oauth.example.com/token',
        method: 'POST',
        body: { grant_type: 'client_credentials', scope: 'read write' },
        headers: [
          { cells: { Key: 'Content-Type', Value: 'application/x-www-form-urlencoded' } },
          { cells: { Key: 'Authorization', Value: 'Basic Y2xpZW50OnNlY3JldA==' } },
        ],
      })

      // Verify the OAuth request was properly formatted
      const fetchCall = (global.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toBe('https://oauth.example.com/token')
      expect(fetchCall[1].method).toBe('POST')
      expect(fetchCall[1].headers['Content-Type']).toBe('application/x-www-form-urlencoded')
      expect(fetchCall[1].headers.Authorization).toBe('Basic Y2xpZW50OnNlY3JldA==')

      // Verify the body is URL-encoded
      expect(fetchCall[1].body).toBe('grant_type=client_credentials&scope=read+write')
    })

    it('should handle errors correctly', async () => {
      // Setup error response
      tester.setup(mockHttpResponses.error, { ok: false, status: 400 })

      // Execute the tool
      const result = await tester.execute({
        url: 'https://api.example.com/data',
        method: 'GET',
      })

      // Check error handling
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should handle timeout parameter', async () => {
      // Setup successful response
      tester.setup({ result: 'success' })

      // Execute with timeout
      await tester.execute({
        url: 'https://api.example.com/data',
        timeout: 5000,
      })

      // Timeout isn't directly testable here since we mock fetch
      // but ensuring the param isn't causing errors is important
      expect(global.fetch).toHaveBeenCalled()
    })
  })

  describe('Response Transformation', () => {
    it('should transform JSON responses correctly', async () => {
      // Setup JSON response
      tester.setup({ data: { key: 'value' } }, { headers: { 'content-type': 'application/json' } })

      // Execute the tool
      const result = await tester.execute({
        url: 'https://api.example.com/data',
      })

      // Check transformed response
      expect(result.success).toBe(true)
      expect(result.output.data).toEqual({ data: { key: 'value' } })
    })

    it('should transform text responses correctly', async () => {
      // Setup text response
      const textContent = 'Plain text response'
      tester.setup(textContent, { headers: { 'content-type': 'text/plain' } })

      // Execute the tool
      const result = await tester.execute({
        url: 'https://api.example.com/text',
      })

      // Check transformed response
      expect(result.success).toBe(true)
      expect(result.output.data).toBe(textContent)
    })
  })

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      // Setup network error
      tester.setupError('Network error')

      // Execute the tool
      const result = await tester.execute({
        url: 'https://api.example.com/data',
      })

      // Check error response
      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
    })

    it('should handle 404 errors', async () => {
      // Setup 404 response
      tester.setup(mockHttpResponses.notFound, { ok: false, status: 404 })

      // Execute the tool
      const result = await tester.execute({
        url: 'https://api.example.com/not-found',
      })

      // Check error response
      expect(result.success).toBe(false)
      expect(result.output).toEqual({})
    })

    it('should handle 401 unauthorized errors', async () => {
      // Setup 401 response
      tester.setup(mockHttpResponses.unauthorized, { ok: false, status: 401 })

      // Execute the tool
      const result = await tester.execute({
        url: 'https://api.example.com/restricted',
      })

      // Check error response
      expect(result.success).toBe(false)
      expect(result.output).toEqual({})
    })
  })

  describe('Default Headers', () => {
    it('should apply all default headers correctly', async () => {
      // Setup mock response
      tester.setup(mockHttpResponses.simple)

      // Set up browser-like environment
      const originalWindow = global.window
      Object.defineProperty(global, 'window', {
        value: {
          location: {
            origin: 'https://app.simstudio.dev',
          },
        },
        writable: true,
      })

      // Execute the tool
      await tester.execute({
        url: 'https://api.example.com/data',
        method: 'GET',
      })

      // Get the headers from the fetch call
      const fetchCall = (global.fetch as any).mock.calls[0]
      const headers = fetchCall[1].headers

      // Check all default headers exist with expected values
      expect(headers['User-Agent']).toMatch(/Mozilla\/5\.0.*Chrome.*Safari/)
      expect(headers.Accept).toBe('*/*')
      expect(headers['Accept-Encoding']).toBe('gzip, deflate, br')
      expect(headers['Cache-Control']).toBe('no-cache')
      expect(headers.Connection).toBe('keep-alive')
      expect(headers['Sec-Ch-Ua']).toMatch(/Chromium.*Not-A\.Brand/)
      expect(headers['Sec-Ch-Ua-Mobile']).toBe('?0')
      expect(headers['Sec-Ch-Ua-Platform']).toBe('"macOS"')
      expect(headers.Referer).toBe('https://app.simstudio.dev')
      expect(headers.Host).toBe('api.example.com')

      // Reset window
      global.window = originalWindow
    })

    it('should allow overriding default headers', async () => {
      // Setup mock response
      tester.setup(mockHttpResponses.simple)

      // Execute with custom headers that override defaults
      await tester.execute({
        url: 'https://api.example.com/data',
        method: 'GET',
        headers: [
          { cells: { Key: 'User-Agent', Value: 'Custom Agent' } },
          { cells: { Key: 'Accept', Value: 'application/json' } },
        ],
      })

      // Get the headers from the fetch call
      const fetchCall = (global.fetch as any).mock.calls[0]
      const headers = fetchCall[1].headers

      // Verify overridden headers
      expect(headers['User-Agent']).toBe('Custom Agent')
      expect(headers.Accept).toBe('application/json')

      // Verify other default headers still exist
      expect(headers['Accept-Encoding']).toBe('gzip, deflate, br')
      expect(headers['Cache-Control']).toBe('no-cache')
    })
  })

  describe('Proxy Functionality', () => {
    it.concurrent('should not use proxy in test environment', () => {
      // This test verifies that the shouldUseProxy function has been disabled for tests

      // Create a browser-like environment
      const originalWindow = global.window
      Object.defineProperty(global, 'window', {
        value: {
          location: {
            origin: 'https://app.simstudio.dev',
          },
        },
        writable: true,
      })

      // Check that external URLs are not proxied during tests
      const url = tester.getRequestUrl({ url: 'https://api.example.com/data' })
      expect(url).toBe('https://api.example.com/data')
      expect(url).not.toContain('/api/proxy')

      // Reset window
      global.window = originalWindow
    })

    it.concurrent('should include method parameter in proxy URL', () => {
      const originalWindow = global.window
      Object.defineProperty(global, 'window', {
        value: {
          location: {
            origin: 'https://sim.ai',
          },
        },
        writable: true,
      })

      const originalVitest = process.env.VITEST

      try {
        process.env.VITEST = undefined

        const buildProxyUrl = (params: any) => {
          const baseUrl = 'https://external-api.com/endpoint'
          let proxyUrl = `/api/proxy?url=${encodeURIComponent(baseUrl)}`

          if (params.method) {
            proxyUrl += `&method=${encodeURIComponent(params.method)}`
          }

          if (
            params.body &&
            ['POST', 'PUT', 'PATCH'].includes(params.method?.toUpperCase() || '')
          ) {
            const bodyStr =
              typeof params.body === 'string' ? params.body : JSON.stringify(params.body)
            proxyUrl += `&body=${encodeURIComponent(bodyStr)}`
          }

          return proxyUrl
        }

        const getParams = {
          url: 'https://external-api.com/endpoint',
          method: 'GET',
        }
        const getProxyUrl = buildProxyUrl(getParams)
        expect(getProxyUrl).toContain('/api/proxy?url=')
        expect(getProxyUrl).toContain('&method=GET')

        const postParams = {
          url: 'https://external-api.com/endpoint',
          method: 'POST',
          body: { key: 'value' },
        }
        const postProxyUrl = buildProxyUrl(postParams)
        expect(postProxyUrl).toContain('/api/proxy?url=')
        expect(postProxyUrl).toContain('&method=POST')
        expect(postProxyUrl).toContain('&body=')
        expect(postProxyUrl).toContain(encodeURIComponent('{"key":"value"}'))

        const putParams = {
          url: 'https://external-api.com/endpoint',
          method: 'PUT',
          body: 'string body',
        }
        const putProxyUrl = buildProxyUrl(putParams)
        expect(putProxyUrl).toContain('/api/proxy?url=')
        expect(putProxyUrl).toContain('&method=PUT')
        expect(putProxyUrl).toContain(`&body=${encodeURIComponent('string body')}`)
      } finally {
        global.window = originalWindow
        process.env.VITEST = originalVitest
      }
    })
  })
})
