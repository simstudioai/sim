import { isolatedVmMock, isolatedVmMockFns } from '@sim/testing/mocks/isolated-vm.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULTS } from '@/executor/constants'
import { loopWorkflow, runLoopWorkflow } from '@/executor/execution/loop-workflow.test-helpers'
import type { SerializedWorkflow } from '@/serializer/types'

const { bodyRuns, conditionResult, runaway } = vi.hoisted(() => ({
  bodyRuns: { count: 0 },
  conditionResult: { stopAfter: Number.POSITIVE_INFINITY },
  /** Cancels a loop the ceiling failed to stop, so a regression fails instead of hanging. */
  runaway: { controller: new AbortController(), limit: 30_000 },
}))

vi.mock('@/lib/execution/isolated-vm', () => isolatedVmMock)

vi.mock('@/executor/handlers/registry', () => ({
  createBlockHandlers: () => [
    {
      canHandle: () => true,
      execute: async (_ctx: unknown, block: { id: string }) => {
        if (block.id === 'tick') bodyRuns.count++
        if (bodyRuns.count >= runaway.limit) runaway.controller.abort()
        return { ok: true }
      },
    },
  ],
}))

const CEILING = DEFAULTS.MAX_CONDITION_LOOP_ITERATIONS

/** Runs under the runaway guard, so a loop the ceiling fails to stop is cancelled instead of hanging. */
const run = (workflow: SerializedWorkflow) =>
  runLoopWorkflow(workflow, { abortSignal: runaway.controller.signal })

describe('condition-driven loop iteration ceiling', () => {
  beforeEach(() => {
    bodyRuns.count = 0
    conditionResult.stopAfter = Number.POSITIVE_INFINITY
    runaway.controller = new AbortController()
    /** Only user conditions reach the sandbox; they stay opaque and hold until `stopAfter`. */
    isolatedVmMockFns.mockExecuteInIsolatedVM.mockImplementation(async () => ({
      result: bodyRuns.count < conditionResult.stopAfter,
    }))
  })

  it.each([
    ['While', { loopType: 'while', whileCondition: '<variable.i> < 3' }],
    ['Do While', { loopType: 'doWhile', doWhileCondition: '<variable.i> < 3', iterations: 5 }],
  ] as const)(
    'fails a %s loop whose condition never turns false at the ceiling',
    async (label, loop) => {
      const result = await run(loopWorkflow(loop))

      expect(bodyRuns.count).toBe(CEILING)
      expect(result.success).toBe(false)
      expect(result.error).toContain(`${label} loop stopped after 10,000 iterations`)
      expect(result.logs?.find((log) => log.blockId === 'loop')).toMatchObject({
        success: false,
        error: expect.stringContaining('condition still true'),
      })
    },
    60_000
  )

  it('ends a While loop normally when its condition turns false on the last allowed iteration', async () => {
    conditionResult.stopAfter = CEILING

    const result = await run(
      loopWorkflow({ loopType: 'while', whileCondition: '<variable.i> < 3' })
    )

    expect(bodyRuns.count).toBe(CEILING)
    expect(result.success).toBe(true)
  }, 60_000)

  it.each([
    ['For', { loopType: 'for', iterations: CEILING + 5 }],
    ['count-driven Do While', { loopType: 'doWhile', iterations: CEILING + 5 }],
  ] as const)(
    'leaves a %s loop free to run its configured count past the ceiling',
    async (_label, loop) => {
      const result = await run(loopWorkflow(loop))

      expect(result.success).toBe(true)
      expect(bodyRuns.count).toBe(CEILING + 5)
    },
    60_000
  )
})
