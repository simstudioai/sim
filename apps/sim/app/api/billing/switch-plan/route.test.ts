/**
 * @vitest-environment node
 */
import { createMockRequest, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCanManageWorkspaceBilling,
  mockGetEffectiveBillingStatus,
  mockGetOrganizationSubscription,
  mockGetSession,
  mockGetWorkspaceHostContextForViewer,
} = vi.hoisted(() => ({
  mockCanManageWorkspaceBilling: vi.fn(),
  mockGetEffectiveBillingStatus: vi.fn(),
  mockGetOrganizationSubscription: vi.fn(),
  mockGetSession: vi.fn(),
  mockGetWorkspaceHostContextForViewer: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing/core/access', () => ({
  getEffectiveBillingStatus: mockGetEffectiveBillingStatus,
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mockGetOrganizationSubscription,
}))

vi.mock('@/lib/billing/core/organization', () => ({
  isOrganizationOwnerOrAdmin: vi.fn(),
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPriorityPersonalSubscription: vi.fn(),
  getHighestPrioritySubscription: vi.fn(),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  writeBillingInterval: vi.fn(),
}))

vi.mock('@/lib/billing/workspace-permissions', () => ({
  canManageWorkspaceBilling: mockCanManageWorkspaceBilling,
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

vi.mock('@/lib/workspaces/host-context', () => ({
  getWorkspaceHostContextForViewer: mockGetWorkspaceHostContextForViewer,
}))

import { POST } from '@/app/api/billing/switch-plan/route'

beforeAll(() => {
  setEnvFlags({ isBillingEnabled: true })
})

afterAll(resetEnvFlagsMock)

describe('POST /api/billing/switch-plan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
