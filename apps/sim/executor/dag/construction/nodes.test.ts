/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { BlockType } from '@/executor/constants'
import type { DAG } from '@/executor/dag/builder'
import { NodeConstructor } from '@/executor/dag/construction/nodes'
import type { SerializedWorkflow } from '@/serializer/types'

describe('NodeConstructor', () => {
  it('assigns nested loop nodes to the innermost loop metadata', () => {
    const dag: DAG = {
      nodes: new Map(),
      loopConfigs: new Map([
        ['outer-loop', { id: 'outer-loop', nodes: ['inner-loop', 'task'], iterations: 1 }],
        ['inner-loop', { id: 'inner-loop', nodes: ['task'], iterations: 1 }],
      ]),
      parallelConfigs: new Map(),
    }
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [
        {
          id: 'task',
          position: { x: 0, y: 0 },
          config: { tool: '', params: {} },
          inputs: {},
          outputs: {},
          metadata: { id: BlockType.FUNCTION, name: 'Task' },
          enabled: true,
        },
      ],
      connections: [],
      loops: {},
      parallels: {},
    }

    new NodeConstructor().execute(workflow, dag, new Set(['task']))

    expect(dag.nodes.get('task')?.metadata).toMatchObject({
      isLoopNode: true,
      subflowId: 'inner-loop',
      subflowType: 'loop',
    })
  })
})
