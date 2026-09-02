/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReadProfile } = vi.hoisted(() => ({
  mockReadProfile: vi.fn(),
}))

vi.mock('@/lib/users/application/read-current-user', () => ({
  getCurrentUserProfileUseCase: {
    operation: { id: 'users.account.profile.read', principalKinds: ['session'] },
    execute: mockReadProfile,
  },
}))

import { GET } from '@/app/api/users/me/profile/route'

describe('GET /api/users/me/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mockReadProfile.mockResolvedValue({
      id: 'user-1',
      name: 'User',
      email: 'user@example.com',
      image: null,
    })
  })

  it('reads the authenticated account through the semantic use case', async () => {
    const response = await GET(createMockRequest('GET'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      user: {
        id: 'user-1',
        name: 'User',
        email: 'user@example.com',
        image: null,
      },
    })
    expect(mockReadProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: {
          kind: 'session',
          userId: 'user-1',
          sessionId: 'session-1',
        },
        input: {},
      })
    )
  })

  it('rejects an unauthenticated request before the use case runs', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await GET(createMockRequest('GET'))

    expect(response.status).toBe(401)
    expect(mockReadProfile).not.toHaveBeenCalled()
  })
})
