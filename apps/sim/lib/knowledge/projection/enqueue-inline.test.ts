/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ runPass: vi.fn(), trigger: vi.fn() }))

vi.mock('@sim/db', () => ({ db: { execute: async () => [{ pending: true }] } }))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: async () => false }))

vi.mock('@trigger.dev/sdk', () => ({ tasks: { trigger: mocks.trigger } }))
vi.mock('@/lib/core/config/env-flags', () => ({ isTriggerDevEnabled: false }))
vi.mock('@/lib/knowledge/projection/run', () => ({ runKnowledgeProjectionPass: mocks.runPass }))

import {
  enqueueKnowledgeProjectionSweep,
  requestKnowledgeProjection,
} from '@/lib/knowledge/projection/enqueue'

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
  it('starts a pass without waiting for it, one at a time, folding requests into the next', async () => {
    const finishFirst = heldPass()
    await expect(requestKnowledgeProjection()).resolves.toBeUndefined()
    await vi.waitFor(() => expect(mocks.runPass).toHaveBeenCalledTimes(1))
    await requestKnowledgeProjection()
    await expect(enqueueKnowledgeProjectionSweep()).resolves.toEqual({
      triggered: true,
      backend: 'inline',
      jobId: null,
    })
    expect(mocks.runPass).toHaveBeenCalledTimes(1)
    const finishSecond = heldPass()
    finishFirst()
    await vi.waitFor(() => expect(mocks.runPass).toHaveBeenCalledTimes(2))
    finishSecond()
    expect(mocks.trigger).not.toHaveBeenCalled()
  })

  it('logs a failed pass and still runs the pass owed after it', async () => {
    mocks.runPass.mockReset()
    const failFirst = heldPass()
    mocks.runPass.mockResolvedValue(undefined)
    await requestKnowledgeProjection()
    await vi.waitFor(() => expect(mocks.runPass).toHaveBeenCalledTimes(1))
    await requestKnowledgeProjection()
    failFirst(new Error('database unavailable'))
    await vi.waitFor(() => expect(mocks.runPass).toHaveBeenCalledTimes(2))
  })
})
