/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getActivePermissionGroupRestrictions,
  PLATFORM_FEATURES,
} from '@/lib/permission-groups/features'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  type PermissionGroupConfig,
} from '@/lib/permission-groups/types'

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
