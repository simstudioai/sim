/**
 * Tests for copilot api-keys API route
 */
import { authMockFns, resetEnvMock, setEnv } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockGetMothershipBaseURL } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockGetMothershipBaseURL: vi.fn(),
}))

vi.mock('@/lib/mothership/constants', () => ({
  SIM_AGENT_API_URL_DEFAULT: 'https://agent.sim.example.com',
  SIM_AGENT_API_URL: 'https://agent.sim.example.com',
  COPILOT_MODES: ['ask', 'build', 'plan'] as const,
  COPILOT_REQUEST_MODES: ['ask', 'build', 'plan', 'agent'] as const,
}))

vi.mock('@/lib/mothership/server/agent-url', () => ({
  getMothershipBaseURL: mockGetMothershipBaseURL,
}))

import { GET } from '@/app/api/copilot/api-keys/route'

// `fetchGo` reads `response.status` and `response.headers.get('content-length')`
// to stamp span attributes, so mock responses need both fields or the call
// path throws before the route handler sees the body.
function buildMockResponse(init: {
  ok: boolean
  status?: number
  json: () => Promise<unknown>
}): Record<string, unknown> {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    headers: new Headers(),
    json: init.json,
  }
}

describe('Copilot API Keys API Route', () => {
  beforeEach(() => {
    setEnv({ COPILOT_API_KEY: 'test-api-key' })
    mockGetMothershipBaseURL.mockResolvedValue('https://agent.sim.example.com')
    global.fetch = mockFetch
  })

  afterAll(() => {
    resetEnvMock()
  })

  describe('GET', () => {
    it('should return list of API keys with masked values', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

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

      mockFetch.mockResolvedValueOnce(
        buildMockResponse({
          ok: true,
          json: () => Promise.resolve(mockApiKeys),
        })
      )

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
  })
})
