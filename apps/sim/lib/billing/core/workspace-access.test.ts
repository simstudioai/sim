import { billingAccessMock, billingAccessMockFns } from '@sim/testing/mocks/billing-access.mock'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import { billingSubscriptionMock } from '@sim/testing/mocks/billing-subscription.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/core/access', () => billingAccessMock)

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)

import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'

const mockGetBillingEntityBlockStatus = billingAccessMockFns.mockGetBillingEntityBlockStatus
const mockResolveWorkspaceBillingPayer = billingAttributionMockFns.mockResolveWorkspaceBillingPayer

describe('getWorkspaceOwnerSubscriptionAccess', () => {
  beforeEach(() => {
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
})
