import { createMockRequest } from '@sim/testing'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { featureFlagsMock } from '@sim/testing/mocks/feature-flags.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

import { GET } from '@/app/api/projects/route'

describe('GET /api/projects with the projects flag off', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Member', email: 'member@example.com' },
      session: { id: 'session-1', token: 'token-1' },
    })
  })

  it('answers as a disabled feature, not as a server fault', async () => {
    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/projects?limit=10')
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'Projects are not enabled' })
    expect(getMockLogger('RouteHandler').error).not.toHaveBeenCalled()
  })
})
