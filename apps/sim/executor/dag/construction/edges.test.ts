import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { SerializedBlock, SerializedLoop, SerializedWorkflow } from '@/serializer/types'
import { EdgeConstructor } from './edges'

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

function createMockBlock(id: string, type = 'function', config: any = {}): SerializedBlock {
  return {
    id,
    metadata: { id: type, name: `Block ${id}` },
    position: { x: 0, y: 0 },
    config: { tool: type, params: config },
    inputs: {},
    outputs: {},
    enabled: true,
  }
}

function createMockNode(id: string): DAGNode {
  return {
    id,
    block: createMockBlock(id),
    outgoingEdges: new Map(),
    incomingEdges: new Set(),
    metadata: {},
  }
}

function createMockDAG(nodeIds: string[]): DAG {
  const nodes = new Map<string, DAGNode>()
  for (const id of nodeIds) {
    nodes.set(id, createMockNode(id))
  }
  return {
    nodes,
    loopConfigs: new Map(),
    parallelConfigs: new Map(),
  }
}

function createMockWorkflow(
  blocks: SerializedBlock[],
  connections: Array<{
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
  }>,
  loops: Record<string, SerializedLoop> = {},
  parallels: Record<string, any> = {}
): SerializedWorkflow {
  return {
    version: '1',
    blocks,
    connections,
    loops,
    parallels,
  }
}

describe('EdgeConstructor', () => {
  let edgeConstructor: EdgeConstructor

  beforeEach(() => {
    edgeConstructor = new EdgeConstructor()
  })

  describe('Edge ID generation (bug fix verification)', () => {
    it('should generate unique edge IDs for multiple edges to same target with different handles', () => {
      const conditionId = 'condition-1'
      const targetId = 'target-1'

      const conditionBlock = createMockBlock(conditionId, 'condition', {
        conditions: JSON.stringify([
          { id: 'if-id', label: 'if', condition: 'true' },
          { id: 'else-id', label: 'else', condition: '' },
        ]),
      })

      const workflow = createMockWorkflow(
        [conditionBlock, createMockBlock(targetId)],
        [
          { source: conditionId, target: targetId, sourceHandle: 'condition-if-id' },
          { source: conditionId, target: targetId, sourceHandle: 'condition-else-id' },
        ]
      )

      const dag = createMockDAG([conditionId, targetId])

      edgeConstructor.execute(
        workflow,
        dag,
        new Set(),
        new Set(),
        new Set([conditionId, targetId]),
        new Map()
      )

      const conditionNode = dag.nodes.get(conditionId)!

      // Should have 2 edges, not 1 (the bug was that they would overwrite each other)
      expect(conditionNode.outgoingEdges.size).toBe(2)

      // Verify edge IDs are unique and include the sourceHandle
      const edgeIds = Array.from(conditionNode.outgoingEdges.keys())
      expect(edgeIds).toContain(`${conditionId}→${targetId}-condition-if-id`)
      expect(edgeIds).toContain(`${conditionId}→${targetId}-condition-else-id`)
    })

    it('should generate edge ID without handle suffix when no sourceHandle', () => {
      const sourceId = 'source-1'
      const targetId = 'target-1'

      const workflow = createMockWorkflow(
        [createMockBlock(sourceId), createMockBlock(targetId)],
        [{ source: sourceId, target: targetId }]
      )

      const dag = createMockDAG([sourceId, targetId])

      edgeConstructor.execute(
        workflow,
        dag,
        new Set(),
        new Set(),
        new Set([sourceId, targetId]),
        new Map()
      )

      const sourceNode = dag.nodes.get(sourceId)!
      const edgeIds = Array.from(sourceNode.outgoingEdges.keys())

      expect(edgeIds).toContain(`${sourceId}→${targetId}`)
    })
  })

  describe('Condition block edge wiring', () => {
    it('should wire condition block edges with proper condition prefixes', () => {
      const conditionId = 'condition-1'
      const target1Id = 'target-1'
      const target2Id = 'target-2'

      const conditionBlock = createMockBlock(conditionId, 'condition', {
        conditions: JSON.stringify([
          { id: 'cond-if', label: 'if', condition: 'x > 5' },
          { id: 'cond-else', label: 'else', condition: '' },
        ]),
      })

      const workflow = createMockWorkflow(
        [conditionBlock, createMockBlock(target1Id), createMockBlock(target2Id)],
        [
          { source: conditionId, target: target1Id, sourceHandle: 'condition-cond-if' },
          { source: conditionId, target: target2Id, sourceHandle: 'condition-cond-else' },
        ]
      )

      const dag = createMockDAG([conditionId, target1Id, target2Id])

      edgeConstructor.execute(
        workflow,
        dag,
        new Set(),
        new Set(),
        new Set([conditionId, target1Id, target2Id]),
        new Map()
      )

      const conditionNode = dag.nodes.get(conditionId)!

      expect(conditionNode.outgoingEdges.size).toBe(2)

      // Verify edges have correct targets and handles
      const edges = Array.from(conditionNode.outgoingEdges.values())
      const ifEdge = edges.find((e) => e.sourceHandle === 'condition-cond-if')
      const elseEdge = edges.find((e) => e.sourceHandle === 'condition-cond-else')

      expect(ifEdge?.target).toBe(target1Id)
      expect(elseEdge?.target).toBe(target2Id)
    })

    it('should handle condition block with if→A, elseif→B, else→A pattern', () => {
      const conditionId = 'condition-1'
      const targetAId = 'target-a'
      const targetBId = 'target-b'

      const conditionBlock = createMockBlock(conditionId, 'condition', {
        conditions: JSON.stringify([
          { id: 'if-id', label: 'if', condition: 'x == 1' },
          { id: 'elseif-id', label: 'else if', condition: 'x == 2' },
          { id: 'else-id', label: 'else', condition: '' },
        ]),
      })

      const workflow = createMockWorkflow(
        [conditionBlock, createMockBlock(targetAId), createMockBlock(targetBId)],
        [
          { source: conditionId, target: targetAId, sourceHandle: 'condition-if-id' },
          { source: conditionId, target: targetBId, sourceHandle: 'condition-elseif-id' },
          { source: conditionId, target: targetAId, sourceHandle: 'condition-else-id' },
        ]
      )

      const dag = createMockDAG([conditionId, targetAId, targetBId])

      edgeConstructor.execute(
        workflow,
        dag,
        new Set(),
        new Set(),
        new Set([conditionId, targetAId, targetBId]),
        new Map()
      )

      const conditionNode = dag.nodes.get(conditionId)!

      // Should have 3 edges (if→A, elseif→B, else→A)
      expect(conditionNode.outgoingEdges.size).toBe(3)

      // Target A should have 2 incoming edges (from if and else)
      const targetANode = dag.nodes.get(targetAId)!
      expect(targetANode.incomingEdges.has(conditionId)).toBe(true)

      // Target B should have 1 incoming edge (from elseif)
      const targetBNode = dag.nodes.get(targetBId)!
      expect(targetBNode.incomingEdges.has(conditionId)).toBe(true)
    })
  })

  describe('Router block edge wiring', () => {
    it('should wire router block edges with router prefix', () => {
      const routerId = 'router-1'
      const target1Id = 'target-1'
      const target2Id = 'target-2'

      const routes = [
        { id: 'route-if', title: 'if', value: 'value > 10' },
        { id: 'route-else', title: 'else', value: '' },
      ]

      const routerBlock = createMockBlock(routerId, 'router', {
        routes: JSON.stringify(routes),
      })

      const workflow = createMockWorkflow(
        [routerBlock, createMockBlock(target1Id), createMockBlock(target2Id)],
        [
          { source: routerId, target: target1Id },
          { source: routerId, target: target2Id },
        ]
      )

      const dag = createMockDAG([routerId, target1Id, target2Id])

      edgeConstructor.execute(
        workflow,
        dag,
        new Set(),
        new Set(),
        new Set([routerId, target1Id, target2Id]),
        new Map()
      )

      const routerNode = dag.nodes.get(routerId)!
      const edges = Array.from(routerNode.outgoingEdges.values())

      // Router edges should have router- prefix with route ID
      expect(edges[0].sourceHandle).toBe('router-route-if')
      expect(edges[1].sourceHandle).toBe('router-route-else')
    })
  })

  describe('Simple linear workflow', () => {
    it('should wire linear workflow correctly', () => {
      const block1Id = 'block-1'
      const block2Id = 'block-2'
      const block3Id = 'block-3'

      const workflow = createMockWorkflow(
        [createMockBlock(block1Id), createMockBlock(block2Id), createMockBlock(block3Id)],
        [
          { source: block1Id, target: block2Id },
          { source: block2Id, target: block3Id },
        ]
      )

      const dag = createMockDAG([block1Id, block2Id, block3Id])

      edgeConstructor.execute(
        workflow,
        dag,
        new Set(),
        new Set(),
        new Set([block1Id, block2Id, block3Id]),
        new Map()
      )

      // Block 1 → Block 2
      const block1Node = dag.nodes.get(block1Id)!
      expect(block1Node.outgoingEdges.size).toBe(1)
      expect(Array.from(block1Node.outgoingEdges.values())[0].target).toBe(block2Id)

      // Block 2 → Block 3
      const block2Node = dag.nodes.get(block2Id)!
      expect(block2Node.outgoingEdges.size).toBe(1)
      expect(Array.from(block2Node.outgoingEdges.values())[0].target).toBe(block3Id)
      expect(block2Node.incomingEdges.has(block1Id)).toBe(true)

      // Block 3 has incoming from Block 2
      const block3Node = dag.nodes.get(block3Id)!
      expect(block3Node.incomingEdges.has(block2Id)).toBe(true)
    })
  })

  describe('Edge reachability', () => {
    it('should not wire edges to blocks not in DAG nodes', () => {
      const block1Id = 'block-1'
      const block2Id = 'block-2'
      const unreachableId = 'unreachable'

      const workflow = createMockWorkflow(
        [createMockBlock(block1Id), createMockBlock(block2Id), createMockBlock(unreachableId)],
        [
          { source: block1Id, target: block2Id },
          { source: block1Id, target: unreachableId },
        ]
      )

      // Only create DAG nodes for block1 and block2 (not unreachable)
      const dag = createMockDAG([block1Id, block2Id])

      edgeConstructor.execute(
        workflow,
        dag,
        new Set(),
        new Set(),
        new Set([block1Id, block2Id]),
        new Map()
      )

      const block1Node = dag.nodes.get(block1Id)!

      // Should only have edge to block2, not unreachable (not in DAG)
      expect(block1Node.outgoingEdges.size).toBe(1)
      expect(Array.from(block1Node.outgoingEdges.values())[0].target).toBe(block2Id)
    })

    it('should check both reachableBlocks and dag.nodes for edge validity', () => {
      const block1Id = 'block-1'
      const block2Id = 'block-2'

      const workflow = createMockWorkflow(
        [createMockBlock(block1Id), createMockBlock(block2Id)],
        [{ source: block1Id, target: block2Id }]
      )

      const dag = createMockDAG([block1Id, block2Id])

      // Block2 exists in DAG but not in reachableBlocks - edge should still be wired
      // because isEdgeReachable checks: reachableBlocks.has(target) || dag.nodes.has(target)
      edgeConstructor.execute(
        workflow,
        dag,
        new Set(),
        new Set(),
        new Set([block1Id]), // Only block1 is "reachable" but block2 exists in DAG
        new Map()
      )

      const block1Node = dag.nodes.get(block1Id)!
      expect(block1Node.outgoingEdges.size).toBe(1)
    })
  })

  describe('Error edge handling', () => {
    it('should preserve error sourceHandle', () => {
      const sourceId = 'source-1'
      const successTargetId = 'success-target'
      const errorTargetId = 'error-target'

      const workflow = createMockWorkflow(
        [
          createMockBlock(sourceId),
          createMockBlock(successTargetId),
          createMockBlock(errorTargetId),
        ],
        [
          { source: sourceId, target: successTargetId, sourceHandle: 'source' },
          { source: sourceId, target: errorTargetId, sourceHandle: 'error' },
        ]
      )

      const dag = createMockDAG([sourceId, successTargetId, errorTargetId])

      edgeConstructor.execute(
        workflow,
        dag,
        new Set(),
        new Set(),
        new Set([sourceId, successTargetId, errorTargetId]),
        new Map()
      )

      const sourceNode = dag.nodes.get(sourceId)!
      const edges = Array.from(sourceNode.outgoingEdges.values())

      const successEdge = edges.find((e) => e.target === successTargetId)
      const errorEdge = edges.find((e) => e.target === errorTargetId)

      expect(successEdge?.sourceHandle).toBe('source')
      expect(errorEdge?.sourceHandle).toBe('error')
    })
  })

  describe('Loop sentinel wiring', () => {
    it('should wire loop sentinels to nodes with no incoming edges from within loop', () => {
      const loopId = 'loop-1'
      const nodeInLoopId = 'node-in-loop'
      const sentinelStartId = `loop-${loopId}-sentinel-start`
      const sentinelEndId = `loop-${loopId}-sentinel-end`

      // Create DAG with sentinels - nodeInLoop has no incoming edges from loop nodes
      // so it will be identified as a start node
      const dag = createMockDAG([nodeInLoopId, sentinelStartId, sentinelEndId])
      dag.loopConfigs.set(loopId, {
        id: loopId,
        nodes: [nodeInLoopId],
        iterations: 5,
        loopType: 'for',
      } as SerializedLoop)

      const workflow = createMockWorkflow([createMockBlock(nodeInLoopId)], [], {
        [loopId]: {
          id: loopId,
          nodes: [nodeInLoopId],
          iterations: 5,
          loopType: 'for',
        } as SerializedLoop,
      })

      edgeConstructor.execute(
        workflow,
        dag,
        new Set(),
        new Set([nodeInLoopId]),
        new Set([nodeInLoopId, sentinelStartId, sentinelEndId]),
        new Map()
      )

      // Sentinel start should have edge to node in loop (it's a start node - no incoming from loop)
      const sentinelStartNode = dag.nodes.get(sentinelStartId)!
      expect(sentinelStartNode.outgoingEdges.size).toBe(1)
      const startEdge = Array.from(sentinelStartNode.outgoingEdges.values())[0]
      expect(startEdge.target).toBe(nodeInLoopId)

      // Node in loop should have edge to sentinel end (it's a terminal node - no outgoing to loop)
      const nodeInLoopNode = dag.nodes.get(nodeInLoopId)!
      const hasEdgeToEnd = Array.from(nodeInLoopNode.outgoingEdges.values()).some(
        (e) => e.target === sentinelEndId
      )
      expect(hasEdgeToEnd).toBe(true)

      // Sentinel end should have loop_continue edge back to start
      const sentinelEndNode = dag.nodes.get(sentinelEndId)!
      const continueEdge = Array.from(sentinelEndNode.outgoingEdges.values()).find(
        (e) => e.sourceHandle === 'loop_continue'
      )
      expect(continueEdge?.target).toBe(sentinelStartId)
    })

    it('should identify multiple start and terminal nodes in loop', () => {
      const loopId = 'loop-1'
      const node1Id = 'node-1'
      const node2Id = 'node-2'
      const sentinelStartId = `loop-${loopId}-sentinel-start`
      const sentinelEndId = `loop-${loopId}-sentinel-end`

      // Create DAG with two nodes in loop - both are start and terminal (no edges between them)
      const dag = createMockDAG([node1Id, node2Id, sentinelStartId, sentinelEndId])
      dag.loopConfigs.set(loopId, {
        id: loopId,
        nodes: [node1Id, node2Id],
        iterations: 3,
        loopType: 'for',
      } as SerializedLoop)

      const workflow = createMockWorkflow(
        [createMockBlock(node1Id), createMockBlock(node2Id)],
        [],
        {
          [loopId]: {
            id: loopId,
            nodes: [node1Id, node2Id],
            iterations: 3,
            loopType: 'for',
          } as SerializedLoop,
        }
      )

      edgeConstructor.execute(
        workflow,
        dag,
        new Set(),
        new Set([node1Id, node2Id]),
        new Set([node1Id, node2Id, sentinelStartId, sentinelEndId]),
        new Map()
      )

      // Sentinel start should have edges to both nodes (both are start nodes)
      const sentinelStartNode = dag.nodes.get(sentinelStartId)!
      expect(sentinelStartNode.outgoingEdges.size).toBe(2)

      // Both nodes should have edges to sentinel end (both are terminal nodes)
      const node1 = dag.nodes.get(node1Id)!
      const node2 = dag.nodes.get(node2Id)!
      expect(Array.from(node1.outgoingEdges.values()).some((e) => e.target === sentinelEndId)).toBe(
        true
      )
      expect(Array.from(node2.outgoingEdges.values()).some((e) => e.target === sentinelEndId)).toBe(
        true
      )
    })
  })

  describe('Cross-loop boundary detection', () => {
    it('should not wire edges that cross loop boundaries', () => {
      const outsideId = 'outside'
      const insideId = 'inside'
      const loopId = 'loop-1'

      const workflow = createMockWorkflow(
        [createMockBlock(outsideId), createMockBlock(insideId)],
        [{ source: outsideId, target: insideId }],
        {
          [loopId]: {
            id: loopId,
            nodes: [insideId],
            iterations: 5,
            loopType: 'for',
          } as SerializedLoop,
        }
      )

      const dag = createMockDAG([outsideId, insideId])
      dag.loopConfigs.set(loopId, {
        id: loopId,
        nodes: [insideId],
        iterations: 5,
        loopType: 'for',
      } as SerializedLoop)

      edgeConstructor.execute(
        workflow,
        dag,
        new Set(),
        new Set([insideId]),
        new Set([outsideId, insideId]),
        new Map()
      )

      // Edge should not be wired because it crosses loop boundary
      const outsideNode = dag.nodes.get(outsideId)!
      expect(outsideNode.outgoingEdges.size).toBe(0)
    })
  })
})
