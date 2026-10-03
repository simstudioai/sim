import { describe, expect, it } from 'vitest'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { DAGEdge, NodeMetadata } from '@/executor/dag/types'
import { computeExecutionSets, validateRunFromBlock } from '@/executor/utils/run-from-block'
import type { SerializedLoop, SerializedParallel } from '@/serializer/types'

/**
 * Helper to extract dirty set from computeExecutionSets
 */
function computeDirtySet(dag: DAG, startBlockId: string): Set<string> {
  return computeExecutionSets(dag, startBlockId).dirtySet
}

/**
 * Helper to create a DAG node for testing
 */
function createNode(
  id: string,
  outgoingEdges: Array<{ target: string; sourceHandle?: string }> = [],
  metadata: Partial<NodeMetadata> = {}
): DAGNode {
  const edges = new Map<string, DAGEdge>()
  for (const edge of outgoingEdges) {
    edges.set(edge.target, { target: edge.target, sourceHandle: edge.sourceHandle })
  }

  return {
    id,
    block: {
      id,
      position: { x: 0, y: 0 },
      config: { tool: 'test', params: {} },
      inputs: {},
      outputs: {},
      metadata: { id: 'test', name: `block-${id}`, category: 'tools' },
      enabled: true,
    },
    incomingEdges: new Set<string>(),
    outgoingEdges: edges,
    metadata: {
      isParallelBranch: false,
      isLoopNode: false,
      isSentinel: false,
      ...metadata,
    },
  }
}

/**
 * Helper to create a DAG for testing
 */
function createDAG(nodes: DAGNode[]): DAG {
  const nodeMap = new Map<string, DAGNode>()
  for (const node of nodes) {
    nodeMap.set(node.id, node)
  }

  // Set up incoming edges based on outgoing edges
  for (const node of nodes) {
    for (const [, edge] of node.outgoingEdges) {
      const targetNode = nodeMap.get(edge.target)
      if (targetNode) {
        targetNode.incomingEdges.add(node.id)
      }
    }
  }

  return {
    nodes: nodeMap,
    loopConfigs: new Map<string, SerializedLoop>(),
    parallelConfigs: new Map<string, SerializedParallel>(),
  }
}

describe('computeDirtySet', () => {
  it('includes all downstream blocks in linear workflow', () => {
    // A → B → C → D
    const dag = createDAG([
      createNode('A', [{ target: 'B' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C', [{ target: 'D' }]),
      createNode('D'),
    ])

    const dirtySet = computeDirtySet(dag, 'B')

    expect(dirtySet.has('A')).toBe(false)
    expect(dirtySet.has('B')).toBe(true)
    expect(dirtySet.has('C')).toBe(true)
    expect(dirtySet.has('D')).toBe(true)
    expect(dirtySet.size).toBe(3)
  })

  it('handles convergence points', () => {
    // A → C
    // B → C → D
    const dag = createDAG([
      createNode('A', [{ target: 'C' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C', [{ target: 'D' }]),
      createNode('D'),
    ])

    // Run from A: should include A, C, D (but not B)
    const dirtySet = computeDirtySet(dag, 'A')

    expect(dirtySet.has('A')).toBe(true)
    expect(dirtySet.has('B')).toBe(false)
    expect(dirtySet.has('C')).toBe(true)
    expect(dirtySet.has('D')).toBe(true)
    expect(dirtySet.size).toBe(3)
  })

  it('stops at graph boundaries', () => {
    // A → B    C → D (disconnected)
    const dag = createDAG([
      createNode('A', [{ target: 'B' }]),
      createNode('B'),
      createNode('C', [{ target: 'D' }]),
      createNode('D'),
    ])

    const dirtySet = computeDirtySet(dag, 'A')

    expect(dirtySet.has('A')).toBe(true)
    expect(dirtySet.has('B')).toBe(true)
    expect(dirtySet.has('C')).toBe(false)
    expect(dirtySet.has('D')).toBe(false)
    expect(dirtySet.size).toBe(2)
  })

  it('handles node not in DAG gracefully', () => {
    const dag = createDAG([createNode('A'), createNode('B')])

    const dirtySet = computeDirtySet(dag, 'nonexistent')

    // Should just contain the start block ID even if not found
    expect(dirtySet.has('nonexistent')).toBe(true)
    expect(dirtySet.size).toBe(1)
  })

  it('includes convergent block when running from one branch of parallel', () => {
    // Parallel branches converging:
    // A → B → D
    // A → C → D
    // Running from B should include B and D (but not A or C)
    const dag = createDAG([
      createNode('A', [{ target: 'B' }, { target: 'C' }]),
      createNode('B', [{ target: 'D' }]),
      createNode('C', [{ target: 'D' }]),
      createNode('D'),
    ])

    const dirtySet = computeDirtySet(dag, 'B')

    expect(dirtySet.has('A')).toBe(false)
    expect(dirtySet.has('B')).toBe(true)
    expect(dirtySet.has('C')).toBe(false)
    expect(dirtySet.has('D')).toBe(true)
    expect(dirtySet.size).toBe(2)
  })

  it('handles running from convergent block itself (all upstream non-dirty)', () => {
    // A → C
    // B → C
    // Running from C should only include C
    const dag = createDAG([
      createNode('A', [{ target: 'C' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C', [{ target: 'D' }]),
      createNode('D'),
    ])

    const dirtySet = computeDirtySet(dag, 'C')

    expect(dirtySet.has('A')).toBe(false)
    expect(dirtySet.has('B')).toBe(false)
    expect(dirtySet.has('C')).toBe(true)
    expect(dirtySet.has('D')).toBe(true)
    expect(dirtySet.size).toBe(2)
  })
})

describe('validateRunFromBlock', () => {
  it('rejects block not found in DAG', () => {
    const dag = createDAG([createNode('A')])
    const executedBlocks = new Set(['A', 'B'])

    const result = validateRunFromBlock('B', dag, executedBlocks)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Block not found')
  })

  it('rejects blocks inside loops', () => {
    const dag = createDAG([
      createNode('A', [], {
        isLoopNode: true,
        subflowId: 'loop-1',
        subflowType: 'loop',
      }),
    ])
    const executedBlocks = new Set(['A'])

    const result = validateRunFromBlock('A', dag, executedBlocks)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('inside loop')
    expect(result.error).toContain('loop-1')
  })

  it('rejects blocks inside parallels', () => {
    const dag = createDAG([
      createNode('A', [], {
        isParallelBranch: true,
        subflowId: 'parallel-1',
        subflowType: 'parallel',
      }),
    ])
    const executedBlocks = new Set(['A'])

    const result = validateRunFromBlock('A', dag, executedBlocks)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('inside parallel')
    expect(result.error).toContain('parallel-1')
  })

  it('rejects sentinel nodes', () => {
    const dag = createDAG([createNode('A', [], { isSentinel: true, sentinelType: 'start' })])
    const executedBlocks = new Set(['A'])

    const result = validateRunFromBlock('A', dag, executedBlocks)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('sentinel')
  })

  it('rejects blocks with unexecuted upstream dependencies', () => {
    // X → A → B, where A was not executed but B depends on A
    // X is the entry point (no incoming edges), A is a regular block
    const dag = createDAG([
      createNode('X', [{ target: 'A' }]),
      createNode('A', [{ target: 'B' }]),
      createNode('B'),
    ])
    const executedBlocks = new Set(['X']) // X executed but A was not

    const result = validateRunFromBlock('B', dag, executedBlocks)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Upstream dependency not executed')
  })

  it('allows running from block when immediate predecessor was executed (ignores transitive)', () => {
    // A → X → B → C, where X is new (not executed)
    // Running from C is allowed because B (immediate predecessor) was executed
    // C will use B's cached output - doesn't matter that X is new
    const dag = createDAG([
      createNode('A', [{ target: 'X' }]),
      createNode('X', [{ target: 'B' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C'),
    ])
    const executedBlocks = new Set(['A', 'B', 'C']) // X was not executed (new block)

    const result = validateRunFromBlock('C', dag, executedBlocks)

    // Valid because C's immediate predecessor B was executed
    expect(result.valid).toBe(true)
  })

  it('rejects loop containers nested inside another loop', () => {
    const outerLoopId = 'outer-loop'
    const innerLoopId = 'inner-loop'
    const innerStartId = `loop-${innerLoopId}-sentinel-start`
    const dag = createDAG([
      createNode(innerStartId, [], {
        isSentinel: true,
        sentinelType: 'start',
        subflowId: innerLoopId,
        subflowType: 'loop',
      }),
    ])
    dag.loopConfigs.set(outerLoopId, {
      id: outerLoopId,
      nodes: [innerLoopId],
      iterations: 2,
      loopType: 'for',
    } as any)
    dag.loopConfigs.set(innerLoopId, {
      id: innerLoopId,
      nodes: ['B'],
      iterations: 2,
      loopType: 'for',
    } as any)

    const result = validateRunFromBlock(innerLoopId, dag, new Set([innerStartId]))

    expect(result.valid).toBe(false)
    expect(result.error).toContain('inside loop')
    expect(result.error).toContain(outerLoopId)
  })

  it('rejects containers nested inside a parallel', () => {
    const outerParallelId = 'outer-parallel'
    const innerLoopId = 'inner-loop'
    const innerStartId = `loop-${innerLoopId}-sentinel-start`
    const dag = createDAG([
      createNode(innerStartId, [], {
        isSentinel: true,
        sentinelType: 'start',
        subflowId: innerLoopId,
        subflowType: 'loop',
      }),
    ])
    dag.parallelConfigs.set(outerParallelId, {
      id: outerParallelId,
      nodes: [innerLoopId],
      count: 2,
    } as any)
    dag.loopConfigs.set(innerLoopId, {
      id: innerLoopId,
      nodes: ['B'],
      iterations: 2,
      loopType: 'for',
    } as any)

    const result = validateRunFromBlock(innerLoopId, dag, new Set([innerStartId]))

    expect(result.valid).toBe(false)
    expect(result.error).toContain('inside parallel')
    expect(result.error).toContain(outerParallelId)
  })

  it('rejects container when sentinel-start upstream dependency was not executed', () => {
    const loopId = 'loop-container-1'
    const sentinelStartId = `loop-${loopId}-sentinel-start`
    const dag = createDAG([
      createNode('A', [{ target: sentinelStartId }]),
      createNode('X', [{ target: 'B' }]),
      createNode('B', [{ target: sentinelStartId }]),
      createNode(sentinelStartId, [], {
        isSentinel: true,
        sentinelType: 'start',
        subflowId: loopId,
        subflowType: 'loop',
      }),
    ])
    dag.loopConfigs.set(loopId, { id: loopId, nodes: [], iterations: 3, loopType: 'for' } as any)

    const result = validateRunFromBlock(loopId, dag, new Set(['A']))

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Upstream dependency not executed: B')
  })
})

describe('computeDirtySet with containers', () => {
  it('includes loop container and all downstream when running from loop', () => {
    // A → loop-sentinel-start → B (inside loop) → loop-sentinel-end → C
    const loopId = 'loop-1'
    const sentinelStartId = `loop-${loopId}-sentinel-start`
    const sentinelEndId = `loop-${loopId}-sentinel-end`
    const dag = createDAG([
      createNode('A', [{ target: sentinelStartId }]),
      createNode(sentinelStartId, [{ target: 'B' }], {
        isSentinel: true,
        sentinelType: 'start',
        subflowId: loopId,
        subflowType: 'loop',
      }),
      createNode('B', [{ target: sentinelEndId }], {
        isLoopNode: true,
        subflowId: loopId,
        subflowType: 'loop',
      }),
      createNode(sentinelEndId, [{ target: 'C' }], {
        isSentinel: true,
        sentinelType: 'end',
        subflowId: loopId,
        subflowType: 'loop',
      }),
      createNode('C'),
    ])
    dag.loopConfigs.set(loopId, { id: loopId, nodes: ['B'], iterations: 3, loopType: 'for' } as any)

    const dirtySet = computeDirtySet(dag, loopId)

    // Should include loop container, sentinel-start, B, sentinel-end, C
    expect(dirtySet.has(loopId)).toBe(true)
    expect(dirtySet.has(sentinelStartId)).toBe(true)
    expect(dirtySet.has('B')).toBe(true)
    expect(dirtySet.has(sentinelEndId)).toBe(true)
    expect(dirtySet.has('C')).toBe(true)
    // Should NOT include A (upstream)
    expect(dirtySet.has('A')).toBe(false)
  })
})

describe('computeExecutionSets upstream set', () => {
  it('excludes parallel branches not in upstream path', () => {
    // A → B → D
    // A → C → D
    // Running from B: upstream is A only, not C
    const dag = createDAG([
      createNode('A', [{ target: 'B' }, { target: 'C' }]),
      createNode('B', [{ target: 'D' }]),
      createNode('C', [{ target: 'D' }]),
      createNode('D'),
    ])

    const { upstreamSet, dirtySet } = computeExecutionSets(dag, 'B')

    // Upstream should only contain A
    expect(upstreamSet.has('A')).toBe(true)
    expect(upstreamSet.has('C')).toBe(false) // parallel branch, not upstream of B
    // Dirty should contain B and D
    expect(dirtySet.has('B')).toBe(true)
    expect(dirtySet.has('D')).toBe(true)
    expect(dirtySet.has('C')).toBe(false)
  })
})

describe('computeExecutionSets reachableUpstreamSet', () => {
  it('includes sibling branches for convergent downstream blocks', () => {
    // A → C
    // B → C
    // Running from A: C is dirty and may reference B, so B should be in reachableUpstreamSet
    const dag = createDAG([
      createNode('A', [{ target: 'C' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C'),
    ])

    const { dirtySet, upstreamSet, reachableUpstreamSet } = computeExecutionSets(dag, 'A')

    // Dirty should be A and C
    expect(dirtySet.has('A')).toBe(true)
    expect(dirtySet.has('C')).toBe(true)
    expect(dirtySet.has('B')).toBe(false)

    // Upstream of start block (A) is empty
    expect(upstreamSet.size).toBe(0)

    // But reachableUpstreamSet should include B because C (dirty) has B as upstream
    expect(reachableUpstreamSet.has('B')).toBe(true)
    expect(reachableUpstreamSet.has('A')).toBe(false) // A is in dirty set
    expect(reachableUpstreamSet.has('C')).toBe(false) // C is in dirty set
  })

  it('equals upstream set when no sibling branches exist', () => {
    // A → B → C → D
    // Running from B: no sibling branches, reachableUpstreamSet should equal upstreamSet
    const dag = createDAG([
      createNode('A', [{ target: 'B' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C', [{ target: 'D' }]),
      createNode('D'),
    ])

    const { upstreamSet, reachableUpstreamSet } = computeExecutionSets(dag, 'B')

    // Both should be the same for linear workflow
    expect(reachableUpstreamSet.has('A')).toBe(true)
    expect(upstreamSet.has('A')).toBe(true)
    expect(reachableUpstreamSet.size).toBe(upstreamSet.size)
  })
})

describe('run from trigger scenarios', () => {
  it('handles multiple triggers with reference to other trigger being undefined', () => {
    // Trigger1 → A → C
    // Trigger2 → B → C
    // Running from Trigger1: B should be in reachableUpstreamSet (for C's reference)
    // but Trigger2's output should not be required
    const dag = createDAG([
      createNode('trigger1', [{ target: 'A' }]),
      createNode('trigger2', [{ target: 'B' }]),
      createNode('A', [{ target: 'C' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C'),
    ])

    const { dirtySet, reachableUpstreamSet } = computeExecutionSets(dag, 'trigger1')

    // Dirty: trigger1, A, C
    expect(dirtySet.has('trigger1')).toBe(true)
    expect(dirtySet.has('A')).toBe(true)
    expect(dirtySet.has('C')).toBe(true)

    // trigger2 and B are NOT dirty
    expect(dirtySet.has('trigger2')).toBe(false)
    expect(dirtySet.has('B')).toBe(false)

    // But B should be in reachableUpstreamSet because C may reference it
    // trigger2 should also be in reachableUpstreamSet as upstream of B
    expect(reachableUpstreamSet.has('B')).toBe(true)
    expect(reachableUpstreamSet.has('trigger2')).toBe(true)
  })

  it('validates trigger block even when not previously executed', () => {
    // Trigger blocks are entry points, so they don't need upstream deps
    const dag = createDAG([createNode('trigger', [{ target: 'A' }]), createNode('A')])
    const executedBlocks = new Set<string>() // Nothing executed yet

    const result = validateRunFromBlock('trigger', dag, executedBlocks)

    expect(result.valid).toBe(true)
  })
})

describe('run from subflow (loop) scenarios', () => {
  it('handles loop.results reference outside loop scope', () => {
    // A → Loop[B] → C (references <loop.results>)
    const loopId = 'loop-1'
    const sentinelStartId = `loop-${loopId}-sentinel-start`
    const sentinelEndId = `loop-${loopId}-sentinel-end`
    const dag = createDAG([
      createNode('A', [{ target: sentinelStartId }]),
      createNode(sentinelStartId, [{ target: 'B' }], {
        isSentinel: true,
        sentinelType: 'start',
        loopId,
      }),
      createNode('B', [{ target: sentinelEndId }], { isLoopNode: true, loopId }),
      createNode(sentinelEndId, [{ target: 'C' }], {
        isSentinel: true,
        sentinelType: 'end',
        loopId,
      }),
      createNode('C'), // This block can reference <loop.results>
    ])
    dag.loopConfigs.set(loopId, {
      id: loopId,
      nodes: ['B'],
      iterations: 3,
      loopType: 'forEach',
    } as any)

    const { dirtySet, reachableUpstreamSet } = computeExecutionSets(dag, 'C')

    // Only C should be dirty when running from C
    expect(dirtySet.has('C')).toBe(true)
    expect(dirtySet.size).toBe(1)

    // Loop sentinels and internals should be in reachableUpstream
    expect(reachableUpstreamSet.has(sentinelEndId)).toBe(true)
    expect(reachableUpstreamSet.has('B')).toBe(true)
    expect(reachableUpstreamSet.has(sentinelStartId)).toBe(true)
    expect(reachableUpstreamSet.has('A')).toBe(true)
  })

  it('handles nested loops correctly', () => {
    // Outer loop contains inner loop
    const outerLoopId = 'outer-loop'
    const innerLoopId = 'inner-loop'
    const outerStartId = `loop-${outerLoopId}-sentinel-start`
    const outerEndId = `loop-${outerLoopId}-sentinel-end`
    const innerStartId = `loop-${innerLoopId}-sentinel-start`
    const innerEndId = `loop-${innerLoopId}-sentinel-end`

    const dag = createDAG([
      createNode('A', [{ target: outerStartId }]),
      createNode(outerStartId, [{ target: innerStartId }], {
        isSentinel: true,
        sentinelType: 'start',
        subflowId: outerLoopId,
        subflowType: 'loop',
      }),
      createNode(innerStartId, [{ target: 'B' }], {
        isSentinel: true,
        sentinelType: 'start',
        subflowId: innerLoopId,
        subflowType: 'loop',
        isLoopNode: true,
      }),
      createNode('B', [{ target: innerEndId }], {
        isLoopNode: true,
        subflowId: innerLoopId,
        subflowType: 'loop',
      }),
      createNode(innerEndId, [{ target: outerEndId }], {
        isSentinel: true,
        sentinelType: 'end',
        subflowId: innerLoopId,
        subflowType: 'loop',
        isLoopNode: true,
      }),
      createNode(outerEndId, [{ target: 'C' }], {
        isSentinel: true,
        sentinelType: 'end',
        subflowId: outerLoopId,
        subflowType: 'loop',
      }),
      createNode('C'),
    ])
    dag.loopConfigs.set(outerLoopId, {
      id: outerLoopId,
      nodes: [innerStartId, 'B', innerEndId],
      iterations: 2,
      loopType: 'for',
    } as any)
    dag.loopConfigs.set(innerLoopId, {
      id: innerLoopId,
      nodes: ['B'],
      iterations: 3,
      loopType: 'for',
    } as any)

    const { dirtySet } = computeExecutionSets(dag, outerLoopId)

    // Everything from outer loop onwards should be dirty
    expect(dirtySet.has(outerLoopId)).toBe(true)
    expect(dirtySet.has(outerStartId)).toBe(true)
    expect(dirtySet.has(innerStartId)).toBe(true)
    expect(dirtySet.has('B')).toBe(true)
    expect(dirtySet.has(innerEndId)).toBe(true)
    expect(dirtySet.has(outerEndId)).toBe(true)
    expect(dirtySet.has('C')).toBe(true)
    expect(dirtySet.has('A')).toBe(false)
  })
})

describe('branching variable resolution scenarios', () => {
  it('variable not in upstream should not resolve (not in reachableUpstreamSet)', () => {
    // Completely separate paths:
    // A → B → C
    // X → Y → Z
    // Running from B: Y and Z should NOT be in any set
    const dag = createDAG([
      createNode('A', [{ target: 'B' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C'),
      createNode('X', [{ target: 'Y' }]),
      createNode('Y', [{ target: 'Z' }]),
      createNode('Z'),
    ])

    const { dirtySet, upstreamSet, reachableUpstreamSet } = computeExecutionSets(dag, 'B')

    // Only A → B → C path affected
    expect(dirtySet.has('B')).toBe(true)
    expect(dirtySet.has('C')).toBe(true)
    expect(upstreamSet.has('A')).toBe(true)

    // X → Y → Z completely isolated
    expect(dirtySet.has('X')).toBe(false)
    expect(dirtySet.has('Y')).toBe(false)
    expect(dirtySet.has('Z')).toBe(false)
    expect(upstreamSet.has('X')).toBe(false)
    expect(reachableUpstreamSet.has('X')).toBe(false)
    expect(reachableUpstreamSet.has('Y')).toBe(false)
    expect(reachableUpstreamSet.has('Z')).toBe(false)
  })

  it('branch and reconnect: running from middle of second branch includes convergence correctly', () => {
    // A → B1 → B2 → D
    // A → C1 → C2 → D → E
    // Running from C2: dirty is {C2, D, E}
    // C2 doesn't know about B1 or B2 until D converges
    const dag = createDAG([
      createNode('A', [{ target: 'B1' }, { target: 'C1' }]),
      createNode('B1', [{ target: 'B2' }]),
      createNode('B2', [{ target: 'D' }]),
      createNode('C1', [{ target: 'C2' }]),
      createNode('C2', [{ target: 'D' }]),
      createNode('D', [{ target: 'E' }]),
      createNode('E'),
    ])

    const { dirtySet, upstreamSet, reachableUpstreamSet } = computeExecutionSets(dag, 'C2')

    // Dirty: C2, D, E
    expect(dirtySet.has('C2')).toBe(true)
    expect(dirtySet.has('D')).toBe(true)
    expect(dirtySet.has('E')).toBe(true)

    // NOT dirty: A, B1, B2, C1
    expect(dirtySet.has('A')).toBe(false)
    expect(dirtySet.has('B1')).toBe(false)
    expect(dirtySet.has('B2')).toBe(false)
    expect(dirtySet.has('C1')).toBe(false)

    // Upstream of C2: A, C1
    expect(upstreamSet.has('A')).toBe(true)
    expect(upstreamSet.has('C1')).toBe(true)

    // reachableUpstreamSet: A, C1 (upstream of C2) + B1, B2 (upstream of D's other branch)
    expect(reachableUpstreamSet.has('A')).toBe(true)
    expect(reachableUpstreamSet.has('C1')).toBe(true)
    expect(reachableUpstreamSet.has('B1')).toBe(true)
    expect(reachableUpstreamSet.has('B2')).toBe(true)
  })
})

describe('run until block scenarios', () => {
  it('run-until for loop container includes sentinel-end', () => {
    // When stopAfterBlockId is a loop, it resolves to sentinel-end
    // This ensures all iterations complete
    const loopId = 'loop-1'
    const sentinelStartId = `loop-${loopId}-sentinel-start`
    const sentinelEndId = `loop-${loopId}-sentinel-end`
    const dag = createDAG([
      createNode('A', [{ target: sentinelStartId }]),
      createNode(sentinelStartId, [{ target: 'B' }], {
        isSentinel: true,
        sentinelType: 'start',
        loopId,
      }),
      createNode('B', [{ target: sentinelEndId }], { isLoopNode: true, loopId }),
      createNode(sentinelEndId, [{ target: 'C' }], {
        isSentinel: true,
        sentinelType: 'end',
        loopId,
      }),
      createNode('C'),
    ])
    dag.loopConfigs.set(loopId, {
      id: loopId,
      nodes: ['B'],
      iterations: 3,
      loopType: 'for',
    } as any)

    // Dirty set from A should include everything
    const { dirtySet } = computeExecutionSets(dag, 'A')

    expect(dirtySet.has('A')).toBe(true)
    expect(dirtySet.has(sentinelStartId)).toBe(true)
    expect(dirtySet.has('B')).toBe(true)
    expect(dirtySet.has(sentinelEndId)).toBe(true)
    expect(dirtySet.has('C')).toBe(true)
  })

  it('rejects run-until for trigger blocks', () => {
    // Triggers are entry points, not valid as "run until" targets
    // (You can't stop "until" a trigger since triggers start execution)
    const dag = createDAG([
      createNode('trigger', [{ target: 'A' }]),
      createNode('A', [{ target: 'B' }]),
      createNode('B'),
    ])

    // When considering "run until trigger", the trigger has no incoming edges
    // so there's nothing to "run until"
    const { dirtySet } = computeExecutionSets(dag, 'trigger')

    // Running FROM trigger makes everything dirty
    expect(dirtySet.has('trigger')).toBe(true)
    expect(dirtySet.has('A')).toBe(true)
    expect(dirtySet.has('B')).toBe(true)
  })
})

describe('run-until followed by run-from-block state preservation', () => {
  it('preserves loop execution state after run-until loop completes', () => {
    const loopId = 'loop-1'
    const sentinelStartId = `loop-${loopId}-sentinel-start`
    const sentinelEndId = `loop-${loopId}-sentinel-end`
    const dag = createDAG([
      createNode('A', [{ target: sentinelStartId }]),
      createNode(sentinelStartId, [{ target: 'B' }], {
        isSentinel: true,
        sentinelType: 'start',
        loopId,
      }),
      createNode('B', [{ target: sentinelEndId }], { isLoopNode: true, loopId }),
      createNode(sentinelEndId, [{ target: 'C' }], {
        isSentinel: true,
        sentinelType: 'end',
        loopId,
      }),
      createNode('C'),
    ])
    dag.loopConfigs.set(loopId, {
      id: loopId,
      nodes: ['B'],
      iterations: 3,
      loopType: 'for',
    } as any)

    // After run-until loop completes: all loop iterations done
    const executedBlocks = new Set(['A', sentinelStartId, 'B', sentinelEndId])

    // Run from C: valid because sentinel-end (immediate upstream) was executed
    const result = validateRunFromBlock('C', dag, executedBlocks)

    expect(result.valid).toBe(true)

    // Dirty set for running from C
    const { dirtySet } = computeExecutionSets(dag, 'C')

    expect(dirtySet.has('C')).toBe(true)
    expect(dirtySet.size).toBe(1)
  })
})

describe('upstream block addition/deletion scenarios', () => {
  it('allows run-from-block when upstream block deleted (no missing dependency)', () => {
    // Original: A → B → C
    // Modified: A → C (B deleted, edge now A → C)
    // Running from C should be valid because A was executed
    const dag = createDAG([
      createNode('A', [{ target: 'C' }]), // Direct edge, B removed
      createNode('C'),
    ])

    // A, B, C were all executed in previous run
    const executedBlocks = new Set(['A', 'B', 'C'])

    const result = validateRunFromBlock('C', dag, executedBlocks)

    expect(result.valid).toBe(true)
  })
})
