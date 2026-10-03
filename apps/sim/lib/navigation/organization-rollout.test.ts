import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { billingAccessMock, billingAccessMockFns } from '@sim/testing/mocks/billing-access.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureFlagsConfig } from '@/lib/core/config/feature-flags'

const mocks = vi.hoisted(() => ({
  appConfig: vi.fn(),
  landing: vi.fn(),
  platformAdmin: vi.fn(),
}))

vi.mock('@/lib/core/config/appconfig', () => ({ fetchAppConfigProfile: mocks.appConfig }))
vi.mock('@/lib/permissions/super-user', () => ({ isPlatformAdmin: mocks.platformAdmin }))
vi.mock('@/lib/organizations/surface', () => ({ resolveOrganizationLanding: mocks.landing }))
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
vi.mock('@/lib/billing/core/access', () => billingAccessMock)

import {
  forgetKnowledgeAccessAvailability,
  requireOrganizationSearchAvailable,
} from '@/lib/knowledge/access/availability'
import { resolveAppEntryPath } from '@/lib/navigation/resolve-app-entry'

billingAccessMockFns.mockIsOrganizationBillingBlocked.mockResolvedValue(false)
billingSubscriptionMockFns.mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)
billingSubscriptionMockFns.mockGetOrganizationSubscriptionUsable.mockResolvedValue({
  plan: 'enterprise',
  status: 'active',
})

afterAll(resetEnvFlagsMock)

describe('organization rollout during impersonation', () => {
  beforeEach(() => {
    /** Each case answers the same organization differently; the memo must not carry one across. */
    forgetKnowledgeAccessAvailability()
    setEnvFlags({ isAppConfigEnabled: true, isHosted: true })
    mocks.landing.mockImplementation(async (userId: string) =>
      userId === 'platform-admin' ? 'admin-org' : 'customer-org'
    )
    mocks.platformAdmin.mockImplementation(async (userId: string) => userId === 'platform-admin')
  })

  it.each([
    { knowledge: false, groups: false },
    { knowledge: false, groups: true },
    { knowledge: true, groups: false },
    { knowledge: true, groups: true },
  ])('uses the customer organization for both gates: %j', async ({ knowledge, groups }) => {
    const flags: FeatureFlagsConfig = {
      'knowledge-member-access': {
        orgIds: ['admin-org', ...(knowledge ? ['customer-org'] : [])],
        userIds: ['platform-admin'],
        adminEnabled: true,
      },
      'credential-groups': {
        orgIds: ['admin-org', ...(groups ? ['customer-org'] : [])],
        userIds: ['platform-admin'],
        adminEnabled: true,
      },
    }
    mocks.appConfig.mockResolvedValue(flags)

    await expect(resolveAppEntryPath({ user: { id: 'platform-admin' } })).resolves.toBe(
      '/o/admin-org/home'
    )

    const impersonatedSession = {
      user: { id: 'customer-member' },
      session: { impersonatedBy: 'platform-admin', activeOrganizationId: 'customer-org' },
    }
    await expect(resolveAppEntryPath(impersonatedSession)).resolves.toBe(
      knowledge && groups ? '/o/customer-org/home' : '/workspace'
    )
    expect(mocks.landing).toHaveBeenLastCalledWith('customer-member', 'customer-org')
    expect(mocks.platformAdmin).not.toHaveBeenCalled()

    if (knowledge && groups) {
      await expect(requireOrganizationSearchAvailable('customer-org')).resolves.toBeUndefined()
    } else {
      await expect(requireOrganizationSearchAvailable('customer-org')).rejects.toMatchObject({
        code: 'forbidden',
      })
    }
  })
})
