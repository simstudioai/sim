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

      const readyAfterA = edgeManager.processOutgoingEdges(blockANode, { result: 'done' })
      expect(readyAfterA).toContain(blockBId)
      expect(readyAfterA).not.toContain(blockCId)

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

      const readyAfterFirst = edgeManager.processOutgoingEdges(source1Node, {})
      expect(readyAfterFirst).not.toContain(targetId)

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

      edgeManager.processOutgoingEdges(conditionNode, { selectedOption: 'nonexistent' })

      edgeManager.clearDeactivatedEdgesForNodes(new Set([conditionId]))

      function1Node.incomingEdges.add(conditionId)

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

      const output = { selectedOption: 'if' }
      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, output)

      expect(readyNodes).toContain(branchAId)
      expect(readyNodes).not.toContain(branchBId)

      const mergeReady = edgeManager.processOutgoingEdges(branchANode, {})

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

      const readyAfterFirst = edgeManager.processOutgoingEdges(source1Node, {})
      expect(readyAfterFirst).not.toContain(mergeId)

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

      const output = { error: 'Something failed' }
      const readyNodes = edgeManager.processOutgoingEdges(sourceNode, output)

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

      const output = { result: 'success' }
      const readyNodes = edgeManager.processOutgoingEdges(sourceNode, output)

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

      const errorOutput = { error: 'Failed' }
      const readyWithError = edgeManager.processOutgoingEdges(sourceNode, errorOutput)
      expect(readyWithError).toContain(handlerId)
    })
  })

  describe('Multiple error ports to same target', () => {
    it('should mark target ready when one source errors and another succeeds', () => {
      // This tests the case where a node has multiple incoming error edges
      // from different sources. When one source errors (activating its error edge)
      // and another source succeeds (deactivating its error edge), the target
      // should become ready after both sources complete.
      //
      // Workflow 1 (errors) ─── error ───┐
      //                                  ├──→ Error Handler
      // Workflow 7 (succeeds) ─ error ───┘

      const workflow1Id = 'workflow-1'
      const workflow7Id = 'workflow-7'
      const errorHandlerId = 'error-handler'

      const workflow1Node = createMockNode(workflow1Id, [
        { target: errorHandlerId, sourceHandle: 'error' },
      ])

      const workflow7Node = createMockNode(workflow7Id, [
        { target: errorHandlerId, sourceHandle: 'error' },
      ])

      const errorHandlerNode = createMockNode(errorHandlerId, [], [workflow1Id, workflow7Id])

      const nodes = new Map<string, DAGNode>([
        [workflow1Id, workflow1Node],
        [workflow7Id, workflow7Node],
        [errorHandlerId, errorHandlerNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Workflow 1 errors first - error edge activates
      const readyAfterWorkflow1 = edgeManager.processOutgoingEdges(workflow1Node, {
        error: 'Something went wrong',
      })
      // Error handler should NOT be ready yet (waiting for workflow 7)
      expect(readyAfterWorkflow1).not.toContain(errorHandlerId)

      // Workflow 7 succeeds - error edge deactivates
      const readyAfterWorkflow7 = edgeManager.processOutgoingEdges(workflow7Node, {
        result: 'success',
      })
      // Error handler SHOULD be ready now (workflow 1's error edge activated)
      expect(readyAfterWorkflow7).toContain(errorHandlerId)
    })

    it('should mark target ready when first source succeeds then second errors', () => {
      // Opposite order: first source succeeds, then second errors

      const workflow1Id = 'workflow-1'
      const workflow7Id = 'workflow-7'
      const errorHandlerId = 'error-handler'

      const workflow1Node = createMockNode(workflow1Id, [
        { target: errorHandlerId, sourceHandle: 'error' },
      ])

      const workflow7Node = createMockNode(workflow7Id, [
        { target: errorHandlerId, sourceHandle: 'error' },
      ])

      const errorHandlerNode = createMockNode(errorHandlerId, [], [workflow1Id, workflow7Id])

      const nodes = new Map<string, DAGNode>([
        [workflow1Id, workflow1Node],
        [workflow7Id, workflow7Node],
        [errorHandlerId, errorHandlerNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Workflow 1 succeeds first - error edge deactivates
      const readyAfterWorkflow1 = edgeManager.processOutgoingEdges(workflow1Node, {
        result: 'success',
      })
      // Error handler should NOT be ready yet (waiting for workflow 7)
      expect(readyAfterWorkflow1).not.toContain(errorHandlerId)

      // Workflow 7 errors - error edge activates
      const readyAfterWorkflow7 = edgeManager.processOutgoingEdges(workflow7Node, {
        error: 'Something went wrong',
      })
      // Error handler SHOULD be ready now (workflow 7's error edge activated)
      expect(readyAfterWorkflow7).toContain(errorHandlerId)
    })

    it('should NOT mark target ready when all sources succeed (no errors)', () => {
      // When neither source errors, the error handler should NOT run

      const workflow1Id = 'workflow-1'
      const workflow7Id = 'workflow-7'
      const errorHandlerId = 'error-handler'

      const workflow1Node = createMockNode(workflow1Id, [
        { target: errorHandlerId, sourceHandle: 'error' },
      ])

      const workflow7Node = createMockNode(workflow7Id, [
        { target: errorHandlerId, sourceHandle: 'error' },
      ])

      const errorHandlerNode = createMockNode(errorHandlerId, [], [workflow1Id, workflow7Id])

      const nodes = new Map<string, DAGNode>([
        [workflow1Id, workflow1Node],
        [workflow7Id, workflow7Node],
        [errorHandlerId, errorHandlerNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Both workflows succeed - both error edges deactivate
      const readyAfterWorkflow1 = edgeManager.processOutgoingEdges(workflow1Node, {
        result: 'success',
      })
      expect(readyAfterWorkflow1).not.toContain(errorHandlerId)

      const readyAfterWorkflow7 = edgeManager.processOutgoingEdges(workflow7Node, {
        result: 'success',
      })
      // Error handler should NOT be ready (no errors occurred)
      expect(readyAfterWorkflow7).not.toContain(errorHandlerId)
    })

    it('should mark target ready when both sources error', () => {
      // When both sources error, the error handler should run

      const workflow1Id = 'workflow-1'
      const workflow7Id = 'workflow-7'
      const errorHandlerId = 'error-handler'

      const workflow1Node = createMockNode(workflow1Id, [
        { target: errorHandlerId, sourceHandle: 'error' },
      ])

      const workflow7Node = createMockNode(workflow7Id, [
        { target: errorHandlerId, sourceHandle: 'error' },
      ])

      const errorHandlerNode = createMockNode(errorHandlerId, [], [workflow1Id, workflow7Id])

      const nodes = new Map<string, DAGNode>([
        [workflow1Id, workflow1Node],
        [workflow7Id, workflow7Node],
        [errorHandlerId, errorHandlerNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Workflow 1 errors
      const readyAfterWorkflow1 = edgeManager.processOutgoingEdges(workflow1Node, {
        error: 'Error 1',
      })
      expect(readyAfterWorkflow1).not.toContain(errorHandlerId)

      // Workflow 7 errors
      const readyAfterWorkflow7 = edgeManager.processOutgoingEdges(workflow7Node, {
        error: 'Error 2',
      })
      // Error handler SHOULD be ready (both edges activated)
      expect(readyAfterWorkflow7).toContain(errorHandlerId)
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

      const ready1 = edgeManager.processOutgoingEdges(condition1Node, { selectedOption: 'if' })
      expect(ready1).toContain(condition2Id)
      expect(ready1).not.toContain(target1Id)

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

      const readyNodes = edgeManager.processOutgoingEdges(loopBodyNode, {}, true)

      expect(readyNodes).not.toContain(loopStartId)
    })

    it('should include backwards edge when skipBackwardsEdge is false', () => {
      const loopStartId = 'loop-start'
      const loopBodyId = 'loop-body'

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

      const output = { selectedOption: 'nonexistent' }
      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, output)

      expect(readyNodes).not.toContain(target1Id)
      expect(readyNodes).not.toContain(target2Id)
      expect(readyNodes).toHaveLength(0)
    })
  })

  describe('Condition inside loop - loop control edges should not be cascade-deactivated', () => {
    it('should not cascade-deactivate loop_continue edge when condition selects else path', () => {
      // This test reproduces the bug where a condition inside a loop would cause
      // the loop to exit when the "else" branch was selected, because the cascade
      // deactivation would incorrectly deactivate the loop_continue edge.
      //
      // Workflow:
      //   sentinel_start → condition → (if) → nodeA → sentinel_end
      //                              → (else) → nodeB → sentinel_end
      //   sentinel_end → (loop_continue) → sentinel_start
      //                → (loop_exit) → after_loop

      const sentinelStartId = 'sentinel-start'
      const sentinelEndId = 'sentinel-end'
      const conditionId = 'condition'
      const nodeAId = 'node-a'
      const nodeBId = 'node-b'
      const afterLoopId = 'after-loop'

      const sentinelStartNode = createMockNode(sentinelStartId, [{ target: conditionId }])

      const conditionNode = createMockNode(
        conditionId,
        [
          { target: nodeAId, sourceHandle: 'condition-if' },
          { target: nodeBId, sourceHandle: 'condition-else' },
        ],
        [sentinelStartId]
      )

      const nodeANode = createMockNode(nodeAId, [{ target: sentinelEndId }], [conditionId])
      const nodeBNode = createMockNode(nodeBId, [{ target: sentinelEndId }], [conditionId])

      const sentinelEndNode = createMockNode(
        sentinelEndId,
        [
          { target: sentinelStartId, sourceHandle: 'loop_continue' },
          { target: afterLoopId, sourceHandle: 'loop_exit' },
        ],
        [nodeAId, nodeBId]
      )

      const afterLoopNode = createMockNode(afterLoopId, [], [sentinelEndId])

      const nodes = new Map<string, DAGNode>([
        [sentinelStartId, sentinelStartNode],
        [conditionId, conditionNode],
        [nodeAId, nodeANode],
        [nodeBId, nodeBNode],
        [sentinelEndId, sentinelEndNode],
        [afterLoopId, afterLoopNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      const readyAfterCondition = edgeManager.processOutgoingEdges(conditionNode, {
        selectedOption: 'else',
      })
      expect(readyAfterCondition).toContain(nodeBId)
      expect(readyAfterCondition).not.toContain(nodeAId)

      const readyAfterNodeB = edgeManager.processOutgoingEdges(nodeBNode, {})
      expect(readyAfterNodeB).toContain(sentinelEndId)

      const readyAfterSentinel = edgeManager.processOutgoingEdges(sentinelEndNode, {
        selectedRoute: 'loop_continue',
      })

      expect(readyAfterSentinel).toContain(sentinelStartId)
      expect(readyAfterSentinel).not.toContain(afterLoopId)
    })

    it('should not cascade-deactivate parallel_exit edge through condition deactivation', () => {
      const parallelStartId = 'parallel-start'
      const parallelEndId = 'parallel-end'
      const conditionId = 'condition'
      const nodeAId = 'node-a'
      const nodeBId = 'node-b'
      const afterParallelId = 'after-parallel'

      const parallelStartNode = createMockNode(parallelStartId, [{ target: conditionId }])

      const conditionNode = createMockNode(
        conditionId,
        [
          { target: nodeAId, sourceHandle: 'condition-if' },
          { target: nodeBId, sourceHandle: 'condition-else' },
        ],
        [parallelStartId]
      )

      const nodeANode = createMockNode(nodeAId, [{ target: parallelEndId }], [conditionId])
      const nodeBNode = createMockNode(nodeBId, [{ target: parallelEndId }], [conditionId])

      const parallelEndNode = createMockNode(
        parallelEndId,
        [{ target: afterParallelId, sourceHandle: 'parallel_exit' }],
        [nodeAId, nodeBId]
      )

      const afterParallelNode = createMockNode(afterParallelId, [], [parallelEndId])

      const nodes = new Map<string, DAGNode>([
        [parallelStartId, parallelStartNode],
        [conditionId, conditionNode],
        [nodeAId, nodeANode],
        [nodeBId, nodeBNode],
        [parallelEndId, parallelEndNode],
        [afterParallelId, afterParallelNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      edgeManager.processOutgoingEdges(conditionNode, { selectedOption: 'else' })

      const readyAfterNodeB = edgeManager.processOutgoingEdges(nodeBNode, {})
      expect(readyAfterNodeB).toContain(parallelEndId)

      const readyAfterParallelEnd = edgeManager.processOutgoingEdges(parallelEndNode, {
        selectedRoute: 'parallel_exit',
      })
      expect(readyAfterParallelEnd).toContain(afterParallelId)
    })

    it('should handle condition with null selectedOption inside loop (dead-end branch)', () => {
      // When a condition selects a branch with no outgoing connection (dead-end),
      // selectedOption is null - cascade deactivation should make sentinel_end ready

      const sentinelStartId = 'sentinel-start'
      const sentinelEndId = 'sentinel-end'
      const conditionId = 'condition'
      const nodeAId = 'node-a'
      const afterLoopId = 'after-loop'

      const sentinelStartNode = createMockNode(sentinelStartId, [{ target: conditionId }])
      const conditionNode = createMockNode(
        conditionId,
        [{ target: nodeAId, sourceHandle: 'condition-if' }],
        [sentinelStartId]
      )
      const nodeANode = createMockNode(nodeAId, [{ target: sentinelEndId }], [conditionId])
      const sentinelEndNode = createMockNode(
        sentinelEndId,
        [
          { target: sentinelStartId, sourceHandle: 'loop_continue' },
          { target: afterLoopId, sourceHandle: 'loop_exit' },
        ],
        [nodeAId]
      )
      const afterLoopNode = createMockNode(afterLoopId, [], [sentinelEndId])

      const nodes = new Map<string, DAGNode>([
        [sentinelStartId, sentinelStartNode],
        [conditionId, conditionNode],
        [nodeAId, nodeANode],
        [sentinelEndId, sentinelEndNode],
        [afterLoopId, afterLoopNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // When selectedOption is null, the cascade deactivation makes sentinel_end ready
      const readyAfterCondition = edgeManager.processOutgoingEdges(conditionNode, {
        selectedOption: null,
      })
      expect(readyAfterCondition).toContain(sentinelEndId)
    })

    it('should handle condition directly connecting to sentinel_end with dead-end selected', () => {
      // Bugbot scenario: condition → (if) → sentinel_end directly, dead-end selected
      // sentinel_end should become ready even without intermediate nodes

      const sentinelStartId = 'sentinel-start'
      const sentinelEndId = 'sentinel-end'
      const conditionId = 'condition'
      const afterLoopId = 'after-loop'

      const sentinelStartNode = createMockNode(sentinelStartId, [{ target: conditionId }])
      const conditionNode = createMockNode(
        conditionId,
        [{ target: sentinelEndId, sourceHandle: 'condition-if' }],
        [sentinelStartId]
      )
      const sentinelEndNode = createMockNode(
        sentinelEndId,
        [
          { target: sentinelStartId, sourceHandle: 'loop_continue' },
          { target: afterLoopId, sourceHandle: 'loop_exit' },
        ],
        [conditionId]
      )
      const afterLoopNode = createMockNode(afterLoopId, [], [sentinelEndId])

      const nodes = new Map<string, DAGNode>([
        [sentinelStartId, sentinelStartNode],
        [conditionId, conditionNode],
        [sentinelEndId, sentinelEndNode],
        [afterLoopId, afterLoopNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Dead-end: no edge matches, sentinel_end should still become ready
      const ready = edgeManager.processOutgoingEdges(conditionNode, {
        selectedOption: null,
      })
      expect(ready).toContain(sentinelEndId)
    })

    it('should handle multiple conditions in sequence inside loop', () => {
      const sentinelStartId = 'sentinel-start'
      const sentinelEndId = 'sentinel-end'
      const condition1Id = 'condition-1'
      const condition2Id = 'condition-2'
      const nodeAId = 'node-a'
      const nodeBId = 'node-b'
      const nodeCId = 'node-c'

      const sentinelStartNode = createMockNode(sentinelStartId, [{ target: condition1Id }])
      const condition1Node = createMockNode(
        condition1Id,
        [
          { target: condition2Id, sourceHandle: 'condition-if' },
          { target: nodeBId, sourceHandle: 'condition-else' },
        ],
        [sentinelStartId]
      )
      const condition2Node = createMockNode(
        condition2Id,
        [
          { target: nodeAId, sourceHandle: 'condition-if' },
          { target: nodeCId, sourceHandle: 'condition-else' },
        ],
        [condition1Id]
      )
      const nodeANode = createMockNode(nodeAId, [{ target: sentinelEndId }], [condition2Id])
      const nodeBNode = createMockNode(nodeBId, [{ target: sentinelEndId }], [condition1Id])
      const nodeCNode = createMockNode(nodeCId, [{ target: sentinelEndId }], [condition2Id])
      const sentinelEndNode = createMockNode(
        sentinelEndId,
        [{ target: sentinelStartId, sourceHandle: 'loop_continue' }],
        [nodeAId, nodeBId, nodeCId]
      )

      const nodes = new Map<string, DAGNode>([
        [sentinelStartId, sentinelStartNode],
        [condition1Id, condition1Node],
        [condition2Id, condition2Node],
        [nodeAId, nodeANode],
        [nodeBId, nodeBNode],
        [nodeCId, nodeCNode],
        [sentinelEndId, sentinelEndNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Path: condition1(if) → condition2(else) → nodeC → sentinel_end
      const ready1 = edgeManager.processOutgoingEdges(condition1Node, { selectedOption: 'if' })
      expect(ready1).toContain(condition2Id)

      const ready2 = edgeManager.processOutgoingEdges(condition2Node, { selectedOption: 'else' })
      expect(ready2).toContain(nodeCId)

      const ready3 = edgeManager.processOutgoingEdges(nodeCNode, {})
      expect(ready3).toContain(sentinelEndId)

      const ready4 = edgeManager.processOutgoingEdges(sentinelEndNode, {
        selectedRoute: 'loop_continue',
      })
      expect(ready4).toContain(sentinelStartId)
    })

    it('should handle diamond pattern inside loop (condition splits then converges)', () => {
      const sentinelStartId = 'sentinel-start'
      const sentinelEndId = 'sentinel-end'
      const conditionId = 'condition'
      const nodeAId = 'node-a'
      const nodeBId = 'node-b'
      const mergeId = 'merge'

      const sentinelStartNode = createMockNode(sentinelStartId, [{ target: conditionId }])
      const conditionNode = createMockNode(
        conditionId,
        [
          { target: nodeAId, sourceHandle: 'condition-if' },
          { target: nodeBId, sourceHandle: 'condition-else' },
        ],
        [sentinelStartId]
      )
      const nodeANode = createMockNode(nodeAId, [{ target: mergeId }], [conditionId])
      const nodeBNode = createMockNode(nodeBId, [{ target: mergeId }], [conditionId])
      const mergeNode = createMockNode(mergeId, [{ target: sentinelEndId }], [nodeAId, nodeBId])
      const sentinelEndNode = createMockNode(
        sentinelEndId,
        [{ target: sentinelStartId, sourceHandle: 'loop_continue' }],
        [mergeId]
      )

      const nodes = new Map<string, DAGNode>([
        [sentinelStartId, sentinelStartNode],
        [conditionId, conditionNode],
        [nodeAId, nodeANode],
        [nodeBId, nodeBNode],
        [mergeId, mergeNode],
        [sentinelEndId, sentinelEndNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Test else path through diamond
      const ready1 = edgeManager.processOutgoingEdges(conditionNode, { selectedOption: 'else' })
      expect(ready1).toContain(nodeBId)
      expect(ready1).not.toContain(nodeAId)

      const ready2 = edgeManager.processOutgoingEdges(nodeBNode, {})
      expect(ready2).toContain(mergeId)

      const ready3 = edgeManager.processOutgoingEdges(mergeNode, {})
      expect(ready3).toContain(sentinelEndId)

      const ready4 = edgeManager.processOutgoingEdges(sentinelEndNode, {
        selectedRoute: 'loop_continue',
      })
      expect(ready4).toContain(sentinelStartId)
    })

    it('should handle deep cascade that reaches sentinel_end through multiple hops', () => {
      const sentinelStartId = 'sentinel-start'
      const sentinelEndId = 'sentinel-end'
      const conditionId = 'condition'
      const nodeAId = 'node-a'
      const nodeBId = 'node-b'
      const nodeCId = 'node-c'
      const nodeDId = 'node-d'

      const sentinelStartNode = createMockNode(sentinelStartId, [{ target: conditionId }])
      const conditionNode = createMockNode(
        conditionId,
        [
          { target: nodeAId, sourceHandle: 'condition-if' },
          { target: nodeDId, sourceHandle: 'condition-else' },
        ],
        [sentinelStartId]
      )
      const nodeANode = createMockNode(nodeAId, [{ target: nodeBId }], [conditionId])
      const nodeBNode = createMockNode(nodeBId, [{ target: nodeCId }], [nodeAId])
      const nodeCNode = createMockNode(nodeCId, [{ target: sentinelEndId }], [nodeBId])
      const nodeDNode = createMockNode(nodeDId, [{ target: sentinelEndId }], [conditionId])
      const sentinelEndNode = createMockNode(
        sentinelEndId,
        [
          { target: sentinelStartId, sourceHandle: 'loop_continue' },
          { target: 'after-loop', sourceHandle: 'loop_exit' },
        ],
        [nodeCId, nodeDId]
      )

      const nodes = new Map<string, DAGNode>([
        [sentinelStartId, sentinelStartNode],
        [conditionId, conditionNode],
        [nodeAId, nodeANode],
        [nodeBId, nodeBNode],
        [nodeCId, nodeCNode],
        [nodeDId, nodeDNode],
        [sentinelEndId, sentinelEndNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Select else - triggers deep cascade deactivation of if path
      const ready1 = edgeManager.processOutgoingEdges(conditionNode, { selectedOption: 'else' })
      expect(ready1).toContain(nodeDId)

      const ready2 = edgeManager.processOutgoingEdges(nodeDNode, {})
      expect(ready2).toContain(sentinelEndId)

      // loop_continue should still work despite deep cascade
      const ready3 = edgeManager.processOutgoingEdges(sentinelEndNode, {
        selectedRoute: 'loop_continue',
      })
      expect(ready3).toContain(sentinelStartId)
    })

    it('should handle condition with 3+ branches inside loop', () => {
      const sentinelStartId = 'sentinel-start'
      const sentinelEndId = 'sentinel-end'
      const conditionId = 'condition'
      const nodeAId = 'node-a'
      const nodeBId = 'node-b'
      const nodeCId = 'node-c'
      const nodeDId = 'node-d'

      const sentinelStartNode = createMockNode(sentinelStartId, [{ target: conditionId }])
      const conditionNode = createMockNode(
        conditionId,
        [
          { target: nodeAId, sourceHandle: 'condition-if' },
          { target: nodeBId, sourceHandle: 'condition-elseif1' },
          { target: nodeCId, sourceHandle: 'condition-elseif2' },
          { target: nodeDId, sourceHandle: 'condition-else' },
        ],
        [sentinelStartId]
      )
      const nodeANode = createMockNode(nodeAId, [{ target: sentinelEndId }], [conditionId])
      const nodeBNode = createMockNode(nodeBId, [{ target: sentinelEndId }], [conditionId])
      const nodeCNode = createMockNode(nodeCId, [{ target: sentinelEndId }], [conditionId])
      const nodeDNode = createMockNode(nodeDId, [{ target: sentinelEndId }], [conditionId])
      const sentinelEndNode = createMockNode(
        sentinelEndId,
        [{ target: sentinelStartId, sourceHandle: 'loop_continue' }],
        [nodeAId, nodeBId, nodeCId, nodeDId]
      )

      const nodes = new Map<string, DAGNode>([
        [sentinelStartId, sentinelStartNode],
        [conditionId, conditionNode],
        [nodeAId, nodeANode],
        [nodeBId, nodeBNode],
        [nodeCId, nodeCNode],
        [nodeDId, nodeDNode],
        [sentinelEndId, sentinelEndNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Test middle branch (elseif2)
      const ready1 = edgeManager.processOutgoingEdges(conditionNode, { selectedOption: 'elseif2' })
      expect(ready1).toContain(nodeCId)
      expect(ready1).not.toContain(nodeAId)
      expect(ready1).not.toContain(nodeBId)
      expect(ready1).not.toContain(nodeDId)

      const ready2 = edgeManager.processOutgoingEdges(nodeCNode, {})
      expect(ready2).toContain(sentinelEndId)

      const ready3 = edgeManager.processOutgoingEdges(sentinelEndNode, {
        selectedRoute: 'loop_continue',
      })
      expect(ready3).toContain(sentinelStartId)
    })

    it('should handle loop_continue_alt edge (alternative continue handle)', () => {
      const sentinelStartId = 'sentinel-start'
      const sentinelEndId = 'sentinel-end'
      const conditionId = 'condition'
      const nodeAId = 'node-a'
      const nodeBId = 'node-b'

      const sentinelStartNode = createMockNode(sentinelStartId, [{ target: conditionId }])
      const conditionNode = createMockNode(
        conditionId,
        [
          { target: nodeAId, sourceHandle: 'condition-if' },
          { target: nodeBId, sourceHandle: 'condition-else' },
        ],
        [sentinelStartId]
      )
      const nodeANode = createMockNode(nodeAId, [{ target: sentinelEndId }], [conditionId])
      const nodeBNode = createMockNode(nodeBId, [{ target: sentinelEndId }], [conditionId])
      const sentinelEndNode = createMockNode(
        sentinelEndId,
        [{ target: sentinelStartId, sourceHandle: 'loop-continue-source' }],
        [nodeAId, nodeBId]
      )

      const nodes = new Map<string, DAGNode>([
        [sentinelStartId, sentinelStartNode],
        [conditionId, conditionNode],
        [nodeAId, nodeANode],
        [nodeBId, nodeBNode],
        [sentinelEndId, sentinelEndNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      edgeManager.processOutgoingEdges(conditionNode, { selectedOption: 'else' })
      edgeManager.processOutgoingEdges(nodeBNode, {})

      const ready = edgeManager.processOutgoingEdges(sentinelEndNode, {
        selectedRoute: 'loop_continue',
      })
      expect(ready).toContain(sentinelStartId)
    })

    it('should handle condition with dead-end branch (no outgoing edge) inside loop', () => {
      // Scenario: Loop with Function 1 → Condition 1 → Function 2
      // Condition has "if" branch → Function 2
      // Condition has "else" branch → NO connection (dead end)
      // When else is selected (selectedOption: null), the loop should continue
      //
      // DAG structure:
      //   sentinel_start → func1 → condition → (if) → func2 → sentinel_end
      //                                      → (else) → [nothing]
      //   sentinel_end → (loop_continue) → sentinel_start
      //
      // When condition takes else with no edge:
      // - selectedOption: null (no condition matches)
      // - The "if" edge gets deactivated
      // - func2 has no other active incoming edges, so edge to sentinel_end gets deactivated
      // - sentinel_end has no active incoming edges and should become ready

      const sentinelStartId = 'sentinel-start'
      const sentinelEndId = 'sentinel-end'
      const func1Id = 'func1'
      const conditionId = 'condition'
      const func2Id = 'func2'

      const sentinelStartNode = createMockNode(sentinelStartId, [{ target: func1Id }])
      const func1Node = createMockNode(func1Id, [{ target: conditionId }], [sentinelStartId])
      // Condition only has "if" branch, no "else" edge (dead end)
      const conditionNode = createMockNode(
        conditionId,
        [{ target: func2Id, sourceHandle: 'condition-if' }],
        [func1Id]
      )
      const func2Node = createMockNode(func2Id, [{ target: sentinelEndId }], [conditionId])
      const sentinelEndNode = createMockNode(
        sentinelEndId,
        [
          { target: sentinelStartId, sourceHandle: 'loop_continue' },
          { target: 'after-loop', sourceHandle: 'loop_exit' },
        ],
        [func2Id]
      )
      const afterLoopNode = createMockNode('after-loop', [], [sentinelEndId])

      const nodes = new Map<string, DAGNode>([
        [sentinelStartId, sentinelStartNode],
        [func1Id, func1Node],
        [conditionId, conditionNode],
        [func2Id, func2Node],
        [sentinelEndId, sentinelEndNode],
        ['after-loop', afterLoopNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Simulate execution: sentinel_start → func1 → condition
      // Clear incoming edges as execution progresses (simulating normal flow)
      func1Node.incomingEdges.clear()
      conditionNode.incomingEdges.clear()

      // Condition takes "else" but there's no else edge
      // selectedOption: null means no condition branch matches
      const ready = edgeManager.processOutgoingEdges(conditionNode, {
        selectedOption: null,
        conditionResult: false,
        selectedPath: null,
      })

      // The "if" edge to func2 should be deactivated
      // func2 has no other incoming edges, so its edge to sentinel_end gets deactivated
      // sentinel_end has no active incoming edges and should be ready
      expect(ready).toContain(sentinelEndId)
    })

    it('should handle condition with dead-end else branch where another path exists to sentinel_end', () => {
      // Scenario: Loop with two paths to sentinel_end
      // Path 1: condition → (if) → func2 → sentinel_end
      // Path 2: condition → (else) → [nothing]
      // But there's also: func3 → sentinel_end (from different source)
      //
      // When condition takes else:
      // - func2's path gets deactivated
      // - sentinel_end still has active incoming from func3
      // - sentinel_end should NOT become ready

      const sentinelStartId = 'sentinel-start'
      const sentinelEndId = 'sentinel-end'
      const conditionId = 'condition'
      const func2Id = 'func2'
      const func3Id = 'func3'

      const sentinelStartNode = createMockNode(sentinelStartId, [
        { target: conditionId },
        { target: func3Id },
      ])
      const conditionNode = createMockNode(
        conditionId,
        [{ target: func2Id, sourceHandle: 'condition-if' }],
        [sentinelStartId]
      )
      const func2Node = createMockNode(func2Id, [{ target: sentinelEndId }], [conditionId])
      const func3Node = createMockNode(func3Id, [{ target: sentinelEndId }], [sentinelStartId])
      const sentinelEndNode = createMockNode(
        sentinelEndId,
        [{ target: sentinelStartId, sourceHandle: 'loop_continue' }],
        [func2Id, func3Id]
      )

      const nodes = new Map<string, DAGNode>([
        [sentinelStartId, sentinelStartNode],
        [conditionId, conditionNode],
        [func2Id, func2Node],
        [func3Id, func3Node],
        [sentinelEndId, sentinelEndNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Simulate execution: sentinel_start fires, condition incoming cleared
      conditionNode.incomingEdges.clear()
      func3Node.incomingEdges.clear()

      // Condition takes else (dead end)
      const ready = edgeManager.processOutgoingEdges(conditionNode, {
        selectedOption: null,
      })

      // sentinel_end should NOT be ready because func3 hasn't completed yet
      expect(ready).not.toContain(sentinelEndId)
      // func2 should not be ready either (its edge was deactivated, not activated)
      expect(ready).not.toContain(func2Id)
    })

    it('should handle nested conditions with dead-end branches inside loop', () => {
      // Scenario: condition1 → (if) → condition2 → (if) → func → sentinel_end
      //                      → (else) → [nothing]
      //                                            → (else) → [nothing]
      //
      // When condition1 takes if, then condition2 takes else:
      // - condition2's "if" edge to func gets deactivated
      // - func's edge to sentinel_end gets deactivated
      // - sentinel_end should become ready

      const sentinelStartId = 'sentinel-start'
      const sentinelEndId = 'sentinel-end'
      const condition1Id = 'condition1'
      const condition2Id = 'condition2'
      const funcId = 'func'

      const sentinelStartNode = createMockNode(sentinelStartId, [{ target: condition1Id }])
      const condition1Node = createMockNode(
        condition1Id,
        [{ target: condition2Id, sourceHandle: 'condition-if' }],
        [sentinelStartId]
      )
      const condition2Node = createMockNode(
        condition2Id,
        [{ target: funcId, sourceHandle: 'condition-if' }],
        [condition1Id]
      )
      const funcNode = createMockNode(funcId, [{ target: sentinelEndId }], [condition2Id])
      const sentinelEndNode = createMockNode(
        sentinelEndId,
        [{ target: sentinelStartId, sourceHandle: 'loop_continue' }],
        [funcId]
      )

      const nodes = new Map<string, DAGNode>([
        [sentinelStartId, sentinelStartNode],
        [condition1Id, condition1Node],
        [condition2Id, condition2Node],
        [funcId, funcNode],
        [sentinelEndId, sentinelEndNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Clear incoming edges as execution progresses
      condition1Node.incomingEdges.clear()

      // condition1 takes "if" - condition2 becomes ready
      const ready1 = edgeManager.processOutgoingEdges(condition1Node, { selectedOption: 'if' })
      expect(ready1).toContain(condition2Id)

      condition2Node.incomingEdges.clear()

      // condition2 takes "else" (dead end)
      const ready2 = edgeManager.processOutgoingEdges(condition2Node, { selectedOption: null })

      // sentinel_end should be ready because all paths to it are deactivated
      expect(ready2).toContain(sentinelEndId)
    })

    it('should NOT execute intermediate nodes in long cascade chains (2+ hops)', () => {
      // Regression test: When condition hits dead-end with 2+ intermediate nodes,
      // only sentinel_end should be ready, NOT the intermediate nodes.
      //
      // Structure: sentinel_start → condition → funcA → funcB → sentinel_end
      // When condition hits dead-end, funcA and funcB should NOT execute.

      const sentinelStartId = 'sentinel-start'
      const sentinelEndId = 'sentinel-end'
      const conditionId = 'condition'
      const funcAId = 'funcA'
      const funcBId = 'funcB'

      const sentinelStartNode = createMockNode(sentinelStartId, [{ target: conditionId }])
      const conditionNode = createMockNode(
        conditionId,
        [{ target: funcAId, sourceHandle: 'condition-if' }],
        [sentinelStartId]
      )
      const funcANode = createMockNode(funcAId, [{ target: funcBId }], [conditionId])
      const funcBNode = createMockNode(funcBId, [{ target: sentinelEndId }], [funcAId])
      const sentinelEndNode = createMockNode(
        sentinelEndId,
        [
          { target: sentinelStartId, sourceHandle: 'loop_continue' },
          { target: 'after-loop', sourceHandle: 'loop_exit' },
        ],
        [funcBId]
      )
      const afterLoopNode = createMockNode('after-loop', [], [sentinelEndId])

      const nodes = new Map<string, DAGNode>([
        [sentinelStartId, sentinelStartNode],
        [conditionId, conditionNode],
        [funcAId, funcANode],
        [funcBId, funcBNode],
        [sentinelEndId, sentinelEndNode],
        ['after-loop', afterLoopNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Simulate execution up to condition
      conditionNode.incomingEdges.clear()

      // Condition hits dead-end (else branch with no edge)
      const ready = edgeManager.processOutgoingEdges(conditionNode, {
        selectedOption: null,
      })

      // Only sentinel_end should be ready
      expect(ready).toContain(sentinelEndId)

      // Intermediate nodes should NOT be in readyNodes
      expect(ready).not.toContain(funcAId)
      expect(ready).not.toContain(funcBId)
    })
  })

  describe('Condition inside parallel - parallel control edges should not be cascade-deactivated', () => {
    it('should handle condition inside single parallel branch', () => {
      // parallel_start → condition → (if) → nodeA → parallel_end
      //                            → (else) → nodeB → parallel_end

      const parallelStartId = 'parallel-start'
      const parallelEndId = 'parallel-end'
      const conditionId = 'condition'
      const nodeAId = 'node-a'
      const nodeBId = 'node-b'
      const afterParallelId = 'after-parallel'

      const parallelStartNode = createMockNode(parallelStartId, [{ target: conditionId }])
      const conditionNode = createMockNode(
        conditionId,
        [
          { target: nodeAId, sourceHandle: 'condition-if' },
          { target: nodeBId, sourceHandle: 'condition-else' },
        ],
        [parallelStartId]
      )
      const nodeANode = createMockNode(nodeAId, [{ target: parallelEndId }], [conditionId])
      const nodeBNode = createMockNode(nodeBId, [{ target: parallelEndId }], [conditionId])
      const parallelEndNode = createMockNode(
        parallelEndId,
        [{ target: afterParallelId, sourceHandle: 'parallel_exit' }],
        [nodeAId, nodeBId]
      )
      const afterParallelNode = createMockNode(afterParallelId, [], [parallelEndId])

      const nodes = new Map<string, DAGNode>([
        [parallelStartId, parallelStartNode],
        [conditionId, conditionNode],
        [nodeAId, nodeANode],
        [nodeBId, nodeBNode],
        [parallelEndId, parallelEndNode],
        [afterParallelId, afterParallelNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Select else path
      const ready1 = edgeManager.processOutgoingEdges(conditionNode, { selectedOption: 'else' })
      expect(ready1).toContain(nodeBId)
      expect(ready1).not.toContain(nodeAId)

      const ready2 = edgeManager.processOutgoingEdges(nodeBNode, {})
      expect(ready2).toContain(parallelEndId)

      const ready3 = edgeManager.processOutgoingEdges(parallelEndNode, {
        selectedRoute: 'parallel_exit',
      })
      expect(ready3).toContain(afterParallelId)
    })

    it('should handle condition with null selectedOption inside parallel', () => {
      // When a condition selects a branch with no outgoing connection (dead-end),
      // selectedOption is null - cascade deactivation should make parallel_end ready

      const parallelStartId = 'parallel-start'
      const parallelEndId = 'parallel-end'
      const conditionId = 'condition'
      const nodeAId = 'node-a'

      const parallelStartNode = createMockNode(parallelStartId, [{ target: conditionId }])
      const conditionNode = createMockNode(
        conditionId,
        [{ target: nodeAId, sourceHandle: 'condition-if' }],
        [parallelStartId]
      )
      const nodeANode = createMockNode(nodeAId, [{ target: parallelEndId }], [conditionId])
      const parallelEndNode = createMockNode(
        parallelEndId,
        [{ target: 'after', sourceHandle: 'parallel_exit' }],
        [nodeAId]
      )

      const nodes = new Map<string, DAGNode>([
        [parallelStartId, parallelStartNode],
        [conditionId, conditionNode],
        [nodeAId, nodeANode],
        [parallelEndId, parallelEndNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // When selectedOption is null, the cascade deactivation makes parallel_end ready
      const ready = edgeManager.processOutgoingEdges(conditionNode, { selectedOption: null })
      expect(ready).toContain(parallelEndId)
    })

    it('should handle multiple conditions in parallel branches', () => {
      // parallel_start → branch1 → condition1 → nodeA → parallel_end
      //                → branch2 → condition2 → nodeB → parallel_end

      const parallelStartId = 'parallel-start'
      const parallelEndId = 'parallel-end'
      const branch1Id = 'branch-1'
      const branch2Id = 'branch-2'
      const condition1Id = 'condition-1'
      const condition2Id = 'condition-2'
      const nodeAId = 'node-a'
      const nodeBId = 'node-b'
      const nodeCId = 'node-c'
      const nodeDId = 'node-d'

      const parallelStartNode = createMockNode(parallelStartId, [
        { target: branch1Id },
        { target: branch2Id },
      ])
      const branch1Node = createMockNode(branch1Id, [{ target: condition1Id }], [parallelStartId])
      const branch2Node = createMockNode(branch2Id, [{ target: condition2Id }], [parallelStartId])
      const condition1Node = createMockNode(
        condition1Id,
        [
          { target: nodeAId, sourceHandle: 'condition-if' },
          { target: nodeBId, sourceHandle: 'condition-else' },
        ],
        [branch1Id]
      )
      const condition2Node = createMockNode(
        condition2Id,
        [
          { target: nodeCId, sourceHandle: 'condition-if' },
          { target: nodeDId, sourceHandle: 'condition-else' },
        ],
        [branch2Id]
      )
      const nodeANode = createMockNode(nodeAId, [{ target: parallelEndId }], [condition1Id])
      const nodeBNode = createMockNode(nodeBId, [{ target: parallelEndId }], [condition1Id])
      const nodeCNode = createMockNode(nodeCId, [{ target: parallelEndId }], [condition2Id])
      const nodeDNode = createMockNode(nodeDId, [{ target: parallelEndId }], [condition2Id])
      const afterId = 'after'
      const parallelEndNode = createMockNode(
        parallelEndId,
        [{ target: afterId, sourceHandle: 'parallel_exit' }],
        [nodeAId, nodeBId, nodeCId, nodeDId]
      )
      const afterNode = createMockNode(afterId, [], [parallelEndId])

      const nodes = new Map<string, DAGNode>([
        [parallelStartId, parallelStartNode],
        [branch1Id, branch1Node],
        [branch2Id, branch2Node],
        [condition1Id, condition1Node],
        [condition2Id, condition2Node],
        [nodeAId, nodeANode],
        [nodeBId, nodeBNode],
        [nodeCId, nodeCNode],
        [nodeDId, nodeDNode],
        [parallelEndId, parallelEndNode],
        [afterId, afterNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Branch 1: condition1 selects else
      const ready1 = edgeManager.processOutgoingEdges(condition1Node, { selectedOption: 'else' })
      expect(ready1).toContain(nodeBId)

      // Branch 2: condition2 selects if
      const ready2 = edgeManager.processOutgoingEdges(condition2Node, { selectedOption: 'if' })
      expect(ready2).toContain(nodeCId)

      // Both complete
      edgeManager.processOutgoingEdges(nodeBNode, {})
      edgeManager.processOutgoingEdges(nodeCNode, {})

      // parallel_exit should work
      const ready3 = edgeManager.processOutgoingEdges(parallelEndNode, {
        selectedRoute: 'parallel_exit',
      })
      expect(ready3).toContain('after')
    })

    it('should handle diamond pattern inside parallel', () => {
      const parallelStartId = 'parallel-start'
      const parallelEndId = 'parallel-end'
      const conditionId = 'condition'
      const nodeAId = 'node-a'
      const nodeBId = 'node-b'
      const mergeId = 'merge'

      const parallelStartNode = createMockNode(parallelStartId, [{ target: conditionId }])
      const conditionNode = createMockNode(
        conditionId,
        [
          { target: nodeAId, sourceHandle: 'condition-if' },
          { target: nodeBId, sourceHandle: 'condition-else' },
        ],
        [parallelStartId]
      )
      const nodeANode = createMockNode(nodeAId, [{ target: mergeId }], [conditionId])
      const nodeBNode = createMockNode(nodeBId, [{ target: mergeId }], [conditionId])
      const afterId = 'after'
      const mergeNode = createMockNode(mergeId, [{ target: parallelEndId }], [nodeAId, nodeBId])
      const parallelEndNode = createMockNode(
        parallelEndId,
        [{ target: afterId, sourceHandle: 'parallel_exit' }],
        [mergeId]
      )
      const afterNode = createMockNode(afterId, [], [parallelEndId])

      const nodes = new Map<string, DAGNode>([
        [parallelStartId, parallelStartNode],
        [conditionId, conditionNode],
        [nodeAId, nodeANode],
        [nodeBId, nodeBNode],
        [mergeId, mergeNode],
        [parallelEndId, parallelEndNode],
        [afterId, afterNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      edgeManager.processOutgoingEdges(conditionNode, { selectedOption: 'else' })
      edgeManager.processOutgoingEdges(nodeBNode, {})
      edgeManager.processOutgoingEdges(mergeNode, {})

      const ready = edgeManager.processOutgoingEdges(parallelEndNode, {
        selectedRoute: 'parallel_exit',
      })
      expect(ready).toContain(afterId)
    })

    it('should handle deep cascade inside parallel', () => {
      const parallelStartId = 'parallel-start'
      const parallelEndId = 'parallel-end'
      const conditionId = 'condition'
      const nodeAId = 'node-a'
      const nodeBId = 'node-b'
      const nodeCId = 'node-c'
      const nodeDId = 'node-d'
      const afterId = 'after'

      const parallelStartNode = createMockNode(parallelStartId, [{ target: conditionId }])
      const conditionNode = createMockNode(
        conditionId,
        [
          { target: nodeAId, sourceHandle: 'condition-if' },
          { target: nodeDId, sourceHandle: 'condition-else' },
        ],
        [parallelStartId]
      )
      const nodeANode = createMockNode(nodeAId, [{ target: nodeBId }], [conditionId])
      const nodeBNode = createMockNode(nodeBId, [{ target: nodeCId }], [nodeAId])
      const nodeCNode = createMockNode(nodeCId, [{ target: parallelEndId }], [nodeBId])
      const nodeDNode = createMockNode(nodeDId, [{ target: parallelEndId }], [conditionId])
      const parallelEndNode = createMockNode(
        parallelEndId,
        [{ target: afterId, sourceHandle: 'parallel_exit' }],
        [nodeCId, nodeDId]
      )
      const afterNode = createMockNode(afterId, [], [parallelEndId])

      const nodes = new Map<string, DAGNode>([
        [parallelStartId, parallelStartNode],
        [conditionId, conditionNode],
        [nodeAId, nodeANode],
        [nodeBId, nodeBNode],
        [nodeCId, nodeCNode],
        [nodeDId, nodeDNode],
        [parallelEndId, parallelEndNode],
        [afterId, afterNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      edgeManager.processOutgoingEdges(conditionNode, { selectedOption: 'else' })
      edgeManager.processOutgoingEdges(nodeDNode, {})

      const ready = edgeManager.processOutgoingEdges(parallelEndNode, {
        selectedRoute: 'parallel_exit',
      })
      expect(ready).toContain(afterId)
    })

    it('should handle error edge inside parallel', () => {
      const parallelStartId = 'parallel-start'
      const parallelEndId = 'parallel-end'
      const nodeAId = 'node-a'
      const successNodeId = 'success-node'
      const errorNodeId = 'error-node'
      const afterId = 'after'

      const parallelStartNode = createMockNode(parallelStartId, [{ target: nodeAId }])
      const nodeANode = createMockNode(
        nodeAId,
        [
          { target: successNodeId, sourceHandle: 'source' },
          { target: errorNodeId, sourceHandle: 'error' },
        ],
        [parallelStartId]
      )
      const successNode = createMockNode(successNodeId, [{ target: parallelEndId }], [nodeAId])
      const errorNode = createMockNode(errorNodeId, [{ target: parallelEndId }], [nodeAId])
      const parallelEndNode = createMockNode(
        parallelEndId,
        [{ target: afterId, sourceHandle: 'parallel_exit' }],
        [successNodeId, errorNodeId]
      )
      const afterNode = createMockNode(afterId, [], [parallelEndId])

      const nodes = new Map<string, DAGNode>([
        [parallelStartId, parallelStartNode],
        [nodeAId, nodeANode],
        [successNodeId, successNode],
        [errorNodeId, errorNode],
        [parallelEndId, parallelEndNode],
        [afterId, afterNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // nodeA errors
      const ready1 = edgeManager.processOutgoingEdges(nodeANode, { error: 'Something failed' })
      expect(ready1).toContain(errorNodeId)
      expect(ready1).not.toContain(successNodeId)

      const ready2 = edgeManager.processOutgoingEdges(errorNode, {})
      expect(ready2).toContain(parallelEndId)

      const ready3 = edgeManager.processOutgoingEdges(parallelEndNode, {
        selectedRoute: 'parallel_exit',
      })
      expect(ready3).toContain(afterId)
    })
  })

  describe('Loop inside parallel with conditions', () => {
    it('should handle loop with condition inside parallel branch', () => {
      const parallelStartId = 'parallel-start'
      const parallelEndId = 'parallel-end'
      const loopStartId = 'loop-start'
      const loopEndId = 'loop-end'
      const conditionId = 'condition'
      const nodeAId = 'node-a'
      const nodeBId = 'node-b'
      const afterId = 'after'

      const parallelStartNode = createMockNode(parallelStartId, [{ target: loopStartId }])
      // In a real loop, after the first iteration, loopStartNode's incomingEdges would be cleared
      // For this test, we start with no incoming edges to simulate mid-loop state
      const loopStartNode = createMockNode(loopStartId, [{ target: conditionId }], [])
      const conditionNode = createMockNode(
        conditionId,
        [
          { target: nodeAId, sourceHandle: 'condition-if' },
          { target: nodeBId, sourceHandle: 'condition-else' },
        ],
        [loopStartId]
      )
      const nodeANode = createMockNode(nodeAId, [{ target: loopEndId }], [conditionId])
      const nodeBNode = createMockNode(nodeBId, [{ target: loopEndId }], [conditionId])
      const loopEndNode = createMockNode(
        loopEndId,
        [
          { target: loopStartId, sourceHandle: 'loop_continue' },
          { target: parallelEndId, sourceHandle: 'loop_exit' },
        ],
        [nodeAId, nodeBId]
      )
      const parallelEndNode = createMockNode(
        parallelEndId,
        [{ target: afterId, sourceHandle: 'parallel_exit' }],
        [loopEndId]
      )
      const afterNode = createMockNode(afterId, [], [parallelEndId])

      const nodes = new Map<string, DAGNode>([
        [parallelStartId, parallelStartNode],
        [loopStartId, loopStartNode],
        [conditionId, conditionNode],
        [nodeAId, nodeANode],
        [nodeBId, nodeBNode],
        [loopEndId, loopEndNode],
        [parallelEndId, parallelEndNode],
        [afterId, afterNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Condition selects else
      edgeManager.processOutgoingEdges(conditionNode, { selectedOption: 'else' })
      edgeManager.processOutgoingEdges(nodeBNode, {})

      // loop_continue should work - loopStartNode should be ready (no other incoming edges)
      const ready1 = edgeManager.processOutgoingEdges(loopEndNode, {
        selectedRoute: 'loop_continue',
      })
      expect(ready1).toContain(loopStartId)

      // Reset and test loop_exit → parallel_exit
      loopEndNode.incomingEdges = new Set([nodeAId, nodeBId])
      parallelEndNode.incomingEdges = new Set([loopEndId])
      conditionNode.incomingEdges = new Set([loopStartId])
      nodeANode.incomingEdges = new Set([conditionId])
      nodeBNode.incomingEdges = new Set([conditionId])
      edgeManager.clearDeactivatedEdges()

      edgeManager.processOutgoingEdges(conditionNode, { selectedOption: 'if' })
      edgeManager.processOutgoingEdges(nodeANode, {})

      const ready2 = edgeManager.processOutgoingEdges(loopEndNode, { selectedRoute: 'loop_exit' })
      expect(ready2).toContain(parallelEndId)

      const ready3 = edgeManager.processOutgoingEdges(parallelEndNode, {
        selectedRoute: 'parallel_exit',
      })
      expect(ready3).toContain(afterId)
    })
  })

  describe('Parallel inside loop with conditions', () => {
    it('should handle parallel with condition inside loop', () => {
      const loopStartId = 'loop-start'
      const loopEndId = 'loop-end'
      const parallelStartId = 'parallel-start'
      const parallelEndId = 'parallel-end'
      const conditionId = 'condition'
      const nodeAId = 'node-a'
      const nodeBId = 'node-b'

      const loopStartNode = createMockNode(loopStartId, [{ target: parallelStartId }])
      const parallelStartNode = createMockNode(
        parallelStartId,
        [{ target: conditionId }],
        [loopStartId]
      )
      const conditionNode = createMockNode(
        conditionId,
        [
          { target: nodeAId, sourceHandle: 'condition-if' },
          { target: nodeBId, sourceHandle: 'condition-else' },
        ],
        [parallelStartId]
      )
      const nodeANode = createMockNode(nodeAId, [{ target: parallelEndId }], [conditionId])
      const nodeBNode = createMockNode(nodeBId, [{ target: parallelEndId }], [conditionId])
      const parallelEndNode = createMockNode(
        parallelEndId,
        [{ target: loopEndId, sourceHandle: 'parallel_exit' }],
        [nodeAId, nodeBId]
      )
      const loopEndNode = createMockNode(
        loopEndId,
        [
          { target: loopStartId, sourceHandle: 'loop_continue' },
          { target: 'after', sourceHandle: 'loop_exit' },
        ],
        [parallelEndId]
      )

      const nodes = new Map<string, DAGNode>([
        [loopStartId, loopStartNode],
        [parallelStartId, parallelStartNode],
        [conditionId, conditionNode],
        [nodeAId, nodeANode],
        [nodeBId, nodeBNode],
        [parallelEndId, parallelEndNode],
        [loopEndId, loopEndNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Condition selects else
      edgeManager.processOutgoingEdges(conditionNode, { selectedOption: 'else' })
      edgeManager.processOutgoingEdges(nodeBNode, {})

      // parallel_exit should work
      const ready1 = edgeManager.processOutgoingEdges(parallelEndNode, {
        selectedRoute: 'parallel_exit',
      })
      expect(ready1).toContain(loopEndId)

      // loop_continue should work
      const ready2 = edgeManager.processOutgoingEdges(loopEndNode, {
        selectedRoute: 'loop_continue',
      })
      expect(ready2).toContain(loopStartId)
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

      const successReady = edgeManager.processOutgoingEdges(sourceNode, { result: 'ok' })
      expect(successReady).toContain(targetId)
    })
  })

  describe('Condition with loop downstream - deactivation propagation', () => {
    it('should deactivate nodes after loop when condition branch containing loop is deactivated', () => {
      // Scenario: condition → (if) → sentinel_start → loopBody → sentinel_end → (loop_exit) → after_loop
      //                     → (else) → other_branch
      // When condition takes "else" path, the entire if-branch including nodes after the loop should be deactivated
      const conditionId = 'condition'
      const sentinelStartId = 'sentinel-start'
      const loopBodyId = 'loop-body'
      const sentinelEndId = 'sentinel-end'
      const afterLoopId = 'after-loop'
      const otherBranchId = 'other-branch'

      const conditionNode = createMockNode(conditionId, [
        { target: sentinelStartId, sourceHandle: 'condition-if' },
        { target: otherBranchId, sourceHandle: 'condition-else' },
      ])

      const sentinelStartNode = createMockNode(
        sentinelStartId,
        [{ target: loopBodyId }],
        [conditionId]
      )

      const loopBodyNode = createMockNode(
        loopBodyId,
        [{ target: sentinelEndId }],
        [sentinelStartId]
      )

      const sentinelEndNode = createMockNode(
        sentinelEndId,
        [
          { target: sentinelStartId, sourceHandle: 'loop_continue' },
          { target: afterLoopId, sourceHandle: 'loop_exit' },
        ],
        [loopBodyId]
      )

      const afterLoopNode = createMockNode(afterLoopId, [], [sentinelEndId])
      const otherBranchNode = createMockNode(otherBranchId, [], [conditionId])

      const nodes = new Map<string, DAGNode>([
        [conditionId, conditionNode],
        [sentinelStartId, sentinelStartNode],
        [loopBodyId, loopBodyNode],
        [sentinelEndId, sentinelEndNode],
        [afterLoopId, afterLoopNode],
        [otherBranchId, otherBranchNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Condition selects "else" branch, deactivating the "if" branch (which contains the loop)
      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, { selectedOption: 'else' })

      // Only otherBranch should be ready
      expect(readyNodes).toContain(otherBranchId)
      expect(readyNodes).not.toContain(sentinelStartId)

      // sentinel_end should NOT be ready - it's on a fully deactivated path
      expect(readyNodes).not.toContain(sentinelEndId)

      // afterLoop should NOT be ready - its incoming edge from sentinel_end should be deactivated
      expect(readyNodes).not.toContain(afterLoopId)

      // Verify that countActiveIncomingEdges returns 0 for afterLoop
      // (meaning the loop_exit edge was properly deactivated)
      // Note: isNodeReady returns true when all edges are deactivated (no pending deps),
      // but the node won't be in readyNodes since it wasn't reached via an active path
      expect(edgeManager.isNodeReady(afterLoopNode)).toBe(true) // All edges deactivated = no blocking deps
    })

    it('should deactivate nodes after parallel when condition branch containing parallel is deactivated', () => {
      // Similar scenario with parallel instead of loop
      const conditionId = 'condition'
      const parallelStartId = 'parallel-start'
      const parallelBodyId = 'parallel-body'
      const parallelEndId = 'parallel-end'
      const afterParallelId = 'after-parallel'
      const otherBranchId = 'other-branch'

      const conditionNode = createMockNode(conditionId, [
        { target: parallelStartId, sourceHandle: 'condition-if' },
        { target: otherBranchId, sourceHandle: 'condition-else' },
      ])

      const parallelStartNode = createMockNode(
        parallelStartId,
        [{ target: parallelBodyId }],
        [conditionId]
      )

      const parallelBodyNode = createMockNode(
        parallelBodyId,
        [{ target: parallelEndId }],
        [parallelStartId]
      )

      const parallelEndNode = createMockNode(
        parallelEndId,
        [{ target: afterParallelId, sourceHandle: 'parallel_exit' }],
        [parallelBodyId]
      )

      const afterParallelNode = createMockNode(afterParallelId, [], [parallelEndId])
      const otherBranchNode = createMockNode(otherBranchId, [], [conditionId])

      const nodes = new Map<string, DAGNode>([
        [conditionId, conditionNode],
        [parallelStartId, parallelStartNode],
        [parallelBodyId, parallelBodyNode],
        [parallelEndId, parallelEndNode],
        [afterParallelId, afterParallelNode],
        [otherBranchId, otherBranchNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Condition selects "else" branch
      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, { selectedOption: 'else' })

      expect(readyNodes).toContain(otherBranchId)
      expect(readyNodes).not.toContain(parallelStartId)
      expect(readyNodes).not.toContain(afterParallelId)
      // isNodeReady returns true when all edges are deactivated (no pending deps)
      expect(edgeManager.isNodeReady(afterParallelNode)).toBe(true)
    })

    it('should not queue loop sentinel-end when upstream condition deactivates entire loop branch', () => {
      // Regression test for: upstream condition → (if) → ... many blocks ... → sentinel_start → body → sentinel_end
      //                                        → (else) → exit_block
      // When condition takes "else", the deep cascade deactivation should NOT queue sentinel_end.
      // Previously, sentinel_end was flagged as a cascadeTarget (terminal control node) and
      // spuriously queued, causing it to attempt loop scope initialization and fail.

      const conditionId = 'condition'
      const intermediateId = 'intermediate'
      const sentinelStartId = 'sentinel-start'
      const loopBodyId = 'loop-body'
      const sentinelEndId = 'sentinel-end'
      const afterLoopId = 'after-loop'
      const exitBlockId = 'exit-block'

      const conditionNode = createMockNode(conditionId, [
        { target: intermediateId, sourceHandle: 'condition-if' },
        { target: exitBlockId, sourceHandle: 'condition-else' },
      ])

      const intermediateNode = createMockNode(
        intermediateId,
        [{ target: sentinelStartId }],
        [conditionId]
      )

      const sentinelStartNode = createMockNode(
        sentinelStartId,
        [{ target: loopBodyId }],
        [intermediateId]
      )

      const loopBodyNode = createMockNode(
        loopBodyId,
        [{ target: sentinelEndId }],
        [sentinelStartId]
      )

      const sentinelEndNode = createMockNode(
        sentinelEndId,
        [
          { target: sentinelStartId, sourceHandle: 'loop_continue' },
          { target: afterLoopId, sourceHandle: 'loop_exit' },
        ],
        [loopBodyId]
      )

      const afterLoopNode = createMockNode(afterLoopId, [], [sentinelEndId])
      const exitBlockNode = createMockNode(exitBlockId, [], [conditionId])

      const nodes = new Map<string, DAGNode>([
        [conditionId, conditionNode],
        [intermediateId, intermediateNode],
        [sentinelStartId, sentinelStartNode],
        [loopBodyId, loopBodyNode],
        [sentinelEndId, sentinelEndNode],
        [afterLoopId, afterLoopNode],
        [exitBlockId, exitBlockNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      const readyNodes = edgeManager.processOutgoingEdges(conditionNode, {
        selectedOption: 'else',
      })

      // Only exitBlock should be ready
      expect(readyNodes).toContain(exitBlockId)

      // Nothing on the deactivated path should be queued
      expect(readyNodes).not.toContain(intermediateId)
      expect(readyNodes).not.toContain(sentinelStartId)
      expect(readyNodes).not.toContain(loopBodyId)
      expect(readyNodes).not.toContain(sentinelEndId)
      expect(readyNodes).not.toContain(afterLoopId)
    })

    it('should still correctly handle normal loop exit (not deactivate when loop runs)', () => {
      // When a loop actually executes and exits normally, after_loop should become ready
      const sentinelStartId = 'sentinel-start'
      const loopBodyId = 'loop-body'
      const sentinelEndId = 'sentinel-end'
      const afterLoopId = 'after-loop'

      const sentinelStartNode = createMockNode(sentinelStartId, [{ target: loopBodyId }])

      const loopBodyNode = createMockNode(
        loopBodyId,
        [{ target: sentinelEndId }],
        [sentinelStartId]
      )

      const sentinelEndNode = createMockNode(
        sentinelEndId,
        [
          { target: sentinelStartId, sourceHandle: 'loop_continue' },
          { target: afterLoopId, sourceHandle: 'loop_exit' },
        ],
        [loopBodyId]
      )

      const afterLoopNode = createMockNode(afterLoopId, [], [sentinelEndId])

      const nodes = new Map<string, DAGNode>([
        [sentinelStartId, sentinelStartNode],
        [loopBodyId, loopBodyNode],
        [sentinelEndId, sentinelEndNode],
        [afterLoopId, afterLoopNode],
      ])

      const dag = createMockDAG(nodes)
      const edgeManager = new EdgeManager(dag)

      // Simulate sentinel_end completing with loop_exit (loop is done)
      const readyNodes = edgeManager.processOutgoingEdges(sentinelEndNode, {
        selectedRoute: 'loop_exit',
      })

      // afterLoop should be ready
      expect(readyNodes).toContain(afterLoopId)
    })
  })
})
