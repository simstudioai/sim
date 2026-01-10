import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { DAGEdge } from '@/executor/dag/types'
import type { SerializedBlock } from '@/serializer/types'
import { EdgeManager } from './edge-manager'

vi.mock('@sim/logger', () => loggerMock)

function createMockBlock(id: string): SerializedBlock {
  return {
    id,
    metadata: { id: 'test', name: 'Test Block' },
    position: { x: 0, y: 0 },
    config: { tool: '', params: {} },
    inputs: {},
    outputs: {},
    enabled: true,
  }
}

function createMockNode(
  id: string,
  outgoingEdges: DAGEdge[] = [],
  incomingEdges: string[] = []
): DAGNode {
  const outEdgesMap = new Map<string, DAGEdge>()
  outgoingEdges.forEach((edge, i) => {
    outEdgesMap.set(`edge-${i}`, edge)
  })

  return {
    id,
    block: createMockBlock(id),
    outgoingEdges: outEdgesMap,
    incomingEdges: new Set(incomingEdges),
    metadata: {},
  }
}

function createMockDAG(nodes: Map<string, DAGNode>): DAG {
  return {
    nodes,
    loopConfigs: new Map(),
    parallelConfigs: new Map(),
  }
}

describe('EdgeManager', () => {
  describe('Happy path - basic workflows', () => {
    it('should handle simple linear flow (A → B → C)', () => {
      const blockAId = 'block-a'
      const blockBId = 'block-b'
      const blockCId = 'block-c'

      const blockANode = createMockNode(blockAId, [{ target: blockBId }])
      const blockBNode = createMockNode(blockBId, [{ target: blockCId }], [blockAId])
      const blockCNode = createMockNode(blockCId, [], [blockBId])

      const nodes = new Map<string, DAGNode>([
        [blockAId, blockANode],
        [blockBId, blockBNode],
        [blockCId, blockCNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // A completes → B becomes ready
      const readyAfterA = edgeManager.processOutgoingEdges(blockANode, { result: 'done' })
      expect(readyAfterA).toContain(blockBId)
      expect(readyAfterA).not.toContain(blockCId)

      // B completes → C becomes ready
      const readyAfterB = edgeManager.processOutgoingEdges(blockBNode, { result: 'done' })
      expect(readyAfterB).toContain(blockCId)
    })

    it('should handle branching and each branch executing independently', () => {
      const startId = 'start'
      const branch1Id = 'branch-1'
      const branch2Id = 'branch-2'

      const startNode = createMockNode(startId, [
        { target: branch1Id, sourceHandle: 'condition-opt1' },
        { target: branch2Id, sourceHandle: 'condition-opt2' },
      ])

      const branch1Node = createMockNode(branch1Id, [], [startId])
      const branch2Node = createMockNode(branch2Id, [], [startId])

      const nodes = new Map<string, DAGNode>([
        [startId, startNode],
        [branch1Id, branch1Node],
        [branch2Id, branch2Node],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Select option 1
      const readyNodes = edgeManager.processOutgoingEdges(startNode, { selectedOption: 'opt1' })
      expect(readyNodes).toContain(branch1Id)
      expect(readyNodes).not.toContain(branch2Id)
    })

    it('should process standard block output with result', () => {
      const sourceId = 'source'
      const targetId = 'target'

      const sourceNode = createMockNode(sourceId, [{ target: targetId }])
      const targetNode = createMockNode(targetId, [], [sourceId])

      const nodes = new Map<string, DAGNode>([
        [sourceId, sourceNode],
        [targetId, targetNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Normal block output
      const output = {
        result: { data: 'test' },
        content: 'Hello world',
        tokens: { input: 10, output: 20, total: 30 },
      }

      const readyNodes = edgeManager.processOutgoingEdges(sourceNode, output)
      expect(readyNodes).toContain(targetId)
    })

    it('should handle multiple sequential blocks completing in order', () => {
      const block1Id = 'block-1'
      const block2Id = 'block-2'
      const block3Id = 'block-3'
      const block4Id = 'block-4'

      const block1Node = createMockNode(block1Id, [{ target: block2Id }])
      const block2Node = createMockNode(block2Id, [{ target: block3Id }], [block1Id])
      const block3Node = createMockNode(block3Id, [{ target: block4Id }], [block2Id])
      const block4Node = createMockNode(block4Id, [], [block3Id])

      const nodes = new Map<string, DAGNode>([
        [block1Id, block1Node],
        [block2Id, block2Node],
        [block3Id, block3Node],
        [block4Id, block4Node],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Process through the chain
      let ready = edgeManager.processOutgoingEdges(block1Node, {})
      expect(ready).toEqual([block2Id])

      ready = edgeManager.processOutgoingEdges(block2Node, {})
      expect(ready).toEqual([block3Id])

      ready = edgeManager.processOutgoingEdges(block3Node, {})
      expect(ready).toEqual([block4Id])

      ready = edgeManager.processOutgoingEdges(block4Node, {})
      expect(ready).toEqual([])
    })
  })

  describe('Multiple condition edges to same target', () => {
    it('should not cascade-deactivate when multiple edges from same source go to same target', () => {
      const conditionId = 'condition-1'
      const function1Id = 'function-1'
      const function2Id = 'function-2'

      const conditionNode = createMockNode(conditionId, [
        { target: function1Id, sourceHandle: 'condition-if' },
        { target: function1Id, sourceHandle: 'condition-else' },
      ])

      const function1Node = createMockNode(function1Id, [{ target: function2Id }], [conditionId])

      const function2Node = createMockNode(function2Id, [], [function1Id])

      const nodes = new Map<string, DAGNode>([
        [conditionId, conditionNode],
        [function1Id, function1Node],
        [function2Id, function2Node],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      const output = { selectedOption: 'if' }
      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, output)

      expect(readyNodes).toContain(function1Id)
      expect(function1Node.incomingEdges.size).toBe(0)
    })

    it('should handle "else if" selected when "if" points to same target', () => {
      const conditionId = 'condition-1'
      const function1Id = 'function-1'

      const conditionNode = createMockNode(conditionId, [
        { target: function1Id, sourceHandle: 'condition-if-id' },
        { target: function1Id, sourceHandle: 'condition-elseif-id' },
      ])

      const function1Node = createMockNode(function1Id, [], [conditionId])

      const nodes = new Map<string, DAGNode>([
        [conditionId, conditionNode],
        [function1Id, function1Node],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      const output = { selectedOption: 'elseif-id' }
      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, output)

      expect(readyNodes).toContain(function1Id)
    })

    it('should handle condition with if→A, elseif→B, else→A pattern', () => {
      const conditionId = 'condition-1'
      const function1Id = 'function-1'
      const function2Id = 'function-2'

      const conditionNode = createMockNode(conditionId, [
        { target: function1Id, sourceHandle: 'condition-if' },
        { target: function2Id, sourceHandle: 'condition-elseif' },
        { target: function1Id, sourceHandle: 'condition-else' },
      ])

      const function1Node = createMockNode(function1Id, [], [conditionId])
      const function2Node = createMockNode(function2Id, [], [conditionId])

      const nodes = new Map<string, DAGNode>([
        [conditionId, conditionNode],
        [function1Id, function1Node],
        [function2Id, function2Node],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      const output = { selectedOption: 'if' }
      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, output)
      expect(readyNodes).toContain(function1Id)
      expect(readyNodes).not.toContain(function2Id)
    })

    it('should activate correct target when elseif is selected (iteration 2)', () => {
      const conditionId = 'condition-1'
      const function1Id = 'function-1'
      const function2Id = 'function-2'

      const conditionNode = createMockNode(conditionId, [
        { target: function1Id, sourceHandle: 'condition-if' },
        { target: function2Id, sourceHandle: 'condition-elseif' },
        { target: function1Id, sourceHandle: 'condition-else' },
      ])

      const function1Node = createMockNode(function1Id, [], [conditionId])
      const function2Node = createMockNode(function2Id, [], [conditionId])

      const nodes = new Map<string, DAGNode>([
        [conditionId, conditionNode],
        [function1Id, function1Node],
        [function2Id, function2Node],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      const output = { selectedOption: 'elseif' }
      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, output)

      expect(readyNodes).toContain(function2Id)
      expect(readyNodes).not.toContain(function1Id)
    })

    it('should activate Function1 when else is selected (iteration 3+)', () => {
      const conditionId = 'condition-1'
      const function1Id = 'function-1'
      const function2Id = 'function-2'

      const conditionNode = createMockNode(conditionId, [
        { target: function1Id, sourceHandle: 'condition-if' },
        { target: function2Id, sourceHandle: 'condition-elseif' },
        { target: function1Id, sourceHandle: 'condition-else' },
      ])

      const function1Node = createMockNode(function1Id, [], [conditionId])
      const function2Node = createMockNode(function2Id, [], [conditionId])

      const nodes = new Map<string, DAGNode>([
        [conditionId, conditionNode],
        [function1Id, function1Node],
        [function2Id, function2Node],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      const output = { selectedOption: 'else' }
      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, output)

      expect(readyNodes).toContain(function1Id)
      expect(readyNodes).not.toContain(function2Id)
    })
  })

  describe('Cascade deactivation', () => {
    it('should cascade-deactivate descendants when ALL edges to target are deactivated', () => {
      const conditionId = 'condition-1'
      const function1Id = 'function-1'
      const function2Id = 'function-2'

      const conditionNode = createMockNode(conditionId, [
        { target: function1Id, sourceHandle: 'condition-if' },
      ])

      const function1Node = createMockNode(function1Id, [{ target: function2Id }], [conditionId])

      const function2Node = createMockNode(function2Id, [], [function1Id])

      const nodes = new Map<string, DAGNode>([
        [conditionId, conditionNode],
        [function1Id, function1Node],
        [function2Id, function2Node],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      const output = { selectedOption: 'else' }
      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, output)

      expect(readyNodes).not.toContain(function1Id)
    })
  })

  describe('Exact workflow reproduction: modern-atoll', () => {
    const conditionId = '63353190-ed15-427b-af6b-c0967ba06010'
    const function1Id = '576cc8a3-c3f3-40f5-a515-8320462b8162'
    const function2Id = 'b96067c5-0c5c-4a91-92bd-299e8c4ab42d'

    const ifConditionId = '63353190-ed15-427b-af6b-c0967ba06010-if'
    const elseIfConditionId = '63353190-ed15-427b-af6b-c0967ba06010-else-if-1766204485970'
    const elseConditionId = '63353190-ed15-427b-af6b-c0967ba06010-else'

    function setupWorkflow() {
      const conditionNode = createMockNode(conditionId, [
        { target: function1Id, sourceHandle: `condition-${ifConditionId}` },
        { target: function2Id, sourceHandle: `condition-${elseIfConditionId}` },
        { target: function1Id, sourceHandle: `condition-${elseConditionId}` },
      ])

      const function1Node = createMockNode(function1Id, [], [conditionId])
      const function2Node = createMockNode(function2Id, [], [conditionId])

      const nodes = new Map<string, DAGNode>([
        [conditionId, conditionNode],
        [function1Id, function1Node],
        [function2Id, function2Node],
      ])

      return createMockDAG(nodes)
    }

    it('iteration 1: if selected (loop.index == 1) should activate Function 1', () => {
      const dag = setupWorkflow()
      const edgeManager = new EdgeManager(dag)
      const conditionNode = dag.nodes.get(conditionId)!

      const output = { selectedOption: ifConditionId }
      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, output)

      expect(readyNodes).toContain(function1Id)
      expect(readyNodes).not.toContain(function2Id)
    })

    it('iteration 2: else if selected (loop.index == 2) should activate Function 2', () => {
      const dag = setupWorkflow()
      const edgeManager = new EdgeManager(dag)
      const conditionNode = dag.nodes.get(conditionId)!

      const output = { selectedOption: elseIfConditionId }
      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, output)

      expect(readyNodes).toContain(function2Id)
      expect(readyNodes).not.toContain(function1Id)
    })

    it('iteration 3+: else selected (loop.index > 2) should activate Function 1', () => {
      const dag = setupWorkflow()
      const edgeManager = new EdgeManager(dag)
      const conditionNode = dag.nodes.get(conditionId)!

      const output = { selectedOption: elseConditionId }
      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, output)

      expect(readyNodes).toContain(function1Id)
      expect(readyNodes).not.toContain(function2Id)
    })

    it('should handle multiple iterations correctly (simulating loop)', () => {
      const dag = setupWorkflow()
      const edgeManager = new EdgeManager(dag)
      const conditionNode = dag.nodes.get(conditionId)!

      // Iteration 1: if selected
      {
        dag.nodes.get(function1Id)!.incomingEdges = new Set([conditionId])
        dag.nodes.get(function2Id)!.incomingEdges = new Set([conditionId])
        edgeManager.clearDeactivatedEdges()

        const output = { selectedOption: ifConditionId }
        const readyNodes = edgeManager.processOutgoingEdges(conditionNode, output)
        expect(readyNodes).toContain(function1Id)
        expect(readyNodes).not.toContain(function2Id)
      }

      // Iteration 2: else if selected
      {
        dag.nodes.get(function1Id)!.incomingEdges = new Set([conditionId])
        dag.nodes.get(function2Id)!.incomingEdges = new Set([conditionId])
        edgeManager.clearDeactivatedEdges()

        const output = { selectedOption: elseIfConditionId }
        const readyNodes = edgeManager.processOutgoingEdges(conditionNode, output)
        expect(readyNodes).toContain(function2Id)
        expect(readyNodes).not.toContain(function1Id)
      }

      // Iteration 3: else selected
      {
        dag.nodes.get(function1Id)!.incomingEdges = new Set([conditionId])
        dag.nodes.get(function2Id)!.incomingEdges = new Set([conditionId])
        edgeManager.clearDeactivatedEdges()

        const output = { selectedOption: elseConditionId }
        const readyNodes = edgeManager.processOutgoingEdges(conditionNode, output)
        expect(readyNodes).toContain(function1Id)
        expect(readyNodes).not.toContain(function2Id)
      }
    })
  })

  describe('Error/Success edge handling', () => {
    it('should activate error edge when output has error', () => {
      const sourceId = 'source-1'
      const successTargetId = 'success-target'
      const errorTargetId = 'error-target'

      const sourceNode = createMockNode(sourceId, [
        { target: successTargetId, sourceHandle: 'source' },
        { target: errorTargetId, sourceHandle: 'error' },
      ])

      const successNode = createMockNode(successTargetId, [], [sourceId])
      const errorNode = createMockNode(errorTargetId, [], [sourceId])

      const nodes = new Map<string, DAGNode>([
        [sourceId, sourceNode],
        [successTargetId, successNode],
        [errorTargetId, errorNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      const output = { error: 'Something went wrong' }
      const readyNodes = edgeManager.processOutgoingEdges(sourceNode, output)

      expect(readyNodes).toContain(errorTargetId)
      expect(readyNodes).not.toContain(successTargetId)
    })

    it('should activate source edge when no error', () => {
      const sourceId = 'source-1'
      const successTargetId = 'success-target'
      const errorTargetId = 'error-target'

      const sourceNode = createMockNode(sourceId, [
        { target: successTargetId, sourceHandle: 'source' },
        { target: errorTargetId, sourceHandle: 'error' },
      ])

      const successNode = createMockNode(successTargetId, [], [sourceId])
      const errorNode = createMockNode(errorTargetId, [], [sourceId])

      const nodes = new Map<string, DAGNode>([
        [sourceId, sourceNode],
        [successTargetId, successNode],
        [errorTargetId, errorNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      const output = { result: 'success' }
      const readyNodes = edgeManager.processOutgoingEdges(sourceNode, output)

      expect(readyNodes).toContain(successTargetId)
      expect(readyNodes).not.toContain(errorTargetId)
    })
  })

  describe('Router edge handling', () => {
    it('should activate only the selected route', () => {
      const routerId = 'router-1'
      const route1Id = 'route-1'
      const route2Id = 'route-2'
      const route3Id = 'route-3'

      const routerNode = createMockNode(routerId, [
        { target: route1Id, sourceHandle: 'router-route1' },
        { target: route2Id, sourceHandle: 'router-route2' },
        { target: route3Id, sourceHandle: 'router-route3' },
      ])

      const route1Node = createMockNode(route1Id, [], [routerId])
      const route2Node = createMockNode(route2Id, [], [routerId])
      const route3Node = createMockNode(route3Id, [], [routerId])

      const nodes = new Map<string, DAGNode>([
        [routerId, routerNode],
        [route1Id, route1Node],
        [route2Id, route2Node],
        [route3Id, route3Node],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      const output = { selectedRoute: 'route2' }
      const readyNodes = edgeManager.processOutgoingEdges(routerNode, output)

      expect(readyNodes).toContain(route2Id)
      expect(readyNodes).not.toContain(route1Id)
      expect(readyNodes).not.toContain(route3Id)
    })
  })

  describe('Node with multiple incoming sources', () => {
    it('should wait for all incoming edges before becoming ready', () => {
      const source1Id = 'source-1'
      const source2Id = 'source-2'
      const targetId = 'target'

      const source1Node = createMockNode(source1Id, [{ target: targetId }])
      const source2Node = createMockNode(source2Id, [{ target: targetId }])
      const targetNode = createMockNode(targetId, [], [source1Id, source2Id])

      const nodes = new Map<string, DAGNode>([
        [source1Id, source1Node],
        [source2Id, source2Node],
        [targetId, targetNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Process first source
      const readyAfterFirst = edgeManager.processOutgoingEdges(source1Node, {})
      expect(readyAfterFirst).not.toContain(targetId)

      // Process second source
      const readyAfterSecond = edgeManager.processOutgoingEdges(source2Node, {})
      expect(readyAfterSecond).toContain(targetId)
    })
  })

  describe('clearDeactivatedEdgesForNodes', () => {
    it('should clear deactivated edges for specified nodes', () => {
      const conditionId = 'condition-1'
      const function1Id = 'function-1'

      const conditionNode = createMockNode(conditionId, [
        { target: function1Id, sourceHandle: 'condition-if' },
      ])
      const function1Node = createMockNode(function1Id, [], [conditionId])

      const nodes = new Map<string, DAGNode>([
        [conditionId, conditionNode],
        [function1Id, function1Node],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Deactivate edge by selecting non-existent option
      edgeManager.processOutgoingEdges(conditionNode, { selectedOption: 'nonexistent' })

      // Clear deactivated edges for condition node
      edgeManager.clearDeactivatedEdgesForNodes(new Set([conditionId]))

      // Restore incoming edge and try again
      function1Node.incomingEdges.add(conditionId)

      // Now select "if" - should work since edge is no longer deactivated
      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, { selectedOption: 'if' })
      expect(readyNodes).toContain(function1Id)
    })
  })

  describe('restoreIncomingEdge', () => {
    it('should restore an incoming edge to a target node', () => {
      const sourceId = 'source-1'
      const targetId = 'target-1'

      const sourceNode = createMockNode(sourceId, [{ target: targetId }])
      const targetNode = createMockNode(targetId, [], [])

      const nodes = new Map<string, DAGNode>([
        [sourceId, sourceNode],
        [targetId, targetNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      expect(targetNode.incomingEdges.has(sourceId)).toBe(false)

      edgeManager.restoreIncomingEdge(targetId, sourceId)

      expect(targetNode.incomingEdges.has(sourceId)).toBe(true)
    })
  })

  describe('Diamond pattern (convergent paths)', () => {
    it('should handle diamond: condition splits then converges at merge point', () => {
      const conditionId = 'condition-1'
      const branchAId = 'branch-a'
      const branchBId = 'branch-b'
      const mergeId = 'merge-point'

      const conditionNode = createMockNode(conditionId, [
        { target: branchAId, sourceHandle: 'condition-if' },
        { target: branchBId, sourceHandle: 'condition-else' },
      ])

      const branchANode = createMockNode(branchAId, [{ target: mergeId }], [conditionId])
      const branchBNode = createMockNode(branchBId, [{ target: mergeId }], [conditionId])
      const mergeNode = createMockNode(mergeId, [], [branchAId, branchBId])

      const nodes = new Map<string, DAGNode>([
        [conditionId, conditionNode],
        [branchAId, branchANode],
        [branchBId, branchBNode],
        [mergeId, mergeNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Select "if" branch
      const output = { selectedOption: 'if' }
      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, output)

      // Branch A should be ready
      expect(readyNodes).toContain(branchAId)
      expect(readyNodes).not.toContain(branchBId)

      // Process branch A completing
      const mergeReady = edgeManager.processOutgoingEdges(branchANode, {})

      // Merge point should be ready since branch B was deactivated
      expect(mergeReady).toContain(mergeId)
    })

    it('should wait for both branches when both are active (parallel merge)', () => {
      const source1Id = 'source-1'
      const source2Id = 'source-2'
      const mergeId = 'merge-point'

      const source1Node = createMockNode(source1Id, [{ target: mergeId }])
      const source2Node = createMockNode(source2Id, [{ target: mergeId }])
      const mergeNode = createMockNode(mergeId, [], [source1Id, source2Id])

      const nodes = new Map<string, DAGNode>([
        [source1Id, source1Node],
        [source2Id, source2Node],
        [mergeId, mergeNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Process first source
      const readyAfterFirst = edgeManager.processOutgoingEdges(source1Node, {})
      expect(readyAfterFirst).not.toContain(mergeId)

      // Process second source
      const readyAfterSecond = edgeManager.processOutgoingEdges(source2Node, {})
      expect(readyAfterSecond).toContain(mergeId)
    })
  })

  describe('Error edge cascading', () => {
    it('should cascade-deactivate success path when error occurs', () => {
      const sourceId = 'source'
      const successId = 'success-handler'
      const errorId = 'error-handler'
      const afterSuccessId = 'after-success'

      const sourceNode = createMockNode(sourceId, [
        { target: successId, sourceHandle: 'source' },
        { target: errorId, sourceHandle: 'error' },
      ])

      const successNode = createMockNode(successId, [{ target: afterSuccessId }], [sourceId])
      const errorNode = createMockNode(errorId, [], [sourceId])
      const afterSuccessNode = createMockNode(afterSuccessId, [], [successId])

      const nodes = new Map<string, DAGNode>([
        [sourceId, sourceNode],
        [successId, successNode],
        [errorId, errorNode],
        [afterSuccessId, afterSuccessNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Source produces an error
      const output = { error: 'Something failed' }
      const readyNodes = edgeManager.processOutgoingEdges(sourceNode, output)

      // Error handler should be ready, success handler should not
      expect(readyNodes).toContain(errorId)
      expect(readyNodes).not.toContain(successId)
    })

    it('should cascade-deactivate error path when success occurs', () => {
      const sourceId = 'source'
      const successId = 'success-handler'
      const errorId = 'error-handler'
      const afterErrorId = 'after-error'

      const sourceNode = createMockNode(sourceId, [
        { target: successId, sourceHandle: 'source' },
        { target: errorId, sourceHandle: 'error' },
      ])

      const successNode = createMockNode(successId, [], [sourceId])
      const errorNode = createMockNode(errorId, [{ target: afterErrorId }], [sourceId])
      const afterErrorNode = createMockNode(afterErrorId, [], [errorId])

      const nodes = new Map<string, DAGNode>([
        [sourceId, sourceNode],
        [successId, successNode],
        [errorId, errorNode],
        [afterErrorId, afterErrorNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Source succeeds
      const output = { result: 'success' }
      const readyNodes = edgeManager.processOutgoingEdges(sourceNode, output)

      // Success handler should be ready, error handler should not
      expect(readyNodes).toContain(successId)
      expect(readyNodes).not.toContain(errorId)
    })

    it('should handle error edge to same target as success edge', () => {
      const sourceId = 'source'
      const handlerId = 'handler'

      const sourceNode = createMockNode(sourceId, [
        { target: handlerId, sourceHandle: 'source' },
        { target: handlerId, sourceHandle: 'error' },
      ])

      const handlerNode = createMockNode(handlerId, [], [sourceId])

      const nodes = new Map<string, DAGNode>([
        [sourceId, sourceNode],
        [handlerId, handlerNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // When error occurs, handler should still be ready via error edge
      const errorOutput = { error: 'Failed' }
      const readyWithError = edgeManager.processOutgoingEdges(sourceNode, errorOutput)
      expect(readyWithError).toContain(handlerId)
    })
  })

  describe('Chained conditions', () => {
    it('should handle sequential conditions (condition1 → condition2)', () => {
      const condition1Id = 'condition-1'
      const condition2Id = 'condition-2'
      const target1Id = 'target-1'
      const target2Id = 'target-2'

      const condition1Node = createMockNode(condition1Id, [
        { target: condition2Id, sourceHandle: 'condition-if' },
        { target: target1Id, sourceHandle: 'condition-else' },
      ])

      const condition2Node = createMockNode(
        condition2Id,
        [
          { target: target2Id, sourceHandle: 'condition-if' },
          { target: target1Id, sourceHandle: 'condition-else' },
        ],
        [condition1Id]
      )

      const target1Node = createMockNode(target1Id, [], [condition1Id, condition2Id])
      const target2Node = createMockNode(target2Id, [], [condition2Id])

      const nodes = new Map<string, DAGNode>([
        [condition1Id, condition1Node],
        [condition2Id, condition2Node],
        [target1Id, target1Node],
        [target2Id, target2Node],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // First condition: select "if" → goes to condition2
      const ready1 = edgeManager.processOutgoingEdges(condition1Node, { selectedOption: 'if' })
      expect(ready1).toContain(condition2Id)
      expect(ready1).not.toContain(target1Id)

      // Second condition: select "else" → goes to target1
      const ready2 = edgeManager.processOutgoingEdges(condition2Node, { selectedOption: 'else' })
      expect(ready2).toContain(target1Id)
      expect(ready2).not.toContain(target2Id)
    })
  })

  describe('Loop edge handling', () => {
    it('should skip backwards edge when skipBackwardsEdge is true', () => {
      const loopStartId = 'loop-start'
      const loopBodyId = 'loop-body'

      const loopStartNode = createMockNode(loopStartId, [
        { target: loopBodyId, sourceHandle: 'loop-start-source' },
      ])

      // Use correct constant: loop_continue (with underscore)
      const loopBodyNode = createMockNode(
        loopBodyId,
        [{ target: loopStartId, sourceHandle: 'loop_continue' }],
        [loopStartId]
      )

      const nodes = new Map<string, DAGNode>([
        [loopStartId, loopStartNode],
        [loopBodyId, loopBodyNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Process with skipBackwardsEdge = true
      const readyNodes = edgeManager.processOutgoingEdges(loopBodyNode, {}, true)

      // Loop start should NOT be activated because we're skipping backwards edges
      expect(readyNodes).not.toContain(loopStartId)
    })

    it('should include backwards edge when skipBackwardsEdge is false', () => {
      const loopStartId = 'loop-start'
      const loopBodyId = 'loop-body'

      // Use correct constant: loop_continue (with underscore)
      const loopBodyNode = createMockNode(loopBodyId, [
        { target: loopStartId, sourceHandle: 'loop_continue' },
      ])

      const loopStartNode = createMockNode(loopStartId, [], [loopBodyId])

      const nodes = new Map<string, DAGNode>([
        [loopStartId, loopStartNode],
        [loopBodyId, loopBodyNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Process without skipping backwards edges
      const readyNodes = edgeManager.processOutgoingEdges(loopBodyNode, {}, false)

      // Loop start should be activated
      expect(readyNodes).toContain(loopStartId)
    })

    it('should handle loop-exit vs loop-continue based on selectedRoute', () => {
      const loopCheckId = 'loop-check'
      const loopBodyId = 'loop-body'
      const afterLoopId = 'after-loop'

      // Use correct constants: loop_continue, loop_exit (with underscores)
      const loopCheckNode = createMockNode(loopCheckId, [
        { target: loopBodyId, sourceHandle: 'loop_continue' },
        { target: afterLoopId, sourceHandle: 'loop_exit' },
      ])

      const loopBodyNode = createMockNode(loopBodyId, [], [loopCheckId])
      const afterLoopNode = createMockNode(afterLoopId, [], [loopCheckId])

      const nodes = new Map<string, DAGNode>([
        [loopCheckId, loopCheckNode],
        [loopBodyId, loopBodyNode],
        [afterLoopId, afterLoopNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Test loop-exit selection using the correct constant value
      const exitOutput = { selectedRoute: 'loop_exit' }
      const exitReady = edgeManager.processOutgoingEdges(loopCheckNode, exitOutput)
      expect(exitReady).toContain(afterLoopId)
      expect(exitReady).not.toContain(loopBodyId)
    })
  })

  describe('Complex routing patterns', () => {
    it('should handle 3+ conditions pointing to same target', () => {
      const conditionId = 'condition-1'
      const targetId = 'target'
      const altTargetId = 'alt-target'

      const conditionNode = createMockNode(conditionId, [
        { target: targetId, sourceHandle: 'condition-cond1' },
        { target: targetId, sourceHandle: 'condition-cond2' },
        { target: targetId, sourceHandle: 'condition-cond3' },
        { target: altTargetId, sourceHandle: 'condition-else' },
      ])

      const targetNode = createMockNode(targetId, [], [conditionId])
      const altTargetNode = createMockNode(altTargetId, [], [conditionId])

      const nodes = new Map<string, DAGNode>([
        [conditionId, conditionNode],
        [targetId, targetNode],
        [altTargetId, altTargetNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Select middle condition
      const output = { selectedOption: 'cond2' }
      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, output)

      expect(readyNodes).toContain(targetId)
      expect(readyNodes).not.toContain(altTargetId)
    })

    it('should handle no matching condition (all edges deactivated)', () => {
      const conditionId = 'condition-1'
      const target1Id = 'target-1'
      const target2Id = 'target-2'

      const conditionNode = createMockNode(conditionId, [
        { target: target1Id, sourceHandle: 'condition-cond1' },
        { target: target2Id, sourceHandle: 'condition-cond2' },
      ])

      const target1Node = createMockNode(target1Id, [], [conditionId])
      const target2Node = createMockNode(target2Id, [], [conditionId])

      const nodes = new Map<string, DAGNode>([
        [conditionId, conditionNode],
        [target1Id, target1Node],
        [target2Id, target2Node],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Select non-existent condition
      const output = { selectedOption: 'nonexistent' }
      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, output)

      // No nodes should be ready
      expect(readyNodes).not.toContain(target1Id)
      expect(readyNodes).not.toContain(target2Id)
      expect(readyNodes).toHaveLength(0)
    })
  })

  describe('Edge with no sourceHandle (default edge)', () => {
    it('should activate edge without sourceHandle by default', () => {
      const sourceId = 'source'
      const targetId = 'target'

      const sourceNode = createMockNode(sourceId, [{ target: targetId }])
      const targetNode = createMockNode(targetId, [], [sourceId])

      const nodes = new Map<string, DAGNode>([
        [sourceId, sourceNode],
        [targetId, targetNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      const readyNodes = edgeManager.processOutgoingEdges(sourceNode, {})

      expect(readyNodes).toContain(targetId)
    })

    it('should not activate default edge when error occurs', () => {
      const sourceId = 'source'
      const targetId = 'target'
      const errorTargetId = 'error-target'

      const sourceNode = createMockNode(sourceId, [
        { target: targetId },
        { target: errorTargetId, sourceHandle: 'error' },
      ])

      const targetNode = createMockNode(targetId, [], [sourceId])
      const errorTargetNode = createMockNode(errorTargetId, [], [sourceId])

      const nodes = new Map<string, DAGNode>([
        [sourceId, sourceNode],
        [targetId, targetNode],
        [errorTargetId, errorTargetNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // When no explicit error, default edge should be activated
      const successReady = edgeManager.processOutgoingEdges(sourceNode, { result: 'ok' })
      expect(successReady).toContain(targetId)
    })
  })
})
