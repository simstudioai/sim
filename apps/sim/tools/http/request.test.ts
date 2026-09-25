/**
 * HTTP Request Tool Unit Tests
 *
 * This file contains unit tests for the HTTP Request tool, which is used
 * to make HTTP requests to external APIs and services.
 */

import { ToolTester } from '@sim/testing/builders'
import { mockHttpResponses } from '@sim/testing/factories'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestTool } from '@/tools/http/request'
import { processUrl } from '@/tools/http/utils'

process.env.VITEST = 'true'

describe('HTTP Request Tool', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tester: ToolTester<any, any>

  beforeEach(() => {
    tester = new ToolTester(requestTool as any)
    process.env.NEXT_PUBLIC_APP_URL = 'https://sim.ai'
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

    it.concurrent('substitutes path parameters only by their whole name', () => {
      expect(processUrl('https://www.google.com', { '': '' })).toBe('https://www.google.com')
      expect(processUrl('https://api.example.com:8443/users/:id', { '8443': 'x', id: '42' })).toBe(
        'https://api.example.com:8443/users/42'
      )
      expect(processUrl('https://api.example.com/users/:idx/:id', { id: '1', idx: '2' })).toBe(
        'https://api.example.com/users/2/1'
      )
      expect(processUrl('https://api.example.com/users/:id-profile', { id: '7' })).toBe(
        'https://api.example.com/users/7-profile'
      )
      expect(processUrl('https://api.example.com/users/:user-id', { 'user-id': '9' })).toBe(
        'https://api.example.com/users/9'
      )
      expect(processUrl('https://api.example.com/users/:id', { id: '$&' })).toBe(
        'https://api.example.com/users/%24%26'
      )
      expect(processUrl('https://api.example.com/users/:user.name', { 'user.name': 'ada' })).toBe(
        'https://api.example.com/users/ada'
      )
      expect(processUrl('https://api.example.com/v1/:$ref', { $ref: 'x' })).toBe(
        'https://api.example.com/v1/x'
      )
      expect(processUrl('https://api.example.com/users/:id', { '/': 'x', '1': 'y' })).toBe(
        'https://api.example.com/users/:id'
      )
      expect(
        processUrl('https://api.example.com/:user-id/:user', { user: 'alice', 'user-id': '42' })
      ).toBe('https://api.example.com/42/alice')
      expect(
        processUrl('https://api.example.com/:user.name', { user: 'alice', 'user.name': 'ada' })
      ).toBe('https://api.example.com/ada')
      expect(processUrl('https://api.example.com/:é/:éa', { é: '42', éa: '7' })).toBe(
        'https://api.example.com/42/7'
      )
    })

    it.concurrent('canonicalizes first-party API calls before the apex redirect', () => {
      expect(
        processUrl('https://sim.ai/api/v2/workflows', undefined, [
          { cells: { Key: 'limit', Value: '10' } },
        ])
      ).toBe('https://www.sim.ai/api/v2/workflows?limit=10')
      expect(processUrl('https://sim.ai/pricing')).toBe('https://sim.ai/pricing')
      expect(processUrl('https://www.sim.ai/api/v2/workflows')).toBe(
        'https://www.sim.ai/api/v2/workflows'
      )
      expect(processUrl('https://sim.ai:8443/api/v2/workflows')).toBe(
        'https://sim.ai:8443/api/v2/workflows'
      )
      expect(processUrl('https://staging.sim.ai/api/v2/workflows')).toBe(
        'https://www.staging.sim.ai/api/v2/workflows'
      )
      expect(processUrl('https://dev.sim.ai/api/v2/workflows')).toBe(
        'https://www.dev.sim.ai/api/v2/workflows'
      )
      expect(processUrl('https://preview.dev.sim.ai/api/v2/workflows')).toBe(
        'https://preview.dev.sim.ai/api/v2/workflows'
      )
    })
  })

  describe('Redirect Policy', () => {
    it.concurrent('keeps missing policy fields on legacy behavior', () => {
      expect(requestTool.request.redirectPolicy?.({ url: 'https://api.example.com' })).toEqual({
        mode: 'legacy',
        sendCredentialsOnCrossOriginRedirect: true,
        sensitiveHeaders: [],
      })
    })

    it.concurrent('uses the standard safe policy for newly versioned blocks', () => {
      expect(
        requestTool.request.redirectPolicy?.({
          url: 'https://api.example.com',
          redirectPolicyVersion: 'standard-v1',
          sendCredentialsOnCrossOriginRedirect: false,
          headers: {
            Authorization: 'Bearer token',
            'X-Api-Key': 'key',
            'X-Trace': 'trace',
          },
        })
      ).toEqual({
        mode: 'standard',
        sendCredentialsOnCrossOriginRedirect: false,
        sensitiveHeaders: ['Authorization', 'X-Api-Key'],
      })
    })

    it.concurrent('keeps an existing block legacy when credential forwarding is enabled', () => {
      expect(
        requestTool.request.redirectPolicy?.({
          url: 'https://api.example.com',
          sendCredentialsOnCrossOriginRedirect: true,
        })
      ).toMatchObject({
        mode: 'legacy',
        sendCredentialsOnCrossOriginRedirect: true,
      })
    })

    it.concurrent('uses the standard policy with credential forwarding on by default', () => {
      expect(
        requestTool.request.redirectPolicy?.({
          url: 'https://api.example.com',
          redirectPolicyVersion: 'standard-v1',
          sendCredentialsOnCrossOriginRedirect: true,
        })
      ).toMatchObject({
        mode: 'standard',
        sendCredentialsOnCrossOriginRedirect: true,
      })
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

    it('should not set a default Referer header', async () => {
      tester.setup(mockHttpResponses.simple)

      await tester.execute({
        url: 'https://api.example.com',
        method: 'GET',
      })

      const fetchCall = (global.fetch as any).mock.calls[0]
      expect(fetchCall[1].headers.Referer).toBeUndefined()
    })

    it('should respect a user-provided Referer header', async () => {
      tester.setup(mockHttpResponses.simple)

      await tester.execute({
        url: 'https://api.example.com',
        method: 'GET',
        headers: [{ cells: { Key: 'Referer', Value: 'https://custom.example.com' } }],
      })

      const fetchCall = (global.fetch as any).mock.calls[0]
      expect(fetchCall[1].headers.Referer).toBe('https://custom.example.com')
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

      await tester.execute({
        url: 'https://api.example.com/data',
        method: 'GET',
      })

      const fetchCall = (global.fetch as any).mock.calls[0]
      const headers = fetchCall[1].headers

      expect(headers.Host).toBe('api.example.com')
      expect(headers.Referer).toBeUndefined()
      expect(headers['User-Agent']).toBe('Sim/1.0 (+https://sim.ai)')
      expect(headers.Accept).toBe('*/*')
      expect(headers['Accept-Encoding']).toContain('gzip')
      expect(headers['Cache-Control']).toBe('no-cache')
      expect(headers.Connection).toBe('keep-alive')
      expect(headers['Sec-Ch-Ua']).toBeUndefined()
    })

    it('should reject responses that exceed the workflow data cap', async () => {
      const response = new Response('too large', {
        status: 200,
        headers: {
          'content-type': 'text/plain',
          'content-length': '10485761',
        },
      })

      await expect(requestTool.transformResponse?.(response, {} as any)).rejects.toMatchObject({
        name: 'PayloadSizeLimitError',
      })
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

    it('should handle nested objects and arrays in URL-encoded form data', async () => {
      tester.setup({ result: 'success' })

      const body = {
        name: 'test',
        data: { nested: 'value' },
        items: [1, 2, 3],
      }

      await tester.execute({
        url: 'https://api.example.com/submit',
        method: 'POST',
        body,
        headers: [{ cells: { Key: 'Content-Type', Value: 'application/x-www-form-urlencoded' } }],
      })

      const fetchCall = (global.fetch as any).mock.calls[0]
      const bodyStr = fetchCall[1].body

      expect(bodyStr).toContain('name=test')
      expect(bodyStr).toContain('data=%7B%22nested%22%3A%22value%22%7D')
      expect(bodyStr).toContain('items=%5B1%2C2%2C3%5D')
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
  })

  describe('Default Headers', () => {
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
})
