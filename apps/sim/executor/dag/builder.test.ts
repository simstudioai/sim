import { describe, expect, it } from 'vitest'
import { BlockType } from '@/executor/constants'
import { DAGBuilder } from '@/executor/dag/builder'
import {
  buildBranchNodeId,
  buildParallelSentinelEndId,
  buildParallelSentinelStartId,
} from '@/executor/utils/subflow-utils'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

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

  it('does not mutate serialized loop config nodes during DAG build', () => {
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [
        createBlock('start', BlockType.STARTER),
        createBlock('loop-1', BlockType.LOOP),
        { ...createBlock('inner-block', BlockType.FUNCTION), enabled: false },
      ],
      connections: [{ source: 'start', target: 'loop-1' }],
      loops: {
        'loop-1': {
          id: 'loop-1',
          nodes: ['inner-block'],
          iterations: 3,
        },
      },
      parallels: {},
    }

    const builder = new DAGBuilder()
    builder.build(workflow)

    expect(workflow.loops?.['loop-1']?.nodes).toEqual(['inner-block'])
  })

  it('does not mutate serialized parallel config nodes during DAG build', () => {
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [
        createBlock('start', BlockType.STARTER),
        createBlock('parallel-1', BlockType.PARALLEL),
        { ...createBlock('inner-block', BlockType.FUNCTION), enabled: false },
      ],
      connections: [{ source: 'start', target: 'parallel-1' }],
      loops: {},
      parallels: {
        'parallel-1': {
          id: 'parallel-1',
          nodes: ['inner-block'],
          count: 2,
          parallelType: 'count',
        },
      },
    }

    const builder = new DAGBuilder()
    builder.build(workflow)

    expect(workflow.parallels?.['parallel-1']?.nodes).toEqual(['inner-block'])
  })
})

describe('DAGBuilder nested parallel support', () => {
  it('builds DAG for parallel-in-parallel with correct sentinel wiring', () => {
    const outerParallelId = 'outer-parallel'
    const innerParallelId = 'inner-parallel'
    const functionId = 'func-1'

    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [
        createBlock('start', BlockType.STARTER),
        createBlock(outerParallelId, BlockType.PARALLEL),
        createBlock(innerParallelId, BlockType.PARALLEL),
        createBlock(functionId, BlockType.FUNCTION),
      ],
      connections: [
        { source: 'start', target: outerParallelId },
        {
          source: outerParallelId,
          target: innerParallelId,
          sourceHandle: 'parallel-start-source',
        },
        {
          source: innerParallelId,
          target: functionId,
          sourceHandle: 'parallel-start-source',
        },
      ],
      loops: {},
      parallels: {
        [innerParallelId]: {
          id: innerParallelId,
          nodes: [functionId],
          count: 5,
          parallelType: 'count',
        },
        [outerParallelId]: {
          id: outerParallelId,
          nodes: [innerParallelId],
          count: 5,
          parallelType: 'count',
        },
      },
    }

    const builder = new DAGBuilder()
    const dag = builder.build(workflow)

    // Outer parallel sentinel pair exists
    const outerStartId = buildParallelSentinelStartId(outerParallelId)
    const outerEndId = buildParallelSentinelEndId(outerParallelId)
    expect(dag.nodes.has(outerStartId)).toBe(true)
    expect(dag.nodes.has(outerEndId)).toBe(true)

    // Inner parallel sentinel pair exists
    const innerStartId = buildParallelSentinelStartId(innerParallelId)
    const innerEndId = buildParallelSentinelEndId(innerParallelId)
    expect(dag.nodes.has(innerStartId)).toBe(true)
    expect(dag.nodes.has(innerEndId)).toBe(true)

    // Function 1 branch template node exists
    const funcTemplateId = buildBranchNodeId(functionId, 0)
    expect(dag.nodes.has(funcTemplateId)).toBe(true)

    // Start → outer-sentinel-start
    const startNode = dag.nodes.get('start')!
    const startTargets = Array.from(startNode.outgoingEdges.values()).map((e) => e.target)
    expect(startTargets).toContain(outerStartId)

    // Outer-sentinel-start → inner-sentinel-start
    const outerStart = dag.nodes.get(outerStartId)!
    const outerStartTargets = Array.from(outerStart.outgoingEdges.values()).map((e) => e.target)
    expect(outerStartTargets).toContain(innerStartId)

    // Inner-sentinel-start → function branch template
    const innerStart = dag.nodes.get(innerStartId)!
    const innerStartTargets = Array.from(innerStart.outgoingEdges.values()).map((e) => e.target)
    expect(innerStartTargets).toContain(funcTemplateId)

    // Function branch template → inner-sentinel-end
    const funcTemplate = dag.nodes.get(funcTemplateId)!
    const funcTargets = Array.from(funcTemplate.outgoingEdges.values()).map((e) => e.target)
    expect(funcTargets).toContain(innerEndId)

    // Inner-sentinel-end → outer-sentinel-end
    const innerEnd = dag.nodes.get(innerEndId)!
    const innerEndTargets = Array.from(innerEnd.outgoingEdges.values()).map((e) => e.target)
    expect(innerEndTargets).toContain(outerEndId)
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
