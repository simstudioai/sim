import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_SETTINGS_ITEMS,
  ACCOUNT_SETTINGS_PATH_ALIASES,
  canMutateWorkspaceSettingsSection,
  getOrganizationSettingsFeatures,
  getWorkspaceSettingsHref,
  isOrganizationSettingsSectionAvailable,
  isSelfHostedOverrideEnabled,
  parseSettingsPathSection,
  resolveOrganizationSectionAccess,
  resolveWorkspaceNavigation,
  WORKSPACE_SETTINGS_ITEMS,
  WORKSPACE_SETTINGS_PATH_ALIASES,
} from '@/components/settings/navigation'
import type { DeploymentShape } from '@/lib/api/contracts/workspaces'

const SELF_HOSTED: DeploymentShape = {
  hosted: false,
  billingEnabled: false,
  chatEnabled: true,
  azureConfigured: false,
  cohereConfigured: false,
  features: {
    accessControl: false,
    auditLogs: false,
    customBlocks: false,
    dataDrains: false,
    dataRetention: false,
    inbox: true,
    sandboxes: false,
    sessionPolicies: true,
    sso: false,
    usageMonitoring: false,
    whitelabeling: true,
  },
}

const HOSTED: DeploymentShape = { ...SELF_HOSTED, hosted: true, billingEnabled: true }

/** A self-hosted deployment with every feature override on. */
const SELF_HOSTED_ALL_FEATURES: DeploymentShape = {
  ...SELF_HOSTED,
  features: { ...SELF_HOSTED.features, customBlocks: true },
}

const ALL_ENTITLEMENTS = {
  customBlocks: true,
  forks: true,
  inbox: true,
  sandboxes: true,
}

describe('settings navigation boundaries', () => {
  it('resolves self-hosted overrides against the deployment shape, never on Sim Cloud', () => {
    expect(isSelfHostedOverrideEnabled(undefined, SELF_HOSTED)).toBe(false)
    expect(isSelfHostedOverrideEnabled('always', SELF_HOSTED)).toBe(true)
    expect(isSelfHostedOverrideEnabled('always', HOSTED)).toBe(false)
    expect(isSelfHostedOverrideEnabled('sessionPolicies', SELF_HOSTED)).toBe(true)
    expect(isSelfHostedOverrideEnabled('sessionPolicies', HOSTED)).toBe(false)
    expect(isSelfHostedOverrideEnabled('sso', SELF_HOSTED)).toBe(false)
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

  it('allows member requests while reserving management for organization admins', () => {
    expect(
      resolveOrganizationSectionAccess({
        section: 'requests',
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: false,
      })
    ).toBe('view')
    expect(
      resolveOrganizationSectionAccess({
        section: 'requests',
        isTargetOrganizationMember: false,
        isTargetOrganizationAdmin: true,
      })
    ).toBe('unavailable')
    expect(
      resolveOrganizationSectionAccess({
        section: 'requests',
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: true,
      })
    ).toBe('manage')
    expect(
      isOrganizationSettingsSectionAvailable(
        'requests',
        getOrganizationSettingsFeatures(false, SELF_HOSTED)
      )
    ).toBe(true)
    expect(
      isOrganizationSettingsSectionAvailable(
        'requests',
        getOrganizationSettingsFeatures(false, {
          ...SELF_HOSTED,
          features: { ...SELF_HOSTED.features, accessControl: true },
        })
      )
    ).toBe(true)
  })

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
      entitlements: ALL_ENTITLEMENTS,
      deployment: SELF_HOSTED_ALL_FEATURES,
    })

    expect(items.map(({ id }) => id)).toEqual([
      'teammates',
      'workflow-mcp-servers',
      'recently-deleted',
      'forks',
      'custom-blocks',
      'requests',
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
