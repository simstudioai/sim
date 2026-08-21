/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@/lib/knowledge/documents/processing-outbox-event', () => ({
  enqueueKnowledgeDocumentProcessing: vi.fn(),
}))
vi.mock('@/lib/uploads', () => ({ StorageService: {} }))
vi.mock('@/connectors/registry.server', () => ({ CONNECTOR_REGISTRY: {} }))

import { isStuckDocumentSweepEligible } from '@/lib/knowledge/connectors/sync-engine'
import {
  processDocumentsWithQueue,
  retryDocumentProcessing,
} from '@/lib/knowledge/documents/service'

const DOC_DATA = {
  filename: 'report.pdf',
  fileUrl: 'https://example.com/report.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
}

/**
 * Runs the requeue and returns the values it wrote. Dispatch runs after the
 * reset transaction and needs infrastructure this test does not stand up, so a
 * throw from it is expected and irrelevant to the reset itself.
 */
async function captureRequeueValues(): Promise<Record<string, unknown>> {
  await retryDocumentProcessing('kb-1', 'doc-1', DOC_DATA, 'req-1', undefined).catch(() => {})

  const resetCall = dbChainMockFns.set.mock.calls.find(
    (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === 'pending'
  )
  expect(resetCall).toBeDefined()
  return resetCall?.[0] as Record<string, unknown>
}

describe('retryDocumentProcessing requeue stamp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('stamps the requeue time on the dispatch column', async () => {
    const before = Date.now()
    const values = await captureRequeueValues()
    const after = Date.now()

    expect(values.processingQueuedAt).toBeInstanceOf(Date)
    const stamp = values.processingQueuedAt as Date
    expect(stamp.getTime()).toBeGreaterThanOrEqual(before)
    expect(stamp.getTime()).toBeLessThanOrEqual(after)
    expect(values.processingCompletedAt).toBeNull()
  })

  it('leaves processingStartedAt null so the API reports no start time', async () => {
    const values = await captureRequeueValues()

    expect(values.processingStartedAt).toBeNull()
  })

  it('leaves the requeued document outside the reach of the next connector sync', async () => {
    const values = await captureRequeueValues()
    const uploadedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const sweptAt = new Date(Date.now() + 60 * 1000)

    expect(
      isStuckDocumentSweepEligible(
        {
          processingStatus: values.processingStatus as string,
          processingQueuedAt: values.processingQueuedAt as Date | null,
          processingStartedAt: values.processingStartedAt as Date | null,
          uploadedAt,
        },
        sweptAt
      )
    ).toBe(false)

    expect(
      isStuckDocumentSweepEligible(
        {
          processingStatus: 'pending',
          processingQueuedAt: null,
          processingStartedAt: null,
          uploadedAt,
        },
        sweptAt
      )
    ).toBe(true)
  })
})

describe('processDocumentsWithQueue dispatch stamp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([{ userId: 'user-1', workspaceId: null }])
  })

  /**
   * The dispatch itself needs Trigger.dev infrastructure this test does not
   * stand up; the stamp is written before it, so a later throw is irrelevant.
   */
  async function dispatch(): Promise<void> {
    await processDocumentsWithQueue(
      [{ documentId: 'doc-1', ...DOC_DATA }],
      'kb-1',
      {},
      'req-1',
      undefined
    ).catch(() => {})
  }

  it('stamps the queue time and clears any leftover start time', async () => {
    const before = Date.now()
    await dispatch()
    const after = Date.now()

    const stampCall = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingQueuedAt !== undefined
    )
    expect(stampCall).toBeDefined()
    const values = stampCall?.[0] as Record<string, unknown>

    expect(values.processingQueuedAt).toBeInstanceOf(Date)
    const stamp = values.processingQueuedAt as Date
    expect(stamp.getTime()).toBeGreaterThanOrEqual(before)
    expect(stamp.getTime()).toBeLessThanOrEqual(after)
    expect(values.processingStartedAt).toBeNull()
  })
})
