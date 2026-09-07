/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDispatch, mockEnqueue, mockFindWebhooks } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockEnqueue: vi.fn(),
  mockFindWebhooks: vi.fn(),
}))
vi.mock('@trigger.dev/sdk', () => ({
  task: vi.fn((config: unknown) => config),
}))
vi.mock('@/lib/webhooks/processor', () => ({
  dispatchResolvedWebhookTarget: mockDispatch,
  findWebhooksByRoutingKey: mockFindWebhooks,
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
  appKey: 'a'.repeat(43),
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
    mockFindWebhooks
      .mockResolvedValueOnce([
        { webhook: { id: 'w1' }, workflow: { id: 'wf1' } },
        { webhook: { id: 'w2' }, workflow: { id: 'wf2' } },
      ])
      .mockResolvedValueOnce([{ webhook: { id: 'w3' }, workflow: { id: 'wf3' } }])
    mockDispatch.mockImplementation(async (webhook: { id: string }) => {
      order.push(webhook.id)
      return { outcome: 'queued' }
    })
    await expect(executeQuickBooksWebhookIngress(payload)).resolves.toEqual({
      failed: 0,
      ignored: 0,
      processed: 3,
      targetCount: 3,
    })
    expect(mockFindWebhooks).toHaveBeenNthCalledWith(
      1,
      `${payload.appKey}:456`,
      'request-1',
      'quickbooks'
    )
    expect(mockFindWebhooks).toHaveBeenNthCalledWith(
      2,
      `${payload.appKey}:789`,
      'request-1',
      'quickbooks'
    )
    expect(order).toEqual(['w1', 'w2', 'w3'])
  })

  it('enqueues the bounded delivery once without copying it into continuation jobs', async () => {
    mockFindWebhooks.mockResolvedValue([])
    await enqueueQuickBooksWebhookIngress(payload)
    const options = mockEnqueue.mock.calls[0][2] as {
      runner: () => Promise<void>
    }
    await options.runner()
    expect(mockEnqueue).toHaveBeenCalledOnce()
    expect(mockEnqueue).toHaveBeenCalledWith(
      'quickbooks-webhook-ingress',
      payload,
      expect.objectContaining({
        jobId: expect.stringMatching(/^quickbooks-webhook-ingress:[A-Za-z0-9_-]{43}$/),
      })
    )
  })

  it('continues later events before retrying a delivery with failed targets', async () => {
    mockFindWebhooks
      .mockResolvedValueOnce([
        { webhook: { id: 'w1' }, workflow: { id: 'wf1' } },
        { webhook: { id: 'w2' }, workflow: { id: 'wf2' } },
      ])
      .mockResolvedValueOnce([{ webhook: { id: 'w3' }, workflow: { id: 'wf3' } }])
    mockDispatch
      .mockRejectedValueOnce(new Error('dispatch unavailable'))
      .mockResolvedValueOnce({ outcome: 'failed' })
      .mockResolvedValueOnce({ outcome: 'queued' })

    await enqueueQuickBooksWebhookIngress(payload)
    const options = mockEnqueue.mock.calls[0][2] as {
      runner: () => Promise<void>
    }
    await expect(options.runner()).rejects.toThrow(
      'QuickBooks webhook delivery completed with 2 failures'
    )
    expect(mockFindWebhooks).toHaveBeenCalledWith(
      `${payload.appKey}:789`,
      'request-1',
      'quickbooks'
    )
    expect(mockDispatch).toHaveBeenCalledTimes(3)
    expect(mockEnqueue).toHaveBeenCalledOnce()
  })

  it('ignores an event whose company identity can never be routed', async () => {
    mockFindWebhooks.mockResolvedValue([])
    const unroutablePayload: QuickBooksWebhookIngressPayload = {
      ...payload,
      events: [{ ...event, intuitaccountid: 'not-a-realm' }, payload.events[1]],
    }

    await expect(executeQuickBooksWebhookIngress(unroutablePayload)).resolves.toEqual({
      failed: 0,
      ignored: 1,
      processed: 0,
      targetCount: 0,
    })
    expect(mockFindWebhooks).toHaveBeenCalledOnce()
    expect(mockFindWebhooks).toHaveBeenCalledWith(
      `${payload.appKey}:789`,
      'request-1',
      'quickbooks'
    )
  })

  it('continues later events when targets cannot be resolved', async () => {
    mockFindWebhooks
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce([])

    await expect(executeQuickBooksWebhookIngress(payload)).resolves.toEqual({
      failed: 1,
      ignored: 0,
      processed: 0,
      targetCount: 0,
    })
    expect(mockFindWebhooks).toHaveBeenCalledWith(
      `${payload.appKey}:789`,
      'request-1',
      'quickbooks'
    )
  })
})
