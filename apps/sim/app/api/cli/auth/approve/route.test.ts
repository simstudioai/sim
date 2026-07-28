/**
 * @vitest-environment node
 */
import { createHash } from 'node:crypto'
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockCreateApproval, mockEnforceUserRateLimit } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockCreateApproval: vi.fn(),
  mockEnforceUserRateLimit: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/cli-auth/approval-store', () => ({
  createApproval: mockCreateApproval,
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  enforceUserRateLimit: mockEnforceUserRateLimit,
}))

import { POST } from '@/app/api/cli/auth/approve/route'

const REQUEST = 'a'.repeat(43)
const CHALLENGE = createHash('sha256').update('b'.repeat(43)).digest('base64url')

describe('POST /api/cli/auth/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockEnforceUserRateLimit.mockResolvedValue(null)
    mockCreateApproval.mockResolvedValue(undefined)
  })

  it('records the approval for the signed-in user', async () => {
    const response = await POST(
      createMockRequest('POST', { request: REQUEST, challenge: CHALLENGE })
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mockCreateApproval).toHaveBeenCalledWith('user-1', REQUEST, CHALLENGE)
  })

  it('rejects an unauthenticated caller', async () => {
    mockGetSession.mockResolvedValue(null)
    const response = await POST(
      createMockRequest('POST', { request: REQUEST, challenge: CHALLENGE })
    )
    expect(response.status).toBe(401)
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })

  it('ignores a user id supplied in the body', async () => {
    await POST(
      createMockRequest('POST', { request: REQUEST, challenge: CHALLENGE, userId: 'attacker' })
    )
    expect(mockCreateApproval).toHaveBeenCalledWith('user-1', REQUEST, CHALLENGE)
  })

  it('rejects a malformed challenge', async () => {
    const response = await POST(
      createMockRequest('POST', { request: REQUEST, challenge: 'not-a-digest' })
    )
    expect(response.status).toBe(400)
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })
})
