import { authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckWorkspaceAccess, mockIsPlatformAdmin, mockGetBlockVisibility } = vi.hoisted(
  () => ({
    mockCheckWorkspaceAccess: vi.fn(),
    mockIsPlatformAdmin: vi.fn(),
    mockGetBlockVisibility: vi.fn(),
  })
)

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/permissions/super-user', () => ({
  isPlatformAdmin: mockIsPlatformAdmin,
}))

vi.mock('@/lib/core/config/block-visibility', () => ({
  getBlockVisibility: mockGetBlockVisibility,
}))

import { GET } from '@/app/api/blocks/visibility/route'

const mockGetSession = authMockFns.mockGetSession

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'

function request(workspaceId = WORKSPACE_ID) {
  return new NextRequest(`http://localhost/api/blocks/visibility?workspaceId=${workspaceId}`)
}

describe('GET /api/blocks/visibility', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockCheckWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      workspace: { organizationId: 'org-1' },
    })
  })

  it('returns 403 without workspace access', async () => {
    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: false, workspace: null })
    const response = await GET(request())
    expect(response.status).toBe(403)
    expect(mockGetBlockVisibility).not.toHaveBeenCalled()
  })
})
