/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getActivePermissionGroupRestrictions,
  isFeatureInertForGroup,
  PLATFORM_FEATURES,
} from '@/lib/permission-groups/features'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  type PermissionGroupConfig,
} from '@/lib/permission-groups/fields'

describe('getActivePermissionGroupRestrictions', () => {
  it('returns no restrictions for an absent or unrestricted config', () => {
    expect(getActivePermissionGroupRestrictions(null)).toEqual([])
    expect(getActivePermissionGroupRestrictions(DEFAULT_PERMISSION_GROUP_CONFIG)).toEqual([])
  })

  it.each([
    {
      key: 'allowedIntegrations',
      emptyValue: [],
      limitedValue: ['slack'],
      emptyDescription: 'No non-exempt integrations or blocks are allowed.',
      limitedDescription:
        'Integrations and blocks are limited to effectiveConfig.allowedIntegrations.',
    },
    {
      key: 'allowedModelProviders',
      emptyValue: [],
      limitedValue: ['openai'],
      emptyDescription: 'No model providers are allowed.',
      limitedDescription: 'Model providers are limited to effectiveConfig.allowedModelProviders.',
    },
    {
      key: 'allowedFileShareAuthTypes',
      emptyValue: [],
      limitedValue: ['password'],
      emptyDescription: 'No public file-share authentication modes are allowed.',
      limitedDescription:
        'Public file-share authentication is limited to effectiveConfig.allowedFileShareAuthTypes.',
    },
    {
      key: 'allowedChatDeployAuthTypes',
      emptyValue: [],
      limitedValue: ['sso'],
      emptyDescription: 'No chat deployment authentication modes are allowed.',
      limitedDescription:
        'Chat deployment authentication is limited to effectiveConfig.allowedChatDeployAuthTypes.',
    },
  ] as const)(
    'describes empty and limited $key allowlists',
    ({ key, emptyValue, limitedValue, emptyDescription, limitedDescription }) => {
      const emptyConfig = { ...DEFAULT_PERMISSION_GROUP_CONFIG, [key]: emptyValue }
      const limitedConfig = { ...DEFAULT_PERMISSION_GROUP_CONFIG, [key]: limitedValue }

      expect(getActivePermissionGroupRestrictions(emptyConfig)).toEqual([
        { key, description: emptyDescription },
      ])
      expect(getActivePermissionGroupRestrictions(limitedConfig)).toEqual([
        { key, description: limitedDescription },
      ])
    }
  )

  it.each([
    {
      key: 'deniedModels',
      value: ['gpt-4o'],
      description: 'Models listed in effectiveConfig.deniedModels are blocked.',
    },
    {
      key: 'deniedTools',
      value: ['slack_delete_message'],
      description: 'Integration tools listed in effectiveConfig.deniedTools are blocked.',
    },
  ] as const)('describes a populated $key denylist', ({ key, value, description }) => {
    const config = { ...DEFAULT_PERMISSION_GROUP_CONFIG, [key]: value }

    expect(getActivePermissionGroupRestrictions(config)).toEqual([{ key, description }])
  })

  it.each(PLATFORM_FEATURES)(
    'uses the shared prose for $configKey when enabled',
    ({ configKey, hint }) => {
      const config: PermissionGroupConfig = {
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        [configKey]: true,
      }

      expect(getActivePermissionGroupRestrictions(config)).toEqual([
        { key: configKey, description: hint },
      ])
    }
  )
})

/**
 * The editor renders every boolean key on every group, so a key whose
 * capability is read from the organization's *default* group is a checkbox that
 * does nothing on any other group. `scope` is what lets the editor say so, and
 * this pins the membership of each class: a new key that reads the default
 * group has to be added here deliberately, rather than shipping as a silently
 * inert checkbox.
 *
 * `workspace-or-organization` is the honest third answer. `api_keys.manage`,
 * `cli.use`, `integrations.manage`, `invitations.send` and
 * `personal_api_key.use` each have a workspace-scoped path that reads the group
 * being edited *and* an account-level path that falls back to the default
 * group, so they are neither inert nor purely local — marking them
 * `organization` would tell an admin their workspace restriction does not apply
 * when it does.
 */
describe('platform feature scope', () => {
  function keysWithScope(scope: string): string[] {
    return PLATFORM_FEATURES.filter((feature) => feature.scope === scope)
      .map((feature) => feature.configKey)
      .sort()
  }

  it('reads exactly two keys from the organization default group alone', () => {
    expect(keysWithScope('organization')).toEqual([
      'disableWorkspaceCreation',
      'hideOrgMemberDirectory',
    ])
  })

  it('reads exactly six keys from both a workspace group and the default group', () => {
    expect(keysWithScope('workspace-or-organization')).toEqual([
      'disableCliAccess',
      'disableInvitations',
      'disableOAuthAppAccess',
      'disablePersonalApiKeys',
      'hideApiKeysTab',
      'hideIntegrationsTab',
    ])
  })

  it('gives every feature a scope', () => {
    for (const feature of PLATFORM_FEATURES) {
      expect(
        ['workspace', 'organization', 'workspace-or-organization'],
        `${feature.configKey} declares no known scope`
      ).toContain(feature.scope)
    }
  })
})

describe('isFeatureInertForGroup', () => {
  function feature(configKey: string) {
    const found = PLATFORM_FEATURES.find((f) => f.configKey === configKey)
    if (!found) throw new Error(`No platform feature for ${configKey}`)
    return found
  }

  it('makes an organization-scoped key inert on a non-default group', () => {
    expect(isFeatureInertForGroup(feature('hideOrgMemberDirectory'), false)).toBe(true)
    expect(isFeatureInertForGroup(feature('disableWorkspaceCreation'), false)).toBe(true)
  })

  it('leaves an organization-scoped key editable on the default group', () => {
    expect(isFeatureInertForGroup(feature('hideOrgMemberDirectory'), true)).toBe(false)
  })

  /**
   * The dual-scope keys have a workspace path that reads the group being
   * edited, so making them inert would withhold a restriction that does apply.
   */
  it('never makes a workspace or dual-scope key inert', () => {
    expect(isFeatureInertForGroup(feature('hideApiKeysTab'), false)).toBe(false)
    expect(isFeatureInertForGroup(feature('disableCliAccess'), false)).toBe(false)
    expect(isFeatureInertForGroup(feature('hideTraceSpans'), false)).toBe(false)
  })
})
