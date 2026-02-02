import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import { BlockType } from '@/executor/constants'
import { DAGBuilder } from '@/executor/dag/builder'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

vi.mock('@sim/logger', () => loggerMock)

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

describe('DAGBuilder disabled subflow validation', () => {
  it('skips validation for disabled loops with no blocks inside', () => {
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [
        createBlock('start', BlockType.STARTER),
        { ...createBlock('loop-block', BlockType.FUNCTION), enabled: false },
      ],
      connections: [],
      loops: {
        'loop-1': {
          id: 'loop-1',
          nodes: [], // Empty loop - would normally throw
          iterations: 3,
        },
      },
    }

    const builder = new DAGBuilder()
    // Should not throw even though loop has no blocks inside
    expect(() => builder.build(workflow)).not.toThrow()
  })

  it('skips validation for disabled parallels with no blocks inside', () => {
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [createBlock('start', BlockType.STARTER)],
      connections: [],
      loops: {},
      parallels: {
        'parallel-1': {
          id: 'parallel-1',
          nodes: [], // Empty parallel - would normally throw
        },
      },
    }

    const builder = new DAGBuilder()
    // Should not throw even though parallel has no blocks inside
    expect(() => builder.build(workflow)).not.toThrow()
  })

  it('skips validation for loops where all inner blocks are disabled', () => {
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [
        createBlock('start', BlockType.STARTER),
        { ...createBlock('inner-block', BlockType.FUNCTION), enabled: false },
      ],
      connections: [],
      loops: {
        'loop-1': {
          id: 'loop-1',
          nodes: ['inner-block'], // Has node but it's disabled
          iterations: 3,
        },
      },
    }

    const builder = new DAGBuilder()
    // Should not throw - loop is effectively disabled since all inner blocks are disabled
    expect(() => builder.build(workflow)).not.toThrow()
  })
})

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
