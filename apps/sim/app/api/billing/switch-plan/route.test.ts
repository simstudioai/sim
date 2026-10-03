import { authMockFns, createMockRequest, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { billingAccessMock, billingAccessMockFns } from '@sim/testing/mocks/billing-access.mock'
import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import { billingOrganizationMock } from '@sim/testing/mocks/billing-organization.mock'
import { billingPlanMock } from '@sim/testing/mocks/billing-plan.mock'
import { billingSubscriptionMock } from '@sim/testing/mocks/billing-subscription.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCanManageWorkspaceBilling, mockGetWorkspaceHostContextForViewer } = vi.hoisted(() => ({
  mockCanManageWorkspaceBilling: vi.fn(),
  mockGetWorkspaceHostContextForViewer: vi.fn(),
}))

vi.mock('@/lib/billing/core/access', () => billingAccessMock)

vi.mock('@/lib/billing/core/billing', () => billingCoreMock)

vi.mock('@/lib/billing/core/organization', () => billingOrganizationMock)

vi.mock('@/lib/billing/core/plan', () => billingPlanMock)

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)

vi.mock('@/lib/billing/workspace-permissions', () => ({
  canManageWorkspaceBilling: mockCanManageWorkspaceBilling,
}))

vi.mock('@/lib/posthog/server', () => posthogServerMock)

vi.mock('@/lib/workspaces/host-context', () => ({
  getWorkspaceHostContextForViewer: mockGetWorkspaceHostContextForViewer,
}))

import { POST } from '@/app/api/billing/switch-plan/route'

const { mockGetOrganizationSubscription } = billingCoreMockFns

const { mockGetEffectiveBillingStatus } = billingAccessMockFns

const mockGetSession = authMockFns.mockGetSession

beforeAll(() => {
  setEnvFlags({ isBillingEnabled: true })
})

afterAll(resetEnvFlagsMock)

describe('POST /api/billing/switch-plan', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue({ user: { id: 'viewer-1' } })
    mockCanManageWorkspaceBilling.mockReturnValue(true)
    mockGetOrganizationSubscription.mockResolvedValue({
      id: 'subscription-1',
      referenceId: 'organization-1',
      plan: 'enterprise',
      status: 'active',
      stripeSubscriptionId: 'stripe-subscription-1',
    })
    mockGetWorkspaceHostContextForViewer.mockResolvedValue({
      workspace: {
        id: 'workspace-1',
        name: 'Workspace',
        workspaceMode: 'organization',
        billedAccountUserId: 'payer-1',
      },
      hostOrganizationId: 'organization-1',
      ownerBilling: {
        plan: 'enterprise',
        status: 'active',
        isPaid: true,
        isPro: false,
        isTeam: false,
        isEnterprise: true,
        isOrgScoped: true,
        organizationId: 'organization-1',
        billingInterval: 'month',
        billingBlocked: false,
        billingBlockedReason: null,
      },
      viewer: {
        permission: 'admin',
        isHostOrganizationMember: true,
        isHostOrganizationAdmin: true,
      },
    })
    mockGetEffectiveBillingStatus.mockResolvedValue({
      billingBlocked: true,
      billingBlockedReason: 'payment_failed',
      blockedByOrgOwner: true,
    })
  })

  it('uses only the routed workspace payer block state', async () => {
    const response = await POST(
      createMockRequest('POST', {
        targetPlanName: 'enterprise',
        workspaceId: 'workspace-1',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Enterprise plan changes must be handled via support',
    })
    expect(mockGetEffectiveBillingStatus).not.toHaveBeenCalled()
  })
})
