/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkspaceHostContextForViewer } = vi.hoisted(() => ({
  mockGetWorkspaceHostContextForViewer: vi.fn(),
}))

vi.mock('@/lib/workspaces/host-context', () => ({
  getWorkspaceHostContextForViewer: mockGetWorkspaceHostContextForViewer,
}))

import { GET } from '@/app/api/workspaces/[id]/host-context/route'

const mockGetSession = authMockFns.mockGetSession

const HOST_CONTEXT = {
  workspace: {
    id: 'workspace-1',
    name: 'Workspace 1',
    workspaceMode: 'organization',
    billedAccountUserId: 'owner-1',
  },
  hostOrganizationId: 'org-host',
  ownerBilling: {
    plan: 'enterprise',
    status: 'active',
    isPaid: true,
    isPro: false,
    isTeam: false,
    isEnterprise: true,
    isOrgScoped: true,
    organizationId: 'org-host',
    billingInterval: 'month',
    billingBlocked: false,
    billingBlockedReason: null,
  },
  viewer: {
    permission: 'read',
    isHostOrganizationMember: false,
    isHostOrganizationAdmin: false,
  },
}

async function callGet() {
  const response = await GET(createMockRequest('GET'), {
    params: Promise.resolve({ id: 'workspace-1' }),
  })
  return { status: response.status, body: await response.json() }
}

describe('GET /api/workspaces/[id]/host-context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'viewer-1' } })
    mockGetWorkspaceHostContextForViewer.mockResolvedValue(HOST_CONTEXT)
  })

  it('authenticates before resolving workspace context', async () => {
    mockGetSession.mockResolvedValue(null)

    const { status, body } = await callGet()

    expect(status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(mockGetWorkspaceHostContextForViewer).not.toHaveBeenCalled()
  })

  it('returns 403 without leaking host context when access is denied', async () => {
    mockGetWorkspaceHostContextForViewer.mockResolvedValue(null)

    const { status, body } = await callGet()

    expect(status).toBe(403)
    expect(body).toEqual({ error: 'Workspace access denied' })
  })

  it('returns route-derived host context for an external collaborator', async () => {
    const { status, body } = await callGet()

    expect(status).toBe(200)
    expect(body).toEqual(HOST_CONTEXT)
    expect(mockGetWorkspaceHostContextForViewer).toHaveBeenCalledWith('workspace-1', 'viewer-1')
  })
})
