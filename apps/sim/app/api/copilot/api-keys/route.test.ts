/**
 * Tests for copilot api-keys API route
 *
 * @vitest-environment node
 */
import { mockAuth, mockCryptoUuid, setupCommonApiMocks } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Copilot API Keys API Route', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()
    mockCryptoUuid()

    global.fetch = mockFetch

    vi.doMock('@/lib/copilot/constants', () => ({
      SIM_AGENT_API_URL_DEFAULT: 'https://agent.sim.example.com',
    }))

    vi.doMock('@/lib/core/config/env', async () => {
      const { createEnvMock } = await import('@sim/testing')
      return createEnvMock({
        SIM_AGENT_API_URL: undefined,
        COPILOT_API_KEY: 'test-api-key',
      })
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe('GET', () => {
    it('should return 401 when user is not authenticated', async () => {
      const authMocks = mockAuth()
      authMocks.setUnauthenticated()

      const { GET } = await import('@/app/api/copilot/api-keys/route')
      const request = new NextRequest('http://localhost:3000/api/copilot/api-keys')
      const response = await GET(request)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return list of API keys with masked values', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const mockApiKeys = [
        {
          id: 'key-1',
          apiKey: 'sk-sim-abcdefghijklmnopqrstuv',
          name: 'Production Key',
          createdAt: '2024-01-01T00:00:00.000Z',
          lastUsed: '2024-01-15T00:00:00.000Z',
        },
        {
          id: 'key-2',
          apiKey: 'sk-sim-zyxwvutsrqponmlkjihgfe',
          name: null,
          createdAt: '2024-01-02T00:00:00.000Z',
          lastUsed: null,
        },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockApiKeys),
      })

      const { GET } = await import('@/app/api/copilot/api-keys/route')
      const request = new NextRequest('http://localhost:3000/api/copilot/api-keys')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.keys).toHaveLength(2)
      expect(responseData.keys[0].id).toBe('key-1')
      expect(responseData.keys[0].displayKey).toBe('•••••qrstuv')
      expect(responseData.keys[0].name).toBe('Production Key')
      expect(responseData.keys[1].displayKey).toBe('•••••jihgfe')
      expect(responseData.keys[1].name).toBeNull()
    })

    it('should return empty array when user has no API keys', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })

      const { GET } = await import('@/app/api/copilot/api-keys/route')
      const request = new NextRequest('http://localhost:3000/api/copilot/api-keys')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.keys).toEqual([])
    })

    it('should forward userId to Sim Agent', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })

      const { GET } = await import('@/app/api/copilot/api-keys/route')
      const request = new NextRequest('http://localhost:3000/api/copilot/api-keys')
      await GET(request)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://agent.sim.example.com/api/validate-key/get-api-keys',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-api-key': 'test-api-key',
          }),
          body: JSON.stringify({ userId: 'user-123' }),
        })
      )
    })

    it('should return error when Sim Agent returns non-ok response', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: 'Service unavailable' }),
      })

      const { GET } = await import('@/app/api/copilot/api-keys/route')
      const request = new NextRequest('http://localhost:3000/api/copilot/api-keys')
      const response = await GET(request)

      expect(response.status).toBe(503)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Failed to get keys' })
    })

    it('should return 500 when Sim Agent returns invalid response', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ invalid: 'response' }),
      })

      const { GET } = await import('@/app/api/copilot/api-keys/route')
      const request = new NextRequest('http://localhost:3000/api/copilot/api-keys')
      const response = await GET(request)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Invalid response from Sim Agent' })
    })

    it('should handle network errors gracefully', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { GET } = await import('@/app/api/copilot/api-keys/route')
      const request = new NextRequest('http://localhost:3000/api/copilot/api-keys')
      const response = await GET(request)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Failed to get keys' })
    })

    it('should handle API keys with empty apiKey string', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const mockApiKeys = [
        {
          id: 'key-1',
          apiKey: '',
          name: 'Empty Key',
          createdAt: '2024-01-01T00:00:00.000Z',
          lastUsed: null,
        },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockApiKeys),
      })

      const { GET } = await import('@/app/api/copilot/api-keys/route')
      const request = new NextRequest('http://localhost:3000/api/copilot/api-keys')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.keys[0].displayKey).toBe('•••••')
    })

    it('should handle JSON parsing errors from Sim Agent', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      })

      const { GET } = await import('@/app/api/copilot/api-keys/route')
      const request = new NextRequest('http://localhost:3000/api/copilot/api-keys')
      const response = await GET(request)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Invalid response from Sim Agent' })
    })
  })

  describe('DELETE', () => {
    it('should return 401 when user is not authenticated', async () => {
      const authMocks = mockAuth()
      authMocks.setUnauthenticated()

      const { DELETE } = await import('@/app/api/copilot/api-keys/route')
      const request = new NextRequest('http://localhost:3000/api/copilot/api-keys?id=key-123')
      const response = await DELETE(request)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return 400 when id parameter is missing', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const { DELETE } = await import('@/app/api/copilot/api-keys/route')
      const request = new NextRequest('http://localhost:3000/api/copilot/api-keys')
      const response = await DELETE(request)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'id is required' })
    })

    it('should successfully delete an API key', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const { DELETE } = await import('@/app/api/copilot/api-keys/route')
      const request = new NextRequest('http://localhost:3000/api/copilot/api-keys?id=key-123')
      const response = await DELETE(request)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: true })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://agent.sim.example.com/api/validate-key/delete',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-api-key': 'test-api-key',
          }),
          body: JSON.stringify({ userId: 'user-123', apiKeyId: 'key-123' }),
        })
      )
    })

    it('should return error when Sim Agent returns non-ok response', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Key not found' }),
      })

      const { DELETE } = await import('@/app/api/copilot/api-keys/route')
      const request = new NextRequest('http://localhost:3000/api/copilot/api-keys?id=non-existent')
      const response = await DELETE(request)

      expect(response.status).toBe(404)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Failed to delete key' })
    })

    it('should return 500 when Sim Agent returns invalid response', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: false }),
      })

      const { DELETE } = await import('@/app/api/copilot/api-keys/route')
      const request = new NextRequest('http://localhost:3000/api/copilot/api-keys?id=key-123')
      const response = await DELETE(request)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Invalid response from Sim Agent' })
    })

    it('should handle network errors gracefully', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { DELETE } = await import('@/app/api/copilot/api-keys/route')
      const request = new NextRequest('http://localhost:3000/api/copilot/api-keys?id=key-123')
      const response = await DELETE(request)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Failed to delete key' })
    })

    it('should handle JSON parsing errors from Sim Agent on delete', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      })

      const { DELETE } = await import('@/app/api/copilot/api-keys/route')
      const request = new NextRequest('http://localhost:3000/api/copilot/api-keys?id=key-123')
      const response = await DELETE(request)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Invalid response from Sim Agent' })
    })
  })
})
