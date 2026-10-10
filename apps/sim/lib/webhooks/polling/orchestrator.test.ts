import { webhook } from '@sim/db/schema'
import { createWorkflowRecord } from '@sim/testing'
import { queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { createMockRedis } from '@sim/testing/mocks/redis.mock'
import { redisConfigMockFns, resetRedisConfigMock } from '@sim/testing/mocks/redis-config.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPollWebhook } = vi.hoisted(() => ({ mockPollWebhook: vi.fn() }))

vi.mock('@/lib/webhooks/polling/registry', () => ({
  getPollingHandler: () => ({ provider: 'rss', label: 'RSS', pollWebhook: mockPollWebhook }),
}))

import { recordPollAdmissionRefusal } from '@/lib/webhooks/polling/admission-refusals'
import { pollProvider } from '@/lib/webhooks/polling/orchestrator'
import type { WebhookRecord } from '@/lib/webhooks/polling/types'

function activeEntry(
  id: string,
  workspaceId: string,
  providerConfig: Record<string, unknown> = {}
) {
  return {
    webhook: {
      id,
      workflowId: `workflow-${id}`,
      deploymentVersionId: null,
      registrationStatus: null,
      registrationGeneration: null,
      configFingerprint: null,
      preparedAt: null,
      blockId: null,
      path: id,
      routingKey: null,
      provider: 'rss',
      providerConfig,
      isActive: true,
      failedCount: 0,
      lastFailedAt: null,
      archivedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } satisfies WebhookRecord,
    workflow: createWorkflowRecord({ id: `workflow-${id}`, workspaceId }),
  }
}

/** Polled webhook ids, read from what the handler was asked to poll. */
const polledWebhookIds = () =>
  mockPollWebhook.mock.calls.map(([ctx]) => (ctx as { webhookData: WebhookRecord }).webhookData.id)

describe('pollProvider skips', () => {
  beforeEach(() => {
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: true })
    const store = new Map<string, string>()
    const redis = createMockRedis()
    redis.set.mockImplementation(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    })
    Object.assign(redis, {
      mget: vi.fn(async (...keys: string[]) => keys.map((key) => store.get(key) ?? null)),
    })
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis)
    mockPollWebhook.mockResolvedValue('success')
  })

  afterEach(() => {
    resetEnvFlagsMock()
    resetRedisConfigMock()
  })

  it('does not poll a workspace whose polled event admission recently refused', async () => {
    await recordPollAdmissionRefusal('refused-workspace')
    queueTableRows(webhook, [
      activeEntry('refused', 'refused-workspace'),
      activeEntry('healthy', 'healthy-workspace'),
    ])

    const summary = await pollProvider('rss')

    expect(polledWebhookIds()).toEqual(['healthy'])
    expect(summary).toMatchObject({ successful: 1, skipped: 1, failed: 0 })
  })

  it('does not poll a webhook still inside its source backoff window', async () => {
    queueTableRows(webhook, [
      activeEntry('backing-off', 'workspace-1', {
        pollBackoffUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
      activeEntry('due', 'workspace-1', {
        pollBackoffUntil: new Date(Date.now() - 1000).toISOString(),
      }),
    ])

    await pollProvider('rss')

    expect(polledWebhookIds()).toEqual(['due'])
  })

  it('polls every workspace when billing is disabled', async () => {
    await recordPollAdmissionRefusal('refused-workspace')
    setEnvFlags({ isBillingEnabled: false })
    queueTableRows(webhook, [activeEntry('refused', 'refused-workspace')])

    await pollProvider('rss')

    expect(polledWebhookIds()).toEqual(['refused'])
  })
})
