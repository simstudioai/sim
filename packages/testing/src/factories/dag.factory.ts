/**
 * Factory functions for creating DAG (Directed Acyclic Graph) test fixtures.
 * These are used in executor tests for DAG construction and edge management.
 */

import { createSerializedBlock, type SerializedBlock } from './serialized-block.factory'

/**
 * DAG edge structure.
 */
export interface DAGEdge {
  target: string
  sourceHandle?: string
  targetHandle?: string
}

/**
 * DAG node structure.
 */
export interface DAGNode {
  id: string
  block: SerializedBlock
  outgoingEdges: Map<string, DAGEdge>
  incomingEdges: Set<string>
  metadata: Record<string, any>
}

/**
 * DAG structure.
 */
export interface DAG {
  nodes: Map<string, DAGNode>
  loopConfigs: Map<string, any>
  parallelConfigs: Map<string, any>
}

/**
 * Options for creating a DAG node.
 */
export interface DAGNodeFactoryOptions {
  id?: string
  type?: string
  block?: SerializedBlock
  outgoingEdges?: DAGEdge[]
  incomingEdges?: string[]
  metadata?: Record<string, any>
  params?: Record<string, any>
}

/**
 * Creates a DAG node with sensible defaults.
 *
 * @example
 * ```ts
 * const node = createDAGNode({ id: 'block-1' })
 *
 * // With outgoing edges
 * const node = createDAGNode({
 *   id: 'start',
 *   outgoingEdges: [{ target: 'end' }]
 * })
 * ```
 */
export function createDAGNode(options: DAGNodeFactoryOptions = {}): DAGNode {
  const id = options.id ?? `node-${Math.random().toString(36).substring(2, 8)}`
  const block =
    options.block ??
    createSerializedBlock({
      id,
      type: options.type ?? 'function',
      params: options.params,
    })

  const outgoingEdges = new Map<string, DAGEdge>()
  if (options.outgoingEdges) {
    options.outgoingEdges.forEach((edge, i) => {
      outgoingEdges.set(`edge-${i}`, edge)
    })
  }

  return {
    id,
    block,
    outgoingEdges,
    incomingEdges: new Set(options.incomingEdges ?? []),
    metadata: options.metadata ?? {},
  }
}

/**
 * Creates a DAG structure from a list of node IDs.
 *
 * @example
 * ```ts
 * const dag = createDAG(['block-1', 'block-2', 'block-3'])
 * ```
 */
export function createDAG(nodeIds: string[]): DAG {
  const nodes = new Map<string, DAGNode>()
  for (const id of nodeIds) {
    nodes.set(id, createDAGNode({ id }))
  }
  return {
    nodes,
    loopConfigs: new Map(),
    parallelConfigs: new Map(),
  }
}

/**
 * Creates a DAG from a node configuration array.
 *
 * @example
 * ```ts
 * const dag = createDAGFromNodes([
 *   { id: 'start', outgoingEdges: [{ target: 'middle' }] },
 *   { id: 'middle', outgoingEdges: [{ target: 'end' }], incomingEdges: ['start'] },
 *   { id: 'end', incomingEdges: ['middle'] }
 * ])
 * ```
 */
export function createDAGFromNodes(nodeConfigs: DAGNodeFactoryOptions[]): DAG {
  const nodes = new Map<string, DAGNode>()
  for (const config of nodeConfigs) {
    const node = createDAGNode(config)
    nodes.set(node.id, node)
  }
  return {
    nodes,
    loopConfigs: new Map(),
    parallelConfigs: new Map(),
  }
}

/**
 * Creates a linear DAG where each node connects to the next.
 *
 * @example
 * ```ts
 * // Creates A -> B -> C
 * const dag = createLinearDAG(['A', 'B', 'C'])
 * ```
 */
export function createLinearDAG(nodeIds: string[]): DAG {
  const nodes = new Map<string, DAGNode>()

  for (let i = 0; i < nodeIds.length; i++) {
    const id = nodeIds[i]
    const outgoingEdges: DAGEdge[] = i < nodeIds.length - 1 ? [{ target: nodeIds[i + 1] }] : []
    const incomingEdges = i > 0 ? [nodeIds[i - 1]] : []

    nodes.set(id, createDAGNode({ id, outgoingEdges, incomingEdges }))
  }

  return {
    nodes,
    loopConfigs: new Map(),
    parallelConfigs: new Map(),
  }
}

/**
 * Adds a node to an existing DAG.
 */
export function addNodeToDAG(dag: DAG, node: DAGNode): DAG {
  dag.nodes.set(node.id, node)
  return dag
}

/**
 * Connects two nodes in a DAG with an edge.
 */
export function connectDAGNodes(
  dag: DAG,
  sourceId: string,
  targetId: string,
  sourceHandle?: string
): DAG {
  const sourceNode = dag.nodes.get(sourceId)
  const targetNode = dag.nodes.get(targetId)

  if (sourceNode && targetNode) {
    const edgeId = sourceHandle
      ? `${sourceId}→${targetId}-${sourceHandle}`
      : `${sourceId}→${targetId}`
    sourceNode.outgoingEdges.set(edgeId, { target: targetId, sourceHandle })
    targetNode.incomingEdges.add(sourceId)
  }

  return dag
}
