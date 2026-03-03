import { DEFAULTS } from '@/executor/constants'
import type { NodeMetadata } from '@/executor/dag/types'
import type { IterationContext } from '@/executor/execution/types'
import type { ExecutionContext } from '@/executor/types'
import { extractOuterBranchIndex } from '@/executor/utils/subflow-utils'

/** Maximum ancestor depth to prevent runaway traversal in deeply nested subflows. */
const MAX_PARENT_DEPTH = DEFAULTS.MAX_NESTING_DEPTH

/**
 * Subset of {@link NodeMetadata} needed for iteration context resolution.
 * Compatible with both DAGNode.metadata and inline metadata objects.
 */
export type IterationNodeMetadata = Pick<
  NodeMetadata,
  'loopId' | 'parallelId' | 'branchIndex' | 'branchTotal' | 'isLoopNode'
>

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
    const parentIterations = metadata.parallelId
      ? buildParallelParentIterations(ctx, metadata.parallelId)
      : []
    return {
      iterationCurrent: metadata.branchIndex,
      iterationTotal: metadata.branchTotal,
      iterationType: 'parallel',
      iterationContainerId: metadata.parallelId,
      ...(parentIterations.length > 0 && { parentIterations }),
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
  while (
    ctx.loopParentMap?.has(currentLoopId) &&
    !visited.has(currentLoopId) &&
    visited.size < MAX_PARENT_DEPTH
  ) {
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

/**
 * Walks the parallel parent map to build the ancestor parallel iteration chain.
 * For nested parallels (parallel-in-parallel), the outer parallel is a pass-through
 * container — its scope tracks the branch count but individual blocks only know about
 * the innermost parallel. This function resolves the outer parallel context so the
 * terminal can display the full nesting hierarchy.
 */
export function buildParallelParentIterations(
  ctx: ExecutionContext,
  parallelId: string
): NonNullable<IterationContext['parentIterations']> {
  const parents: NonNullable<IterationContext['parentIterations']> = []
  const visited = new Set<string>()
  let currentId = parallelId
  while (
    ctx.parallelParentMap?.has(currentId) &&
    !visited.has(currentId) &&
    visited.size < MAX_PARENT_DEPTH
  ) {
    visited.add(currentId)
    const parentParallelId = ctx.parallelParentMap.get(currentId)!
    const parentScope = ctx.parallelExecutions?.get(parentParallelId)
    if (parentScope) {
      const outerBranchIndex = extractOuterBranchIndex(currentId) ?? 0
      parents.unshift({
        iterationCurrent: outerBranchIndex,
        iterationTotal: parentScope.totalBranches,
        iterationType: 'parallel',
        iterationContainerId: parentParallelId,
      })
    }
    currentId = parentParallelId
  }
  return parents
}
