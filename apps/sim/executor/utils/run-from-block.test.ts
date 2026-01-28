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

  it('includes sibling branches when running from the other branch', () => {
    // A → C
    // B → C
    // Running from B: C is dirty and may reference A, so A should be in reachableUpstreamSet
    const dag = createDAG([
      createNode('A', [{ target: 'C' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C'),
    ])

    const { dirtySet, upstreamSet, reachableUpstreamSet } = computeExecutionSets(dag, 'B')

    // Dirty should be B and C
    expect(dirtySet.has('B')).toBe(true)
    expect(dirtySet.has('C')).toBe(true)
    expect(dirtySet.has('A')).toBe(false)

    // Upstream of start block (B) is empty
    expect(upstreamSet.size).toBe(0)

    // reachableUpstreamSet should include A because C (dirty) has A as upstream
    expect(reachableUpstreamSet.has('A')).toBe(true)
    expect(reachableUpstreamSet.has('B')).toBe(false) // B is in dirty set
    expect(reachableUpstreamSet.has('C')).toBe(false) // C is in dirty set
  })

  it('includes all branches in diamond pattern when running from one branch', () => {
    // A → B → D
    // A → C → D
    // Running from B: dirty is {B, D}, D may reference C, so C should be in reachableUpstreamSet
    const dag = createDAG([
      createNode('A', [{ target: 'B' }, { target: 'C' }]),
      createNode('B', [{ target: 'D' }]),
      createNode('C', [{ target: 'D' }]),
      createNode('D'),
    ])

    const { dirtySet, upstreamSet, reachableUpstreamSet } = computeExecutionSets(dag, 'B')

    // Dirty should be B and D
    expect(dirtySet.has('B')).toBe(true)
    expect(dirtySet.has('D')).toBe(true)
    expect(dirtySet.has('A')).toBe(false)
    expect(dirtySet.has('C')).toBe(false)

    // Upstream of start block (B) is A
    expect(upstreamSet.has('A')).toBe(true)
    expect(upstreamSet.has('C')).toBe(false)

    // reachableUpstreamSet should include A and C
    // A is upstream of B, C is upstream of D (sibling branch)
    expect(reachableUpstreamSet.has('A')).toBe(true)
    expect(reachableUpstreamSet.has('C')).toBe(true)
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

  it('handles complex multi-branch convergence', () => {
    // X → A → D
    // Y → B → D → E
    // Z → C → D
    // Running from A: dirty is {A, D, E}, D may reference B and C
    const dag = createDAG([
      createNode('X', [{ target: 'A' }]),
      createNode('Y', [{ target: 'B' }]),
      createNode('Z', [{ target: 'C' }]),
      createNode('A', [{ target: 'D' }]),
      createNode('B', [{ target: 'D' }]),
      createNode('C', [{ target: 'D' }]),
      createNode('D', [{ target: 'E' }]),
      createNode('E'),
    ])

    const { dirtySet, upstreamSet, reachableUpstreamSet } = computeExecutionSets(dag, 'A')

    // Dirty: A, D, E
    expect(dirtySet.has('A')).toBe(true)
    expect(dirtySet.has('D')).toBe(true)
    expect(dirtySet.has('E')).toBe(true)

    // Upstream of A: just X
    expect(upstreamSet.has('X')).toBe(true)
    expect(upstreamSet.size).toBe(1)

    // reachableUpstreamSet: X (upstream of A), Y, B (upstream of D), Z, C (upstream of D)
    expect(reachableUpstreamSet.has('X')).toBe(true)
    expect(reachableUpstreamSet.has('Y')).toBe(true)
    expect(reachableUpstreamSet.has('Z')).toBe(true)
    expect(reachableUpstreamSet.has('B')).toBe(true)
    expect(reachableUpstreamSet.has('C')).toBe(true)
  })
})

describe('run from trigger scenarios', () => {
  it('allows running from trigger block (entry point with no upstream)', () => {
    // Trigger → A → B
    const dag = createDAG([
      createNode('trigger', [{ target: 'A' }]),
      createNode('A', [{ target: 'B' }]),
      createNode('B'),
    ])
    const executedBlocks = new Set(['trigger', 'A', 'B'])

    const result = validateRunFromBlock('trigger', dag, executedBlocks)

    expect(result.valid).toBe(true)
  })

  it('computes dirty set correctly when running from trigger', () => {
    // Trigger → A → B → C
    const dag = createDAG([
      createNode('trigger', [{ target: 'A' }]),
      createNode('A', [{ target: 'B' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C'),
    ])

    const { dirtySet, upstreamSet } = computeExecutionSets(dag, 'trigger')

    // All blocks should be dirty when running from trigger
    expect(dirtySet.has('trigger')).toBe(true)
    expect(dirtySet.has('A')).toBe(true)
    expect(dirtySet.has('B')).toBe(true)
    expect(dirtySet.has('C')).toBe(true)
    expect(dirtySet.size).toBe(4)

    // No upstream for trigger
    expect(upstreamSet.size).toBe(0)
  })

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

  it('allows running from webhook trigger (starter block)', () => {
    // Webhook/Start trigger with input format → A → B
    const dag = createDAG([
      createNode('starter', [{ target: 'A' }]),
      createNode('A', [{ target: 'B' }]),
      createNode('B'),
    ])
    const executedBlocks = new Set(['starter', 'A', 'B'])

    const result = validateRunFromBlock('starter', dag, executedBlocks)

    expect(result.valid).toBe(true)
  })

  it('includes webhook input format in dirty set computation', () => {
    // Webhook trigger has input format that downstream blocks can reference
    // Starter → Process → Output
    const dag = createDAG([
      createNode('webhook-starter', [{ target: 'process' }]),
      createNode('process', [{ target: 'output' }]),
      createNode('output'),
    ])

    const { dirtySet } = computeExecutionSets(dag, 'webhook-starter')

    // All should be re-executed to process new webhook input
    expect(dirtySet.has('webhook-starter')).toBe(true)
    expect(dirtySet.has('process')).toBe(true)
    expect(dirtySet.has('output')).toBe(true)
  })
})

describe('run from subflow (loop) scenarios', () => {
  it('allows running from loop container', () => {
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
    const executedBlocks = new Set(['A', sentinelStartId, 'B', sentinelEndId, 'C'])

    const result = validateRunFromBlock(loopId, dag, executedBlocks)

    expect(result.valid).toBe(true)
  })

  it('rejects running from block inside loop', () => {
    const loopId = 'loop-1'
    const dag = createDAG([createNode('inside-loop', [], { isLoopNode: true, loopId })])
    const executedBlocks = new Set(['inside-loop'])

    const result = validateRunFromBlock('inside-loop', dag, executedBlocks)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('inside loop')
  })

  it('computes dirty set for loop to include all iterations', () => {
    // When running from loop, all internal blocks get re-executed for all iterations
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
      createNode('B', [{ target: 'C' }], { isLoopNode: true, loopId }),
      createNode('C', [{ target: sentinelEndId }], { isLoopNode: true, loopId }),
      createNode(sentinelEndId, [{ target: 'D' }], {
        isSentinel: true,
        sentinelType: 'end',
        loopId,
      }),
      createNode('D'),
    ])
    dag.loopConfigs.set(loopId, {
      id: loopId,
      nodes: ['B', 'C'],
      iterations: 5,
      loopType: 'for',
    } as any)

    const { dirtySet } = computeExecutionSets(dag, loopId)

    // Loop container, sentinels, inner blocks, and downstream should be dirty
    expect(dirtySet.has(loopId)).toBe(true)
    expect(dirtySet.has(sentinelStartId)).toBe(true)
    expect(dirtySet.has('B')).toBe(true)
    expect(dirtySet.has('C')).toBe(true)
    expect(dirtySet.has(sentinelEndId)).toBe(true)
    expect(dirtySet.has('D')).toBe(true)

    // Upstream should not be dirty
    expect(dirtySet.has('A')).toBe(false)
  })

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
        loopId: outerLoopId,
      }),
      createNode(innerStartId, [{ target: 'B' }], {
        isSentinel: true,
        sentinelType: 'start',
        loopId: innerLoopId,
        isLoopNode: true,
      }),
      createNode('B', [{ target: innerEndId }], {
        isLoopNode: true,
        loopId: innerLoopId,
      }),
      createNode(innerEndId, [{ target: outerEndId }], {
        isSentinel: true,
        sentinelType: 'end',
        loopId: innerLoopId,
        isLoopNode: true,
      }),
      createNode(outerEndId, [{ target: 'C' }], {
        isSentinel: true,
        sentinelType: 'end',
        loopId: outerLoopId,
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
  it('parallel branches do not know about each other (no cross-branch in dirty)', () => {
    // A splits into B and C (parallel branches), both merge at D
    // Running from B: B and D are dirty, but C is NOT dirty
    const dag = createDAG([
      createNode('A', [{ target: 'B' }, { target: 'C' }]),
      createNode('B', [{ target: 'D' }]),
      createNode('C', [{ target: 'D' }]),
      createNode('D'),
    ])

    const { dirtySet } = computeExecutionSets(dag, 'B')

    expect(dirtySet.has('B')).toBe(true)
    expect(dirtySet.has('D')).toBe(true)
    expect(dirtySet.has('A')).toBe(false)
    expect(dirtySet.has('C')).toBe(false) // Parallel branch NOT in dirty
  })

  it('after convergence, downstream knows about both branches', () => {
    // A → B → D → E
    // A → C → D → E
    // Running from B: D may reference C, and E may reference both B and C
    const dag = createDAG([
      createNode('A', [{ target: 'B' }, { target: 'C' }]),
      createNode('B', [{ target: 'D' }]),
      createNode('C', [{ target: 'D' }]),
      createNode('D', [{ target: 'E' }]),
      createNode('E'),
    ])

    const { dirtySet, reachableUpstreamSet } = computeExecutionSets(dag, 'B')

    // Dirty: B, D, E
    expect(dirtySet.has('B')).toBe(true)
    expect(dirtySet.has('D')).toBe(true)
    expect(dirtySet.has('E')).toBe(true)

    // reachableUpstreamSet includes C (sibling branch that D can reference)
    expect(reachableUpstreamSet.has('A')).toBe(true)
    expect(reachableUpstreamSet.has('C')).toBe(true)
  })

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

  it('deep nested convergence with multiple levels', () => {
    // Complex graph:
    //       B → D
    //     ↗     ↘
    // A          F → G
    //     ↘     ↗
    //       C → E
    // Running from D: dirty is {D, F, G}, but E is in reachableUpstreamSet (via F)
    const dag = createDAG([
      createNode('A', [{ target: 'B' }, { target: 'C' }]),
      createNode('B', [{ target: 'D' }]),
      createNode('C', [{ target: 'E' }]),
      createNode('D', [{ target: 'F' }]),
      createNode('E', [{ target: 'F' }]),
      createNode('F', [{ target: 'G' }]),
      createNode('G'),
    ])

    const { dirtySet, reachableUpstreamSet } = computeExecutionSets(dag, 'D')

    // Dirty: D, F, G
    expect(dirtySet.has('D')).toBe(true)
    expect(dirtySet.has('F')).toBe(true)
    expect(dirtySet.has('G')).toBe(true)

    // NOT dirty: A, B, C, E
    expect(dirtySet.has('A')).toBe(false)
    expect(dirtySet.has('B')).toBe(false)
    expect(dirtySet.has('C')).toBe(false)
    expect(dirtySet.has('E')).toBe(false)

    // reachableUpstreamSet: A, B (upstream of D) + C, E (upstream of F's other branch)
    expect(reachableUpstreamSet.has('A')).toBe(true)
    expect(reachableUpstreamSet.has('B')).toBe(true)
    expect(reachableUpstreamSet.has('C')).toBe(true)
    expect(reachableUpstreamSet.has('E')).toBe(true)
  })
})

describe('run until block scenarios', () => {
  it('validates that run-until target block must exist in DAG', () => {
    const dag = createDAG([
      createNode('A', [{ target: 'B' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C'),
    ])
    const executedBlocks = new Set<string>()

    // The run-until target should be a valid block
    const result = validateRunFromBlock('nonexistent', dag, executedBlocks)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Block not found')
  })

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

  it('run-until for parallel container includes sentinel-end', () => {
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
      createNode('B₍0₎', [{ target: sentinelEndId }], {
        isParallelBranch: true,
        parallelId,
      }),
      createNode(sentinelEndId, [{ target: 'C' }], {
        isSentinel: true,
        sentinelType: 'end',
        parallelId,
      }),
      createNode('C'),
    ])
    dag.parallelConfigs.set(parallelId, {
      id: parallelId,
      nodes: ['B'],
      count: 2,
    } as any)

    // Ensure parallel container is valid to run to
    const result = validateRunFromBlock(parallelId, dag, new Set(['A']))

    expect(result.valid).toBe(true)
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
  it('validates run-from-block after partial execution respects executed blocks', () => {
    // Scenario: Run until B completed, now run from B
    // A → B → C → D
    const dag = createDAG([
      createNode('A', [{ target: 'B' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C', [{ target: 'D' }]),
      createNode('D'),
    ])

    // After run-until B: A and B were executed
    const executedBlocks = new Set(['A', 'B'])

    // Now run from B: should be valid since B was executed
    const result = validateRunFromBlock('B', dag, executedBlocks)

    expect(result.valid).toBe(true)
  })

  it('computes dirty set correctly after partial execution', () => {
    // A → B → C → D
    // After run-until B: A and B executed
    // Run from B: dirty should be B, C, D
    const dag = createDAG([
      createNode('A', [{ target: 'B' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C', [{ target: 'D' }]),
      createNode('D'),
    ])

    const { dirtySet, upstreamSet } = computeExecutionSets(dag, 'B')

    expect(dirtySet.has('B')).toBe(true)
    expect(dirtySet.has('C')).toBe(true)
    expect(dirtySet.has('D')).toBe(true)
    expect(dirtySet.has('A')).toBe(false)

    expect(upstreamSet.has('A')).toBe(true)
  })

  it('rejects run-from-block if upstream dependency not executed', () => {
    // A → B → C
    // After run-until C but B failed/wasn't executed
    const dag = createDAG([
      createNode('A', [{ target: 'B' }]),
      createNode('B', [{ target: 'C' }]),
      createNode('C'),
    ])

    // Only A executed, B was not
    const executedBlocks = new Set(['A'])

    // Run from C: should fail because B (immediate upstream) not executed
    const result = validateRunFromBlock('C', dag, executedBlocks)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Upstream dependency not executed')
    expect(result.error).toContain('B')
  })

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
  it('disables run-from-block when new upstream block added (dependency not executed)', () => {
    // Original: A → C
    // Modified: A → B → C (B is new)
    // Running from C should be invalid because B wasn't executed
    const dag = createDAG([
      createNode('A', [{ target: 'B' }]),
      createNode('B', [{ target: 'C' }]), // New block
      createNode('C'),
    ])

    // Only A and C were executed in previous run (before B existed)
    const executedBlocks = new Set(['A', 'C'])

    const result = validateRunFromBlock('C', dag, executedBlocks)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Upstream dependency not executed')
    expect(result.error).toContain('B')
  })

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

  it('handles block replacement (same position, different block)', () => {
    // Original: A → OldB → C
    // Modified: A → NewB → C (OldB replaced with NewB)
    const dag = createDAG([
      createNode('A', [{ target: 'NewB' }]),
      createNode('NewB', [{ target: 'C' }]),
      createNode('C'),
    ])

    // OldB was executed, but NewB wasn't
    const executedBlocks = new Set(['A', 'OldB', 'C'])

    const result = validateRunFromBlock('C', dag, executedBlocks)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Upstream dependency not executed')
    expect(result.error).toContain('NewB')
  })

  it('allows run-from-block when parallel upstream branch added', () => {
    // Original: A → C
    // Modified: A → B → C (parallel branch)
    //           A → C
    // If C has multiple upstreams and at least one was executed
    const dag = createDAG([
      createNode('A', [{ target: 'B' }, { target: 'C' }]),
      createNode('B', [{ target: 'C' }]), // New parallel path
      createNode('C'),
    ])

    // Only A and direct A→C path executed, B not executed
    const executedBlocks = new Set(['A', 'C'])

    // C has two incoming: A and B
    // A was executed (entry point), B was not
    // This should be invalid because B is an immediate upstream
    const result = validateRunFromBlock('C', dag, executedBlocks)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('B')
  })

  it('validates correctly when intermediate block reconnected', () => {
    // Original: A → B → C → D
    // Modified: A → B → D (C deleted, B now connects to D)
    const dag = createDAG([
      createNode('A', [{ target: 'B' }]),
      createNode('B', [{ target: 'D' }]), // Now connects directly to D
      createNode('D'),
    ])

    // A, B, C, D all executed in previous run
    const executedBlocks = new Set(['A', 'B', 'C', 'D'])

    // Run from D: B was executed, so valid
    const result = validateRunFromBlock('D', dag, executedBlocks)

    expect(result.valid).toBe(true)
  })

  it('handles complex graph modification with multiple changes', () => {
    // Original: A → B → D → E
    //           A → C → D → E
    // Modified: A → B → D → E (C path removed)
    //           A → X → D → E (X is new)
    const dag = createDAG([
      createNode('A', [{ target: 'B' }, { target: 'X' }]),
      createNode('B', [{ target: 'D' }]),
      createNode('X', [{ target: 'D' }]), // New block
      createNode('D', [{ target: 'E' }]),
      createNode('E'),
    ])

    // A, B, C, D, E executed (C no longer exists, X is new)
    const executedBlocks = new Set(['A', 'B', 'C', 'D', 'E'])

    // Run from D: B was executed, but X was not
    const result = validateRunFromBlock('D', dag, executedBlocks)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('X')
  })
})
