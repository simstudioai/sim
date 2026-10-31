import type { SessionPrincipal } from '@sim/auth/principal'
import {
  createSerializedBlock,
  createSerializedWorkflow,
} from '@sim/testing/factories/serialized-block.factory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockType, DEFAULTS } from '@/executor/constants'
import { DAGExecutor } from '@/executor/execution/executor'
import type { ExecutionResult } from '@/executor/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import type { SerializedLoop, SerializedWorkflow } from '@/serializer/types'

const { bodyRuns, conditionResult, runaway } = vi.hoisted(() => ({
  bodyRuns: { count: 0 },
  conditionResult: { stopAfter: Number.POSITIVE_INFINITY },
  /** Cancels a loop the ceiling failed to stop, so a regression fails instead of hanging. */
  runaway: { controller: new AbortController(), limit: 30_000 },
}))

/** Count conditions resolve to `return Boolean(<index> < <count>)`; user conditions stay opaque. */
vi.mock('@/lib/execution/isolated-vm', () => ({
  executeInIsolatedVM: vi.fn(async ({ code }: { code: string }) => {
    const indexCheck = /^return Boolean\((\d+) < (\d+)\)$/.exec(code)
    if (indexCheck) return { result: Number(indexCheck[1]) < Number(indexCheck[2]) }
    return { result: bodyRuns.count < conditionResult.stopAfter }
  }),
}))

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

const PRINCIPAL: SessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }
const CEILING = DEFAULTS.MAX_CONDITION_LOOP_ITERATIONS

function loopWorkflow(loop: Partial<Omit<SerializedLoop, 'id' | 'nodes'>>): SerializedWorkflow {
  const blocks = [
    createSerializedBlock({ id: 'start', name: 'start', type: BlockType.STARTER }),
    createSerializedBlock({ id: 'loop', name: 'loop', type: BlockType.LOOP }),
    createSerializedBlock({ id: 'tick', name: 'tick', type: BlockType.FUNCTION }),
  ]
  return {
    ...createSerializedWorkflow(blocks, [
      { source: 'start', target: 'loop' },
      { source: 'loop', target: 'tick', sourceHandle: 'loop-start-source' },
    ]),
    loops: { loop: { id: 'loop', nodes: ['tick'], iterations: 0, ...loop } },
  }
}

/** Runs the workflow and returns its result, including the one a failed run attaches to its throw. */
async function run(workflow: SerializedWorkflow): Promise<ExecutionResult> {
  try {
    return await new DAGExecutor({
      workflow,
      contextExtensions: {
        workspaceId: 'ws',
        executionId: 'exec-1',
        principal: PRINCIPAL,
        abortSignal: runaway.controller.signal,
      },
    }).execute('wf')
  } catch (error) {
    if (hasExecutionResult(error)) return error.executionResult
    throw error
  }
}

describe('condition-driven loop iteration ceiling', () => {
  beforeEach(() => {
    bodyRuns.count = 0
    conditionResult.stopAfter = Number.POSITIVE_INFINITY
    runaway.controller = new AbortController()
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
