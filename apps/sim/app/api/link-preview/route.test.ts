/**
 * Tests for link preview API route
 *
 * @vitest-environment node
 */

import {
  authMockFns,
  createMockRedis,
  createMockRequest,
  inputValidationMock,
  inputValidationMockFns,
  redisConfigMockFns,
  type MockRedis,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockEnforceUserRateLimit = vi.fn()

vi.mock('@/lib/core/rate-limiter/route-helpers', () => ({
  enforceUserRateLimit: mockEnforceUserRateLimit,
}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { GET } from '@/app/api/link-preview/route'

describe('Link Preview API Route', () => {
  let mockRedis: MockRedis

  beforeEach(() => {
    vi.clearAllMocks()

    // Default auth: authenticated user
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-123', email: 'test@example.com' },
      session: { id: 'session-123' },
    })

    // Default rate limit: not limited
    mockEnforceUserRateLimit.mockResolvedValue(null)

    // Default redis: available
    mockRedis = createMockRedis()
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(mockRedis as never)
  })

  describe('Authentication', () => {
    it('should return 401 when user is not authenticated', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 401 when session exists but no user', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ session: { id: 'session-123' } })

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })
  })

  describe('Rate Limiting', () => {
    it('should enforce rate limits for the user', async () => {
      const rateLimitResponse = new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
      })
      mockEnforceUserRateLimit.mockResolvedValue(rateLimitResponse)

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(429)
      expect(data.error).toBe('Rate limit exceeded')
      expect(mockEnforceUserRateLimit).toHaveBeenCalledWith('link-preview', 'user-123')
    })
  })

  describe('URL Validation', () => {
    it('should return 400 when url parameter is missing', async () => {
      const request = createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/link-preview')

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('url is required')
    })

    it('should return 400 when url parameter is empty', async () => {
      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url='
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('url is required')
    })

    it('should return 400 when url parameter is not a valid URL', async () => {
      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=not-a-url'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('url must be a valid URL')
    })

    it('should return 400 when url parameter exceeds maximum length', async () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2100)
      const request = createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost:3000/api/link-preview?url=${encodeURIComponent(longUrl)}`
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('url must be 2048 characters or less')
    })

    it('should return null preview for non-HTTPS URLs', async () => {
      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=http://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview).toBeNull()
      expect(inputValidationMockFns.mockSecureFetchWithValidation).not.toHaveBeenCalled()
    })
  })

  describe('Image URL Extraction', () => {
    it('should extract absolute og:image URL', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <meta property="og:title" content="Test Title" />
            <meta property="og:description" content="Test Description" />
            <meta property="og:image" content="https://example.com/image.jpg" />
          </head>
        </html>
      `

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview).toEqual({
        title: 'Test Title',
        description: 'Test Description',
        siteName: null,
        imageUrl: 'https://example.com/image.jpg',
      })
    })

    it('should extract absolute twitter:image URL when og:image is missing', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <meta property="og:title" content="Test Title" />
            <meta name="twitter:image" content="https://example.com/twitter-image.jpg" />
          </head>
        </html>
      `

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview).toEqual({
        title: 'Test Title',
        description: null,
        siteName: null,
        imageUrl: 'https://example.com/twitter-image.jpg',
      })
    })

    it('should prefer og:image over twitter:image when both exist', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <meta property="og:title" content="Test Title" />
            <meta property="og:image" content="https://example.com/og-image.jpg" />
            <meta name="twitter:image" content="https://example.com/twitter-image.jpg" />
          </head>
        </html>
      `

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview?.imageUrl).toBe('https://example.com/og-image.jpg')
    })

    it('should resolve relative image URLs to absolute URLs', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <meta property="og:title" content="Test Title" />
            <meta property="og:image" content="/images/relative-image.jpg" />
          </head>
        </html>
      `

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com/page/article'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview?.imageUrl).toBe('https://example.com/images/relative-image.jpg')
    })

    it('should resolve protocol-relative image URLs', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <meta property="og:title" content="Test Title" />
            <meta property="og:image" content="//cdn.example.com/image.jpg" />
          </head>
        </html>
      `

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview?.imageUrl).toBe('https://cdn.example.com/image.jpg')
    })

    it('should resolve relative image URLs against final URL after redirects', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <meta property="og:title" content="Test Title" />
            <meta property="og:image" content="/images/redirected-image.jpg" />
          </head>
        </html>
      `

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }), { url: 'https://redirected.example.com/page' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview?.imageUrl).toBe('https://redirected.example.com/images/redirected-image.jpg')
    })

    it('should handle missing image URL', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <meta property="og:title" content="Test Title" />
            <meta property="og:description" content="Test Description" />
          </head>
        </html>
      `

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview).toEqual({
        title: 'Test Title',
        description: 'Test Description',
        siteName: null,
        imageUrl: null,
      })
    })

    it('should return null imageUrl when image URL resolution fails', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <meta property="og:title" content="Test Title" />
            <meta property="og:image" content="::invalid::" />
          </head>
        </html>
      `

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview).toEqual({
        title: 'Test Title',
        description: null,
        siteName: null,
        imageUrl: null,
      })
    })

    it('should drop image URLs that exceed maximum length', async () => {
      const longImageUrl = 'https://example.com/' + 'a'.repeat(2100) + '.jpg'
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <meta property="og:title" content="Test Title" />
            <meta property="og:image" content="${longImageUrl}" />
          </head>
        </html>
      `

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview?.imageUrl).toBeNull()
      expect(data.preview?.title).toBe('Test Title')
    })

    it('should return preview with imageUrl only when no other metadata exists', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta property="og:image" content="https://example.com/image.jpg" />
          </head>
        </html>
      `

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview).toEqual({
        title: null,
        description: null,
        siteName: null,
        imageUrl: 'https://example.com/image.jpg',
      })
    })
  })

  describe('Caching', () => {
    it('should return cached preview when available', async () => {
      const cachedPreview = {
        title: 'Cached Title',
        description: 'Cached Description',
        siteName: 'Cached Site',
        imageUrl: 'https://example.com/cached-image.jpg',
      }

      mockRedis.get.mockResolvedValue(JSON.stringify(cachedPreview))

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview).toEqual(cachedPreview)
      expect(mockRedis.get).toHaveBeenCalled()
      expect(inputValidationMockFns.mockSecureFetchWithValidation).not.toHaveBeenCalled()
    })

    it('should cache successful preview fetches', async () => {
      mockRedis.get.mockResolvedValue(null)

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <meta property="og:title" content="Test Title" />
            <meta property="og:image" content="https://example.com/image.jpg" />
          </head>
        </html>
      `

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(mockRedis.set).toHaveBeenCalled()
      const setCalls = (mockRedis.set as ReturnType<typeof vi.fn>).mock.calls
      const cacheValue = JSON.parse(setCalls[0][1] as string)
      expect(cacheValue).toEqual(data.preview)
      expect(setCalls[0][3]).toBe(24 * 60 * 60) // TTL for successful fetch
    })

    it('should cache null previews with shorter TTL', async () => {
      mockRedis.get.mockResolvedValue(null)

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response('Not Found', { status: 404 }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      await response.json()

      expect(mockRedis.set).toHaveBeenCalled()
      const setCalls = (mockRedis.set as ReturnType<typeof vi.fn>).mock.calls
      expect(setCalls[0][3]).toBe(60 * 60) // TTL for failed fetch
    })

    it('should handle redis cache read failures gracefully', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection failed'))

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <meta property="og:image" content="https://example.com/image.jpg" />
          </head>
        </html>
      `

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview).toBeTruthy()
    })

    it('should handle redis cache write failures gracefully', async () => {
      mockRedis.get.mockResolvedValue(null)
      mockRedis.set.mockRejectedValue(new Error('Redis write failed'))

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <meta property="og:image" content="https://example.com/image.jpg" />
          </head>
        </html>
      `

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview).toBeTruthy()
    })

    it('should work when redis is not available', async () => {
      redisConfigMockFns.mockGetRedisClient.mockReturnValue(null)

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <meta property="og:image" content="https://example.com/image.jpg" />
          </head>
        </html>
      `

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview).toBeTruthy()
    })
  })

  describe('Fetch Failures', () => {
    it('should return null preview when fetch fails', async () => {
      mockRedis.get.mockResolvedValue(null)

      inputValidationMockFns.mockSecureFetchWithValidation.mockRejectedValue(
        new Error('Network error')
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview).toBeNull()
    })

    it('should return null preview for non-2xx status codes', async () => {
      mockRedis.get.mockResolvedValue(null)

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response('Not Found', { status: 404 }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview).toBeNull()
    })

    it('should return null preview for non-HTML content types', async () => {
      mockRedis.get.mockResolvedValue(null)

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response('{}' , {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview).toBeNull()
    })

    it('should return null preview when no metadata is found', async () => {
      mockRedis.get.mockResolvedValue(null)

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
          </head>
        </html>
      `

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview).toBeNull()
    })
  })

  describe('Complete Metadata Extraction', () => {
    it('should extract all metadata fields including imageUrl', async () => {
      mockRedis.get.mockResolvedValue(null)

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Fallback Title</title>
            <meta property="og:title" content="Open Graph Title" />
            <meta property="og:description" content="Open Graph Description" />
            <meta property="og:site_name" content="Example Site" />
            <meta property="og:image" content="https://example.com/og-image.jpg" />
          </head>
        </html>
      `

      inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValue(
        Object.assign(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }), { url: 'https://example.com' })
      )

      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/link-preview?url=https://example.com'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.preview).toEqual({
        title: 'Open Graph Title',
        description: 'Open Graph Description',
        siteName: 'Example Site',
        imageUrl: 'https://example.com/og-image.jpg',
      })
    })
  })
})
