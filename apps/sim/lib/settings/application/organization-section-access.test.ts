/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ canOpen: vi.fn(), enterprise: vi.fn() }))
vi.mock('@/lib/organizations/settings-access', () => ({
  canOpenOrganizationSettingsSection: mocks.canOpen,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mocks.enterprise,
}))

import { authorizeOrganizationSettingsSection } from '@/lib/settings/application/organization-section-access'

describe('organization settings authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isHosted: true, isBillingEnabled: true })
    mocks.canOpen.mockResolvedValue(true)
    mocks.enterprise.mockResolvedValue(true)
  })
  afterEach(resetEnvFlagsMock)

  it('checks current target organization membership before billing reads', async () => {
    mocks.canOpen.mockResolvedValue(false)
    expect(
      await authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'viewer',
        section: 'sso',
      })
    ).toBe(false)
    expect(mocks.canOpen).toHaveBeenCalledWith('target', 'viewer', 'sso')
    expect(mocks.enterprise).not.toHaveBeenCalled()
  })

  it('does not require a plan or workspace for the member roster', async () => {
    expect(
      await authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'viewer',
        section: 'members',
      })
    ).toBe(true)
    expect(mocks.enterprise).not.toHaveBeenCalled()
  })

  it('applies enterprise entitlement only after role authorization', async () => {
    mocks.enterprise.mockResolvedValue(false)
    expect(
      await authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'admin',
        section: 'sso',
      })
    ).toBe(false)
  })

  it('does not turn authorization infrastructure failures into empty settings', async () => {
    mocks.canOpen.mockRejectedValue(new Error('Membership database unavailable'))
    await expect(
      authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'viewer',
        section: 'members',
      })
    ).rejects.toThrow('Membership database unavailable')
  })
})
