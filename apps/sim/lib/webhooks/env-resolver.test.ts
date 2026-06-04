/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetEffectiveDecryptedEnv } = vi.hoisted(() => ({
  mockGetEffectiveDecryptedEnv: vi.fn(),
}))

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv: mockGetEffectiveDecryptedEnv,
}))

import {
  resolveWebhookProviderConfig,
  resolveWebhookRecordProviderConfig,
} from '@/lib/webhooks/env-resolver'

describe('webhook env resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetEffectiveDecryptedEnv.mockResolvedValue({
      SLACK_BOT_TOKEN: 'xoxb-resolved',
      SLACK_HOST: 'files.slack.com',
    })
  })

  it('resolves environment variables inside webhook provider config', async () => {
    const result = await resolveWebhookProviderConfig(
      {
        botToken: '{{SLACK_BOT_TOKEN}}',
        includeFiles: true,
        nested: {
          url: 'https://{{SLACK_HOST}}/api/files.info',
        },
      },
      'user-1',
      'workspace-1'
    )

    expect(result).toEqual({
      botToken: 'xoxb-resolved',
      includeFiles: true,
      nested: {
        url: 'https://files.slack.com/api/files.info',
      },
    })
    expect(mockGetEffectiveDecryptedEnv).toHaveBeenCalledWith('user-1', 'workspace-1')
  })

  it('returns a cloned webhook record with resolved provider config', async () => {
    const webhookRecord = {
      id: 'webhook-1',
      provider: 'slack',
      providerConfig: {
        botToken: '{{SLACK_BOT_TOKEN}}',
        includeFiles: true,
      },
    }

    const result = await resolveWebhookRecordProviderConfig(webhookRecord, 'user-1', 'workspace-1')

    expect(result).toEqual({
      ...webhookRecord,
      providerConfig: {
        botToken: 'xoxb-resolved',
        includeFiles: true,
      },
    })
    expect(result).not.toBe(webhookRecord)
    expect(result.providerConfig).not.toBe(webhookRecord.providerConfig)
  })
})
