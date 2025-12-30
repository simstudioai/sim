/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Options for creating a mock edge.
 */
export interface EdgeFactoryOptions {
  id?: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  type?: string
  data?: Record<string, any>
}

/**
 * Generates an edge ID from source and target.
 */
function generateEdgeId(source: string, target: string): string {
  return `${source}-${target}-${Math.random().toString(36).substring(2, 6)}`
}

/**
 * Creates a mock edge connecting two blocks.
 *
 * @example
 * ```ts
 * // Simple edge
 * const edge = createEdge({ source: 'block-1', target: 'block-2' })
 *
 * // Edge with specific handles
 * const edge = createEdge({
 *   source: 'condition-1',
 *   target: 'block-2',
 *   sourceHandle: 'condition-if'
 * })
 * ```
 */
export function createEdge(options: EdgeFactoryOptions): any {
  return {
    id: options.id ?? generateEdgeId(options.source, options.target),
    source: options.source,
    target: options.target,
    sourceHandle: options.sourceHandle,
    targetHandle: options.targetHandle,
    type: options.type ?? 'default',
    data: options.data,
  }
}

/**
 * Creates multiple edges from a connection specification.
 *
 * @example
 * ```ts
 * const edges = createEdges([
 *   { source: 'start', target: 'agent' },
 *   { source: 'agent', target: 'end' },
 * ])
 * ```
 */
export function createEdges(
  connections: Array<{
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
  }>
): any[] {
  return connections.map((conn) => createEdge(conn))
}

/**
 * Creates a linear chain of edges connecting blocks in order.
 *
 * @example
 * ```ts
 * // Creates edges: a->b, b->c, c->d
 * const edges = createLinearEdges(['a', 'b', 'c', 'd'])
 * ```
 */
export function createLinearEdges(blockIds: string[]): any[] {
  const edges: any[] = []
  for (let i = 0; i < blockIds.length - 1; i++) {
    edges.push(createEdge({ source: blockIds[i], target: blockIds[i + 1] }))
  }
  return edges
}
