/**
 * @vitest-environment jsdom
 *
 * HTTP Request Tool Unit Tests
 *
 * This file contains unit tests for the HTTP Request tool, which is used
 * to make HTTP requests to external APIs and services.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mockHttpResponses } from '../__test-utils__/mock-data'
import { ToolTester } from '../__test-utils__/test-tools'
import { requestTool } from './request'

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
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  describe('URL Construction', () => {
    test('should construct URLs correctly', () => {
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
    test('should set headers correctly', () => {
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
  })

  describe('Request Execution', () => {
    test('should handle successful GET requests', async () => {
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

    test('should handle POST requests with body', async () => {
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

    test('should handle errors correctly', async () => {
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

    test('should handle timeout parameter', async () => {
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
    test('should transform JSON responses correctly', async () => {
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

    test('should transform text responses correctly', async () => {
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
    test('should handle network errors', async () => {
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

    test('should handle 404 errors', async () => {
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

    test('should handle 401 unauthorized errors', async () => {
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
})
