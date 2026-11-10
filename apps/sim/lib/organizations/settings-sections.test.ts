import { describe, expect, it } from 'vitest'
import type { OrganizationSettingsFeatures } from '@/components/settings/navigation'
import { organizationSurfaceSettingsNavigation } from '@/lib/organizations/settings-sections'

const enterprise: OrganizationSettingsFeatures = {
  billingEnabled: true,
  hasEnterprisePlan: true,
  governanceActive: true,
  hosted: true,
  selfHosted: {},
  personal: false,
}

describe('organization settings navigation', () => {
  it('keeps both setup pages hidden from non-admins when Search is disabled', () => {
    const sections = organizationSurfaceSettingsNavigation(
      false,
      enterprise,
      { connectedAccounts: true, search: false },
      false
    ).map(({ id }) => id)
    expect(sections).not.toContain('connected-accounts')
    expect(sections).not.toContain('integrations')
  })
})
