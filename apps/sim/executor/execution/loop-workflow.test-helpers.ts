import type { SessionPrincipal } from '@sim/auth/principal'
import {
  createSerializedBlock,
  createSerializedWorkflow,
} from '@sim/testing/factories/serialized-block.factory'
import { BlockType } from '@/executor/constants'
import { DAGExecutor } from '@/executor/execution/executor'
import type { ExecutionResult } from '@/executor/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import type { SerializedLoop, SerializedWorkflow } from '@/serializer/types'

const PRINCIPAL: SessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }

/** A Start block feeding a loop named `loop` whose body is one block, `tick`. */
export function loopWorkflow(
  loop: Partial<Omit<SerializedLoop, 'id' | 'nodes'>>
): SerializedWorkflow {
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
export async function runLoopWorkflow(
  workflow: SerializedWorkflow,
  options: { abortSignal?: AbortSignal } = {}
): Promise<ExecutionResult> {
  try {
    return await new DAGExecutor({
      workflow,
      contextExtensions: {
        workspaceId: 'ws',
        executionId: 'exec-1',
        principal: PRINCIPAL,
        abortSignal: options.abortSignal,
      },
    }).execute('wf')
  } catch (error) {
    if (hasExecutionResult(error)) return error.executionResult
    throw error
  }
}
