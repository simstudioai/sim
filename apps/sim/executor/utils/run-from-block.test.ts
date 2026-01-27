import { describe, expect, it } from 'vitest'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { DAGEdge, NodeMetadata } from '@/executor/dag/types'
import type { SerializedLoop, SerializedParallel } from '@/serializer/types'
import { computeDirtySet, validateRunFromBlock } from '@/executor/utils/run-from-block'

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
    const dag = createDAG([createNode('A', [], { isParallelBranch: true, parallelId: 'parallel-1' })])
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

  it('rejects unexecuted blocks', () => {
    const dag = createDAG([createNode('A'), createNode('B')])
    const executedBlocks = new Set(['A']) // B was not executed

    const result = validateRunFromBlock('B', dag, executedBlocks)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('was not executed')
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
})
