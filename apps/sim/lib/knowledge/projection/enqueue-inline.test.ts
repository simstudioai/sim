import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { sleep } from '@sim/utils/helpers'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ runPass: vi.fn() }))

vi.mock('@sim/db/knowledge-projection', () => ({
  releaseSettledMarks: async () => ({ released: 0, drained: true, empty: false }),
  MARK_RELEASE_BUDGET_MS: 10_000,
  hasKnowledgeProjectionWork: async () => true,
}))

vi.mock('@/lib/core/config/trigger-runtime', () => ({ isInsideTriggerRun: () => false }))
vi.mock('@/lib/knowledge/projection/run', () => ({ runKnowledgeProjectionPass: mocks.runPass }))

import { enqueueKnowledgeProjectionSweep } from '@/lib/knowledge/projection/enqueue'

setEnvFlags({ isTriggerDevEnabled: false })

/** A pass that runs until the test finishes it. */
function heldPass() {
  let finish: (error?: Error) => void = () => {}
  mocks.runPass.mockImplementationOnce(
    () =>
      new Promise<void>((resolve, reject) => {
        finish = (error) => (error ? reject(error) : resolve())
      })
  )
  return (error?: Error) => finish(error)
}

describe('knowledge projection without a Trigger.dev worker', () => {
  it('runs a pass for a sweep that arrives at any point while the last pass is finishing', async () => {
    for (let hops = 0; hops < 8; hops++) {
      mocks.runPass.mockReset()
      /** A sweep arrives once the pass has settled, `hops` microtasks later. */
      mocks.runPass
        .mockImplementationOnce(() => {
          void (async () => {
            for (let hop = 0; hop < hops; hop++) await Promise.resolve()
            await enqueueKnowledgeProjectionSweep()
          })()
          return Promise.resolve()
        })
        .mockResolvedValue(undefined)
      await enqueueKnowledgeProjectionSweep()
      await vi.waitFor(() => expect(mocks.runPass.mock.calls.length).toBeGreaterThanOrEqual(2), {
        timeout: 200,
      })
      /** Lets the loop finish before the next interleaving starts. */
      await sleep(1)
    }
  })

  it('logs a failed pass and still runs the pass owed after it', async () => {
    mocks.runPass.mockReset()
    const failFirst = heldPass()
    mocks.runPass.mockResolvedValue(undefined)
    await enqueueKnowledgeProjectionSweep()
    await vi.waitFor(() => expect(mocks.runPass).toHaveBeenCalledTimes(1))
    await enqueueKnowledgeProjectionSweep()
    failFirst(new Error('database unavailable'))
    await vi.waitFor(() => expect(mocks.runPass).toHaveBeenCalledTimes(2))
  })
})
