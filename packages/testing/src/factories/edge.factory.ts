/* eslint-disable @typescript-eslint/no-explicit-any */

import { generateRandomString } from '@sim/utils/random'

/**
 * Options for creating a mock edge.
 */
interface EdgeFactoryOptions {
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
  return `${source}-${target}-${generateRandomString(4)}`
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
