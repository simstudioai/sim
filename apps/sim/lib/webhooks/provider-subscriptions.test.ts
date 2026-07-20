/**
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetEffectiveDecryptedEnv, mockGetProviderHandler } = vi.hoisted(() => ({
  mockGetEffectiveDecryptedEnv: vi.fn(),
  mockGetProviderHandler: vi.fn(),
}))

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv: mockGetEffectiveDecryptedEnv,
}))

vi.mock('@/lib/webhooks/providers', () => ({
  getProviderHandler: mockGetProviderHandler,
}))

import {
  cleanupExternalWebhook,
  createExternalWebhookSubscription,
} from '@/lib/webhooks/provider-subscriptions'

describe('createExternalWebhookSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetEffectiveDecryptedEnv.mockResolvedValue({ ASHBY_API_KEY: 'real-secret-key' })
  })

  it('resolves {{ENV_VAR}} references in providerConfig before calling the provider', async () => {
    const createSubscription = vi.fn().mockResolvedValue({
      providerConfigUpdates: { externalId: 'ext-1' },
    })
    mockGetProviderHandler.mockReturnValue({ createSubscription })

    const webhookData = {
      provider: 'ashby',
      providerConfig: { apiKey: '{{ASHBY_API_KEY}}', triggerId: 'ashby_application_submit' },
    }
    const workflow = { id: 'wf-1', workspaceId: 'ws-1' }

    await createExternalWebhookSubscription(
      {} as NextRequest,
      webhookData,
      workflow,
      'user-1',
      'req-1'
    )

    expect(mockGetEffectiveDecryptedEnv).toHaveBeenCalledWith('user-1', 'ws-1')
    const passedWebhook = createSubscription.mock.calls[0][0].webhook
    expect(passedWebhook.providerConfig.apiKey).toBe('real-secret-key')
  })

  it('persists the unresolved providerConfig, not the resolved one, back to the caller', async () => {
    const createSubscription = vi.fn().mockResolvedValue({
      providerConfigUpdates: { externalId: 'ext-1' },
    })
    mockGetProviderHandler.mockReturnValue({ createSubscription })

    const webhookData = {
      provider: 'ashby',
      providerConfig: { apiKey: '{{ASHBY_API_KEY}}', triggerId: 'ashby_application_submit' },
    }
    const workflow = { id: 'wf-1', workspaceId: 'ws-1' }

    const result = await createExternalWebhookSubscription(
      {} as NextRequest,
      webhookData,
      workflow,
      'user-1',
      'req-1'
    )

    expect(result.updatedProviderConfig.apiKey).toBe('{{ASHBY_API_KEY}}')
    expect(result.updatedProviderConfig.externalId).toBe('ext-1')
  })

  it('falls back to personal-only env resolution when workspaceId is not a string', async () => {
    const createSubscription = vi.fn().mockResolvedValue({
      providerConfigUpdates: { externalId: 'ext-1' },
    })
    mockGetProviderHandler.mockReturnValue({ createSubscription })

    const webhookData = {
      provider: 'ashby',
      providerConfig: { apiKey: '{{ASHBY_API_KEY}}', triggerId: 'ashby_application_submit' },
    }
    const workflow = { id: 'wf-1', workspaceId: null }

    await createExternalWebhookSubscription(
      {} as NextRequest,
      webhookData,
      workflow,
      'user-1',
      'req-1'
    )

    expect(mockGetEffectiveDecryptedEnv).toHaveBeenCalledWith('user-1', undefined)
  })

  it('skips resolution and provider call entirely when the provider has no createSubscription', async () => {
    mockGetProviderHandler.mockReturnValue({})

    const webhookData = {
      provider: 'slack',
      providerConfig: { token: '{{SLACK_TOKEN}}' },
    }
    const workflow = { id: 'wf-1', workspaceId: 'ws-1' }

    const result = await createExternalWebhookSubscription(
      {} as NextRequest,
      webhookData,
      workflow,
      'user-1',
      'req-1'
    )

    expect(mockGetEffectiveDecryptedEnv).not.toHaveBeenCalled()
    expect(result.externalSubscriptionCreated).toBe(false)
    expect(result.updatedProviderConfig.token).toBe('{{SLACK_TOKEN}}')
  })
})

describe('cleanupExternalWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetEffectiveDecryptedEnv.mockResolvedValue({ CALENDLY_API_KEY: 'real-secret-key' })
  })

  it('resolves {{ENV_VAR}} references before deleting the provider subscription', async () => {
    const deleteSubscription = vi.fn().mockResolvedValue(undefined)
    mockGetProviderHandler.mockReturnValue({ deleteSubscription })

    const webhook = {
      id: 'webhook-1',
      provider: 'calendly',
      providerConfig: {
        apiKey: '{{CALENDLY_API_KEY}}',
        externalId: 'external-1',
      },
    }
    const workflow = {
      id: 'workflow-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    }

    await cleanupExternalWebhook(webhook, workflow, 'request-1')

    expect(mockGetEffectiveDecryptedEnv).toHaveBeenCalledWith('user-1', 'workspace-1')
    expect(deleteSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook: expect.objectContaining({
          providerConfig: {
            apiKey: 'real-secret-key',
            externalId: 'external-1',
          },
        }),
      })
    )
    expect(webhook.providerConfig.apiKey).toBe('{{CALENDLY_API_KEY}}')
  })
})
