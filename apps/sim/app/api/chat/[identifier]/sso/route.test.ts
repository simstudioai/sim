/**
 * @vitest-environment node
 */
import { queueTableRows, requestUtilsMockFns, resetDbChainMock, schemaMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEmailAllowed, mockCheckRateLimitDirect } = vi.hoisted(() => ({
  mockIsEmailAllowed: vi.fn(),
  mockCheckRateLimitDirect: vi.fn(),
}))

vi.mock('@/lib/core/security/deployment', () => ({ isEmailAllowed: mockIsEmailAllowed }))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mockCheckRateLimitDirect
  },
}))

import { POST } from '@/app/api/chat/[identifier]/sso/route'

const deployment = {
  id: 'chat-1',
  authType: 'sso',
  allowedEmails: ['@acme.com'],
  isActive: true,
}

function post(email: string): NextRequest {
  return new NextRequest('http://localhost/api/chat/support/sso', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
}

const context = { params: Promise.resolve({ identifier: 'support' }) }

describe('POST /api/chat/[identifier]/sso', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('returns 429 when the chat-resource limit is exceeded', async () => {
    mockCheckRateLimitDirect
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, retryAfterMs: 3000 })

    const response = await POST(post('user@acme.com'), context)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('3')
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
