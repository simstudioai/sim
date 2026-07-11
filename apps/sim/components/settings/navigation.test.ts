/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_SETTINGS_ITEMS,
  ACCOUNT_SETTINGS_PATH_ALIASES,
  canMutateWorkspaceSettingsSection,
  getAccountSettingsHref,
  getOrganizationSettingsHref,
  getWorkspaceSettingsHref,
  isOrganizationSettingsSectionAvailable,
  LEGACY_SETTINGS_SECTIONS,
  ORGANIZATION_SETTINGS_ITEMS,
  ORGANIZATION_SETTINGS_PATH_ALIASES,
  parseSettingsPathSection,
  resolveLegacySettingsHref,
  resolveOrganizationSectionAccess,
  resolveWorkspaceNavigation,
  WORKSPACE_SETTINGS_ITEMS,
  WORKSPACE_SETTINGS_PATH_ALIASES,
} from '@/components/settings/navigation'

describe('settings navigation boundaries', () => {
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

  it('classifies every legacy section into exactly one settings plane', () => {
    const classified = LEGACY_SETTINGS_SECTIONS.map(({ legacySection, plane }) => ({
      legacySection,
      plane,
    }))

    expect(new Set(classified.map(({ legacySection }) => legacySection)).size).toBe(
      classified.length
    )
    expect(classified.map(({ legacySection }) => legacySection).sort()).toEqual(
      [
        'access-control',
        'admin',
        'apikeys',
        'audit-logs',
        'billing',
        'byok',
        'copilot',
        'custom-blocks',
        'custom-tools',
        'data-drains',
        'data-retention',
        'forks',
        'general',
        'inbox',
        'mcp',
        'mothership',
        'organization',
        'recently-deleted',
        'secrets',
        'sso',
        'subscription',
        'team',
        'teammates',
        'whitelabeling',
        'workflow-mcp-servers',
      ].sort()
    )
    expect(
      classified.every(({ plane }) => ['account', 'organization', 'workspace'].includes(plane))
    ).toBe(true)
  })

  it('keeps API keys split between account and workspace settings', () => {
    expect(ACCOUNT_SETTINGS_ITEMS.some(({ id }) => id === 'api-keys')).toBe(true)
    expect(WORKSPACE_SETTINGS_ITEMS.some(({ id }) => id === 'api-keys')).toBe(true)
    expect(ORGANIZATION_SETTINGS_ITEMS.some(({ id }) => String(id) === 'api-keys')).toBe(false)
  })

  it('resolves organization legacy links from the routed workspace organization', () => {
    expect(
      resolveLegacySettingsHref({
        legacySection: 'sso',
        workspaceId: 'workspace-b',
        hostOrganizationId: 'org-b',
        isTargetOrganizationMember: true,
      })
    ).toBe('/organization/org-b/settings/sso')

    expect(
      resolveLegacySettingsHref({
        legacySection: 'sso',
        workspaceId: 'workspace-b',
        hostOrganizationId: 'org-b',
        isTargetOrganizationMember: false,
      })
    ).toBe('/organization/org-b/settings/unavailable')
  })

  it('redirects legacy aliases to canonical account, organization, and workspace routes', () => {
    expect(
      resolveLegacySettingsHref({
        legacySection: 'general',
        workspaceId: 'workspace-b',
        hostOrganizationId: 'org-b',
        isTargetOrganizationMember: true,
      })
    ).toBe('/account/settings/general')
    expect(
      resolveLegacySettingsHref({
        legacySection: 'team',
        workspaceId: 'workspace-b',
        hostOrganizationId: 'org-b',
        isTargetOrganizationMember: true,
      })
    ).toBe('/organization/org-b/settings/members')
    expect(
      resolveLegacySettingsHref({
        legacySection: 'apikeys',
        workspaceId: 'workspace-b',
        hostOrganizationId: 'org-b',
        isTargetOrganizationMember: true,
      })
    ).toBe('/workspace/workspace-b/settings/api-keys')
  })

  it.each([
    ['integrations', '/workspace/workspace-b/integrations'],
    ['skills', '/workspace/workspace-b/skills'],
  ])('preserves the top-level destination for legacy %s links', (legacySection, destination) => {
    expect(
      resolveLegacySettingsHref({
        legacySection,
        workspaceId: 'workspace-b',
        hostOrganizationId: 'org-b',
        isTargetOrganizationMember: true,
      })
    ).toBe(destination)
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
