/**
 * Tests for the chat identifier availability endpoint.
 */
import { authMockFns, resetDbChainMock } from '@sim/testing'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnforceUserRateLimit } = vi.hoisted(() => ({
  mockEnforceUserRateLimit: vi.fn(),
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  enforceUserRateLimit: mockEnforceUserRateLimit,
}))

import { GET } from '@/app/api/chat/validate/route'

function request(identifier: string) {
  return new NextRequest(`http://localhost:3000/api/chat/validate?identifier=${identifier}`)
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
