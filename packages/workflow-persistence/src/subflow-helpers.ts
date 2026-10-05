import type { BlockState, Loop, Parallel } from '@sim/workflow-types/workflow'

const DEFAULT_LOOP_ITERATIONS = 5
const DEFAULT_PARALLEL_BATCH_SIZE = 20
const MAX_PARALLEL_BATCH_SIZE = 20

/** Clamps a parallel block's batch size to 1..20, defaulting to 20 when it is not a number. */
export function clampParallelBatchSize(batchSize: unknown): number {
  const parsed = typeof batchSize === 'number' ? batchSize : Number.parseInt(String(batchSize), 10)
  if (Number.isNaN(parsed)) {
    return DEFAULT_PARALLEL_BATCH_SIZE
  }
  return Math.max(1, Math.min(MAX_PARALLEL_BATCH_SIZE, parsed))
}

/**
 * Finds the direct children of a loop or parallel container.
 *
 * @param containerId - ID of the container to find children for
 * @param blocks - Record of all blocks in the workflow
 * @returns IDs of the blocks whose parent is this container
 */
function findChildNodes(containerId: string, blocks: Record<string, BlockState>): string[] {
  return Object.values(blocks)
    .filter((block) => block.data?.parentId === containerId)
    .map((block) => block.id)
}

/**
 * Converts a loop block into the executor's {@link Loop} format.
 *
 * @param loopBlockId - ID of the loop block to convert
 * @param blocks - Record of all blocks in the workflow
 * @returns The loop, or undefined when the block is missing or not a loop
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
 * Converts a parallel block into the executor's {@link Parallel} format.
 *
 * @param parallelBlockId - ID of the parallel block to convert
 * @param blocks - Record of all blocks in the workflow
 * @returns The parallel, or undefined when the block is missing or not a parallel
 */
function convertParallelBlockToParallel(
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
  const batchSize = clampParallelBatchSize(parallelBlock.data?.batchSize)

  return {
    id: parallelBlockId,
    nodes: findChildNodes(parallelBlockId, blocks),
    distribution,
    count,
    parallelType: validatedParallelType,
    batchSize,
    enabled: parallelBlock.enabled,
  }
}

/**
 * Builds every loop in a workflow from its loop blocks.
 *
 * @param blocks - Record of all blocks in the workflow
 * @returns Loops keyed by block ID
 */
export function generateLoopBlocks(blocks: Record<string, BlockState>): Record<string, Loop> {
  const loops: Record<string, Loop> = {}

  Object.entries(blocks)
    .filter(([_, block]) => block.type === 'loop')
    .forEach(([id]) => {
      const loop = convertLoopBlockToLoop(id, blocks)
      if (loop) {
        loops[id] = loop
      }
    })

  return loops
}

/**
 * Builds every parallel in a workflow from its parallel blocks.
 *
 * @param blocks - Record of all blocks in the workflow
 * @returns Parallels keyed by block ID
 */
export function generateParallelBlocks(
  blocks: Record<string, BlockState>
): Record<string, Parallel> {
  const parallels: Record<string, Parallel> = {}

  Object.entries(blocks)
    .filter(([_, block]) => block.type === 'parallel')
    .forEach(([id]) => {
      const parallel = convertParallelBlockToParallel(id, blocks)
      if (parallel) {
        parallels[id] = parallel
      }
    })

  return parallels
}
