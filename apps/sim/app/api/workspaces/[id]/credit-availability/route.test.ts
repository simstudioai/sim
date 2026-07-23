/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkspaceCreditAvailability, mockGetWorkspaceHostContextForViewer } = vi.hoisted(
  () => ({
    mockGetWorkspaceCreditAvailability: vi.fn(),
    mockGetWorkspaceHostContextForViewer: vi.fn(),
  })
)

vi.mock('@/lib/billing/core/workspace-usage-gate', () => ({
  getWorkspaceCreditAvailability: mockGetWorkspaceCreditAvailability,
}))

vi.mock('@/lib/workspaces/host-context', () => ({
  getWorkspaceHostContextForViewer: mockGetWorkspaceHostContextForViewer,
}))

import { GET } from '@/app/api/workspaces/[id]/credit-availability/route'

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

describe('GET /api/workspaces/[id]/credit-availability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'external-a' } })
    mockGetWorkspaceHostContextForViewer.mockResolvedValue(HOST_CONTEXT)
    mockGetWorkspaceCreditAvailability.mockResolvedValue({
      remainingDollars: 20,
      scope: 'member',
    })
  })

  it('authenticates before resolving workspace or billing context', async () => {
    mockGetSession.mockResolvedValue(null)

    const { status } = await callGet()

    expect(status).toBe(401)
    expect(mockGetWorkspaceHostContextForViewer).not.toHaveBeenCalled()
    expect(mockGetWorkspaceCreditAvailability).not.toHaveBeenCalled()
  })

  it('uses workspace B payer for an external actor without exposing the host pool', async () => {
    const { status, body } = await callGet()

    expect(status).toBe(200)
    expect(body).toEqual({ remainingDollars: 20, scope: 'member' })
    expect(mockGetWorkspaceCreditAvailability).toHaveBeenCalledWith({
      actorUserId: 'external-a',
      workspaceId: 'workspace-b',
      canViewPayerPool: false,
    })
  })

  it('allows a target-organization admin to view the host pool availability', async () => {
    mockGetWorkspaceHostContextForViewer.mockResolvedValue({
      ...HOST_CONTEXT,
      viewer: {
        ...HOST_CONTEXT.viewer,
        isHostOrganizationMember: true,
        isHostOrganizationAdmin: true,
      },
    })

    await callGet()

    expect(mockGetWorkspaceCreditAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ canViewPayerPool: true })
    )
  })
})
