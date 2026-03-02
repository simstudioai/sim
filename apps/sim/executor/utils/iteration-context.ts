import type { IterationContext } from '@/executor/execution/types'
import type { ExecutionContext } from '@/executor/types'

/**
 * Metadata shape needed for iteration context resolution.
 * Compatible with both DAGNode.metadata and inline metadata objects.
 */
export interface IterationNodeMetadata {
  loopId?: string
  parallelId?: string
  branchIndex?: number
  branchTotal?: number
  isLoopNode?: boolean
}

/**
 * Resolves the iteration context for a node based on its metadata and execution state.
 * Handles both parallel (branch) and loop iteration contexts.
 */
export function getIterationContext(
  ctx: ExecutionContext,
  metadata: IterationNodeMetadata | undefined
): IterationContext | undefined {
  if (!metadata) return undefined

  if (metadata.branchIndex !== undefined && metadata.branchTotal !== undefined) {
    return {
      iterationCurrent: metadata.branchIndex,
      iterationTotal: metadata.branchTotal,
      iterationType: 'parallel',
      iterationContainerId: metadata.parallelId,
    }
  }

  if (metadata.isLoopNode && metadata.loopId) {
    const loopScope = ctx.loopExecutions?.get(metadata.loopId)
    if (loopScope && loopScope.iteration !== undefined) {
      const parentIterations = buildParentIterations(ctx, metadata.loopId)
      return {
        iterationCurrent: loopScope.iteration,
        iterationTotal: loopScope.maxIterations,
        iterationType: 'loop',
        iterationContainerId: metadata.loopId,
        ...(parentIterations.length > 0 && { parentIterations }),
      }
    }
  }

  return undefined
}

/**
 * Walks the loop parent map to build the ancestor iteration chain.
 * Returns an array of parent iteration contexts, ordered from outermost to innermost.
 */
export function buildParentIterations(
  ctx: ExecutionContext,
  loopId: string
): NonNullable<IterationContext['parentIterations']> {
  const parents: NonNullable<IterationContext['parentIterations']> = []
  const visited = new Set<string>()
  let currentLoopId = loopId
  while (ctx.loopParentMap?.has(currentLoopId) && !visited.has(currentLoopId)) {
    visited.add(currentLoopId)
    const parentLoopId = ctx.loopParentMap.get(currentLoopId)!
    const parentScope = ctx.loopExecutions?.get(parentLoopId)
    if (parentScope && parentScope.iteration !== undefined) {
      parents.unshift({
        iterationCurrent: parentScope.iteration,
        iterationTotal: parentScope.maxIterations,
        iterationType: 'loop',
        iterationContainerId: parentLoopId,
      })
    }
    currentLoopId = parentLoopId
  }
  return parents
}
