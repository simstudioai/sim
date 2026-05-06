import type { BlockState, Loop, Parallel } from '@sim/workflow-types/workflow'

const DEFAULT_LOOP_ITERATIONS = 5

export function findChildNodes(containerId: string, blocks: Record<string, BlockState>): string[] {
  return Object.values(blocks)
    .filter((block) => block.data?.parentId === containerId)
    .map((block) => block.id)
}

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
