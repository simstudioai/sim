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

  it('routes the batch by company and dispatches targets sequentially', async () => {
    const order: string[] = []
    mockFindPage
      .mockResolvedValueOnce({
        hasMore: true,
        nextCursor: 'w2',
        targets: [
          { webhook: { id: 'w1' }, workflow: { id: 'wf1' } },
          { webhook: { id: 'w2' }, workflow: { id: 'wf2' } },
        ],
      })
      .mockResolvedValueOnce({
        hasMore: false,
        nextCursor: null,
        targets: [{ webhook: { id: 'w3' }, workflow: { id: 'wf3' } }],
      })
      .mockResolvedValueOnce({
        hasMore: false,
        nextCursor: null,
        targets: [{ webhook: { id: 'w4' }, workflow: { id: 'wf4' } }],
      })
    mockDispatch.mockImplementation(async (webhook: { id: string }) => {
      order.push(webhook.id)
      return { outcome: 'queued' }
    })
    await expect(executeQuickBooksWebhookIngress(payload)).resolves.toEqual({
      failed: 0,
      ignored: 0,
      processed: 4,
      targetCount: 4,
    })
    expect(mockFindPage).toHaveBeenCalledWith('456', 'request-1', undefined)
    expect(mockFindPage).toHaveBeenCalledWith('456', 'request-1', 'w2')
    expect(mockFindPage).toHaveBeenCalledWith('789', 'request-1', undefined)
    expect(order).toEqual(['w1', 'w2', 'w3', 'w4'])
  })

  it('enqueues the bounded delivery once without copying it into continuation jobs', async () => {
    mockFindPage.mockResolvedValue({ hasMore: false, nextCursor: null, targets: [] })
    await enqueueQuickBooksWebhookIngress(payload)
    const options = mockEnqueue.mock.calls[0][2] as { runner: () => Promise<void> }
    await options.runner()
    expect(mockEnqueue).toHaveBeenCalledOnce()
    expect(mockEnqueue).toHaveBeenCalledWith(
      'quickbooks-webhook-ingress',
      payload,
      expect.objectContaining({
        jobId: 'quickbooks-webhook-ingress:request-1',
      })
    )
  })

  it('continues later events before retrying a delivery with failed targets', async () => {
    mockFindPage
      .mockResolvedValueOnce({
        hasMore: false,
        nextCursor: null,
        targets: [
          { webhook: { id: 'w1' }, workflow: { id: 'wf1' } },
          { webhook: { id: 'w2' }, workflow: { id: 'wf2' } },
        ],
      })
      .mockResolvedValueOnce({
        hasMore: false,
        nextCursor: null,
        targets: [{ webhook: { id: 'w3' }, workflow: { id: 'wf3' } }],
      })
    mockDispatch
      .mockRejectedValueOnce(new Error('dispatch unavailable'))
      .mockResolvedValueOnce({ outcome: 'failed' })
      .mockResolvedValueOnce({ outcome: 'queued' })

    await enqueueQuickBooksWebhookIngress(payload)
    const options = mockEnqueue.mock.calls[0][2] as { runner: () => Promise<void> }
    await expect(options.runner()).rejects.toThrow(
      'QuickBooks webhook delivery completed with 2 failures'
    )
    expect(mockFindPage).toHaveBeenCalledWith('789', 'request-1', undefined)
    expect(mockDispatch).toHaveBeenCalledTimes(3)
    expect(mockEnqueue).toHaveBeenCalledOnce()
  })

  it('continues later events when a target page cannot be resolved', async () => {
    mockFindPage
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ hasMore: false, nextCursor: null, targets: [] })

    await expect(executeQuickBooksWebhookIngress(payload)).resolves.toEqual({
      failed: 1,
      ignored: 0,
      processed: 0,
      targetCount: 0,
    })
    expect(mockFindPage).toHaveBeenCalledWith('789', 'request-1', undefined)
  })
})
