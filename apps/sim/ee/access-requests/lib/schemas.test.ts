/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  PERMISSION_GROUP_FIELDS,
} from '@/lib/permission-groups/fields'
import { storedAccessRequestPolicyChangeSchema } from '@/ee/access-requests/lib/schemas'

describe('stored access request policy changes', () => {
  it('accepts unchanged canonical values for every field', () => {
    for (const configKey of Object.keys(
      PERMISSION_GROUP_FIELDS
    ) as (keyof typeof PERMISSION_GROUP_FIELDS)[]) {
      const value = DEFAULT_PERMISSION_GROUP_CONFIG[configKey]
      expect(
        storedAccessRequestPolicyChangeSchema.parse({
          configKey,
          label: configKey,
          before: value,
          after: value,
        })
      ).toEqual({ configKey, label: configKey, before: value, after: value })
    }
  })

  it.each([
    { configKey: 'hideCopilot', before: true, after: false },
    { configKey: 'allowedIntegrations', before: ['github_v2'], after: ['github_v2', 'slack_v2'] },
    {
      configKey: 'allowedFileShareAuthTypes',
      before: null,
      after: ['public', 'password', 'email', 'sso'],
    },
    { configKey: 'allowedChatDeployAuthTypes', before: [], after: null },
    { configKey: 'deniedTools', before: ['tool'], after: [] },
  ])('preserves valid snapshots for $configKey', (change) => {
    expect(storedAccessRequestPolicyChangeSchema.parse({ ...change, label: 'Access' })).toEqual({
      ...change,
      label: 'Access',
    })
  })

  it.each([
    { configKey: 'hideCopilot', valid: false, invalid: ['public'] },
    { configKey: 'allowedIntegrations', valid: null, invalid: false },
    { configKey: 'allowedFileShareAuthTypes', valid: ['sso'], invalid: ['invented'] },
    { configKey: 'allowedChatDeployAuthTypes', valid: null, invalid: ['invented'] },
    { configKey: 'deniedTools', valid: [], invalid: null },
    { configKey: 'deniedModels', valid: [], invalid: true },
  ])('rejects invalid before and after values for $configKey', ({ configKey, valid, invalid }) => {
    for (const side of ['before', 'after'] as const) {
      const result = storedAccessRequestPolicyChangeSchema.safeParse({
        configKey,
        label: 'Access',
        before: valid,
        after: valid,
        [side]: invalid,
      })
      expect(result.success).toBe(false)
      if (!result.success)
        expect(result.error.issues).toEqual([expect.objectContaining({ path: [side] })])
    }
  })
})
