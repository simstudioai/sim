/**
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import { BlockType } from '@/executor/constants'
import { DAGBuilder } from '@/executor/dag/builder'
import { EdgeManager } from '@/executor/execution/edge-manager'
import { ParallelExpander } from '@/executor/utils/parallel-expansion'
import {
  buildBranchNodeId,
  buildParallelSentinelEndId,
  buildParallelSentinelStartId,
} from '@/executor/utils/subflow-utils'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

vi.mock('@sim/logger', () => loggerMock)

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
  it('outer parallel expansion clones inner subflow per branch and edge manager resolves correctly', () => {
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
          count: 3,
          parallelType: 'count',
        },
        [outerParallelId]: {
          id: outerParallelId,
          nodes: [innerParallelId],
          count: 2,
          parallelType: 'count',
        },
      },
    }

    // Step 1: Build the DAG
    const builder = new DAGBuilder()
    const dag = builder.build(workflow)

    const outerStartId = buildParallelSentinelStartId(outerParallelId)
    const outerEndId = buildParallelSentinelEndId(outerParallelId)
    const innerStartId = buildParallelSentinelStartId(innerParallelId)
    const innerEndId = buildParallelSentinelEndId(innerParallelId)

    // Verify DAG construction: start → outer-sentinel-start
    const startNode = dag.nodes.get('start')!
    const startTargets = Array.from(startNode.outgoingEdges.values()).map((e) => e.target)
    expect(startTargets).toContain(outerStartId)

    // Step 2: Simulate runtime expansion of outer parallel (count=2)
    const expander = new ParallelExpander()
    const outerResult = expander.expandParallel(dag, outerParallelId, 2)

    // After expansion, outer-sentinel-start should point to 2 entry nodes:
    // branch 0 uses original inner-sentinel-start, branch 1 uses cloned sentinel
    const outerStart = dag.nodes.get(outerStartId)!
    const outerStartTargets = Array.from(outerStart.outgoingEdges.values()).map((e) => e.target)
    expect(outerStartTargets).toHaveLength(2)
    expect(outerStartTargets).toContain(innerStartId) // branch 0

    // Verify cloned subflow info
    expect(outerResult.clonedSubflows).toHaveLength(1)
    expect(outerResult.clonedSubflows[0].originalId).toBe(innerParallelId)
    expect(outerResult.clonedSubflows[0].outerBranchIndex).toBe(1)

    const clonedInnerParallelId = outerResult.clonedSubflows[0].clonedId
    const clonedInnerStartId = buildParallelSentinelStartId(clonedInnerParallelId)
    const clonedInnerEndId = buildParallelSentinelEndId(clonedInnerParallelId)

    expect(outerStartTargets).toContain(clonedInnerStartId) // branch 1

    // Verify cloned parallel config was registered
    expect(dag.parallelConfigs.has(clonedInnerParallelId)).toBe(true)
    const clonedConfig = dag.parallelConfigs.get(clonedInnerParallelId)!
    expect(clonedConfig.count).toBe(3)
    expect(clonedConfig.nodes).toHaveLength(1)

    // inner-sentinel-end → outer-sentinel-end (branch 0)
    const innerEnd = dag.nodes.get(innerEndId)!
    const innerEndTargets = Array.from(innerEnd.outgoingEdges.values()).map((e) => e.target)
    expect(innerEndTargets).toContain(outerEndId)

    // cloned inner sentinel-end → outer-sentinel-end (branch 1)
    const clonedInnerEnd = dag.nodes.get(clonedInnerEndId)!
    const clonedInnerEndTargets = Array.from(clonedInnerEnd.outgoingEdges.values()).map(
      (e) => e.target
    )
    expect(clonedInnerEndTargets).toContain(outerEndId)

    // Entry/terminal nodes from expansion
    expect(outerResult.entryNodes).toContain(innerStartId)
    expect(outerResult.entryNodes).toContain(clonedInnerStartId)
    expect(outerResult.terminalNodes).toContain(innerEndId)
    expect(outerResult.terminalNodes).toContain(clonedInnerEndId)

    // Step 3: Verify edge manager resolves ready nodes after outer-sentinel-start completes
    const edgeManager = new EdgeManager(dag)
    const readyAfterOuterStart = edgeManager.processOutgoingEdges(
      outerStart,
      { sentinelStart: true },
      false
    )
    expect(readyAfterOuterStart).toContain(innerStartId)
    expect(readyAfterOuterStart).toContain(clonedInnerStartId)

    // Step 4: Expand inner parallel (branch 0's inner) with count=3
    expander.expandParallel(dag, innerParallelId, 3)

    // Inner sentinel-start should now point to 3 branch nodes
    const innerStart = dag.nodes.get(innerStartId)!
    const innerStartTargets = Array.from(innerStart.outgoingEdges.values()).map((e) => e.target)
    expect(innerStartTargets).toHaveLength(3)

    const branch0 = buildBranchNodeId(functionId, 0)
    const branch1 = buildBranchNodeId(functionId, 1)
    const branch2 = buildBranchNodeId(functionId, 2)
    expect(innerStartTargets).toContain(branch0)
    expect(innerStartTargets).toContain(branch1)
    expect(innerStartTargets).toContain(branch2)

    // Step 5: Verify edge manager resolves branch nodes after inner-sentinel-start
    const readyAfterInnerStart = edgeManager.processOutgoingEdges(
      innerStart,
      { sentinelStart: true },
      false
    )
    expect(readyAfterInnerStart).toContain(branch0)
    expect(readyAfterInnerStart).toContain(branch1)
    expect(readyAfterInnerStart).toContain(branch2)

    // Step 6: Simulate branch completions → inner-sentinel-end becomes ready
    const branch0Node = dag.nodes.get(branch0)!
    const branch1Node = dag.nodes.get(branch1)!
    const branch2Node = dag.nodes.get(branch2)!

    edgeManager.processOutgoingEdges(branch0Node, {}, false)
    edgeManager.processOutgoingEdges(branch1Node, {}, false)
    const readyAfterBranch2 = edgeManager.processOutgoingEdges(branch2Node, {}, false)
    expect(readyAfterBranch2).toContain(innerEndId)

    // Step 7: inner-sentinel-end completes → outer-sentinel-end becomes ready
    // (only if both branches are done — cloned branch must also complete)
    const readyAfterInnerEnd = edgeManager.processOutgoingEdges(
      innerEnd,
      { sentinelEnd: true, selectedRoute: 'parallel_exit' },
      false
    )
    // outer-sentinel-end has 2 incoming (innerEnd + clonedInnerEnd), not ready yet
    expect(readyAfterInnerEnd).not.toContain(outerEndId)

    // Expand and complete cloned inner parallel (branch 1's inner)
    const clonedBlockId = clonedConfig.nodes![0]
    expander.expandParallel(dag, clonedInnerParallelId, 3)
    const clonedInnerStart = dag.nodes.get(clonedInnerStartId)!
    const clonedBranch0 = buildBranchNodeId(clonedBlockId, 0)
    const clonedBranch1 = buildBranchNodeId(clonedBlockId, 1)
    const clonedBranch2 = buildBranchNodeId(clonedBlockId, 2)

    edgeManager.processOutgoingEdges(clonedInnerStart, { sentinelStart: true }, false)
    edgeManager.processOutgoingEdges(dag.nodes.get(clonedBranch0)!, {}, false)
    edgeManager.processOutgoingEdges(dag.nodes.get(clonedBranch1)!, {}, false)
    edgeManager.processOutgoingEdges(dag.nodes.get(clonedBranch2)!, {}, false)

    const readyAfterClonedInnerEnd = edgeManager.processOutgoingEdges(
      clonedInnerEnd,
      { sentinelEnd: true, selectedRoute: 'parallel_exit' },
      false
    )
    // Now both branches done → outer-sentinel-end becomes ready
    expect(readyAfterClonedInnerEnd).toContain(outerEndId)
  })
})
