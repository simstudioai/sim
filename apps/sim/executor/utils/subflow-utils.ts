import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { DEFAULTS, LOOP, PARALLEL } from '@/executor/constants'
import type { ContextExtensions } from '@/executor/execution/types'
import { type BlockLog, type ExecutionContext, getNextExecutionOrder } from '@/executor/types'
import { buildContainerIterationContext } from '@/executor/utils/iteration-context'
import type { SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('SubflowUtils')

const BRANCH_PATTERN = new RegExp(`${PARALLEL.BRANCH.PREFIX}\\d+${PARALLEL.BRANCH.SUFFIX}$`)
const BRANCH_INDEX_PATTERN = new RegExp(`${PARALLEL.BRANCH.PREFIX}(\\d+)${PARALLEL.BRANCH.SUFFIX}$`)
const LOOP_SENTINEL_START_PATTERN = new RegExp(
  `${LOOP.SENTINEL.PREFIX}(.+)${LOOP.SENTINEL.START_SUFFIX}`
)
const LOOP_SENTINEL_END_PATTERN = new RegExp(
  `${LOOP.SENTINEL.PREFIX}(.+)${LOOP.SENTINEL.END_SUFFIX}`
)
const PARALLEL_SENTINEL_START_PATTERN = new RegExp(
  `${PARALLEL.SENTINEL.PREFIX}(.+)${PARALLEL.SENTINEL.START_SUFFIX}`
)
const PARALLEL_SENTINEL_END_PATTERN = new RegExp(
  `${PARALLEL.SENTINEL.PREFIX}(.+)${PARALLEL.SENTINEL.END_SUFFIX}`
)

export function buildSentinelStartId(loopId: string): string {
  return `${LOOP.SENTINEL.PREFIX}${loopId}${LOOP.SENTINEL.START_SUFFIX}`
}

export function buildSentinelEndId(loopId: string): string {
  return `${LOOP.SENTINEL.PREFIX}${loopId}${LOOP.SENTINEL.END_SUFFIX}`
}

export function buildParallelSentinelStartId(parallelId: string): string {
  return `${PARALLEL.SENTINEL.PREFIX}${parallelId}${PARALLEL.SENTINEL.START_SUFFIX}`
}

export function buildParallelSentinelEndId(parallelId: string): string {
  return `${PARALLEL.SENTINEL.PREFIX}${parallelId}${PARALLEL.SENTINEL.END_SUFFIX}`
}

export function isLoopSentinelNodeId(nodeId: string): boolean {
  return (
    nodeId.startsWith(LOOP.SENTINEL.PREFIX) &&
    (nodeId.endsWith(LOOP.SENTINEL.START_SUFFIX) || nodeId.endsWith(LOOP.SENTINEL.END_SUFFIX))
  )
}

export function isParallelSentinelNodeId(nodeId: string): boolean {
  return (
    nodeId.startsWith(PARALLEL.SENTINEL.PREFIX) &&
    (nodeId.endsWith(PARALLEL.SENTINEL.START_SUFFIX) ||
      nodeId.endsWith(PARALLEL.SENTINEL.END_SUFFIX))
  )
}

export function isSentinelNodeId(nodeId: string): boolean {
  return isLoopSentinelNodeId(nodeId) || isParallelSentinelNodeId(nodeId)
}

export function extractLoopIdFromSentinel(sentinelId: string): string | null {
  const startMatch = sentinelId.match(LOOP_SENTINEL_START_PATTERN)
  if (startMatch) return startMatch[1]
  const endMatch = sentinelId.match(LOOP_SENTINEL_END_PATTERN)
  if (endMatch) return endMatch[1]
  return null
}

export function extractParallelIdFromSentinel(sentinelId: string): string | null {
  const startMatch = sentinelId.match(PARALLEL_SENTINEL_START_PATTERN)
  if (startMatch) return startMatch[1]
  const endMatch = sentinelId.match(PARALLEL_SENTINEL_END_PATTERN)
  if (endMatch) return endMatch[1]
  return null
}

/**
 * Build branch node ID with subscript notation
 * Example: ("blockId", 2) → "blockId₍2₎"
 */
export function buildBranchNodeId(baseId: string, branchIndex: number): string {
  return `${baseId}${PARALLEL.BRANCH.PREFIX}${branchIndex}${PARALLEL.BRANCH.SUFFIX}`
}
export function extractBaseBlockId(branchNodeId: string): string {
  return branchNodeId.replace(BRANCH_PATTERN, '')
}

export function extractBranchIndex(branchNodeId: string): number | null {
  const match = branchNodeId.match(BRANCH_INDEX_PATTERN)
  return match ? Number.parseInt(match[1], 10) : null
}

export function isBranchNodeId(nodeId: string): boolean {
  return BRANCH_PATTERN.test(nodeId)
}

const OUTER_BRANCH_PATTERN = /__obranch-(\d+)/
const OUTER_BRANCH_STRIP_PATTERN = /__obranch-\d+/g
const CLONE_DIGEST_STRIP_PATTERN = /__clone[0-9a-f]+/gi

/**
 * Extracts the outer branch index from a cloned subflow ID.
 * Cloned IDs follow the pattern `{originalId}__obranch-{index}`.
 * Returns undefined if the ID is not a clone.
 */
export function extractOuterBranchIndex(clonedId: string): number | undefined {
  const match = clonedId.match(OUTER_BRANCH_PATTERN)
  return match ? Number.parseInt(match[1], 10) : undefined
}

export function extractInnermostOuterBranchIndex(clonedId: string): number | undefined {
  const matches = Array.from(clonedId.matchAll(/__obranch-(\d+)/g))
  const lastMatch = matches.at(-1)
  return lastMatch ? Number.parseInt(lastMatch[1], 10) : undefined
}

/**
 * Strips all clone suffixes (`__obranch-N`) and branch subscripts (`₍N₎`)
 * from a node ID, returning the original workflow-level block ID.
 */
export function stripCloneSuffixes(nodeId: string): string {
  return extractBaseBlockId(
    nodeId.replace(OUTER_BRANCH_STRIP_PATTERN, '').replace(CLONE_DIGEST_STRIP_PATTERN, '')
  )
}

/**
 * Builds a stable ID for an output scoped to a global outer parallel branch.
 */
export function buildOuterBranchScopedId(originalId: string, branchIndex: number): string {
  return `${originalId}__obranch-${branchIndex}`
}

/**
 * Builds a cloned subflow ID from an original ID and outer branch index.
 */
export function buildClonedSubflowId(originalId: string, branchIndex: number): string {
  return buildOuterBranchScopedId(originalId, branchIndex)
}

/**
 * Strips outer-branch clone suffixes (`__obranch-N`) from an ID,
 * returning the original workflow-level subflow ID.
 */
export function stripOuterBranchSuffix(id: string): string {
  return id.replace(OUTER_BRANCH_STRIP_PATTERN, '').replace(CLONE_DIGEST_STRIP_PATTERN, '')
}

/**
 * Finds the effective (possibly cloned) container ID for a subflow,
 * given the current node's ID and an execution map (loopExecutions or parallelExecutions).
 *
 * When inside a cloned subflow (e.g., loop-1__obranch-2), the execution scope is
 * stored under the cloned ID, not the original. This function extracts the `__obranch-N`
 * suffix from the current node ID, constructs the candidate cloned container ID, and
 * checks if it exists in the execution map.
 *
 * Returns the effective ID (cloned or original) that exists in the map.
 */
export function findEffectiveContainerId(
  originalId: string,
  currentNodeId: string,
  executionMap: Map<string, unknown>,
  mappedBranchIndex?: number
): string {
  if (mappedBranchIndex !== undefined && mappedBranchIndex > 0) {
    const cloneSuffix = `__obranch-${mappedBranchIndex}`
    const candidateId = buildClonedSubflowId(originalId, mappedBranchIndex)
    if (executionMap.has(candidateId)) {
      return candidateId
    }

    for (const scopeId of executionMap.keys()) {
      if (scopeId.endsWith(cloneSuffix) && stripOuterBranchSuffix(scopeId) === originalId) {
        return scopeId
      }
    }
  }

  // Prefer the cloned variant when currentNodeId carries an __obranch-N suffix.
  // During concurrent parallel-in-loop execution both the original (branch 0)
  // and cloned variants coexist in the map; the clone is the correct scope.
  const match = currentNodeId.match(OUTER_BRANCH_PATTERN)
  if (match) {
    const branchIndex = Number.parseInt(match[1], 10)
    const cloneSuffix = `__obranch-${branchIndex}`
    if (currentNodeId.includes('__clone')) {
      for (const scopeId of executionMap.keys()) {
        if (
          scopeId.includes('__clone') &&
          scopeId.endsWith(cloneSuffix) &&
          stripOuterBranchSuffix(scopeId) === originalId
        ) {
          return scopeId
        }
      }
    }

    const candidateId = buildClonedSubflowId(originalId, branchIndex)
    if (executionMap.has(candidateId)) {
      return candidateId
    }

    for (const scopeId of executionMap.keys()) {
      if (scopeId.endsWith(cloneSuffix) && stripOuterBranchSuffix(scopeId) === originalId) {
        return scopeId
      }
    }
  }

  // Return original ID — for branch-0 (non-cloned) or when scope is missing.
  // Callers handle the missing-scope case gracefully.
  return originalId
}

export function normalizeNodeId(nodeId: string): string {
  if (isBranchNodeId(nodeId)) {
    return extractBaseBlockId(nodeId)
  }
  if (isLoopSentinelNodeId(nodeId)) {
    return extractLoopIdFromSentinel(nodeId) || nodeId
  }
  if (isParallelSentinelNodeId(nodeId)) {
    return extractParallelIdFromSentinel(nodeId) || nodeId
  }
  return nodeId
}

type SubflowContainerType = 'loop' | 'parallel'

function getSubflowNodes(
  workflow: Pick<SerializedWorkflow, 'loops' | 'parallels'>,
  type: SubflowContainerType,
  id: string
): string[] | undefined {
  return type === 'loop' ? workflow.loops?.[id]?.nodes : workflow.parallels?.[id]?.nodes
}

export function subflowContainsBlock(
  workflow: Pick<SerializedWorkflow, 'loops' | 'parallels'>,
  containerType: SubflowContainerType,
  containerId: string,
  baseBlockId: string,
  visited = new Set<string>()
): boolean {
  const visitKey = `${containerType}:${containerId}`
  if (visited.has(visitKey)) return false
  visited.add(visitKey)

  const nodes = getSubflowNodes(workflow, containerType, containerId)
  if (!nodes) return false

  for (const nodeId of nodes) {
    if (nodeId === baseBlockId) return true
    if (workflow.loops?.[nodeId]) {
      if (subflowContainsBlock(workflow, 'loop', nodeId, baseBlockId, visited)) return true
    } else if (workflow.parallels?.[nodeId]) {
      if (subflowContainsBlock(workflow, 'parallel', nodeId, baseBlockId, visited)) return true
    }
  }
  return false
}

export function isSubflowNestedInside(
  workflow: Pick<SerializedWorkflow, 'loops' | 'parallels'>,
  childType: SubflowContainerType,
  childId: string,
  ancestorType: SubflowContainerType,
  ancestorId: string,
  visited = new Set<string>()
): boolean {
  const visitKey = `${ancestorType}:${ancestorId}`
  if (visited.has(visitKey)) return false
  visited.add(visitKey)

  const nodes = getSubflowNodes(workflow, ancestorType, ancestorId)
  if (!nodes) return false

  for (const nodeId of nodes) {
    if (
      nodeId === childId &&
      (childType === 'loop' ? workflow.loops?.[childId] : workflow.parallels?.[childId])
    ) {
      return true
    }
    if (workflow.loops?.[nodeId]) {
      if (isSubflowNestedInside(workflow, childType, childId, 'loop', nodeId, visited)) {
        return true
      }
    } else if (workflow.parallels?.[nodeId]) {
      if (isSubflowNestedInside(workflow, childType, childId, 'parallel', nodeId, visited)) {
        return true
      }
    }
  }
  return false
}

/**
 * Creates and logs an error for a subflow (loop or parallel).
 */
export async function addSubflowErrorLog(
  ctx: ExecutionContext,
  blockId: string,
  blockType: 'loop' | 'parallel',
  errorMessage: string,
  inputData: Record<string, any>,
  contextExtensions: ContextExtensions | null
): Promise<void> {
  const now = new Date().toISOString()
  const execOrder = getNextExecutionOrder(ctx)

  const block = ctx.workflow?.blocks?.find((b) => b.id === blockId)
  const blockName = block?.metadata?.name || (blockType === 'loop' ? 'Loop' : 'Parallel')

  const blockLog: BlockLog = {
    blockId,
    blockName,
    blockType,
    startedAt: now,
    executionOrder: execOrder,
    endedAt: now,
    durationMs: 0,
    success: false,
    error: errorMessage,
    input: inputData,
    output: { error: errorMessage },
    ...(blockType === 'loop' ? { loopId: blockId } : { parallelId: blockId }),
  }
  ctx.blockLogs.push(blockLog)

  if (contextExtensions?.onBlockStart) {
    try {
      await contextExtensions.onBlockStart(blockId, blockName, blockType, execOrder)
    } catch (error) {
      logger.warn('Subflow error start callback failed', {
        blockId,
        blockType,
        error: toError(error).message,
      })
    }
  }

  if (contextExtensions?.onBlockComplete) {
    try {
      await contextExtensions.onBlockComplete(blockId, blockName, blockType, {
        input: inputData,
        output: { error: errorMessage },
        executionTime: 0,
        startedAt: now,
        executionOrder: execOrder,
        endedAt: now,
      })
    } catch (error) {
      logger.warn('Subflow error completion callback failed', {
        blockId,
        blockType,
        error: toError(error).message,
      })
    }
  }
}

/**
 * Emits the BlockLog + onBlockComplete callback for a loop/parallel container that
 * finished successfully. Without this, successful container runs produce no top-level BlockLog,
 * which forces the trace-span builder to fall back
 * to generic counter-based names ("Loop 1", "Parallel 1") instead of the user-configured
 * block name.
 */
export async function emitSubflowSuccessEvents(
  ctx: ExecutionContext,
  blockId: string,
  blockType: 'loop' | 'parallel',
  output: { results: unknown },
  contextExtensions: ContextExtensions | null
): Promise<void> {
  const now = new Date().toISOString()
  const executionOrder = getNextExecutionOrder(ctx)
  const block = ctx.workflow?.blocks.find((b) => b.id === blockId)
  const blockName = block?.metadata?.name ?? blockType
  const iterationContext = buildContainerIterationContext(ctx, blockId)

  ctx.blockLogs.push({
    blockId,
    blockName,
    blockType,
    startedAt: now,
    endedAt: now,
    durationMs: DEFAULTS.EXECUTION_TIME,
    success: true,
    output,
    executionOrder,
  })

  if (contextExtensions?.onBlockComplete) {
    try {
      await contextExtensions.onBlockComplete(
        blockId,
        blockName,
        blockType,
        {
          output,
          executionTime: DEFAULTS.EXECUTION_TIME,
          startedAt: now,
          executionOrder,
          endedAt: now,
        },
        iterationContext
      )
    } catch (error) {
      logger.warn('Subflow success completion callback failed', {
        blockId,
        blockType,
        error: toError(error).message,
      })
    }
  }
}
