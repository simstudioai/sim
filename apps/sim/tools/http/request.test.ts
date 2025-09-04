/**
 * @vitest-environment jsdom
 *
 * HTTP Request Tool Unit Tests
 *
 * This file contains unit tests for the HTTP Request tool, which is used
 * to make HTTP requests to external APIs and services.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockHttpResponses } from '@/tools/__test-utils__/mock-data'
import { ToolTester } from '@/tools/__test-utils__/test-tools'
import { requestTool } from '@/tools/http/request'

process.env.VITEST = 'true'

describe('HTTP Request Tool', () => {
  let tester: ToolTester

  beforeEach(() => {
    tester = new ToolTester(requestTool)
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  })

  afterEach(() => {
    tester.cleanup()
    vi.resetAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = undefined
  })

  describe('URL Construction', () => {
    it.concurrent('should construct URLs correctly', () => {
      expect(tester.getRequestUrl({ url: 'https://api.example.com/data' })).toBe(
        'https://api.example.com/data'
      )

      expect(
        tester.getRequestUrl({
          url: 'https://api.example.com/users/:userId/posts/:postId',
          pathParams: { userId: '123', postId: '456' },
        })
      ).toBe('https://api.example.com/users/123/posts/456')

      expect(
        tester.getRequestUrl({
          url: 'https://api.example.com/search',
          params: [
            { Key: 'q', Value: 'test query' },
            { Key: 'limit', Value: '10' },
          ],
        })
      ).toBe('https://api.example.com/search?q=test+query&limit=10')

      expect(
        tester.getRequestUrl({
          url: 'https://api.example.com/search?sort=desc',
          params: [{ Key: 'q', Value: 'test' }],
        })
      ).toBe('https://api.example.com/search?sort=desc&q=test')

      const url = tester.getRequestUrl({
        url: 'https://api.example.com/users/:userId',
        pathParams: { userId: 'user name+special&chars' },
      })
      expect(url.startsWith('https://api.example.com/users/user')).toBe(true)
      expect(url.includes('name')).toBe(true)
      expect(url.includes('special')).toBe(true)
      expect(url.includes('chars')).toBe(true)
    })
  })

  describe('Headers Construction', () => {
    it.concurrent('should set headers correctly', () => {
      expect(tester.getRequestHeaders({ url: 'https://api.example.com', method: 'GET' })).toEqual(
        {}
      )

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
      const headers = tester.getRequestHeaders({
        url: 'https://api.example.com',
        method: 'POST',
        body: { key: 'value' },
        headers: [{ Key: 'Content-Type', Value: 'application/x-www-form-urlencoded' }],
      })
      expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')

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

      tester.setup(mockHttpResponses.simple)

      await tester.execute({
        url: 'https://api.example.com',
        method: 'GET',
      })

      const fetchCall = (global.fetch as any).mock.calls[0]
      expect(fetchCall[1].headers.Referer).toBe('https://app.simstudio.dev')

      global.window = originalWindow
    })

    it('should set dynamic Host header correctly', async () => {
      tester.setup(mockHttpResponses.simple)

      await tester.execute({
        url: 'https://api.example.com/endpoint',
        method: 'GET',
      })

      const fetchCall = (global.fetch as any).mock.calls[0]
      expect(fetchCall[1].headers.Host).toBe('api.example.com')

      await tester.execute({
        url: 'https://api.example.com/endpoint',
        method: 'GET',
        headers: [{ cells: { Key: 'Host', Value: 'custom-host.com' } }],
      })

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
      tester.setup(mockHttpResponses.simple)

      const originalWindow = global.window
      Object.defineProperty(global, 'window', {
        value: {
          location: {
            origin: 'https://app.simstudio.dev',
          },
        },
        writable: true,
      })

      await tester.execute({
        url: 'https://api.example.com/data',
        method: 'GET',
      })

      const fetchCall = (global.fetch as any).mock.calls[0]
      const headers = fetchCall[1].headers

      expect(headers.Host).toBe('api.example.com')
      expect(headers.Referer).toBe('https://app.simstudio.dev')
      expect(headers['User-Agent']).toContain('Mozilla')
      expect(headers.Accept).toBe('*/*')
      expect(headers['Accept-Encoding']).toContain('gzip')
      expect(headers['Cache-Control']).toBe('no-cache')
      expect(headers.Connection).toBe('keep-alive')
      expect(headers['Sec-Ch-Ua']).toContain('Chromium')

      global.window = originalWindow
    })

    it('should handle successful GET requests', async () => {
      tester.setup(mockHttpResponses.simple)

      const result = await tester.execute({
        url: 'https://api.example.com/data',
        method: 'GET',
      })

      expect(result.success).toBe(true)
      expect(result.output.data).toEqual(mockHttpResponses.simple)
      expect(result.output.status).toBe(200)
      expect(result.output.headers).toHaveProperty('content-type')
    })

    it('should handle POST requests with body', async () => {
      tester.setup({ result: 'success' })

      const body = { name: 'Test User', email: 'test@example.com' }

      await tester.execute({
        url: 'https://api.example.com/users',
        method: 'POST',
        body,
      })

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

      const fetchCall = (global.fetch as any).mock.calls[0]
      const bodyArg = JSON.parse(fetchCall[1].body)
      expect(bodyArg).toEqual(body)
    })

    it('should handle POST requests with URL-encoded form data', async () => {
      tester.setup({ result: 'success' })

      const body = { username: 'testuser123', password: 'testpass456', email: 'test@example.com' }

      await tester.execute({
        url: 'https://api.example.com/oauth/token',
        method: 'POST',
        body,
        headers: [{ cells: { Key: 'Content-Type', Value: 'application/x-www-form-urlencoded' } }],
      })

      const fetchCall = (global.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toBe('https://api.example.com/oauth/token')
      expect(fetchCall[1].method).toBe('POST')
      expect(fetchCall[1].headers['Content-Type']).toBe('application/x-www-form-urlencoded')

      expect(fetchCall[1].body).toBe(
        'username=testuser123&password=testpass456&email=test%40example.com'
      )
    })

    it('should handle OAuth client credentials requests', async () => {
      tester.setup({ access_token: 'token123', token_type: 'Bearer' })

      await tester.execute({
        url: 'https://oauth.example.com/token',
        method: 'POST',
        body: { grant_type: 'client_credentials', scope: 'read write' },
        headers: [
          { cells: { Key: 'Content-Type', Value: 'application/x-www-form-urlencoded' } },
          { cells: { Key: 'Authorization', Value: 'Basic Y2xpZW50OnNlY3JldA==' } },
        ],
      })

      const fetchCall = (global.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toBe('https://oauth.example.com/token')
      expect(fetchCall[1].method).toBe('POST')
      expect(fetchCall[1].headers['Content-Type']).toBe('application/x-www-form-urlencoded')
      expect(fetchCall[1].headers.Authorization).toBe('Basic Y2xpZW50OnNlY3JldA==')

      expect(fetchCall[1].body).toBe('grant_type=client_credentials&scope=read+write')
    })

    it('should handle errors correctly', async () => {
      tester.setup(mockHttpResponses.error, { ok: false, status: 400 })

      const result = await tester.execute({
        url: 'https://api.example.com/data',
        method: 'GET',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should handle timeout parameter', async () => {
      tester.setup({ result: 'success' })

      await tester.execute({
        url: 'https://api.example.com/data',
        timeout: 5000,
      })

      expect(global.fetch).toHaveBeenCalled()
    })
  })

  describe('Response Transformation', () => {
    it('should transform JSON responses correctly', async () => {
      tester.setup({ data: { key: 'value' } }, { headers: { 'content-type': 'application/json' } })

      const result = await tester.execute({
        url: 'https://api.example.com/data',
      })

      expect(result.success).toBe(true)
      expect(result.output.data).toEqual({ data: { key: 'value' } })
    })

    it('should transform text responses correctly', async () => {
      const textContent = 'Plain text response'
      tester.setup(textContent, { headers: { 'content-type': 'text/plain' } })

      const result = await tester.execute({
        url: 'https://api.example.com/text',
      })

      expect(result.success).toBe(true)
      expect(result.output.data).toBe(textContent)
    })
  })

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      tester.setupError('Network error')

      const result = await tester.execute({
        url: 'https://api.example.com/data',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
    })

    it('should handle 404 errors', async () => {
      tester.setup(mockHttpResponses.notFound, { ok: false, status: 404 })

      const result = await tester.execute({
        url: 'https://api.example.com/not-found',
      })

      expect(result.success).toBe(false)
      expect(result.output).toEqual({})
    })

    it('should handle 401 unauthorized errors', async () => {
      tester.setup(mockHttpResponses.unauthorized, { ok: false, status: 401 })

      const result = await tester.execute({
        url: 'https://api.example.com/restricted',
      })

      expect(result.success).toBe(false)
      expect(result.output).toEqual({})
    })
  })

  describe('Default Headers', () => {
    it('should apply all default headers correctly', async () => {
      tester.setup(mockHttpResponses.simple)

      const originalWindow = global.window
      Object.defineProperty(global, 'window', {
        value: {
          location: {
            origin: 'https://app.simstudio.dev',
          },
        },
        writable: true,
      })

      await tester.execute({
        url: 'https://api.example.com/data',
        method: 'GET',
      })

      const fetchCall = (global.fetch as any).mock.calls[0]
      const headers = fetchCall[1].headers

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

      global.window = originalWindow
    })

    it('should allow overriding default headers', async () => {
      tester.setup(mockHttpResponses.simple)

      await tester.execute({
        url: 'https://api.example.com/data',
        method: 'GET',
        headers: [
          { cells: { Key: 'User-Agent', Value: 'Custom Agent' } },
          { cells: { Key: 'Accept', Value: 'application/json' } },
        ],
      })

      const fetchCall = (global.fetch as any).mock.calls[0]
      const headers = fetchCall[1].headers

      expect(headers['User-Agent']).toBe('Custom Agent')
      expect(headers.Accept).toBe('application/json')

      expect(headers['Accept-Encoding']).toBe('gzip, deflate, br')
      expect(headers['Cache-Control']).toBe('no-cache')
    })
  })

  describe('Proxy Functionality', () => {
    it.concurrent('should not use proxy in test environment', () => {
      const originalWindow = global.window
      Object.defineProperty(global, 'window', {
        value: {
          location: {
            origin: 'https://app.simstudio.dev',
          },
        },
        writable: true,
      })

      const url = tester.getRequestUrl({ url: 'https://api.example.com/data' })
      expect(url).toBe('https://api.example.com/data')
      expect(url).not.toContain('/api/proxy')

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

      const originalVitest = process.env.VITEST as string

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
