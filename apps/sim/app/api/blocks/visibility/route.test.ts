/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockCheckWorkspaceAccess, mockIsPlatformAdmin, mockGetBlockVisibility } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockCheckWorkspaceAccess: vi.fn(),
    mockIsPlatformAdmin: vi.fn(),
    mockGetBlockVisibility: vi.fn(),
  }))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

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

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'

function request(workspaceId = WORKSPACE_ID) {
  return new NextRequest(`http://localhost/api/blocks/visibility?workspaceId=${workspaceId}`)
}

describe('GET /api/blocks/visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockCheckWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      workspace: { organizationId: 'org-1' },
    })
    mockIsPlatformAdmin.mockResolvedValue(false)
    mockGetBlockVisibility.mockResolvedValue({
      revealed: new Set(['gmail_v2']),
      disabled: new Set(['slack']),
      previewTagged: new Set(['gmail_v2']),
    })
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)
    const response = await GET(request())
    expect(response.status).toBe(401)
  })

  it('returns 403 without workspace access', async () => {
    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: false, workspace: null })
    const response = await GET(request())
    expect(response.status).toBe(403)
    expect(mockGetBlockVisibility).not.toHaveBeenCalled()
  })

  it('evaluates visibility for the session user, workspace org, and pre-resolved admin', async () => {
    mockIsPlatformAdmin.mockResolvedValue(true)
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      revealed: ['gmail_v2'],
      disabled: ['slack'],
      previewTagged: ['gmail_v2'],
    })
    expect(mockGetBlockVisibility).toHaveBeenCalledWith({
      userId: 'user-1',
      orgId: 'org-1',
      isAdmin: true,
    })
  })
})
