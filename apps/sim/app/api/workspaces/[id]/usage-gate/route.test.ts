/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckWorkspaceUsageGate, mockGetWorkspaceHostContextForViewer } = vi.hoisted(() => ({
  mockCheckWorkspaceUsageGate: vi.fn(),
  mockGetWorkspaceHostContextForViewer: vi.fn(),
}))

vi.mock('@/lib/billing/core/workspace-usage-gate', () => ({
  checkWorkspaceUsageGate: mockCheckWorkspaceUsageGate,
}))

vi.mock('@/lib/workspaces/host-context', () => ({
  getWorkspaceHostContextForViewer: mockGetWorkspaceHostContextForViewer,
}))

import { GET } from '@/app/api/workspaces/[id]/usage-gate/route'

const mockGetSession = authMockFns.mockGetSession

const HOST_CONTEXT = {
  workspace: {
    id: 'workspace-b',
    name: 'Workspace B',
    workspaceMode: 'organization',
    billedAccountUserId: 'owner-b',
  },
  hostOrganizationId: 'org-b',
  ownerBilling: {
    plan: 'team_25000',
    status: 'active',
    isPaid: true,
    isPro: false,
    isTeam: true,
    isEnterprise: false,
    isOrgScoped: true,
    organizationId: 'org-b',
    billingInterval: 'month',
    billingBlocked: false,
    billingBlockedReason: null,
  },
  viewer: {
    permission: 'write',
    isHostOrganizationMember: false,
    isHostOrganizationAdmin: false,
  },
}

async function callGet() {
  const response = await GET(createMockRequest('GET'), {
    params: Promise.resolve({ id: 'workspace-b' }),
  })
  return { status: response.status, body: await response.json() }
}

describe('GET /api/workspaces/[id]/usage-gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({
      user: { id: 'external-a' },
      session: { activeOrganizationId: 'org-a' },
    })
    mockGetWorkspaceHostContextForViewer.mockResolvedValue(HOST_CONTEXT)
    mockCheckWorkspaceUsageGate.mockResolvedValue({
      isExceeded: false,
      message: null,
      scope: null,
    })
  })

  it('authenticates before resolving workspace or billing context', async () => {
    mockGetSession.mockResolvedValue(null)

    const { status, body } = await callGet()

    expect(status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(mockGetWorkspaceHostContextForViewer).not.toHaveBeenCalled()
    expect(mockCheckWorkspaceUsageGate).not.toHaveBeenCalled()
  })

  it('uses workspace B payer and external actor A without consulting active organization A', async () => {
    mockCheckWorkspaceUsageGate.mockResolvedValue({
      isExceeded: true,
      message: 'Member credit limit exceeded.',
      scope: 'member',
    })

    const { status, body } = await callGet()

    expect(status).toBe(200)
    expect(body).toEqual({
      isExceeded: true,
      message: 'Member credit limit exceeded.',
      scope: 'member',
    })
    expect(mockGetWorkspaceHostContextForViewer).toHaveBeenCalledWith('workspace-b', 'external-a')
    expect(mockCheckWorkspaceUsageGate).toHaveBeenCalledWith({
      actorUserId: 'external-a',
      workspaceId: 'workspace-b',
    })
  })

  it('returns 403 before checking usage when workspace access is denied', async () => {
    mockGetWorkspaceHostContextForViewer.mockResolvedValue(null)

    const { status, body } = await callGet()

    expect(status).toBe(403)
    expect(body).toEqual({ error: 'Workspace access denied' })
    expect(mockCheckWorkspaceUsageGate).not.toHaveBeenCalled()
  })
})
