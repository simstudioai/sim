import type { SessionPrincipal } from '@sim/auth/principal'
import {
  createSerializedBlock,
  createSerializedWorkflow,
} from '@sim/testing/factories/serialized-block.factory'
import { isolatedVmMock } from '@sim/testing/mocks/isolated-vm.mock'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockType } from '@/executor/constants'
import { DAGExecutor } from '@/executor/execution/executor'
import { ConditionBlockHandler } from '@/executor/handlers/condition/handler'
import type { SerializedWorkflow } from '@/serializer/types'

vi.mock('@/tools', () => toolsMock)

vi.mock('@/lib/execution/isolated-vm', () => isolatedVmMock)

/** Real condition handler; every other block answers with its own name. */
vi.mock('@/executor/handlers/registry', () => ({
  createBlockHandlers: () => [
    new ConditionBlockHandler(),
    {
      canHandle: () => true,
      execute: async (_ctx: unknown, block: { metadata?: { name?: string } }) => ({
        result: block.metadata?.name,
      }),
    },
  ],
}))

const PRINCIPAL: SessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }

function condition(id: string, conditions: Array<{ id: string; title: string; value: string }>) {
  return createSerializedBlock({
    id,
    name: id,
    type: BlockType.CONDITION,
    params: { conditions: JSON.stringify(conditions) },
  })
}

/**
 * A two-iteration loop where `lc1` sends iteration 0 to `la` and iteration 1 to `lb`, both
 * joining at `lc2`, whose passthrough output carries the branch it read.
 */
function joinInLoop(branchEdgeOrder: ['la' | 'lb', 'la' | 'lb']): SerializedWorkflow {
  const blocks = [
    createSerializedBlock({ id: 'start', name: 'start', type: BlockType.STARTER }),
    createSerializedBlock({ id: 'loop', name: 'loop', type: BlockType.LOOP }),
    condition('lc1', [
      { id: 'first', title: 'if', value: '<loop.index> == 0' },
      { id: 'rest', title: 'else', value: '' },
    ]),
    createSerializedBlock({ id: 'la', name: 'LA', type: BlockType.FUNCTION }),
    createSerializedBlock({ id: 'lb', name: 'LB', type: BlockType.FUNCTION }),
    condition('lc2', [{ id: 'always', title: 'if', value: 'true' }]),
    createSerializedBlock({ id: 'lout', name: 'LOut', type: BlockType.FUNCTION }),
  ]
  return {
    ...createSerializedWorkflow(blocks, [
      { source: 'start', target: 'loop' },
      { source: 'loop', target: 'lc1', sourceHandle: 'loop-start-source' },
      { source: 'lc1', target: 'la', sourceHandle: 'condition-first' },
      { source: 'lc1', target: 'lb', sourceHandle: 'condition-rest' },
      ...branchEdgeOrder.map((source) => ({ source, target: 'lc2' })),
      { source: 'lc2', target: 'lout', sourceHandle: 'condition-always' },
    ]),
    loops: {
      loop: {
        id: 'loop',
        nodes: ['lc1', 'la', 'lb', 'lc2', 'lout'],
        iterations: 2,
        loopType: 'for',
      },
    },
  }
}

describe('a condition joining two branches inside a loop', () => {
  /** Condition code runs as plain JavaScript instead of through the sandboxed function tool. */
  beforeEach(() => {
    toolsMockFns.mockExecuteTool.mockImplementation(
      async (_toolId: string, params: { code: string }) => ({
        success: true,
        output: { result: new Function(params.code)() },
      })
    )
  })

  it.each([
    ['la', 'lb'],
    ['lb', 'la'],
  ] as const)(
    'reads the branch that ran in each iteration (edges into the join: %s first)',
    async (first, second) => {
      const result = await new DAGExecutor({
        workflow: joinInLoop([first, second]),
        contextExtensions: { workspaceId: 'ws', executionId: 'exec-1', principal: PRINCIPAL },
      }).execute('wf')

      expect(result.success).toBe(true)
      const joinReads = (result.logs ?? [])
        .filter((log) => log.blockId.startsWith('lc2'))
        .map((log) => log.output?.result)
      expect(joinReads).toEqual(['LA', 'LB'])
    }
  )
})
