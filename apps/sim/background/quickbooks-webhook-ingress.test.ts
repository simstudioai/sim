/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDispatch, mockEnqueue, mockFindPage } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockEnqueue: vi.fn(),
  mockFindPage: vi.fn(),
}))
vi.mock('@trigger.dev/sdk', () => ({ task: vi.fn((config: unknown) => config) }))
vi.mock('@/lib/webhooks/processor', () => ({ dispatchResolvedWebhookTarget: mockDispatch }))
vi.mock('@/background/quickbooks-webhook-targets', () => ({
  findQuickBooksWebhookTargetPage: mockFindPage,
}))
vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: vi.fn(async () => ({ enqueue: mockEnqueue })),
}))

import {
  enqueueQuickBooksWebhookIngress,
  executeQuickBooksWebhookIngress,
  type QuickBooksWebhookIngressPayload,
} from '@/background/quickbooks-webhook-ingress'

const event = {
  specversion: '1.0',
  id: 'event-1',
  source: 'quickbooks-online',
  type: 'qbo.invoice.created.v1',
  time: '2026-08-03T12:00:00Z',
  intuitentityid: '123',
  intuitaccountid: '456',
}
const payload: QuickBooksWebhookIngressPayload = {
  events: [event, { ...event, id: 'event-2', intuitaccountid: '789' }],
  headers: { 'content-type': 'application/json' },
  requestId: 'request-1',
  receivedAt: 1,
}

describe('QuickBooks webhook ingress job', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnqueue.mockResolvedValue('job-1')
  })

  it('routes one event to one company and dispatches targets sequentially', async () => {
    const order: string[] = []
    mockFindPage.mockResolvedValue({
      hasMore: false,
      nextCursor: null,
      targets: [
        { webhook: { id: 'w1' }, workflow: { id: 'wf1' } },
        { webhook: { id: 'w2' }, workflow: { id: 'wf2' } },
      ],
    })
    mockDispatch.mockImplementation(async (webhook: { id: string }) => {
      order.push(webhook.id)
      return { outcome: 'queued' }
    })
    await expect(executeQuickBooksWebhookIngress(payload)).resolves.toEqual({
      failed: 0,
      ignored: 0,
      processed: 2,
      targetCount: 2,
    })
    expect(mockFindPage).toHaveBeenCalledWith('456', 'request-1', undefined)
    expect(order).toEqual(['w1', 'w2'])
  })

  it('continues target pages before advancing to the next event', async () => {
    mockFindPage.mockResolvedValue({
      hasMore: true,
      nextCursor: 'webhook-100',
      targets: [],
    })
    await enqueueQuickBooksWebhookIngress(payload)
    const options = mockEnqueue.mock.calls[0][2] as { runner: () => Promise<void> }
    await options.runner()
    expect(mockEnqueue).toHaveBeenNthCalledWith(
      2,
      'quickbooks-webhook-ingress',
      expect.objectContaining({ afterWebhookId: 'webhook-100' }),
      expect.objectContaining({
        jobId: 'quickbooks-webhook-ingress:request-1:0:webhook-100',
      })
    )
  })

  it('advances to the next event only after the current event finishes', async () => {
    mockFindPage.mockResolvedValue({ hasMore: false, nextCursor: null, targets: [] })
    await enqueueQuickBooksWebhookIngress(payload)
    const options = mockEnqueue.mock.calls[0][2] as { runner: () => Promise<void> }
    await options.runner()
    expect(mockEnqueue).toHaveBeenNthCalledWith(
      2,
      'quickbooks-webhook-ingress',
      expect.objectContaining({ eventIndex: 1, afterWebhookId: undefined }),
      expect.objectContaining({ jobId: 'quickbooks-webhook-ingress:request-1:1:root' })
    )
  })

  it('durably continues the batch before retrying a failed target page', async () => {
    mockFindPage.mockResolvedValue({
      hasMore: false,
      nextCursor: null,
      targets: [{ webhook: { id: 'w1' }, workflow: { id: 'wf1' } }],
    })
    mockDispatch.mockResolvedValue({ outcome: 'failed' })

    await enqueueQuickBooksWebhookIngress(payload)
    const options = mockEnqueue.mock.calls[0][2] as { runner: () => Promise<void> }
    await expect(options.runner()).rejects.toThrow('Failed to dispatch 1 of 1 QuickBooks targets')
    expect(mockEnqueue).toHaveBeenNthCalledWith(
      2,
      'quickbooks-webhook-ingress',
      expect.objectContaining({ eventIndex: 1, afterWebhookId: undefined }),
      expect.objectContaining({ jobId: 'quickbooks-webhook-ingress:request-1:1:root' })
    )
  })
})
