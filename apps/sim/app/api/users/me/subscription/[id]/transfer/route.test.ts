import {
  authMockFns,
  createMockRequest,
  createSession,
  dbChainMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import {
  billingPlanHelpersMock,
  billingPlanHelpersMockFns,
} from '@sim/testing/mocks/billing-plan-helpers.mock'
import {
  billingSubscriptionUtilsMock,
  billingSubscriptionUtilsMockFns,
} from '@sim/testing/mocks/billing-subscription-utils.mock'
import { organizationMembershipMock } from '@sim/testing/mocks/organization-membership.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAssertNoUnresolvedEnterpriseIssuance = vi.hoisted(() => vi.fn())

vi.mock('@/lib/billing/enterprise-outbox', () => {
  class EnterpriseIssuanceInProgressError extends Error {}
  return {
    EnterpriseIssuanceInProgressError,
    assertNoUnresolvedEnterpriseIssuance: mockAssertNoUnresolvedEnterpriseIssuance,
  }
})

vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)

vi.mock('@/lib/billing/plan-helpers', () => billingPlanHelpersMock)

vi.mock('@/lib/billing/subscriptions/utils', () => billingSubscriptionUtilsMock)

import { POST } from '@/app/api/users/me/subscription/[id]/transfer/route'

billingSubscriptionUtilsMockFns.mockHasPaidSubscriptionStatus.mockImplementation(
  (status) => status === 'active' || status === 'past_due'
)

billingPlanHelpersMockFns.mockIsOrgPlan.mockImplementation(
  (plan) => plan === 'team' || plan === 'enterprise'
)

function makeRequest(body: unknown, id = 'sub-1') {
  return POST(
    createMockRequest(
      'POST',
      body,
      {},
      `http://localhost/api/users/me/subscription/${id}/transfer`
    ),
    createRouteContext({ id })
  )
}

describe('POST /api/users/me/subscription/[id]/transfer', () => {
  beforeEach(() => {
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue(
      createSession({
        userId: 'user-1',
        email: 'owner@example.com',
        name: 'Owner',
      })
    )
  })

  it('rejects transfers for non-organization subscriptions', async () => {
    dbChainMockFns.for.mockResolvedValueOnce([
      { id: 'sub-1', referenceId: 'user-1', plan: 'pro', status: 'active' },
    ])

    const response = await makeRequest({ organizationId: 'org-1' })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Only active Team or Enterprise subscriptions can be transferred to an organization.',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('rejects an entitlement transfer while Enterprise issuance is unresolved', async () => {
    const { EnterpriseIssuanceInProgressError } = await import('@/lib/billing/enterprise-outbox')
    dbChainMockFns.for
      .mockResolvedValueOnce([
        { id: 'sub-1', referenceId: 'user-1', plan: 'team', status: 'active' },
      ])
      .mockResolvedValueOnce([{ id: 'org-1' }])
    dbChainMockFns.limit.mockResolvedValueOnce([{ role: 'owner' }])
    mockAssertNoUnresolvedEnterpriseIssuance.mockRejectedValueOnce(
      new EnterpriseIssuanceInProgressError()
    )

    const response = await makeRequest({ organizationId: 'org-1' })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Organization has an unfinished Enterprise issuance',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('treats an already-transferred organization subscription as a successful no-op', async () => {
    dbChainMockFns.for
      .mockResolvedValueOnce([
        { id: 'sub-1', referenceId: 'org-1', plan: 'team', status: 'active' },
      ])
      .mockResolvedValueOnce([{ id: 'org-1' }])
    dbChainMockFns.limit.mockResolvedValueOnce([{ role: 'owner' }])

    const response = await makeRequest({ organizationId: 'org-1' })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: 'Subscription already belongs to this organization',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('rejects the noop probe when the requester is not a member of the target organization', async () => {
    dbChainMockFns.for
      .mockResolvedValueOnce([
        { id: 'sub-1', referenceId: 'org-1', plan: 'team', status: 'active' },
      ])
      .mockResolvedValueOnce([{ id: 'org-1' }])
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const response = await makeRequest({ organizationId: 'org-1' })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized - user is not admin of organization',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('rejects the transfer when the target organization already has an active subscription', async () => {
    dbChainMockFns.for
      .mockResolvedValueOnce([
        { id: 'sub-1', referenceId: 'user-1', plan: 'team', status: 'active' },
      ])
      .mockResolvedValueOnce([{ id: 'org-1' }])
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ role: 'owner' }])
      .mockResolvedValueOnce([{ id: 'existing-sub' }])

    const response = await makeRequest({ organizationId: 'org-1' })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Organization already has an active subscription',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
