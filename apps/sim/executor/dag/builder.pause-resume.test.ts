import { describe, expect, it, vi } from 'vitest'
import { BlockType } from '@/executor/consts'
import { DAGBuilder } from '@/executor/dag/builder'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

function createBlock(id: string, metadataId: string): SerializedBlock {
  return {
    id,
    position: { x: 0, y: 0 },
    config: {
      tool: 'noop',
      params: {},
    },
    inputs: {},
    outputs: {},
    metadata: {
      id: metadataId,
      name: id,
    },
    enabled: true,
  }
}

describe('DAGBuilder human-in-the-loop transformation', () => {
  it('creates trigger nodes and rewires edges for pause blocks', () => {
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [
        createBlock('start', BlockType.STARTER),
        createBlock('pause', BlockType.HUMAN_IN_THE_LOOP),
        createBlock('finish', BlockType.FUNCTION),
      ],
      connections: [
        { source: 'start', target: 'pause' },
        { source: 'pause', target: 'finish' },
      ],
      loops: {},
    }

    const builder = new DAGBuilder()
    const dag = builder.build(workflow)

    const pauseNode = dag.nodes.get('pause')
    expect(pauseNode).toBeDefined()
    expect(pauseNode?.metadata.isPauseResponse).toBe(true)

    const startNode = dag.nodes.get('start')!
    const startOutgoing = Array.from(startNode.outgoingEdges.values())
    expect(startOutgoing).toHaveLength(1)
    expect(startOutgoing[0].target).toBe('pause')

    const pauseOutgoing = Array.from(pauseNode!.outgoingEdges.values())
    expect(pauseOutgoing).toHaveLength(1)
    expect(pauseOutgoing[0].target).toBe('finish')

    const triggerNode = dag.nodes.get('pause__trigger')
    expect(triggerNode).toBeUndefined()
  })
})
