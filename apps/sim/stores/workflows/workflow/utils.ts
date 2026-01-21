import type { Edge } from 'reactflow'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'

const DEFAULT_LOOP_ITERATIONS = 5

/**
 * Check if adding an edge would create a cycle in the graph.
 * Uses depth-first search to detect if the source node is reachable from the target node.
 *
 * @param edges - Current edges in the graph
 * @param sourceId - Source node ID of the proposed edge
 * @param targetId - Target node ID of the proposed edge
 * @returns true if adding this edge would create a cycle
 */
export function wouldCreateCycle(edges: Edge[], sourceId: string, targetId: string): boolean {
  if (sourceId === targetId) {
    return true
  }

  const adjacencyList = new Map<string, string[]>()
  for (const edge of edges) {
    if (!adjacencyList.has(edge.source)) {
      adjacencyList.set(edge.source, [])
    }
    adjacencyList.get(edge.source)!.push(edge.target)
  }

  const visited = new Set<string>()

  function canReachSource(currentNode: string): boolean {
    if (currentNode === sourceId) {
      return true
    }

    if (visited.has(currentNode)) {
      return false
    }

    visited.add(currentNode)

    const neighbors = adjacencyList.get(currentNode) || []
    for (const neighbor of neighbors) {
      if (canReachSource(neighbor)) {
        return true
      }
    }

    return false
  }

  return canReachSource(targetId)
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

  const loopType = loopBlock.data?.loopType || 'for'

  const loop: Loop = {
    id: loopBlockId,
    nodes: findChildNodes(loopBlockId, blocks),
    iterations: loopBlock.data?.count || DEFAULT_LOOP_ITERATIONS,
    loopType,
    enabled: loopBlock.enabled,
  }

  loop.forEachItems = loopBlock.data?.collection || ''
  loop.whileCondition = loopBlock.data?.whileCondition || ''
  loop.doWhileCondition = loopBlock.data?.doWhileCondition || ''

  return loop
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

  const parallelType = parallelBlock.data?.parallelType || 'count'

  const validParallelTypes = ['collection', 'count'] as const
  const validatedParallelType = validParallelTypes.includes(parallelType as any)
    ? parallelType
    : 'collection'

  const distribution =
    validatedParallelType === 'collection' ? parallelBlock.data?.collection || '' : undefined

  const count = parallelBlock.data?.count || 5

  return {
    id: parallelBlockId,
    nodes: findChildNodes(parallelBlockId, blocks),
    distribution,
    count,
    parallelType: validatedParallelType,
    enabled: parallelBlock.enabled,
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
