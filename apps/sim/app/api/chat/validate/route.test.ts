/**
 * Tests for the chat identifier availability endpoint.
 */

import { authMockFns, resetDbChainMock } from '@sim/testing'
import { rateLimiterMock, rateLimiterMockFns } from '@sim/testing/mocks/rate-limiter.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)

import { GET } from '@/app/api/chat/validate/route'

const mockEnforceUserRateLimit = rateLimiterMockFns.mockEnforceUserRateLimit

function request(identifier: string) {
  return createMockRequest({
    url: `http://localhost:3000/api/chat/validate?identifier=${identifier}`,
  })
}

describe('chat identifier validation route', () => {
  beforeEach(() => {
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mockEnforceUserRateLimit.mockResolvedValue(null)
  })

  it('caps how far one caller can walk a dictionary', async () => {
    mockEnforceUserRateLimit.mockResolvedValue(NextResponse.json({}, { status: 429 }))

    const response = await GET(request('support'))

    expect(response.status).toBe(429)
    expect(mockEnforceUserRateLimit).toHaveBeenCalledWith(
      'chat-identifier-check',
      'user-1',
      expect.objectContaining({ maxTokens: 60, refillIntervalMs: 60_000 })
    )
  })
})
