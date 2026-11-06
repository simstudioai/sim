import { describe, expect, it } from 'vitest'
import type { OrganizationSettingsFeatures } from '@/components/settings/navigation'
import {
  organizationSettingsNavigation,
  resolveOrganizationSettingsSection,
} from '@/platform/lib/data/settings-sections'

const enterprise: OrganizationSettingsFeatures = {
  billingEnabled: true,
  hasEnterprisePlan: true,
  governanceActive: true,
  hosted: true,
  selfHosted: {},
}

describe('organization settings navigation', () => {
  it('normalizes old section names and does not expose unsupported routes', () => {
    expect(resolveOrganizationSettingsSection('/o/one/settings/organization?query=person')).toBe(
      'members'
    )
    expect(resolveOrganizationSettingsSection('subscription')).toBe('billing')
    expect(resolveOrganizationSettingsSection('domains')).toBe('sso')
    expect(resolveOrganizationSettingsSection('sessions')).toBe('security')
    expect(resolveOrganizationSettingsSection('/o/one/settings/network')).toBeNull()
    expect(resolveOrganizationSettingsSection('skills')).toBeNull()
  })
  it('keeps both setup pages hidden from non-admins when Search is disabled', () => {
    const sections = organizationSettingsNavigation(false, enterprise, {
      connectedAccounts: true,
      search: false,
    }).map(({ id }) => id)
    expect(sections).not.toContain('connected-accounts')
    expect(sections).not.toContain('integrations')
  })
})
