/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  ORGANIZATION_SETTINGS_ITEMS,
  type OrganizationSettingsFeatures,
} from '@/components/settings/navigation'
import { buildOrganizationNavItems } from '@/app/o/[organizationId]/components/organization-sidebar/navigation'
import {
  organizationSettingsNavigation,
  resolveOrganizationSettingsSection,
} from '@/app/o/[organizationId]/settings/navigation'

const enterprise: OrganizationSettingsFeatures = {
  billingEnabled: true,
  hasEnterprisePlan: true,
  hosted: true,
  selfHosted: {},
}

describe('organization settings navigation', () => {
  it('exposes MCP setup and the read-only roster to an ordinary organization member', () => {
    expect(organizationSettingsNavigation(false, enterprise).map(({ id }) => id)).toEqual([
      'search-mcp',
      'members',
    ])
  })

  it('offers every org settings section to an entitled organization administrator', () => {
    expect(organizationSettingsNavigation(true, enterprise)).toEqual(ORGANIZATION_SETTINGS_ITEMS)
  })

  it('keeps members and billing reachable without an enterprise plan', () => {
    expect(
      organizationSettingsNavigation(true, { ...enterprise, hasEnterprisePlan: false }).map(
        ({ id }) => id
      )
    ).toEqual(['search-mcp', 'members', 'billing'])
  })

  it('honors individual self-hosted feature flags and hides billing when disabled', () => {
    expect(
      organizationSettingsNavigation(true, {
        ...enterprise,
        hosted: false,
        billingEnabled: false,
        selfHosted: { sso: true },
      }).map(({ id }) => id)
    ).toEqual(['search-mcp', 'members', 'sso'])
  })

  it('normalizes old section names and does not expose unsupported routes', () => {
    expect(resolveOrganizationSettingsSection('/o/one/settings/organization?query=person')).toBe(
      'members'
    )
    expect(resolveOrganizationSettingsSection('subscription')).toBe('billing')
    expect(resolveOrganizationSettingsSection('domains')).toBe('sso')
    expect(resolveOrganizationSettingsSection('skills')).toBeNull()
    expect(buildOrganizationNavItems('org').map(({ id }) => id)).toEqual([
      'home',
      'integrations',
      'workspaces',
    ])
  })
})
