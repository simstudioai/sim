import { describe, expect, it } from 'vitest'
import { BlockType } from '@/executor/constants'
import { DAGBuilder } from '@/executor/dag/builder'
import { EdgeManager } from '@/executor/execution/edge-manager'
import { ParallelExpander } from '@/executor/utils/parallel-expansion'
import {
  buildBranchNodeId,
  buildParallelSentinelEndId,
  buildParallelSentinelStartId,
  stripCloneSuffixes,
} from '@/executor/utils/subflow-utils'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

function createBlock(id: string, metadataId: string): SerializedBlock {
  return {
    id,
    position: { x: 0, y: 0 },
    config: { tool: 'noop', params: {} },
    inputs: {},
    outputs: {},
    metadata: { id: metadataId, name: id },
    enabled: true,
  }
}

describe('Nested parallel expansion + edge resolution', () => {
  it('waits for every branch terminal before queuing the parallel end sentinel', () => {
    const parallelId = 'parallel-1'
    const taskId = 'task-1'
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [
        createBlock('start', BlockType.STARTER),
        createBlock(parallelId, BlockType.PARALLEL),
        createBlock(taskId, BlockType.FUNCTION),
      ],
      connections: [
        { source: 'start', target: parallelId },
        {
          source: parallelId,
          target: taskId,
          sourceHandle: 'parallel-start-source',
        },
      ],
      loops: {},
      parallels: {
        [parallelId]: {
          id: parallelId,
          nodes: [taskId],
          count: 2,
          parallelType: 'count',
        },
      },
    }

    const dag = new DAGBuilder().build(workflow)
    const expander = new ParallelExpander()
    const { terminalNodes } = expander.expandParallel(dag, parallelId, 2)
    const edgeManager = new EdgeManager(dag)
    const parallelEndId = buildParallelSentinelEndId(parallelId)

    expect(terminalNodes).toEqual([buildBranchNodeId(taskId, 0), buildBranchNodeId(taskId, 1)])
    expect(dag.nodes.get(parallelEndId)?.incomingEdges).toEqual(new Set(terminalNodes))

    const firstBranchReady = edgeManager.processOutgoingEdges(dag.nodes.get(terminalNodes[0])!, {
      value: 'first',
    })
    expect(firstBranchReady).not.toContain(parallelEndId)

    const secondBranchReady = edgeManager.processOutgoingEdges(dag.nodes.get(terminalNodes[1])!, {
      value: 'second',
    })
    expect(secondBranchReady).toContain(parallelEndId)
  })

  it('preserves regular-to-nested subflow dependencies across expanded branches', () => {
    const outerParallelId = 'outer-parallel'
    const innerParallelId = 'inner-parallel'
    const prepareId = 'prepare'
    const finishId = 'finish'
    const innerTaskId = 'inner-task'
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [
        createBlock('start', BlockType.STARTER),
        createBlock(outerParallelId, BlockType.PARALLEL),
        createBlock(prepareId, BlockType.FUNCTION),
        createBlock(innerParallelId, BlockType.PARALLEL),
        createBlock(innerTaskId, BlockType.FUNCTION),
        createBlock(finishId, BlockType.FUNCTION),
      ],
      connections: [
        { source: 'start', target: outerParallelId },
        { source: outerParallelId, target: prepareId, sourceHandle: 'parallel-start-source' },
        { source: prepareId, target: innerParallelId },
        { source: innerParallelId, target: finishId },
        { source: innerParallelId, target: innerTaskId, sourceHandle: 'parallel-start-source' },
      ],
      loops: {},
      parallels: {
        [innerParallelId]: {
          id: innerParallelId,
          nodes: [innerTaskId],
          count: 1,
          parallelType: 'count',
        },
        [outerParallelId]: {
          id: outerParallelId,
          nodes: [prepareId, innerParallelId, finishId],
          count: 2,
          parallelType: 'count',
        },
      },
    }

    const dag = new DAGBuilder().build(workflow)
    const expander = new ParallelExpander()
    const result = expander.expandParallel(dag, outerParallelId, 2)

    const clonedInnerId = result.clonedSubflows[0].clonedId
    const prepareBranchOne = dag.nodes.get(buildBranchNodeId(prepareId, 1))!
    const clonedInnerStart = buildParallelSentinelStartId(clonedInnerId)
    const clonedInnerEnd = buildParallelSentinelEndId(clonedInnerId)
    const finishBranchOne = buildBranchNodeId(finishId, 1)

    expect(
      Array.from(prepareBranchOne.outgoingEdges.values()).map((edge) => edge.target)
    ).toContain(clonedInnerStart)
    expect(
      Array.from(dag.nodes.get(clonedInnerEnd)!.outgoingEdges.values()).map((edge) => edge.target)
    ).toContain(finishBranchOne)
    expect(
      Array.from(dag.nodes.get(clonedInnerEnd)!.outgoingEdges.values()).map((edge) => edge.target)
    ).not.toContain(buildBranchNodeId(finishId, 0))

    const outerStartTargets = Array.from(
      dag.nodes.get(buildParallelSentinelStartId(outerParallelId))!.outgoingEdges.values()
    ).map((edge) => edge.target)
    expect(outerStartTargets).toEqual([buildBranchNodeId(prepareId, 0), prepareBranchOne.id])

    const outerEndIncoming = dag.nodes.get(
      buildParallelSentinelEndId(outerParallelId)
    )!.incomingEdges
    expect(outerEndIncoming.has(buildBranchNodeId(finishId, 0))).toBe(true)
    expect(outerEndIncoming.has(finishBranchOne)).toBe(true)
  })

  it('uses global branch indexes for nested subflow clones in later batches', () => {
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
          count: 1,
          parallelType: 'count',
        },
        [outerParallelId]: {
          id: outerParallelId,
          nodes: [innerParallelId],
          count: 4,
          parallelType: 'count',
        },
      },
    }

    const builder = new DAGBuilder()
    const dag = builder.build(workflow)
    const expander = new ParallelExpander()
    const result = expander.expandParallel(dag, outerParallelId, 2, undefined, {
      branchIndexOffset: 2,
      totalBranches: 4,
    })

    expect(result.entryNodes).not.toContain(buildParallelSentinelStartId(innerParallelId))
    expect(result.clonedSubflows.map((clone) => clone.outerBranchIndex)).toEqual([2, 3])
    expect(result.clonedSubflows.map((clone) => clone.clonedId)).toEqual([
      `${innerParallelId}__obranch-2`,
      `${innerParallelId}__obranch-3`,
    ])
  })

  it('clears stale regular-to-nested edges when local branch nodes are reused in later batches', () => {
    const outerParallelId = 'outer-parallel'
    const innerParallelId = 'inner-parallel'
    const prepareId = 'prepare'
    const innerTaskId = 'inner-task'
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [
        createBlock('start', BlockType.STARTER),
        createBlock(outerParallelId, BlockType.PARALLEL),
        createBlock(prepareId, BlockType.FUNCTION),
        createBlock(innerParallelId, BlockType.PARALLEL),
        createBlock(innerTaskId, BlockType.FUNCTION),
      ],
      connections: [
        { source: 'start', target: outerParallelId },
        { source: outerParallelId, target: prepareId, sourceHandle: 'parallel-start-source' },
        { source: prepareId, target: innerParallelId },
        { source: innerParallelId, target: innerTaskId, sourceHandle: 'parallel-start-source' },
      ],
      loops: {},
      parallels: {
        [innerParallelId]: {
          id: innerParallelId,
          nodes: [innerTaskId],
          count: 1,
          parallelType: 'count',
        },
        [outerParallelId]: {
          id: outerParallelId,
          nodes: [prepareId, innerParallelId],
          count: 5,
          parallelType: 'count',
        },
      },
    }

    const dag = new DAGBuilder().build(workflow)
    const expander = new ParallelExpander()
    expander.expandParallel(dag, outerParallelId, 2, undefined, {
      branchIndexOffset: 0,
      totalBranches: 5,
    })
    expander.expandParallel(dag, outerParallelId, 2, undefined, {
      branchIndexOffset: 2,
      totalBranches: 5,
    })
    expander.expandParallel(dag, outerParallelId, 1, undefined, {
      branchIndexOffset: 4,
      totalBranches: 5,
    })

    const prepareBranchZero = dag.nodes.get(buildBranchNodeId(prepareId, 0))!
    const originalInnerStart = buildParallelSentinelStartId(innerParallelId)
    const staleClonedInnerStart = buildParallelSentinelStartId(`${innerParallelId}__obranch-2`)
    const clonedInnerStart = buildParallelSentinelStartId(`${innerParallelId}__obranch-4`)
    const prepareTargets = Array.from(prepareBranchZero.outgoingEdges.values()).map(
      (edge) => edge.target
    )

    expect(prepareTargets).toEqual([clonedInnerStart])
    expect(dag.nodes.get(originalInnerStart)!.incomingEdges.has(prepareBranchZero.id)).toBe(false)
    expect(dag.nodes.get(staleClonedInnerStart)!.incomingEdges.has(prepareBranchZero.id)).toBe(
      false
    )
    expect(dag.nodes.get(clonedInnerStart)!.incomingEdges.has(prepareBranchZero.id)).toBe(true)
  })

  it('clears stale sentinel-end incoming edges when a later batch is smaller', () => {
    const parallelId = 'parallel-1'
    const functionId = 'func-1'

    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [
        createBlock('start', BlockType.STARTER),
        createBlock(parallelId, BlockType.PARALLEL),
        createBlock(functionId, BlockType.FUNCTION),
      ],
      connections: [
        { source: 'start', target: parallelId },
        { source: parallelId, target: functionId, sourceHandle: 'parallel-start-source' },
      ],
      loops: {},
      parallels: {
        [parallelId]: {
          id: parallelId,
          nodes: [functionId],
          count: 4,
          parallelType: 'count',
        },
      },
    }

    const builder = new DAGBuilder()
    const dag = builder.build(workflow)
    const expander = new ParallelExpander()
    const sentinelEnd = dag.nodes.get(buildParallelSentinelEndId(parallelId))!

    expander.expandParallel(dag, parallelId, 3, undefined, {
      branchIndexOffset: 0,
      totalBranches: 4,
    })
    expect(sentinelEnd.incomingEdges).toEqual(
      new Set([
        buildBranchNodeId(functionId, 0),
        buildBranchNodeId(functionId, 1),
        buildBranchNodeId(functionId, 2),
      ])
    )

    expander.expandParallel(dag, parallelId, 1, undefined, {
      branchIndexOffset: 3,
      totalBranches: 4,
    })
    expect(sentinelEnd.incomingEdges).toEqual(new Set([buildBranchNodeId(functionId, 0)]))
  })

  it('3-level nesting: pre-expansion clone IDs do not collide with runtime expansion', () => {
    const p1 = 'p1'
    const p2 = 'p2'
    const p3 = 'p3'
    const leafBlock = 'leaf'

    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [
        createBlock('start', BlockType.STARTER),
        createBlock(p1, BlockType.PARALLEL),
        createBlock(p2, BlockType.PARALLEL),
        createBlock(p3, BlockType.PARALLEL),
        createBlock(leafBlock, BlockType.FUNCTION),
      ],
      connections: [
        { source: 'start', target: p1 },
        { source: p1, target: p2, sourceHandle: 'parallel-start-source' },
        { source: p2, target: p3, sourceHandle: 'parallel-start-source' },
        { source: p3, target: leafBlock, sourceHandle: 'parallel-start-source' },
      ],
      loops: {},
      parallels: {
        [p3]: { id: p3, nodes: [leafBlock], count: 2, parallelType: 'count' },
        [p2]: { id: p2, nodes: [p3], count: 2, parallelType: 'count' },
        [p1]: { id: p1, nodes: [p2], count: 2, parallelType: 'count' },
      },
    }

    const builder = new DAGBuilder()
    const dag = builder.build(workflow)
    const expander = new ParallelExpander()

    // Step 1: Expand P1 (outermost) — this pre-clones P2 and recursively P3
    const p1Result = expander.expandParallel(dag, p1, 2)

    // P1 should have cloned P2 (and recursively P3 inside it)
    const p2Clone = p1Result.clonedSubflows.find((c) => c.originalId === p2)!
    expect(p2Clone).toBeDefined()
    expect(p2Clone.clonedId).toBe('p2__obranch-1')

    // P3 should also be cloned (inside P2__obranch-1) with a __clone prefix
    const p3Clone = p1Result.clonedSubflows.find((c) => c.originalId === p3)!
    expect(p3Clone).toBeDefined()
    expect(p3Clone.clonedId).toMatch(/^p3__clone[0-9a-f]{24}__obranch-1$/)
    expect(stripCloneSuffixes(p3Clone.clonedId)).toBe('p3')
    expect(
      Array.from(
        dag.nodes.get(buildParallelSentinelEndId(p3Clone.clonedId))!.outgoingEdges.values()
      ).map((edge) => edge.target)
    ).toContain(buildParallelSentinelEndId(p2Clone.clonedId))

    // Step 2: Expand P2 (original, branch 0 of P1) — this creates P3__obranch-1 at runtime
    const p2Result = expander.expandParallel(dag, p2, 2)

    // P2 should clone P3 as P3__obranch-1 (standard runtime naming)
    const p3RuntimeClone = p2Result.clonedSubflows.find((c) => c.originalId === p3)!
    expect(p3RuntimeClone).toBeDefined()
    expect(p3RuntimeClone.clonedId).toBe('p3__obranch-1')

    // Key assertion: P3__obranch-1 (runtime) !== P3__clone*__obranch-1 (pre-expansion)
    expect(p3RuntimeClone.clonedId).not.toBe(p3Clone.clonedId)

    // Both P3 configs should exist independently in the DAG
    expect(dag.parallelConfigs.has(p3RuntimeClone.clonedId)).toBe(true)
    expect(dag.parallelConfigs.has(p3Clone.clonedId)).toBe(true)

    // Step 3: Expand P2__obranch-1 (cloned, branch 1 of P1)
    // Its inner P3 is the pre-cloned variant P3__clone*__obranch-1
    const p2ClonedConfig = dag.parallelConfigs.get(p2Clone.clonedId)!
    const p3InsideP2Clone = p2ClonedConfig.nodes![0]
    expect(p3InsideP2Clone).toBe(p3Clone.clonedId)

    const p2CloneResult = expander.expandParallel(dag, p2Clone.clonedId, 2)

    // P2__obranch-1 should clone its P3 (the pre-cloned variant) with __obranch-1 suffix
    const p3DeepClone = p2CloneResult.clonedSubflows.find((c) => c.originalId === p3Clone.clonedId)!
    expect(p3DeepClone).toBeDefined()
    // This ID should be unique (no collision with any earlier P3 clone)
    expect(dag.parallelConfigs.has(p3DeepClone.clonedId)).toBe(true)

    // Step 4: Expand all P3 variants and verify no node collisions
    const allP3Variants = [p3, p3RuntimeClone.clonedId, p3Clone.clonedId, p3DeepClone.clonedId]
    const allLeafNodes = new Set<string>()

    for (const p3Id of allP3Variants) {
      const p3Config = dag.parallelConfigs.get(p3Id)!
      const leafId = p3Config.nodes![0]

      const p3Result = expander.expandParallel(dag, p3Id, 2)

      // Each expansion creates branch nodes — verify they're unique
      const branch0 = buildBranchNodeId(leafId, 0)
      const branch1 = buildBranchNodeId(leafId, 1)

      expect(dag.nodes.has(branch0)).toBe(true)
      expect(dag.nodes.has(branch1)).toBe(true)

      // No duplicate node IDs across all expansions
      expect(allLeafNodes.has(branch0)).toBe(false)
      expect(allLeafNodes.has(branch1)).toBe(false)
      allLeafNodes.add(branch0)
      allLeafNodes.add(branch1)
    }

    // 4 P3 variants × 2 branches each = 8 unique leaf nodes
    expect(allLeafNodes.size).toBe(8)
  })
})
