/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetBillingEntityBlockStatus, mockResolveWorkspaceBillingPayer } = vi.hoisted(() => ({
  mockGetBillingEntityBlockStatus: vi.fn(),
  mockResolveWorkspaceBillingPayer: vi.fn(),
}))

vi.mock('@/lib/billing/core/access', () => ({
  getBillingEntityBlockStatus: mockGetBillingEntityBlockStatus,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveWorkspaceBillingPayer: mockResolveWorkspaceBillingPayer,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  resolveBillingInterval: (subscription?: { billingInterval?: string | null }) =>
    subscription?.billingInterval === 'year' ? 'year' : 'month',
}))

import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'

describe('getWorkspaceOwnerSubscriptionAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBillingEntityBlockStatus.mockResolvedValue({
      billingBlocked: false,
      billingBlockedReason: null,
    })
  })

  it('reports the exact workspace organization plan', async () => {
    mockResolveWorkspaceBillingPayer.mockResolvedValue({
      billedAccountUserId: 'owner-1',
      organizationId: 'org-1',
      payerSubscription: {
        plan: 'team_25000',
        status: 'active',
        referenceId: 'org-1',
        billingInterval: 'year',
      },
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
      billingInterval: 'year',
      billingBlocked: false,
    })
  })

  it('removes usable plan flags when the exact workspace payer is blocked', async () => {
    mockResolveWorkspaceBillingPayer.mockResolvedValue({
      billedAccountUserId: 'owner-1',
      organizationId: 'org-1',
      payerSubscription: {
        plan: 'enterprise',
        status: 'active',
        referenceId: 'org-1',
        billingInterval: 'month',
      },
    })
    mockGetBillingEntityBlockStatus.mockResolvedValue({
      billingBlocked: true,
      billingBlockedReason: 'payment_failed',
    })

    const access = await getWorkspaceOwnerSubscriptionAccess('ws-1')

    expect(mockGetBillingEntityBlockStatus).toHaveBeenCalledWith({
      type: 'organization',
      id: 'org-1',
    })
    expect(access).toMatchObject({
      plan: 'enterprise',
      isPaid: false,
      isEnterprise: false,
      billingBlocked: true,
      billingBlockedReason: 'payment_failed',
    })
  })

  it('reports free when the billed account has no subscription', async () => {
    mockResolveWorkspaceBillingPayer.mockResolvedValue({
      billedAccountUserId: 'owner-1',
      organizationId: null,
      payerSubscription: null,
    })
    const access = await getWorkspaceOwnerSubscriptionAccess('ws-1')
    expect(access).toMatchObject({ plan: 'free', isPaid: false, isOrgScoped: false })
    expect(mockGetBillingEntityBlockStatus).toHaveBeenCalledWith({
      type: 'user',
      id: 'owner-1',
    })
  })

  it('reports free when the workspace has no billed account', async () => {
    mockResolveWorkspaceBillingPayer.mockResolvedValue(null)
    const access = await getWorkspaceOwnerSubscriptionAccess('ws-1')
    expect(access.isPaid).toBe(false)
    expect(mockGetBillingEntityBlockStatus).not.toHaveBeenCalled()
    expect(mockResolveWorkspaceBillingPayer).toHaveBeenCalledWith('ws-1', {
      onMissing: 'return-null',
    })
  })
})
