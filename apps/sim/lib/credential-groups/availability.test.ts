import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveCredentialGroupsAvailability } from '@/lib/credential-groups/availability'

afterEach(resetEnvFlagsMock)

describe('resolveCredentialGroupsAvailability', () => {
  it('does not expose organization accounts in a personal workspace', async () => {
    setEnvFlags({ isHosted: true })
    await expect(
      resolveCredentialGroupsAvailability({
        organizationId: null,
        ownerBilling: { isEnterprise: true },
      })
    ).resolves.toEqual({ available: false, reason: 'feature_disabled' })
  })

  it('requires Enterprise on Sim Cloud', async () => {
    setEnvFlags({ isHosted: true })
    await expect(
      resolveCredentialGroupsAvailability({
        organizationId: 'org-1',
        ownerBilling: { isEnterprise: false },
      })
    ).resolves.toEqual({ available: false, reason: 'enterprise_plan_required' })
    await expect(
      resolveCredentialGroupsAvailability({
        organizationId: 'org-1',
        ownerBilling: { isEnterprise: true },
      })
    ).resolves.toEqual({ available: true })
  })

  it('stays off on self-hosted until the entitlement is enabled', async () => {
    setEnvFlags({ isHosted: false, isCredentialGroupsEnabled: false })
    await expect(
      resolveCredentialGroupsAvailability({
        organizationId: 'org-1',
        ownerBilling: { isEnterprise: true },
      })
    ).resolves.toEqual({ available: false, reason: 'feature_disabled' })

    setEnvFlags({ isHosted: false, isCredentialGroupsEnabled: true })
    await expect(
      resolveCredentialGroupsAvailability({
        organizationId: 'org-1',
        ownerBilling: { isEnterprise: false },
      })
    ).resolves.toEqual({ available: true })
  })
})
