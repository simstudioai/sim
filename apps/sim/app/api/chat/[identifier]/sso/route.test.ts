import { queueTableRows, requestUtilsMockFns, resetDbChainMock, schemaMock } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { rateLimiterMock, rateLimiterMockFns } from '@sim/testing/mocks/rate-limiter.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEmailAllowed } = vi.hoisted(() => ({
  mockIsEmailAllowed: vi.fn(),
}))

vi.mock('@/lib/core/security/deployment', () => ({ isEmailAllowed: mockIsEmailAllowed }))
vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)

import { POST } from '@/app/api/chat/[identifier]/sso/route'

const mockCheckRateLimitDirect = rateLimiterMockFns.mockCheckRateLimitDirect

const deployment = {
  id: 'chat-1',
  authType: 'sso',
  allowedEmails: ['@acme.com'],
  isActive: true,
}

function post(email: string): NextRequest {
  return createMockRequest({
    method: 'POST',
    url: 'http://localhost/api/chat/support/sso',
    body: { email },
  })
}

const context = createRouteContext({ identifier: 'support' })

describe('POST /api/chat/[identifier]/sso', () => {
  beforeEach(() => {
    resetDbChainMock()
    queueTableRows(schemaMock.chat, [deployment])
    requestUtilsMockFns.mockGetClientIp.mockReturnValue('127.0.0.1')
    mockCheckRateLimitDirect.mockResolvedValue({ allowed: true })
    mockIsEmailAllowed.mockReturnValue(true)
  })

  it('applies both client-IP and chat-resource limits', async () => {
    const response = await POST(post('user@acme.com'), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ eligible: true })
    expect(mockCheckRateLimitDirect).toHaveBeenNthCalledWith(
      1,
      'chat-sso:ip:127.0.0.1',
      expect.objectContaining({ maxTokens: 20 }),
      { failClosed: true }
    )
    expect(mockCheckRateLimitDirect).toHaveBeenNthCalledWith(
      2,
      'chat-sso:resource:chat-1',
      expect.objectContaining({ maxTokens: 100 }),
      { failClosed: true }
    )
  })

  it('retains the chat-resource limit when the client IP cannot be resolved', async () => {
    requestUtilsMockFns.mockGetClientIp.mockReturnValueOnce(null)

    const response = await POST(post('user@acme.com'), context)

    expect(response.status).toBe(200)
    expect(mockCheckRateLimitDirect).toHaveBeenCalledTimes(1)
    expect(mockCheckRateLimitDirect).toHaveBeenCalledWith(
      'chat-sso:resource:chat-1',
      expect.objectContaining({ maxTokens: 100 }),
      { failClosed: true }
    )
  })
})
