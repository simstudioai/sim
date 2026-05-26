import { DEFAULTS } from '@/executor/constants'
import type { NodeMetadata } from '@/executor/dag/types'
import type { IterationContext, ParentIteration } from '@/executor/execution/types'
import type { ExecutionContext } from '@/executor/types'
import { findEffectiveContainerId } from '@/executor/utils/subflow-utils'

/** Maximum ancestor depth to prevent runaway traversal in deeply nested subflows. */
const MAX_PARENT_DEPTH = DEFAULTS.MAX_NESTING_DEPTH

/**
 * Subset of {@link NodeMetadata} needed for iteration context resolution.
 * Compatible with both DAGNode.metadata and inline metadata objects.
 */
export type IterationNodeMetadata = Pick<
  NodeMetadata,
  'subflowType' | 'subflowId' | 'branchIndex' | 'branchTotal' | 'isLoopNode'
>

/**
 * Resolves the iteration context for a node based on its metadata and execution state.
 * Handles both parallel (branch) and loop iteration contexts, including cross-type
 * nesting (loop-in-parallel, parallel-in-loop) via the unified subflow parent map.
 */
export function getIterationContext(
  ctx: ExecutionContext,
  metadata: IterationNodeMetadata | undefined
): IterationContext | undefined {
  if (!metadata) return undefined

  if (metadata.branchIndex !== undefined && metadata.branchTotal !== undefined) {
    const parallelId = metadata.subflowType === 'parallel' ? metadata.subflowId : undefined
    const parentIterations = parallelId ? buildUnifiedParentIterations(ctx, parallelId) : []
    return {
      iterationCurrent: metadata.branchIndex,
      iterationTotal: metadata.branchTotal,
      iterationType: 'parallel',
      iterationContainerId: parallelId,
      ...(parentIterations.length > 0 && { parentIterations }),
    }
  }

  const loopId = metadata.subflowType === 'loop' ? metadata.subflowId : undefined
  if (metadata.isLoopNode && loopId) {
    const loopScope = ctx.loopExecutions?.get(loopId)
    if (loopScope && loopScope.iteration !== undefined) {
      const parentIterations = buildUnifiedParentIterations(ctx, loopId)
      return {
        iterationCurrent: loopScope.iteration,
        iterationTotal: loopScope.maxIterations,
        iterationType: 'loop',
        iterationContainerId: loopId,
        ...(parentIterations.length > 0 && { parentIterations }),
      }
    }
  }

  return undefined
}

/**
 * Builds a single-level iteration context for a container (loop/parallel) that is
 * nested inside a parent subflow. Used by orchestrators when emitting onBlockComplete
 * for container sentinel nodes.
 */
export function buildContainerIterationContext(
  ctx: ExecutionContext,
  containerId: string
): IterationContext | undefined {
  const parentEntry = ctx.subflowParentMap?.get(containerId)
  if (!parentEntry) return undefined

  if (parentEntry.parentType === 'parallel') {
    if (parentEntry.branchIndex !== undefined) {
      const parentScope = ctx.parallelExecutions?.get(parentEntry.parentId)
      if (!parentScope) return undefined

      return {
        iterationCurrent: parentEntry.branchIndex,
        iterationTotal: parentScope.totalBranches,
        iterationType: 'parallel',
        iterationContainerId: parentEntry.parentId,
      }
    }
  } else if (parentEntry.parentType === 'loop') {
    const effectiveParentId = ctx.loopExecutions
      ? findEffectiveContainerId(parentEntry.parentId, containerId, ctx.loopExecutions)
      : parentEntry.parentId
    const parentScope = ctx.loopExecutions?.get(effectiveParentId)
    if (parentScope && parentScope.iteration !== undefined) {
      return {
        iterationCurrent: parentScope.iteration,
        iterationTotal: parentScope.maxIterations,
        iterationType: 'loop',
        iterationContainerId: effectiveParentId,
      }
    }
  }
  return undefined
}

/**
 * Walks the unified subflow parent map to build the full ancestor iteration chain,
 * handling all nesting combinations (loop-in-loop, parallel-in-parallel,
 * loop-in-parallel, parallel-in-loop).
 *
 * Returns an array of parent iteration contexts, ordered from outermost to innermost.
 */
export function buildUnifiedParentIterations(
  ctx: ExecutionContext,
  subflowId: string
): ParentIteration[] {
  if (!ctx.subflowParentMap) {
    return []
  }

  const parents: ParentIteration[] = []
  const visited = new Set<string>()
  let currentId = subflowId

  while (
    ctx.subflowParentMap.has(currentId) &&
    !visited.has(currentId) &&
    visited.size < MAX_PARENT_DEPTH
  ) {
    visited.add(currentId)
    const entry = ctx.subflowParentMap.get(currentId)!
    const { parentId, parentType } = entry

    if (parentType === 'loop') {
      // Resolve the effective (possibly cloned) loop ID — at runtime the scope
      // may live under a cloned ID like `mid-loop__obranch-2` rather than `mid-loop`
      const effectiveParentId = ctx.loopExecutions
        ? findEffectiveContainerId(parentId, currentId, ctx.loopExecutions)
        : parentId
      const parentScope = ctx.loopExecutions?.get(effectiveParentId)
      if (parentScope && parentScope.iteration !== undefined) {
        parents.unshift({
          iterationCurrent: parentScope.iteration,
          iterationTotal: parentScope.maxIterations,
          iterationType: 'loop',
          iterationContainerId: effectiveParentId,
        })
      }
    } else {
      if (entry.branchIndex === undefined) {
        currentId = parentId
        continue
      }
      const effectiveParentId = parentId
      const parentScope = ctx.parallelExecutions?.get(effectiveParentId)
      if (parentScope) {
        parents.unshift({
          iterationCurrent: entry.branchIndex,
          iterationTotal: parentScope.totalBranches,
          iterationType: 'parallel',
          iterationContainerId: effectiveParentId,
        })
      }
    }

    currentId = parentId
  }

  return parents
}
