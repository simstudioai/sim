import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'

const DEFAULT_LOOP_ITERATIONS = 5

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
  }

  // Load ALL fields regardless of current loop type
  // This allows switching between loop types without losing data

  // For for/forEach loops, read from collection (block data) and map to forEachItems (loops store)
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
  loop.forEachItems = forEachItems

  // For while loops, use whileCondition
  loop.whileCondition = loopBlock.data?.whileCondition || ''

  // For do-while loops, use doWhileCondition
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

  // Get the parallel type from block data, defaulting to 'count' for consistency
  const parallelType = parallelBlock.data?.parallelType || 'count'

  // Validate parallelType against allowed values
  const validParallelTypes = ['collection', 'count'] as const
  const validatedParallelType = validParallelTypes.includes(parallelType as any)
    ? parallelType
    : 'collection'

  // Only set distribution if it's a collection-based parallel
  const distribution =
    validatedParallelType === 'collection' ? parallelBlock.data?.collection || '' : ''

  const count = parallelBlock.data?.count || 5

  return {
    id: parallelBlockId,
    nodes: findChildNodes(parallelBlockId, blocks),
    distribution,
    count,
    parallelType: validatedParallelType,
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
