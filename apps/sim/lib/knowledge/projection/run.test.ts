/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runProjection: vi.fn(),
  markUnfilled: vi.fn(),
  isFeatureEnabled: vi.fn(),
  end: vi.fn(),
  marks: vi.fn(),
}))

vi.mock('@sim/db', () => ({ resolveDbUrl: () => 'postgresql://fixture/sim_acl_test' }))
vi.mock('@sim/db/knowledge-projection', () => ({
  runKnowledgeProjection: mocks.runProjection,
  markUnfilledProjectionDocuments: mocks.markUnfilled,
}))
/** A session answering the backlog count; the projection itself is mocked above. */
vi.mock('postgres', () => ({
  default: () => Object.assign(async () => [{ marks: mocks.marks() }], { end: mocks.end }),
}))
vi.mock('@/lib/core/config/env', () => ({
  env: { KB_CONFIG_PROJECTION_CONCURRENCY: 2 },
  envNumber: (value: unknown, fallback: number) => (typeof value === 'number' ? value : fallback),
}))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: mocks.isFeatureEnabled }))

import { runKnowledgeProjectionPass } from '@/lib/knowledge/projection/run'

const drained = { settled: 1, deferred: 0, pages: 2, written: 3, remaining: false }

describe('runKnowledgeProjectionPass', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runProjection.mockResolvedValue(drained)
    mocks.isFeatureEnabled.mockResolvedValue(false)
    mocks.marks.mockReturnValue(2)
  })

  it('projects with one worker per connection and closes them all', async () => {
    await expect(runKnowledgeProjectionPass({ budgetMs: 60_000 })).resolves.toMatchObject({
      settled: 2,
      written: 6,
      filled: 0,
      remaining: false,
    })
    expect(mocks.runProjection).toHaveBeenCalledTimes(2)
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith('knowledge-projection-fill')
    expect(mocks.markUnfilled).not.toHaveBeenCalled()
    expect(mocks.end).toHaveBeenCalledTimes(2)
  })

  it('runs another round while workers still settle documents, and stops once none can', async () => {
    mocks.runProjection
      .mockResolvedValueOnce({ ...drained, remaining: true })
      .mockResolvedValueOnce(drained)
      .mockResolvedValueOnce({ ...drained, settled: 0, deferred: 1, remaining: true })
      .mockResolvedValueOnce({ ...drained, settled: 0, remaining: false })
    await expect(runKnowledgeProjectionPass({ budgetMs: 60_000 })).resolves.toMatchObject({
      settled: 2,
      deferred: 1,
      remaining: true,
    })
    expect(mocks.runProjection).toHaveBeenCalledTimes(4)
  })

  it('opens only as many workers as there are marks', async () => {
    mocks.marks.mockReturnValue(1)
    await expect(runKnowledgeProjectionPass({ budgetMs: 60_000 })).resolves.toMatchObject({
      settled: 1,
    })
    expect(mocks.runProjection).toHaveBeenCalledTimes(1)
  })

  it('lets every worker finish its document before a failure ends the pass', async () => {
    let finishOther: () => void = () => {}
    mocks.runProjection.mockRejectedValueOnce(new Error('connection lost')).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOther = () => resolve(drained)
        })
    )
    let settled = false
    const pass = runKnowledgeProjectionPass({ budgetMs: 60_000 }).finally(() => {
      settled = true
    })
    await vi.waitFor(() => expect(mocks.runProjection).toHaveBeenCalledTimes(2))
    await Promise.resolve()
    expect(settled).toBe(false)
    finishOther()
    await expect(pass).rejects.toThrow('connection lost')
  })

  it('marks unfilled documents and converges them until none are left', async () => {
    mocks.isFeatureEnabled.mockResolvedValue(true)
    mocks.markUnfilled
      .mockResolvedValueOnce({ marked: 2, cursor: { projection: 0, afterId: 'row-2' } })
      .mockResolvedValueOnce({ marked: 0, cursor: null })
    const result = await runKnowledgeProjectionPass({ budgetMs: 60_000 })
    expect(result).toMatchObject({ filled: 2, remaining: false })
    expect(mocks.markUnfilled).toHaveBeenNthCalledWith(1, expect.anything(), undefined)
    expect(mocks.markUnfilled).toHaveBeenNthCalledWith(2, expect.anything(), {
      projection: 0,
      afterId: 'row-2',
    })
  })

  describe('at the budget', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      mocks.isFeatureEnabled.mockResolvedValue(true)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('does not start the fill once the budget is spent', async () => {
      mocks.runProjection.mockImplementation(async () => {
        vi.advanceTimersByTime(60_001)
        return drained
      })
      await expect(runKnowledgeProjectionPass({ budgetMs: 60_000 })).resolves.toMatchObject({
        remaining: false,
        filled: 0,
      })
      expect(mocks.markUnfilled).not.toHaveBeenCalled()
    })

    it('reports a fill the budget cut off as remaining once its marks are settled', async () => {
      mocks.markUnfilled.mockResolvedValueOnce({
        marked: 2,
        cursor: { projection: 0, afterId: 'row-2' },
      })
      mocks.runProjection
        .mockResolvedValueOnce(drained)
        .mockResolvedValueOnce(drained)
        .mockImplementation(async () => {
          vi.advanceTimersByTime(60_001)
          return drained
        })
      await expect(runKnowledgeProjectionPass({ budgetMs: 60_000 })).resolves.toMatchObject({
        remaining: true,
        filled: 2,
      })
      expect(mocks.markUnfilled).toHaveBeenCalledOnce()
    })

    it('reports documents the fill marked but no round settled as remaining', async () => {
      mocks.markUnfilled.mockImplementation(async () => {
        vi.advanceTimersByTime(60_001)
        return { marked: 2, cursor: { projection: 0, afterId: 'row-2' } }
      })
      await expect(runKnowledgeProjectionPass({ budgetMs: 60_000 })).resolves.toMatchObject({
        remaining: true,
        filled: 2,
      })
    })
  })

  it('does not fill while marks remain, so writers are converged first', async () => {
    mocks.isFeatureEnabled.mockResolvedValue(true)
    mocks.runProjection.mockResolvedValue({ ...drained, settled: 0, remaining: true })
    await expect(runKnowledgeProjectionPass({ budgetMs: 60_000 })).resolves.toMatchObject({
      remaining: true,
      filled: 0,
    })
    expect(mocks.markUnfilled).not.toHaveBeenCalled()
  })

  it('closes its connections when a pass fails', async () => {
    mocks.runProjection.mockRejectedValue(new Error('connection lost'))
    await expect(runKnowledgeProjectionPass({ budgetMs: 60_000 })).rejects.toThrow(
      'connection lost'
    )
    expect(mocks.end).toHaveBeenCalledTimes(2)
  })
})
