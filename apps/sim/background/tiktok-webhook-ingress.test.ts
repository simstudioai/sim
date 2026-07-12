/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDispatchResolvedWebhookTarget, mockFindTikTokWebhookTargets } = vi.hoisted(() => ({
  mockDispatchResolvedWebhookTarget: vi.fn(),
  mockFindTikTokWebhookTargets: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  task: vi.fn((config: unknown) => config),
}))

vi.mock('@/lib/webhooks/processor', () => ({
  dispatchResolvedWebhookTarget: mockDispatchResolvedWebhookTarget,
}))

vi.mock('@/lib/webhooks/providers/tiktok-targets', () => ({
  findTikTokWebhookTargets: mockFindTikTokWebhookTargets,
}))

import {
  executeTikTokWebhookIngress,
  type TikTokWebhookIngressPayload,
} from '@/background/tiktok-webhook-ingress'

const payload: TikTokWebhookIngressPayload = {
  envelope: {
    client_key: 'client-key',
    event: 'post.publish.complete',
    create_time: 1_725_000_000,
    user_openid: 'act.user',
    content: '{"publish_id":"publish-1"}',
  },
  headers: { 'content-type': 'application/json' },
  requestId: 'request-1',
  receivedAt: 1_725_000_000_000,
}

const targets = [
  {
    webhook: { id: 'webhook-1', path: 'tiktok', provider: 'tiktok' },
    workflow: { id: 'workflow-1' },
  },
  {
    webhook: { id: 'webhook-2', path: 'tiktok', provider: 'tiktok' },
    workflow: { id: 'workflow-2' },
  },
]

describe('executeTikTokWebhookIngress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('acknowledges deliveries without active targets', async () => {
    mockFindTikTokWebhookTargets.mockResolvedValue([])

    await expect(executeTikTokWebhookIngress(payload)).resolves.toEqual({
      ignored: 0,
      processed: 0,
      targetCount: 0,
    })
    expect(mockDispatchResolvedWebhookTarget).not.toHaveBeenCalled()
  })

  it('dispatches every resolved target and reports typed outcomes', async () => {
    mockFindTikTokWebhookTargets.mockResolvedValue(targets)
    mockDispatchResolvedWebhookTarget
      .mockResolvedValueOnce({
        outcome: 'queued',
        reason: 'queued',
        response: new Response(null, { status: 200 }),
      })
      .mockResolvedValueOnce({
        outcome: 'ignored',
        reason: 'event-mismatch',
        response: new Response(null, { status: 200 }),
      })

    await expect(executeTikTokWebhookIngress(payload)).resolves.toEqual({
      ignored: 1,
      processed: 1,
      targetCount: 2,
    })
    expect(mockDispatchResolvedWebhookTarget).toHaveBeenCalledTimes(2)
  })

  it('throws after a target failure so the durable ingress job retries', async () => {
    mockFindTikTokWebhookTargets.mockResolvedValue(targets)
    mockDispatchResolvedWebhookTarget
      .mockResolvedValueOnce({
        outcome: 'queued',
        reason: 'queued',
        response: new Response(null, { status: 200 }),
      })
      .mockResolvedValueOnce({
        outcome: 'failed',
        reason: 'queue-failed',
        response: new Response(null, { status: 500 }),
      })

    await expect(executeTikTokWebhookIngress(payload)).rejects.toThrow(
      'Failed to dispatch 1 of 2 TikTok webhook targets'
    )
  })
})
