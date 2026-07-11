/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_SETTINGS_ITEMS,
  ACCOUNT_SETTINGS_PATH_ALIASES,
  buildUnifiedSettingsNavigation,
  canMutateWorkspaceSettingsSection,
  getAccountSettingsHref,
  getOrganizationSettingsHref,
  getWorkspaceSettingsHref,
  isOrganizationSettingsSectionAvailable,
  ORGANIZATION_SETTINGS_ITEMS,
  ORGANIZATION_SETTINGS_PATH_ALIASES,
  parseSettingsPathSection,
  resolveOrganizationSectionAccess,
  resolveWorkspaceNavigation,
  SETTINGS_SECTION_REGISTRY,
  WORKSPACE_SETTINGS_ITEMS,
  WORKSPACE_SETTINGS_PATH_ALIASES,
} from '@/components/settings/navigation'

describe('settings navigation boundaries', () => {
  it('preserves the order of all four settings catalogs', () => {
    expect(buildUnifiedSettingsNavigation().map(({ id }) => id)).toEqual([
      'general',
      'access-control',
      'audit-logs',
      'forks',
      'billing',
      'teammates',
      'organization',
      'secrets',
      'custom-tools',
      'mcp',
      'apikeys',
      'workflow-mcp-servers',
      'byok',
      'copilot',
      'inbox',
      'recently-deleted',
      'sso',
      'data-retention',
      'data-drains',
      'whitelabeling',
      'custom-blocks',
      'admin',
      'mothership',
    ])
    expect(ACCOUNT_SETTINGS_ITEMS.map(({ id }) => id)).toEqual([
      'general',
      'billing',
      'api-keys',
      'copilot',
      'admin',
      'mothership',
    ])
    expect(ORGANIZATION_SETTINGS_ITEMS.map(({ id }) => id)).toEqual([
      'members',
      'billing',
      'access-control',
      'audit-logs',
      'sso',
      'data-retention',
      'data-drains',
      'whitelabeling',
    ])
    expect(WORKSPACE_SETTINGS_ITEMS.map(({ id }) => id)).toEqual([
      'teammates',
      'secrets',
      'byok',
      'custom-tools',
      'mcp',
      'workflow-mcp-servers',
      'api-keys',
      'inbox',
      'recently-deleted',
      'forks',
      'custom-blocks',
    ])
  })

  it('has one registry source for every unified and plane item', () => {
    const unifiedIds = SETTINGS_SECTION_REGISTRY.map(({ unified }) => unified.id)
    const accountIds = SETTINGS_SECTION_REGISTRY.flatMap(({ planes }) =>
      planes?.account ? [planes.account.id] : []
    )
    const organizationIds = SETTINGS_SECTION_REGISTRY.flatMap(({ planes }) =>
      planes?.organization ? [planes.organization.id] : []
    )
    const workspaceIds = SETTINGS_SECTION_REGISTRY.flatMap(({ planes }) =>
      planes?.workspace ? [planes.workspace.id] : []
    )

    expect(new Set(unifiedIds).size).toBe(unifiedIds.length)
    expect(new Set(accountIds).size).toBe(accountIds.length)
    expect(new Set(organizationIds).size).toBe(organizationIds.length)
    expect(new Set(workspaceIds).size).toBe(workspaceIds.length)
    expect([...unifiedIds].sort()).toEqual(
      buildUnifiedSettingsNavigation()
        .map(({ id }) => id)
        .sort()
    )
    expect([...accountIds].sort()).toEqual(ACCOUNT_SETTINGS_ITEMS.map(({ id }) => id).sort())
    expect([...organizationIds].sort()).toEqual(
      ORGANIZATION_SETTINGS_ITEMS.map(({ id }) => id).sort()
    )
    expect([...workspaceIds].sort()).toEqual(WORKSPACE_SETTINGS_ITEMS.map(({ id }) => id).sort())
  })

  it('shares labels, icons, and docs links across projections', () => {
    const unifiedSso = buildUnifiedSettingsNavigation().find(({ id }) => id === 'sso')
    const organizationSso = ORGANIZATION_SETTINGS_ITEMS.find(({ id }) => id === 'sso')

    expect(organizationSso?.label).toBe(unifiedSso?.label)
    expect(organizationSso?.icon).toBe(unifiedSso?.icon)
    expect(organizationSso?.docsLink).toBe(unifiedSso?.docsLink)
  })

  it('keeps scope-specific labels only where the surface genuinely differs', () => {
    const organizationMembers = ORGANIZATION_SETTINGS_ITEMS.find(({ id }) => id === 'members')
    const unifiedOrganization = buildUnifiedSettingsNavigation().find(
      ({ id }) => id === 'organization'
    )

    expect(organizationMembers?.label).toBe('Members')
    expect(organizationMembers?.description).toBe('Manage organization members, roles, and seats.')
    expect(unifiedOrganization?.label).toBe('Organization')
  })

  it('builds canonical settings hrefs across all three planes', () => {
    expect(getAccountSettingsHref('general')).toBe('/account/settings/general')
    expect(getOrganizationSettingsHref('organization-a', 'members')).toBe(
      '/organization/organization-a/settings/members'
    )
    expect(getWorkspaceSettingsHref('workspace-a', 'teammates')).toBe(
      '/workspace/workspace-a/settings/teammates'
    )
  })

  it('preserves encoded query parameters on canonical settings hrefs', () => {
    const searchParams = new URLSearchParams([
      ['mcpServerId', 'server/a'],
      ['view', 'tools and prompts'],
    ])

    expect(getWorkspaceSettingsHref('workspace-a', 'mcp', searchParams)).toBe(
      '/workspace/workspace-a/settings/mcp?mcpServerId=server%2Fa&view=tools+and+prompts'
    )
  })

  it('parses canonical, nested, and aliased account settings paths', () => {
    const parseAccountPath = (path: string, defaultSection: 'general' | null) =>
      parseSettingsPathSection({
        path,
        items: ACCOUNT_SETTINGS_ITEMS,
        defaultSection,
        aliases: ACCOUNT_SETTINGS_PATH_ALIASES,
      })

    expect(parseAccountPath('general', null)).toBe('general')
    expect(parseAccountPath('/account/settings/billing/credit-usage', null)).toBe('billing')
    expect(parseAccountPath('/account/settings/apikeys', null)).toBe('api-keys')
    expect(parseAccountPath('/account/settings/not-a-section', null)).toBeNull()
    expect(parseAccountPath('/account/settings', 'general')).toBe('general')
  })

  it('parses canonical, aliased, and invalid organization settings paths', () => {
    const parseOrganizationPath = (path: string) =>
      parseSettingsPathSection({
        path,
        items: ORGANIZATION_SETTINGS_ITEMS,
        defaultSection: null,
        aliases: ORGANIZATION_SETTINGS_PATH_ALIASES,
      })

    expect(parseOrganizationPath('sso')).toBe('sso')
    expect(parseOrganizationPath('/organization/org-a/settings/organization')).toBe('members')
    expect(parseOrganizationPath('/organization/org-a/settings/not-a-section')).toBeNull()
  })

  it('parses canonical, aliased, and invalid workspace settings paths', () => {
    const parseWorkspacePath = (path: string) =>
      parseSettingsPathSection({
        path,
        items: WORKSPACE_SETTINGS_ITEMS,
        defaultSection: null,
        aliases: WORKSPACE_SETTINGS_PATH_ALIASES,
      })

    expect(parseWorkspacePath('secrets')).toBe('secrets')
    expect(parseWorkspacePath('/workspace/workspace-a/settings/apikeys')).toBe('api-keys')
    expect(parseWorkspacePath('/workspace/workspace-a/settings/not-a-section')).toBeNull()
  })

  it('keeps API keys split between account and workspace settings', () => {
    expect(ACCOUNT_SETTINGS_ITEMS.some(({ id }) => id === 'api-keys')).toBe(true)
    expect(WORKSPACE_SETTINGS_ITEMS.some(({ id }) => id === 'api-keys')).toBe(true)
    expect(ORGANIZATION_SETTINGS_ITEMS.some(({ id }) => String(id) === 'api-keys')).toBe(false)
  })

  it('requires target-organization membership and admin authority', () => {
    expect(
      resolveOrganizationSectionAccess({
        section: 'members',
        isTargetOrganizationMember: false,
        isTargetOrganizationAdmin: false,
      })
    ).toBe('unavailable')
    expect(
      resolveOrganizationSectionAccess({
        section: 'members',
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: false,
      })
    ).toBe('view')
    expect(
      resolveOrganizationSectionAccess({
        section: 'sso',
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: false,
      })
    ).toBe('unavailable')
    expect(
      resolveOrganizationSectionAccess({
        section: 'sso',
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: true,
      })
    ).toBe('manage')
  })

  it('gates organization control-plane sections by the target organization plan', () => {
    const hostedFree = {
      billingEnabled: true,
      hasEnterprisePlan: false,
      hosted: true,
      selfHosted: {},
    }
    expect(isOrganizationSettingsSectionAvailable('members', hostedFree)).toBe(true)
    expect(isOrganizationSettingsSectionAvailable('billing', hostedFree)).toBe(true)
    expect(isOrganizationSettingsSectionAvailable('sso', hostedFree)).toBe(false)
    expect(
      isOrganizationSettingsSectionAvailable('sso', {
        ...hostedFree,
        hasEnterprisePlan: true,
      })
    ).toBe(true)
  })

  it.each([
    {
      permission: 'read' as const,
      visible: [
        'teammates',
        'secrets',
        'byok',
        'custom-tools',
        'mcp',
        'workflow-mcp-servers',
        'api-keys',
        'inbox',
        'recently-deleted',
        'custom-blocks',
      ],
      mutable: [],
    },
    {
      permission: 'write' as const,
      visible: [
        'teammates',
        'secrets',
        'byok',
        'custom-tools',
        'mcp',
        'workflow-mcp-servers',
        'api-keys',
        'inbox',
        'recently-deleted',
        'custom-blocks',
      ],
      mutable: ['secrets', 'custom-tools', 'mcp', 'workflow-mcp-servers', 'recently-deleted'],
    },
    {
      permission: 'admin' as const,
      visible: WORKSPACE_SETTINGS_ITEMS.map(({ id }) => id),
      mutable: WORKSPACE_SETTINGS_ITEMS.map(({ id }) => id),
    },
  ])(
    'makes workspace $permission navigation and mutation chrome explicit',
    ({ permission, visible, mutable }) => {
      const items = resolveWorkspaceNavigation({
        permission,
        permissionConfig: {},
        entitlements: {
          byok: true,
          customBlocks: true,
          forks: true,
          inbox: true,
        },
      })

      expect(items.map(({ id }) => id)).toEqual(visible)
      expect(items.filter(({ canMutate }) => canMutate).map(({ id }) => id)).toEqual(mutable)
    }
  )

  it('applies permission-group hiding as an independent axis', () => {
    const items = resolveWorkspaceNavigation({
      permission: 'admin',
      permissionConfig: {
        hideSecretsTab: true,
        hideApiKeysTab: true,
        hideInboxTab: true,
        disableMcpTools: true,
        disableCustomTools: true,
      },
      entitlements: {
        byok: true,
        customBlocks: true,
        forks: true,
        inbox: true,
      },
    })

    expect(items.map(({ id }) => id)).toEqual([
      'teammates',
      'byok',
      'workflow-mcp-servers',
      'recently-deleted',
      'forks',
      'custom-blocks',
    ])
  })

  it('uses server-aligned mutation permissions for workspace settings', () => {
    const writer = { canEdit: true, canAdmin: false }
    expect(canMutateWorkspaceSettingsSection('custom-tools', writer)).toBe(true)
    expect(canMutateWorkspaceSettingsSection('mcp', writer)).toBe(true)
    expect(canMutateWorkspaceSettingsSection('recently-deleted', writer)).toBe(true)
    expect(canMutateWorkspaceSettingsSection('workflow-mcp-servers', writer)).toBe(true)
    expect(canMutateWorkspaceSettingsSection('api-keys', writer)).toBe(false)
    expect(canMutateWorkspaceSettingsSection('inbox', writer)).toBe(false)
  })
})
