/** @vitest-environment node */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), enabled: true, insideRun: false }))
vi.mock('@sim/db', () => dbChainMock)
vi.mock('@trigger.dev/sdk', () => ({ runs: { list: mocks.list } }))
vi.mock('@/lib/core/config/env-flags', () => ({
  get isTriggerDevEnabled() {
    return mocks.enabled
  },
}))
vi.mock('@/lib/core/config/trigger-runtime', () => ({
  isInsideTriggerRun: () => mocks.insideRun,
}))

import { filterAbandonedDocumentProcessing } from '@/lib/knowledge/documents/processing-recovery-queue'

const candidate = {
  id: 'document-1',
  processingQueueToken: 'generation-1',
  processingQueuedAt: new Date('2026-01-01T00:00:00Z'),
  processingStartedAt: null,
  uploadedAt: new Date('2026-01-01T00:00:00Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.enabled = true
  mocks.insideRun = false
  mocks.list.mockResolvedValue({ data: [] })
})
afterEach(() => vi.useRealTimers())

it.each(['PENDING_VERSION', 'DELAYED', 'QUEUED', 'DEQUEUED', 'EXECUTING', 'WAITING'])(
  'preserves a %s run regardless of queue age, without spending another attempt',
  async (status) => {
    mocks.list.mockResolvedValue({ data: [{ id: 'run-1', status }] })
    expect(await filterAbandonedDocumentProcessing([candidate])).toEqual([])
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        taskIdentifier: 'knowledge-process-document',
        tag: 'documentId:document-1',
        from: new Date('2025-12-31T20:00:00Z'),
        status: expect.arrayContaining([status]),
        limit: 1,
      }),
      { retry: { maxAttempts: 1 } }
    )
    expect(dbChainMockFns.set).toHaveBeenCalledExactlyOnceWith({
      processingRecoveryAfter: expect.any(Date),
    })
  }
)

it('allows the existing recovery policy after confirming no live job remains', async () => {
  expect(await filterAbandonedDocumentProcessing([candidate])).toEqual([candidate])
  expect(dbChainMockFns.set).not.toHaveBeenCalled()
})

it('fails closed and backs off when the queue cannot be inspected', async () => {
  mocks.list.mockRejectedValue(new Error('unavailable'))
  expect(await filterAbandonedDocumentProcessing([candidate])).toEqual([])
  expect(dbChainMockFns.set).toHaveBeenCalledExactlyOnceWith({
    processingRecoveryAfter: expect.any(Date),
  })
})

it('bounds concurrency and stops scheduling further lookups after the deadline', async () => {
  vi.useFakeTimers()
  const candidates = Array.from({ length: 200 }, (_, index) => ({
    ...candidate,
    id: `doc-${index}`,
  }))
  let finishLookup: (value: { data: [] }) => void = () => undefined
  mocks.list.mockReturnValue(
    new Promise((resolve) => {
      finishLookup = resolve
    })
  )
  const pending = filterAbandonedDocumentProcessing(candidates)
  await vi.advanceTimersByTimeAsync(10_001)
  expect(await pending).toEqual([])
  expect(mocks.list).toHaveBeenCalledTimes(4)
  finishLookup({ data: [] })
  await vi.runAllTimersAsync()
  expect(mocks.list).toHaveBeenCalledTimes(4)
})

it('keeps completed checks when another lookup fails, without recovering unknown jobs', async () => {
  mocks.list.mockResolvedValueOnce({ data: [] }).mockRejectedValueOnce(new Error('unavailable'))
  expect(
    await filterAbandonedDocumentProcessing([candidate, { ...candidate, id: 'doc-2' }])
  ).toEqual([candidate])
})

it('does not look up Trigger runs on a deployment without Trigger', async () => {
  mocks.enabled = false
  expect(await filterAbandonedDocumentProcessing([candidate])).toEqual([candidate])
  expect(mocks.list).not.toHaveBeenCalled()
})

it('still inspects the queue inside a Trigger worker with a disabled environment flag', async () => {
  mocks.enabled = false
  mocks.insideRun = true
  mocks.list.mockResolvedValue({ data: [{ id: 'run-1' }] })
  expect(await filterAbandonedDocumentProcessing([candidate])).toEqual([])
})

it('does not mutate any recovery state when the caller is canceled', async () => {
  const controller = new AbortController()
  controller.abort(new Error('canceled'))
  await expect(filterAbandonedDocumentProcessing([candidate], controller.signal)).rejects.toThrow(
    'canceled'
  )
  expect(dbChainMockFns.set).not.toHaveBeenCalled()
})
