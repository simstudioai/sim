/**
 * @vitest-environment node
 */
import { createElement } from 'react'
import { resetEnvFlagsMock, resetEnvMock, setEnv, setEnvFlags } from '@sim/testing'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ACCOUNT_SETTINGS_ITEMS,
  ACCOUNT_SETTINGS_PATH_ALIASES,
  buildUnifiedSettingsNavigation,
  canMutateWorkspaceSettingsSection,
  getAccountSettingsHref,
  getWorkspaceSettingsHref,
  isOrganizationSettingsSectionAvailable,
  ORGANIZATION_PLANE_UNIFIED_SECTIONS,
  parseSettingsPathSection,
  resolveOrganizationSectionAccess,
  resolveWorkspaceNavigation,
  SELFHOST_SETTINGS_ITEMS,
  SETTINGS_SECTION_REGISTRY,
  UNIFIED_TO_ORGANIZATION_SECTION,
  UNIFIED_TO_WORKSPACE_SECTION,
  WORKSPACE_SETTINGS_ITEMS,
  WORKSPACE_SETTINGS_PATH_ALIASES,
} from '@/components/settings/navigation'

beforeEach(() => {
  setEnv({})
  resetEnvFlagsMock()
})

afterAll(() => {
  resetEnvMock()
  resetEnvFlagsMock()
})

describe('settings navigation boundaries', () => {
  it('keeps Custom Blocks opt-in on self-hosted deployments', () => {
    expect(
      buildUnifiedSettingsNavigation().find(({ id }) => id === 'custom-blocks')?.selfHostedOverride
    ).toBe(false)
  })

  it('preserves the order of all four settings catalogs', () => {
    expect(buildUnifiedSettingsNavigation().map(({ id }) => id)).toEqual([
      'general',
      'desktop',
      'browser',
      'terminal',
      'access-control',
      'audit-logs',
      'forks',
      'billing',
      'teammates',
      'organization',
      'usage',
      'secrets',
      'credential-groups',
      'custom-tools',
      'mcp',
      'apikeys',
      'workflow-mcp-servers',
      'byok',
      'sandboxes',
      'inbox',
      'recently-deleted',
      'self-host',
      'sso',
      'sessions',
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
      'admin',
      'mothership',
    ])
    expect(SELFHOST_SETTINGS_ITEMS.map(({ id }) => id)).toEqual(['general', 'billing', 'chat-keys'])
    expect(WORKSPACE_SETTINGS_ITEMS.map(({ id }) => id)).toEqual([
      'teammates',
      'secrets',
      'byok',
      'sandboxes',
      'credential-groups',
      'custom-tools',
      'mcp',
      'workflow-mcp-servers',
      'api-keys',
      'inbox',
      'recently-deleted',
      'forks',
      'custom-blocks',
      'self-host',
    ])
  })

  it('keeps the Sandboxes section in the legacy self-hosted defaults', () => {
    setEnv({ NEXT_PUBLIC_SANDBOXES_ENABLED: undefined, NEXT_PUBLIC_E2B_ENABLED: undefined })

    expect(buildUnifiedSettingsNavigation().map(({ id }) => id)).toContain('sandboxes')
    expect(
      resolveWorkspaceNavigation({
        permission: 'admin',
        permissionConfig: {},
        entitlements: {
          byok: true,
          credentialGroups: true,
          inbox: true,
          customBlocks: true,
          forks: true,
          sandboxes: true,
        },
      }).map(({ id }) => id)
    ).toContain('sandboxes')
  })

  /**
   * The Self-host section links out to the managed service that issues this
   * deployment's Chat keys. On Sim Cloud that surface is reached from the
   * account plane instead, so the section must not exist there at all — in the
   * sidebar catalog or in the workspace-plane gate the route consults.
   */
  it('shows the Self-host section only on a self-hosted deployment', () => {
    setEnvFlags({ isHosted: false })

    expect(buildUnifiedSettingsNavigation().map(({ id }) => id)).toContain('self-host')
    expect(
      resolveWorkspaceNavigation({
        permission: 'admin',
        permissionConfig: {},
        entitlements: {
          byok: true,
          credentialGroups: true,
          inbox: true,
          customBlocks: true,
          forks: true,
          sandboxes: true,
        },
      }).map(({ id }) => id)
    ).toContain('self-host')
  })

  it('drops the Self-host section on hosted Sim', () => {
    setEnvFlags({ isHosted: true })

    expect(buildUnifiedSettingsNavigation().map(({ id }) => id)).not.toContain('self-host')
    expect(
      resolveWorkspaceNavigation({
        permission: 'admin',
        permissionConfig: {},
        entitlements: {
          byok: true,
          credentialGroups: true,
          inbox: true,
          customBlocks: true,
          forks: true,
          sandboxes: true,
        },
      }).map(({ id }) => id)
    ).not.toContain('self-host')
  })

  /**
   * The mark must be a line icon that inherits `--text-icon` like every other
   * nav glyph — an emoji would render in the platform's own colors and be the
   * one colored item in a monochrome icon column.
   */
  it('marks the Self hosting section with a currentColor line icon', () => {
    const selfHost = buildUnifiedSettingsNavigation().find(({ id }) => id === 'self-host')
    const markup = renderToStaticMarkup(createElement(selfHost!.icon, {}))

    expect(selfHost?.label).toBe('Self hosting')
    expect(markup).toContain('<svg')
    expect(markup).toContain('stroke="currentColor"')
  })

  it('has one registry source for every unified and plane item', () => {
    const unifiedIds = SETTINGS_SECTION_REGISTRY.flatMap(({ unified }) =>
      unified ? [unified.id] : []
    )
    const accountIds = SETTINGS_SECTION_REGISTRY.flatMap(({ planes }) =>
      planes?.account ? [planes.account.id] : []
    )
    const selfHostIds = SETTINGS_SECTION_REGISTRY.flatMap(({ planes }) =>
      planes?.selfhost ? [planes.selfhost.id] : []
    )
    const workspaceIds = SETTINGS_SECTION_REGISTRY.flatMap(({ planes }) =>
      planes?.workspace ? [planes.workspace.id] : []
    )

    expect(new Set(unifiedIds).size).toBe(unifiedIds.length)
    expect(new Set(accountIds).size).toBe(accountIds.length)
    expect(new Set(selfHostIds).size).toBe(selfHostIds.length)
    expect(new Set(workspaceIds).size).toBe(workspaceIds.length)
    expect([...unifiedIds].sort()).toEqual(
      buildUnifiedSettingsNavigation()
        .map(({ id }) => id)
        .sort()
    )
    expect([...accountIds].sort()).toEqual(ACCOUNT_SETTINGS_ITEMS.map(({ id }) => id).sort())
    expect([...selfHostIds].sort()).toEqual(SELFHOST_SETTINGS_ITEMS.map(({ id }) => id).sort())
    expect([...workspaceIds].sort()).toEqual(WORKSPACE_SETTINGS_ITEMS.map(({ id }) => id).sort())
  })

  it('derives the organization-plane unified sections from the registry', () => {
    expect([...ORGANIZATION_PLANE_UNIFIED_SECTIONS].sort()).toEqual([
      'access-control',
      'audit-logs',
      'billing',
      'data-drains',
      'data-retention',
      'organization',
      'sessions',
      'sso',
      'usage',
      'whitelabeling',
    ])
  })

  it('maps every organization-scoped unified section to its organization counterpart', () => {
    // The section page reads this map to decide whether to apply the organization
    // gate at all, so a section missing from it is not "ungated by omission" — it
    // is a section any workspace member could open.
    expect(UNIFIED_TO_ORGANIZATION_SECTION).toEqual({
      organization: 'members',
      billing: 'billing',
      'access-control': 'access-control',
      'audit-logs': 'audit-logs',
      sso: 'sso',
      sessions: 'sessions',
      'data-retention': 'data-retention',
      'data-drains': 'data-drains',
      whitelabeling: 'whitelabeling',
      usage: 'usage',
    })
    expect(Object.keys(UNIFIED_TO_ORGANIZATION_SECTION).sort()).toEqual(
      [...ORGANIZATION_PLANE_UNIFIED_SECTIONS].sort()
    )
  })

  it('maps every workspace projection from its unified section', () => {
    expect(UNIFIED_TO_WORKSPACE_SECTION).toEqual({
      teammates: 'teammates',
      secrets: 'secrets',
      byok: 'byok',
      sandboxes: 'sandboxes',
      'credential-groups': 'credential-groups',
      'custom-tools': 'custom-tools',
      mcp: 'mcp',
      'workflow-mcp-servers': 'workflow-mcp-servers',
      apikeys: 'api-keys',
      inbox: 'inbox',
      'recently-deleted': 'recently-deleted',
      forks: 'forks',
      'custom-blocks': 'custom-blocks',
      'self-host': 'self-host',
    })
  })

  it('labels the members section consistently', () => {
    const unifiedOrganization = buildUnifiedSettingsNavigation().find(
      ({ id }) => id === 'organization'
    )

    expect(unifiedOrganization?.label).toBe('Members')
  })

  it('keeps self-host settings on their standalone account projection', () => {
    expect(
      SELFHOST_SETTINGS_ITEMS.map(({ id, label, description, group }) => ({
        id,
        label,
        description,
        group,
      }))
    ).toEqual([
      {
        id: 'general',
        label: 'General',
        description: 'Manage your profile, appearance, and preferences.',
        group: 'account',
      },
      {
        id: 'billing',
        label: 'Subscription',
        description: 'Manage your personal plan, usage, and invoices.',
        group: 'account',
      },
      {
        id: 'chat-keys',
        label: 'Chat keys',
        description: 'Manage the model-provider keys that power Chat.',
        group: 'developer',
      },
    ])
  })

  it('builds canonical settings hrefs across all three planes', () => {
    expect(getAccountSettingsHref('general')).toBe('/account/settings/general')
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
        'sandboxes',
        'custom-tools',
        'mcp',
        'workflow-mcp-servers',
        'api-keys',
        'inbox',
        'recently-deleted',
        'custom-blocks',
        'self-host',
      ],
      mutable: [],
    },
    {
      permission: 'write' as const,
      visible: [
        'teammates',
        'secrets',
        'byok',
        'sandboxes',
        'custom-tools',
        'mcp',
        'workflow-mcp-servers',
        'api-keys',
        'inbox',
        'recently-deleted',
        'custom-blocks',
        'self-host',
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
          credentialGroups: true,
          customBlocks: true,
          forks: true,
          inbox: true,
          sandboxes: true,
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
        hideSandboxesTab: true,
      },
      entitlements: {
        byok: true,
        credentialGroups: true,
        customBlocks: true,
        forks: true,
        inbox: true,
        sandboxes: true,
      },
    })

    expect(items.map(({ id }) => id)).toEqual([
      'teammates',
      'byok',
      'credential-groups',
      'workflow-mcp-servers',
      'recently-deleted',
      'forks',
      'custom-blocks',
      'self-host',
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
