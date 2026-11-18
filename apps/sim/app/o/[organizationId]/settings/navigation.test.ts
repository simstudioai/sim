import { describe, expect, it } from 'vitest'
import type { OrganizationSettingsFeatures } from '@/components/settings/navigation'
import { buildOrganizationNavItems } from '@/app/o/[organizationId]/components/organization-sidebar/navigation'
import {
  organizationSettingsNavigation,
  organizationSurfaceSettingsNavigation,
  resolveOrganizationSettingsSection,
  resolveOrganizationSurfaceSection,
} from '@/app/o/[organizationId]/settings/navigation'

const enterprise: OrganizationSettingsFeatures = {
  billingEnabled: true,
  hasEnterprisePlan: true,
  governanceActive: true,
  hosted: true,
  selfHosted: {},
}

describe('organization settings navigation', () => {
  it('lists Desktop settings only inside the desktop app, where the page resolves', () => {
    const ids = (desktopSettings: boolean) =>
      organizationSurfaceSettingsNavigation(
        false,
        enterprise,
        { connectedAccounts: false, search: true, desktopSettings },
        false
      ).map(({ id }) => id)
    expect(ids(true)).toContain('desktop')
    expect(ids(false)).not.toContain('desktop')
    expect(resolveOrganizationSurfaceSection('/o/one/settings/desktop')).toEqual({
      plane: 'account',
      section: 'desktop',
    })
  })

  it('normalizes old section names and does not expose unsupported routes', () => {
    expect(resolveOrganizationSettingsSection('/o/one/settings/organization?query=person')).toBe(
      'members'
    )
    expect(resolveOrganizationSettingsSection('subscription')).toBe('billing')
    expect(resolveOrganizationSettingsSection('domains')).toBe('sso')
    expect(resolveOrganizationSettingsSection('sessions')).toBe('security')
    expect(resolveOrganizationSettingsSection('/o/one/settings/network')).toBeNull()
    expect(resolveOrganizationSettingsSection('skills')).toBeNull()
    expect(
      buildOrganizationNavItems('org', { searchAvailable: true, mothershipAvailable: true }).map(
        ({ id }) => id
      )
    ).toEqual(['home', 'search', 'integrations'])
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
