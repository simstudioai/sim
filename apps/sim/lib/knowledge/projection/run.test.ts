import { databaseMockFns } from '@sim/testing/mocks/database.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runProjection: vi.fn(),
  release: vi.fn(),
  end: vi.fn(),
  marks: vi.fn(),
}))

await vi.hoisted(async () => {
  const { setEnv } = await import('@sim/testing/mocks/env.mock')
  setEnv({ KB_CONFIG_PROJECTION_CONCURRENCY: 2 })
})

vi.mock('@sim/db/knowledge-projection', () => ({
  runKnowledgeProjection: mocks.runProjection,
  releaseSettledMarks: mocks.release,
  MARK_RELEASE_BUDGET_MS: 10_000,
}))
/** A session answering the backlog count; the projection itself is mocked above. */
vi.mock('postgres', () => ({
  default: () => Object.assign(async () => [{ marks: mocks.marks() }], { end: mocks.end }),
}))

import { runKnowledgeProjectionPass } from '@/lib/knowledge/projection/run'

databaseMockFns.mockResolveDbUrl.mockReturnValue('postgresql://fixture/sim_acl_test')

const drained = { settled: 1, deferred: 0, pages: 2, written: 3, remaining: false }

describe('runKnowledgeProjectionPass', () => {
  beforeEach(() => {
    mocks.runProjection.mockResolvedValue(drained)
    mocks.release.mockResolvedValue({ released: 0, drained: true, empty: false })
    mocks.marks.mockReturnValue(2)
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

  it('closes its connections when a pass fails', async () => {
    mocks.runProjection.mockRejectedValue(new Error('connection lost'))
    await expect(runKnowledgeProjectionPass({ budgetMs: 60_000 })).rejects.toThrow(
      'connection lost'
    )
    expect(mocks.end).toHaveBeenCalledTimes(2)
  })
})
