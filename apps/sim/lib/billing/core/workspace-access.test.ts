/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkspaceBilledAccountUserId, mockGetHighestPrioritySubscription } = vi.hoisted(
  () => ({
    mockGetWorkspaceBilledAccountUserId: vi.fn(),
    mockGetHighestPrioritySubscription: vi.fn(),
  })
)

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBilledAccountUserId: mockGetWorkspaceBilledAccountUserId,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'

describe('getWorkspaceOwnerSubscriptionAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue('owner-1')
  })

  it('reports paid + org-scoped for an org team plan billed to the owner', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({
      plan: 'team_25000',
      status: 'active',
      referenceId: 'org-1',
    })
    const access = await getWorkspaceOwnerSubscriptionAccess('ws-1')
    expect(access).toMatchObject({
      plan: 'team_25000',
      isPaid: true,
      isTeam: true,
      isPro: false,
      isEnterprise: false,
      isOrgScoped: true,
      organizationId: 'org-1',
    })
  })

  it('reports free when the billed account has no subscription', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
    const access = await getWorkspaceOwnerSubscriptionAccess('ws-1')
    expect(access).toMatchObject({ plan: 'free', isPaid: false, isOrgScoped: false })
  })

  it('reports free when the workspace has no billed account', async () => {
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue(null)
    const access = await getWorkspaceOwnerSubscriptionAccess('ws-1')
    expect(access.isPaid).toBe(false)
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })
})
