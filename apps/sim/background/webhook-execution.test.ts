/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveWebhookRecordProviderConfig } = vi.hoisted(() => ({
  mockResolveWebhookRecordProviderConfig: vi.fn(),
}))

vi.mock('@/lib/webhooks/env-resolver', () => ({
  resolveWebhookRecordProviderConfig: mockResolveWebhookRecordProviderConfig,
}))

import { resolveWebhookExecutionProviderConfig } from './webhook-execution'

describe('resolveWebhookExecutionProviderConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the resolved webhook record when provider config resolution succeeds', async () => {
    const webhookRecord = {
      id: 'webhook-1',
      providerConfig: {
        botToken: '{{SLACK_BOT_TOKEN}}',
      },
    }
    const resolvedWebhookRecord = {
      ...webhookRecord,
      providerConfig: {
        botToken: 'xoxb-resolved',
      },
    }

    mockResolveWebhookRecordProviderConfig.mockResolvedValue(resolvedWebhookRecord)

    await expect(
      resolveWebhookExecutionProviderConfig(webhookRecord, 'slack', 'user-1', 'workspace-1')
    ).resolves.toEqual(resolvedWebhookRecord)

    expect(mockResolveWebhookRecordProviderConfig).toHaveBeenCalledWith(
      webhookRecord,
      'user-1',
      'workspace-1'
    )
  })

  it('throws a contextual error when provider config resolution fails', async () => {
    mockResolveWebhookRecordProviderConfig.mockRejectedValue(new Error('env lookup failed'))

    await expect(
      resolveWebhookExecutionProviderConfig(
        {
          id: 'webhook-1',
          providerConfig: {
            botToken: '{{SLACK_BOT_TOKEN}}',
          },
        },
        'slack',
        'user-1',
        'workspace-1'
      )
    ).rejects.toThrow(
      'Failed to resolve webhook provider config for slack webhook webhook-1: env lookup failed'
    )
  })
})
