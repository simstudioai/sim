/**
 * @vitest-environment node
 */
import { createHash } from 'node:crypto'
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockCreateAuthCode, mockEnforceUserRateLimit } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockCreateAuthCode: vi.fn(),
  mockEnforceUserRateLimit: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/cli-auth/code-store', () => ({
  createAuthCode: mockCreateAuthCode,
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  enforceUserRateLimit: mockEnforceUserRateLimit,
}))

import { POST } from '@/app/api/cli/auth/approve/route'

const CHALLENGE = createHash('sha256').update('a'.repeat(43)).digest('base64url')

describe('POST /api/cli/auth/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockEnforceUserRateLimit.mockResolvedValue(null)
    mockCreateAuthCode.mockResolvedValue('generated-code')
  })

  it('issues a code for the signed-in user', async () => {
    const response = await POST(createMockRequest('POST', { challenge: CHALLENGE }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ code: 'generated-code' })
    expect(mockCreateAuthCode).toHaveBeenCalledWith('user-1', CHALLENGE)
  })

  it('rejects an unauthenticated caller', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(createMockRequest('POST', { challenge: CHALLENGE }))

    expect(response.status).toBe(401)
    expect(mockCreateAuthCode).not.toHaveBeenCalled()
  })

  it('ignores a user id supplied in the body', async () => {
    await POST(createMockRequest('POST', { challenge: CHALLENGE, userId: 'attacker' }))

    expect(mockCreateAuthCode).toHaveBeenCalledWith('user-1', CHALLENGE)
  })

  it('rejects a malformed challenge', async () => {
    const response = await POST(createMockRequest('POST', { challenge: 'not-a-digest' }))

    expect(response.status).toBe(400)
    expect(mockCreateAuthCode).not.toHaveBeenCalled()
  })
})
