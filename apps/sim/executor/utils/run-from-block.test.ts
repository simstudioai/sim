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
  it('includes start block in dirty set', () => {
    const dag = createDAG([createNode('A'), createNode('B'), createNode('C')])

    const dirtySet = computeDirtySet(dag, 'B')

    expect(dirtySet.has('B')).toBe(true)
  })

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

  it('handles branching paths', () => {
    // A → B → C
    //     ↓
    //     D → E
    const dag = createDAG([
      createNode('A', [{ target: 'B' }]),
      createNode('B', [{ target: 'C' }, { target: 'D' }]),
      createNode('C'),
      createNode('D', [{ target: 'E' }]),
      createNode('E'),
    ])

    const dirtySet = computeDirtySet(dag, 'B')

    expect(dirtySet.has('A')).toBe(false)
    expect(dirtySet.has('B')).toBe(true)
    expect(dirtySet.has('C')).toBe(true)
    expect(dirtySet.has('D')).toBe(true)
    expect(dirtySet.has('E')).toBe(true)
    expect(dirtySet.size).toBe(4)
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

  it('handles diamond pattern', () => {
    //     B
    //   ↗   ↘
    // A       D
    //   ↘   ↗
    //     C
    const dag = createDAG([
      createNode('A', [{ target: 'B' }, { target: 'C' }]),
      createNode('B', [{ target: 'D' }]),
      createNode('C', [{ target: 'D' }]),
      createNode('D'),
    ])

    const dirtySet = computeDirtySet(dag, 'A')

    expect(dirtySet.has('A')).toBe(true)
    expect(dirtySet.has('B')).toBe(true)
    expect(dirtySet.has('C')).toBe(true)
    expect(dirtySet.has('D')).toBe(true)
    expect(dirtySet.size).toBe(4)
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

  it('handles single node workflow', () => {
    const dag = createDAG([createNode('A')])

    const dirtySet = computeDirtySet(dag, 'A')

    expect(dirtySet.has('A')).toBe(true)
    expect(dirtySet.size).toBe(1)
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

  it('handles deep downstream chains', () => {
    // A → B → C → D → E → F
    // Running from C should include C, D, E, F
    const dag = createDAG([
      createNode('A', [{ target: 'B' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C', [{ target: 'D' }]),
      createNode('D', [{ target: 'E' }]),
      createNode('E', [{ target: 'F' }]),
      createNode('F'),
    ])

    const dirtySet = computeDirtySet(dag, 'C')

    expect(dirtySet.has('A')).toBe(false)
    expect(dirtySet.has('B')).toBe(false)
    expect(dirtySet.has('C')).toBe(true)
    expect(dirtySet.has('D')).toBe(true)
    expect(dirtySet.has('E')).toBe(true)
    expect(dirtySet.has('F')).toBe(true)
    expect(dirtySet.size).toBe(4)
  })
})

describe('validateRunFromBlock', () => {
  it('accepts valid block', () => {
    const dag = createDAG([createNode('A'), createNode('B')])
    const executedBlocks = new Set(['A', 'B'])

    const result = validateRunFromBlock('A', dag, executedBlocks)

    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('rejects block not found in DAG', () => {
    const dag = createDAG([createNode('A')])
    const executedBlocks = new Set(['A', 'B'])

    const result = validateRunFromBlock('B', dag, executedBlocks)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Block not found')
  })

  it('rejects blocks inside loops', () => {
    const dag = createDAG([createNode('A', [], { isLoopNode: true, loopId: 'loop-1' })])
    const executedBlocks = new Set(['A'])

    const result = validateRunFromBlock('A', dag, executedBlocks)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('inside loop')
    expect(result.error).toContain('loop-1')
  })

  it('rejects blocks inside parallels', () => {
    const dag = createDAG([
      createNode('A', [], { isParallelBranch: true, parallelId: 'parallel-1' }),
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
    // A → B, only A executed but B depends on A
    const dag = createDAG([createNode('A', [{ target: 'B' }]), createNode('B')])
    const executedBlocks = new Set<string>() // A was not executed

    const result = validateRunFromBlock('B', dag, executedBlocks)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Upstream dependency not executed')
  })

  it('rejects blocks with unexecuted transitive upstream dependencies', () => {
    // A → X → B → C, where X is new (not executed)
    // Running from C should fail because X in upstream chain wasn't executed
    const dag = createDAG([
      createNode('A', [{ target: 'X' }]),
      createNode('X', [{ target: 'B' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C'),
    ])
    const executedBlocks = new Set(['A', 'B', 'C']) // X was not executed (new block)

    const result = validateRunFromBlock('C', dag, executedBlocks)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Upstream dependency not executed')
    expect(result.error).toContain('X')
  })

  it('allows blocks with no dependencies even if not previously executed', () => {
    // A and B are independent (no edges)
    const dag = createDAG([createNode('A'), createNode('B')])
    const executedBlocks = new Set(['A']) // B was not executed but has no deps

    const result = validateRunFromBlock('B', dag, executedBlocks)

    expect(result.valid).toBe(true) // B has no incoming edges, so it's valid
  })

  it('accepts regular executed block', () => {
    const dag = createDAG([
      createNode('trigger', [{ target: 'A' }]),
      createNode('A', [{ target: 'B' }]),
      createNode('B'),
    ])
    const executedBlocks = new Set(['trigger', 'A', 'B'])

    const result = validateRunFromBlock('A', dag, executedBlocks)

    expect(result.valid).toBe(true)
  })

  it('accepts loop container when executed', () => {
    // Loop container with sentinel nodes
    const loopId = 'loop-container-1'
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
    dag.loopConfigs.set(loopId, { id: loopId, nodes: ['B'], iterations: 3, loopType: 'for' } as any)
    const executedBlocks = new Set(['A', loopId, sentinelStartId, 'B', sentinelEndId, 'C'])

    const result = validateRunFromBlock(loopId, dag, executedBlocks)

    expect(result.valid).toBe(true)
  })

  it('accepts parallel container when executed', () => {
    // Parallel container with sentinel nodes
    const parallelId = 'parallel-container-1'
    const sentinelStartId = `parallel-${parallelId}-sentinel-start`
    const sentinelEndId = `parallel-${parallelId}-sentinel-end`
    const dag = createDAG([
      createNode('A', [{ target: sentinelStartId }]),
      createNode(sentinelStartId, [{ target: 'B₍0₎' }], {
        isSentinel: true,
        sentinelType: 'start',
        parallelId,
      }),
      createNode('B₍0₎', [{ target: sentinelEndId }], { isParallelBranch: true, parallelId }),
      createNode(sentinelEndId, [{ target: 'C' }], {
        isSentinel: true,
        sentinelType: 'end',
        parallelId,
      }),
      createNode('C'),
    ])
    dag.parallelConfigs.set(parallelId, { id: parallelId, nodes: ['B'], count: 2 } as any)
    const executedBlocks = new Set(['A', parallelId, sentinelStartId, 'B₍0₎', sentinelEndId, 'C'])

    const result = validateRunFromBlock(parallelId, dag, executedBlocks)

    expect(result.valid).toBe(true)
  })

  it('allows loop container with no upstream dependencies', () => {
    // Loop containers are validated via their sentinel nodes, not incoming edges on the container itself
    // If the loop has no upstream dependencies, it should be valid
    const loopId = 'loop-container-1'
    const sentinelStartId = `loop-${loopId}-sentinel-start`
    const dag = createDAG([
      createNode(sentinelStartId, [], { isSentinel: true, sentinelType: 'start', loopId }),
    ])
    dag.loopConfigs.set(loopId, { id: loopId, nodes: [], iterations: 3, loopType: 'for' } as any)
    const executedBlocks = new Set<string>() // Nothing executed but loop has no deps

    const result = validateRunFromBlock(loopId, dag, executedBlocks)

    // Loop container validation doesn't check incoming edges (containers don't have nodes in dag.nodes)
    // So this is valid - the loop can start fresh
    expect(result.valid).toBe(true)
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

  it('includes parallel container and all downstream when running from parallel', () => {
    // A → parallel-sentinel-start → B₍0₎ → parallel-sentinel-end → C
    const parallelId = 'parallel-1'
    const sentinelStartId = `parallel-${parallelId}-sentinel-start`
    const sentinelEndId = `parallel-${parallelId}-sentinel-end`
    const dag = createDAG([
      createNode('A', [{ target: sentinelStartId }]),
      createNode(sentinelStartId, [{ target: 'B₍0₎' }], {
        isSentinel: true,
        sentinelType: 'start',
        parallelId,
      }),
      createNode('B₍0₎', [{ target: sentinelEndId }], { isParallelBranch: true, parallelId }),
      createNode(sentinelEndId, [{ target: 'C' }], {
        isSentinel: true,
        sentinelType: 'end',
        parallelId,
      }),
      createNode('C'),
    ])
    dag.parallelConfigs.set(parallelId, { id: parallelId, nodes: ['B'], count: 2 } as any)

    const dirtySet = computeDirtySet(dag, parallelId)

    // Should include parallel container, sentinel-start, B₍0₎, sentinel-end, C
    expect(dirtySet.has(parallelId)).toBe(true)
    expect(dirtySet.has(sentinelStartId)).toBe(true)
    expect(dirtySet.has('B₍0₎')).toBe(true)
    expect(dirtySet.has(sentinelEndId)).toBe(true)
    expect(dirtySet.has('C')).toBe(true)
    // Should NOT include A (upstream)
    expect(dirtySet.has('A')).toBe(false)
  })
})

describe('computeExecutionSets upstream set', () => {
  it('includes all upstream blocks in linear workflow', () => {
    // A → B → C → D
    const dag = createDAG([
      createNode('A', [{ target: 'B' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C', [{ target: 'D' }]),
      createNode('D'),
    ])

    const { upstreamSet } = computeExecutionSets(dag, 'C')

    expect(upstreamSet.has('A')).toBe(true)
    expect(upstreamSet.has('B')).toBe(true)
    expect(upstreamSet.has('C')).toBe(false) // start block not in upstream
    expect(upstreamSet.has('D')).toBe(false) // downstream
  })

  it('includes all branches in convergent upstream', () => {
    // A → C
    // B → C → D
    const dag = createDAG([
      createNode('A', [{ target: 'C' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C', [{ target: 'D' }]),
      createNode('D'),
    ])

    const { upstreamSet } = computeExecutionSets(dag, 'C')

    expect(upstreamSet.has('A')).toBe(true)
    expect(upstreamSet.has('B')).toBe(true)
    expect(upstreamSet.has('C')).toBe(false)
    expect(upstreamSet.has('D')).toBe(false)
  })

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

  it('handles diamond pattern upstream correctly', () => {
    //     B
    //   ↗   ↘
    // A       D → E
    //   ↘   ↗
    //     C
    // Running from D: upstream should be A, B, C
    const dag = createDAG([
      createNode('A', [{ target: 'B' }, { target: 'C' }]),
      createNode('B', [{ target: 'D' }]),
      createNode('C', [{ target: 'D' }]),
      createNode('D', [{ target: 'E' }]),
      createNode('E'),
    ])

    const { upstreamSet, dirtySet } = computeExecutionSets(dag, 'D')

    expect(upstreamSet.has('A')).toBe(true)
    expect(upstreamSet.has('B')).toBe(true)
    expect(upstreamSet.has('C')).toBe(true)
    expect(upstreamSet.has('D')).toBe(false)
    expect(dirtySet.has('D')).toBe(true)
    expect(dirtySet.has('E')).toBe(true)
  })

  it('returns empty upstream set for root block', () => {
    const dag = createDAG([createNode('A', [{ target: 'B' }]), createNode('B')])

    const { upstreamSet } = computeExecutionSets(dag, 'A')

    expect(upstreamSet.size).toBe(0)
  })
})
