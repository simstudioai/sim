import type { Edge } from 'reactflow'
import type { BlockState, Loop, Parallel } from './types'

/**
 * Performs a depth-first search to detect all cycles in the graph
 * @param edges - List of all edges in the graph
 * @param startNode - Starting node for cycle detection
 * @returns Array of all unique cycles found in the graph
 */
export function detectCycle(
  edges: Edge[],
  startNode: string
): { hasCycle: boolean; paths: string[][] } {
  const visited = new Set<string>()
  const recursionStack = new Set<string>()
  const allCycles: string[][] = []
  const currentPath: string[] = []

  function dfs(node: string) {
    visited.add(node)
    recursionStack.add(node)
    currentPath.push(node)

    // Get all neighbors of current node
    const neighbors = edges.filter((edge) => edge.source === node).map((edge) => edge.target)

    for (const neighbor of neighbors) {
      // Check for self-loops (node connecting to itself)
      if (neighbor === node) {
        allCycles.push([node])
        continue
      }

      if (!recursionStack.has(neighbor)) {
        if (!visited.has(neighbor)) {
          dfs(neighbor)
        }
      } else {
        // Found a cycle
        const cycleStartIndex = currentPath.indexOf(neighbor)
        if (cycleStartIndex !== -1) {
          const cycle = currentPath.slice(cycleStartIndex)
          // Include all cycles, even single-node ones
          allCycles.push([...cycle])
        }
      }
    }

    currentPath.pop()
    recursionStack.delete(node)
  }

  dfs(startNode)

  return {
    hasCycle: allCycles.length > 0,
    paths: allCycles,
  }
}

/**
 * Convert UI loop block to executor Loop format
 *
 * @param loopBlockId - ID of the loop block to convert
 * @param blocks - Record of all blocks in the workflow
 * @returns Loop object for execution engine or undefined if not a valid loop
 */
export function convertLoopBlockToLoop(
  loopBlockId: string,
  blocks: Record<string, BlockState>
): Loop | undefined {
  const loopBlock = blocks[loopBlockId]
  if (!loopBlock || loopBlock.type !== 'loop') return undefined

  // Parse collection if it's a string representation of an array/object
  let forEachItems: any = loopBlock.data?.collection || ''
  if (typeof forEachItems === 'string' && forEachItems.trim()) {
    const trimmed = forEachItems.trim()
    // Try to parse if it looks like JSON
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        forEachItems = JSON.parse(trimmed)
      } catch {
        // Keep as string if parsing fails - will be evaluated at runtime
      }
    }
  }

  return {
    id: loopBlockId,
    nodes: findChildNodes(loopBlockId, blocks),
    iterations: loopBlock.data?.count || 5,
    loopType: loopBlock.data?.loopType || 'for',
    forEachItems,
  }
}

/**
 * Convert UI parallel block to executor Parallel format
 *
 * @param parallelBlockId - ID of the parallel block to convert
 * @param blocks - Record of all blocks in the workflow
 * @returns Parallel object for execution engine or undefined if not a valid parallel block
 */
export function convertParallelBlockToParallel(
  parallelBlockId: string,
  blocks: Record<string, BlockState>
): Parallel | undefined {
  const parallelBlock = blocks[parallelBlockId]
  if (!parallelBlock || parallelBlock.type !== 'parallel') return undefined

  // Only set distribution if it's a collection-based parallel
  const parallelType = parallelBlock.data?.parallelType || 'collection'
  const distribution = parallelType === 'collection' ? parallelBlock.data?.collection || '' : ''

  return {
    id: parallelBlockId,
    nodes: findChildNodes(parallelBlockId, blocks),
    distribution,
  }
}

/**
 * Find all nodes that are children of this container (loop or parallel)
 *
 * @param containerId - ID of the container to find children for
 * @param blocks - Record of all blocks in the workflow
 * @returns Array of node IDs that are direct children of this container
 */
export function findChildNodes(containerId: string, blocks: Record<string, BlockState>): string[] {
  return Object.values(blocks)
    .filter((block) => block.data?.parentId === containerId)
    .map((block) => block.id)
}

/**
 * Find all descendant nodes, including children, grandchildren, etc.
 *
 * @param containerId - ID of the container to find descendants for
 * @param blocks - Record of all blocks in the workflow
 * @returns Array of node IDs that are descendants of this container
 */
export function findAllDescendantNodes(
  containerId: string,
  blocks: Record<string, BlockState>
): string[] {
  const descendants: string[] = []
  const findDescendants = (parentId: string) => {
    const children = Object.values(blocks)
      .filter((block) => block.data?.parentId === parentId)
      .map((block) => block.id)

    children.forEach((childId) => {
      descendants.push(childId)
      findDescendants(childId)
    })
  }

  findDescendants(containerId)
  return descendants
}

/**
 * Builds a complete collection of loops from the UI blocks
 *
 * @param blocks - Record of all blocks in the workflow
 * @returns Record of Loop objects for execution engine
 */
export function generateLoopBlocks(blocks: Record<string, BlockState>): Record<string, Loop> {
  const loops: Record<string, Loop> = {}

  // Find all loop nodes
  Object.entries(blocks)
    .filter(([_, block]) => block.type === 'loop')
    .forEach(([id, block]) => {
      const loop = convertLoopBlockToLoop(id, blocks)
      if (loop) {
        loops[id] = loop
      }
    })

  return loops
}

/**
 * Builds a complete collection of parallel blocks from the UI blocks
 *
 * @param blocks - Record of all blocks in the workflow
 * @returns Record of Parallel objects for execution engine
 */
export function generateParallelBlocks(
  blocks: Record<string, BlockState>
): Record<string, Parallel> {
  const parallels: Record<string, Parallel> = {}

  // Find all parallel nodes
  Object.entries(blocks)
    .filter(([_, block]) => block.type === 'parallel')
    .forEach(([id, block]) => {
      const parallel = convertParallelBlockToParallel(id, blocks)
      if (parallel) {
        parallels[id] = parallel
      }
    })

  return parallels
}
