/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  ORGANIZATION_SETTINGS_GROUPS,
  ORGANIZATION_SETTINGS_ITEMS,
  type OrganizationSettingsFeatures,
} from '@/components/settings/navigation'
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
  hosted: true,
  selfHosted: {},
}

const available = { connectedAccounts: true, search: true }

describe('organization settings navigation', () => {
  it('exposes MCP setup and the read-only roster to an ordinary organization member', () => {
    expect(
      organizationSettingsNavigation(false, enterprise, available).map(({ id }) => id)
    ).toEqual(['members', 'search-mcp'])
  })

  it('uses Sources for administration when Search is available', () => {
    expect(organizationSettingsNavigation(true, enterprise, available)).toEqual(
      ORGANIZATION_SETTINGS_ITEMS.filter(({ id }) => id !== 'connected-accounts')
    )
    expect(
      organizationSettingsNavigation(true, enterprise, available).find(
        ({ id }) => id === 'integrations'
      )?.label
    ).toBe('Sources')
  })

  it('keeps members and billing reachable without an enterprise plan', () => {
    expect(
      organizationSettingsNavigation(
        true,
        { ...enterprise, hasEnterprisePlan: false },
        available
      ).map(({ id }) => id)
    ).toEqual(['billing', 'members', 'search-mcp'])
  })

  it('honors individual self-hosted feature flags and hides billing when disabled', () => {
    expect(
      organizationSettingsNavigation(
        true,
        {
          ...enterprise,
          hosted: false,
          billingEnabled: false,
          selfHosted: { sso: true },
        },
        available
      ).map(({ id }) => id)
    ).toEqual(['members', 'sso', 'integrations', 'search-mcp'])
  })

  it('normalizes old section names and does not expose unsupported routes', () => {
    expect(resolveOrganizationSettingsSection('/o/one/settings/organization?query=person')).toBe(
      'members'
    )
    expect(resolveOrganizationSettingsSection('subscription')).toBe('billing')
    expect(resolveOrganizationSettingsSection('domains')).toBe('sso')
    expect(resolveOrganizationSettingsSection('skills')).toBeNull()
    expect(buildOrganizationNavItems('org', true).map(({ id }) => id)).toEqual([
      'home',
      'search',
      'integrations',
    ])
  })

  it('groups the sections as account, organization, governance, and Sim Search, in order', () => {
    expect(ORGANIZATION_SETTINGS_ITEMS.map(({ id, group }) => `${group}:${id}`)).toEqual([
      'account:billing',
      'organization:members',
      'organization:connected-accounts',
      'organization:usage',
      'organization:whitelabeling',
      'governance:audit-logs',
      'governance:access-control',
      'governance:sso',
      'governance:sessions',
      'governance:data-retention',
      'governance:data-drains',
      'sim-search:integrations',
      'sim-search:search-mcp',
    ])
  })

  it('hosts the account General section ahead of the organization sections', () => {
    expect(
      organizationSurfaceSettingsNavigation(false, enterprise, available).map(({ id }) => id)
    ).toEqual(['general', 'members', 'search-mcp'])
    expect(ORGANIZATION_SETTINGS_GROUPS.map(({ key }) => key)).toEqual([
      'account',
      'organization',
      'governance',
      'sim-search',
    ])
  })

  it('resolves a surface path to the plane that owns it, the organization winning billing', () => {
    expect(resolveOrganizationSurfaceSection('/o/one/settings/general')).toEqual({
      plane: 'account',
      section: 'general',
    })
    expect(resolveOrganizationSurfaceSection('api-keys')).toBeNull()
    expect(resolveOrganizationSurfaceSection('billing')).toEqual({
      plane: 'organization',
      section: 'billing',
    })
    expect(resolveOrganizationSurfaceSection('skills')).toBeNull()
  })
  it('hides gated sections while preserving ordinary organization navigation', () => {
    const sections = organizationSurfaceSettingsNavigation(true, enterprise, {
      connectedAccounts: false,
      search: false,
    }).map(({ id }) => id)
    expect(sections).not.toContain('connected-accounts')
    expect(sections).not.toContain('search-mcp')
    expect(sections).not.toContain('integrations')
    expect(sections).toContain('members')
    expect(sections).toContain('general')
    expect(buildOrganizationNavItems('org', false)).toEqual([])
  })
  it('exposes Connected accounts before Search is enabled', () => {
    const sections = organizationSettingsNavigation(true, enterprise, {
      connectedAccounts: true,
      search: false,
    }).map(({ id }) => id)
    expect(sections).toContain('connected-accounts')
    expect(sections).not.toContain('search-mcp')
    expect(sections).not.toContain('integrations')
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
