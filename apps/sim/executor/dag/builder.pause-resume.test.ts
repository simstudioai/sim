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

describe('DAGBuilder pause-resume transformation', () => {
  it('creates trigger nodes and rewires edges for pause blocks', () => {
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [
        createBlock('start', BlockType.STARTER),
        createBlock('pause', BlockType.PAUSE_RESUME),
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

    const triggerNode = dag.nodes.get('pause__trigger')
    expect(triggerNode).toBeDefined()
    expect(triggerNode?.metadata.isResumeTrigger).toBe(true)

    const startNode = dag.nodes.get('start')!
    const startOutgoing = Array.from(startNode.outgoingEdges.values())
    expect(startOutgoing).toHaveLength(1)
    expect(startOutgoing[0].target).toBe('pause')

    const pauseOutgoing = Array.from(pauseNode!.outgoingEdges.values())
    expect(pauseOutgoing).toHaveLength(0)

    const triggerOutgoing = Array.from(triggerNode!.outgoingEdges.values())
    expect(triggerOutgoing).toHaveLength(1)
    expect(triggerOutgoing[0].target).toBe('finish')
  })
})
