/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDispatchResolvedWebhookTarget, mockEnqueue, mockFindTikTokWebhookTargetPage } =
  vi.hoisted(() => ({
    mockDispatchResolvedWebhookTarget: vi.fn(),
    mockEnqueue: vi.fn(),
    mockFindTikTokWebhookTargetPage: vi.fn(),
  }))

vi.mock('@trigger.dev/sdk', () => ({
  task: vi.fn((config: unknown) => config),
}))

vi.mock('@/lib/webhooks/processor', () => ({
  dispatchResolvedWebhookTarget: mockDispatchResolvedWebhookTarget,
}))

vi.mock('@/lib/webhooks/providers/tiktok-targets', () => ({
  findTikTokWebhookTargetPage: mockFindTikTokWebhookTargetPage,
}))
vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: vi.fn(async () => ({ enqueue: mockEnqueue })),
}))

import {
  enqueueTikTokWebhookIngress,
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

const firstTarget = {
  webhook: { id: 'webhook-1', path: 'tiktok', provider: 'tiktok' },
  workflow: { id: 'workflow-1' },
}
const secondTarget = {
  webhook: { id: 'webhook-2', path: 'tiktok', provider: 'tiktok' },
  workflow: { id: 'workflow-2' },
}

describe('executeTikTokWebhookIngress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnqueue.mockResolvedValue('ingress-job-1')
  })

  it('acknowledges deliveries without active targets', async () => {
    mockFindTikTokWebhookTargetPage.mockResolvedValue({
      hasMore: false,
      nextCursor: null,
      targets: [],
    })

    await expect(executeTikTokWebhookIngress(payload)).resolves.toEqual({
      ignored: 0,
      processed: 0,
      targetCount: 0,
    })
    expect(mockDispatchResolvedWebhookTarget).not.toHaveBeenCalled()
  })

  it('dispatches one bounded page and returns its continuation cursor', async () => {
    const events: string[] = []
    mockFindTikTokWebhookTargetPage.mockImplementationOnce(async () => {
      events.push('page-1')
      return {
        hasMore: true,
        nextCursor: 'webhook-1',
        targets: [firstTarget],
      }
    })
    mockDispatchResolvedWebhookTarget.mockImplementationOnce(async () => {
      events.push('dispatch-1')
      return {
        outcome: 'queued',
        reason: 'queued',
        response: new Response(null, { status: 200 }),
      }
    })

    await expect(executeTikTokWebhookIngress(payload)).resolves.toEqual({
      ignored: 0,
      nextCursor: 'webhook-1',
      processed: 1,
      targetCount: 1,
    })
    expect(events).toEqual(['page-1', 'dispatch-1'])
    expect(mockFindTikTokWebhookTargetPage).toHaveBeenNthCalledWith(
      1,
      'act.user',
      'request-1',
      undefined
    )
  })

  it('enqueues the next page only after the current page succeeds', async () => {
    mockFindTikTokWebhookTargetPage.mockResolvedValue({
      hasMore: true,
      nextCursor: 'webhook-1',
      targets: [firstTarget],
    })
    mockDispatchResolvedWebhookTarget.mockResolvedValue({
      outcome: 'queued',
      reason: 'queued',
      response: new Response(null, { status: 200 }),
    })

    await enqueueTikTokWebhookIngress(payload)
    const options = mockEnqueue.mock.calls[0][2] as { runner: () => Promise<void> }
    await options.runner()

    expect(mockEnqueue).toHaveBeenNthCalledWith(
      2,
      'tiktok-webhook-ingress',
      expect.objectContaining({ afterWebhookId: 'webhook-1' }),
      expect.objectContaining({
        jobId: 'tiktok-webhook-ingress:request-1:webhook-1',
      })
    )
  })

  it('throws after a target failure so the durable ingress job retries', async () => {
    mockFindTikTokWebhookTargetPage.mockResolvedValueOnce({
      hasMore: false,
      nextCursor: 'webhook-2',
      targets: [firstTarget, secondTarget],
    })
    mockDispatchResolvedWebhookTarget
      .mockResolvedValueOnce({
        outcome: 'failed',
        reason: 'queue-failed',
        response: new Response(null, { status: 500 }),
      })
      .mockResolvedValueOnce({
        outcome: 'queued',
        reason: 'queued',
        response: new Response(null, { status: 200 }),
      })

    await expect(executeTikTokWebhookIngress(payload)).rejects.toThrow(
      'Failed to dispatch 1 of 2 TikTok webhook targets'
    )
    expect(mockDispatchResolvedWebhookTarget).toHaveBeenCalledTimes(2)
  })

  it('fails closed if a full target page does not provide a forward cursor', async () => {
    mockFindTikTokWebhookTargetPage.mockResolvedValue({
      hasMore: true,
      nextCursor: null,
      targets: [],
    })

    await expect(executeTikTokWebhookIngress(payload)).rejects.toThrow(
      'TikTok webhook target pagination did not advance'
    )
  })
})
