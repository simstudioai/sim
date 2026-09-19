/** @vitest-environment node */
import { dbChainMockFns, resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { listRuns } = vi.hoisted(() => ({ listRuns: vi.fn() }))
vi.mock('@trigger.dev/core/v3', () => ({
  taskContext: { isInsideTask: false },
  ListRunResponseItem: {},
  apiClientManager: {
    clientOrThrow: () => ({
      baseUrl: 'https://api.trigger.dev',
      getHeaders: () => ({
        Authorization: 'Bearer fixture-key',
        'x-trigger-branch': 'fixture-branch',
      }),
    }),
  },
}))
vi.mock('@trigger.dev/core/v3/zodfetch', () => ({ zodfetchCursorPage: listRuns }))

import { env } from '@/lib/core/config/env'
import { resetInsideTriggerRunForTests } from '@/lib/core/config/trigger-runtime'
import {
  DOCUMENT_LIVENESS_BATCH_SIZE,
  type DocumentProcessingSnapshot,
  findAbandonedDocumentProcessing,
} from '@/lib/knowledge/documents/processing-liveness'

const snapshot: DocumentProcessingSnapshot = {
  id: 'doc-1',
  processingStatus: 'pending',
  processingQueueToken: 'generation-1',
  processingQueuedAt: new Date('2026-09-01T00:00:00Z'),
  processingStartedAt: null,
  processingDeferredUntil: null,
  processingCompletedAt: null,
  processingRecoveryAfter: null,
}
const originalSecret = env.TRIGGER_SECRET_KEY
beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  resetInsideTriggerRunForTests()
  setEnvFlags({ isTriggerDevEnabled: true })
  env.TRIGGER_SECRET_KEY = 'test-secret'
  listRuns.mockReset().mockResolvedValue({ data: [], hasNextPage: () => false })
})
afterEach(() => {
  env.TRIGGER_SECRET_KEY = originalSecret
  resetEnvFlagsMock()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('document processing liveness', () => {
  it.each(['QUEUED', 'DELAYED', 'WAITING', 'EXECUTING', 'PENDING_VERSION', 'DEQUEUED'])(
    'preserves an old document with a %s job without spending an attempt',
    async (status) => {
      listRuns.mockResolvedValue({ data: [{ status }], hasNextPage: () => false })
      expect(await findAbandonedDocumentProcessing([snapshot])).toEqual([])
      expect(dbChainMockFns.set).toHaveBeenCalledWith({ processingRecoveryAfter: expect.any(Date) })
      expect(dbChainMockFns.delete).not.toHaveBeenCalled()
      expect(listRuns).toHaveBeenCalledWith(
        expect.anything(),
        'https://api.trigger.dev/api/v1/runs',
        expect.objectContaining({
          query: expect.any(URLSearchParams),
          limit: 1,
        }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
        { retry: { maxAttempts: 1 } }
      )
      const params = listRuns.mock.calls[0][2].query as URLSearchParams
      expect(params.get('filter[tag]')).toBe('documentId:doc-1')
      expect(params.get('filter[taskIdentifier]')).toBe('knowledge-process-document')
      expect(params.get('filter[status]')?.split(',')).toEqual(
        expect.arrayContaining([
          'QUEUED',
          'WAITING',
          'DELAYED',
          'EXECUTING',
          'DEQUEUED',
          'PENDING_VERSION',
        ])
      )
    }
  )

  it('allows recovery only when no live run or outbox carrier remains', async () => {
    expect(await findAbandonedDocumentProcessing([snapshot])).toEqual([snapshot])
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  it('protects a pending outbox delivery without contacting Trigger', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: snapshot.processingQueueToken }])
    expect(await findAbandonedDocumentProcessing([snapshot])).toEqual([])
    expect(listRuns).not.toHaveBeenCalled()
  })

  it('protects legacy jobs without a generation token', async () => {
    listRuns.mockResolvedValue({ data: [{ status: 'QUEUED' }], hasNextPage: () => false })
    expect(
      await findAbandonedDocumentProcessing([{ ...snapshot, processingQueueToken: null }])
    ).toEqual([])
  })

  it.each(['rejected', 'incomplete'])('fails closed on %s job evidence', async (mode) => {
    if (mode === 'rejected') listRuns.mockRejectedValue(new Error('provider unavailable'))
    else listRuns.mockResolvedValue({ data: [], hasNextPage: () => true })
    expect(await findAbandonedDocumentProcessing([snapshot])).toEqual([])
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ processingRecoveryAfter: expect.any(Date) })
  })

  it('does not substitute missing outbox evidence for abandonment', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('database unavailable'))
    expect(await findAbandonedDocumentProcessing([snapshot])).toEqual([])
    expect(listRuns).not.toHaveBeenCalled()
  })

  it('bounds stalled lookups and starts no more than four requests after the deadline', async () => {
    vi.useFakeTimers()
    listRuns.mockImplementation(() => new Promise(() => {}))
    const candidates = Array.from({ length: 20 }, (_, i) => ({ ...snapshot, id: `doc-${i}` }))
    const result = findAbandonedDocumentProcessing(candidates)
    await vi.advanceTimersByTimeAsync(8_000)
    expect(await result).toEqual([])
    expect(listRuns).toHaveBeenCalledTimes(4)
  })

  it('retains recovery on installations using the in-process fallback', async () => {
    env.TRIGGER_SECRET_KEY = undefined
    expect(await findAbandonedDocumentProcessing([snapshot])).toEqual([snapshot])
    expect(listRuns).not.toHaveBeenCalled()
  })

  it('refuses an unbounded candidate batch before reading external state', async () => {
    await expect(
      findAbandonedDocumentProcessing(
        Array.from({ length: DOCUMENT_LIVENESS_BATCH_SIZE + 1 }, () => snapshot)
      )
    ).rejects.toThrow('exceeds its limit')
    expect(listRuns).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('keeps live work protected even when persisting its cooldown fails', async () => {
    listRuns.mockResolvedValue({ data: [{ status: 'QUEUED' }], hasNextPage: () => false })
    dbChainMockFns.update.mockImplementationOnce(() => {
      throw new Error('database lock timeout')
    })
    expect(await findAbandonedDocumentProcessing([snapshot])).toEqual([])
  })

  it('preserves caller cancellation without resetting a generation', async () => {
    const signal = AbortSignal.abort(new Error('cancelled'))
    await expect(findAbandonedDocumentProcessing([snapshot], signal)).rejects.toBe(signal.reason)
    expect(listRuns).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })
})
