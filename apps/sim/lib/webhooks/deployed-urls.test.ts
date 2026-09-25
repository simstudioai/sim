/**
 * @vitest-environment node
 */
import { webhook } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers/webhook-url', () => ({
  buildWebhookTriggerUrl: (path: string) => `https://sim.test/api/webhooks/trigger/${path}`,
  buildSlackCustomBotRequestUrl: (credentialId: string) =>
    `https://sim.test/api/webhooks/slack/custom/${credentialId}`,
}))

import { listDeployedWebhookUrls } from '@/lib/webhooks/deployed-urls'
import { LEGACY_SLACK_CUSTOM_BOT_INGRESS_MODE } from '@/lib/webhooks/slack-custom-ingress-constants'

afterAll(resetDbChainMock)

describe('listDeployedWebhookUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('resolves a path-addressed registration to the trigger URL the block displays', async () => {
    queueTableRows(webhook, [
      { blockId: 'block-1', provider: 'generic', path: 'leads', providerConfig: {} },
    ])

    await expect(listDeployedWebhookUrls('workflow-1')).resolves.toEqual([
      {
        blockId: 'block-1',
        provider: 'generic',
        url: 'https://sim.test/api/webhooks/trigger/leads',
      },
    ])
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: expect.arrayContaining([
          expect.objectContaining({ right: 'workflow-1' }),
          expect.objectContaining({ right: true }),
        ]),
      })
    )
  })

  it('resolves a Slack custom bot to its Request URL and skips shared-endpoint rows', async () => {
    queueTableRows(webhook, [
      {
        blockId: 'block-bot',
        provider: 'slack',
        path: null,
        providerConfig: {
          ingressMode: LEGACY_SLACK_CUSTOM_BOT_INGRESS_MODE,
          credentialId: 'cred-1',
          triggerId: 'slack_webhook',
        },
      },
      {
        blockId: 'block-native',
        provider: 'slack',
        path: null,
        providerConfig: { triggerId: 'x' },
      },
      { blockId: 'block-tiktok', provider: 'tiktok', path: null, providerConfig: null },
    ])

    await expect(listDeployedWebhookUrls('workflow-1')).resolves.toEqual([
      {
        blockId: 'block-bot',
        provider: 'slack',
        url: 'https://sim.test/api/webhooks/slack/custom/cred-1',
      },
    ])
  })
})
