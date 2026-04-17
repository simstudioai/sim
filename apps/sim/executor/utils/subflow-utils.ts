import { createLogger } from '@sim/logger'
import { DEFAULTS, LOOP, PARALLEL, REFERENCE } from '@/executor/constants'
import type { ContextExtensions } from '@/executor/execution/types'
import { type BlockLog, type ExecutionContext, getNextExecutionOrder } from '@/executor/types'
import { buildContainerIterationContext } from '@/executor/utils/iteration-context'
import type { VariableResolver } from '@/executor/variables/resolver'

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
const CLONE_SEQ_STRIP_PATTERN = /__clone\d+/g

/**
 * Extracts the outer branch index from a cloned subflow ID.
 * Cloned IDs follow the pattern `{originalId}__obranch-{index}`.
 * Returns undefined if the ID is not a clone.
 */
export function extractOuterBranchIndex(clonedId: string): number | undefined {
  const match = clonedId.match(OUTER_BRANCH_PATTERN)
  return match ? Number.parseInt(match[1], 10) : undefined
}

/**
 * Strips all clone suffixes (`__obranch-N`) and branch subscripts (`₍N₎`)
 * from a node ID, returning the original workflow-level block ID.
 */
export function stripCloneSuffixes(nodeId: string): string {
  return extractBaseBlockId(
    nodeId.replace(OUTER_BRANCH_STRIP_PATTERN, '').replace(CLONE_SEQ_STRIP_PATTERN, '')
  )
}

/**
 * Builds a cloned subflow ID from an original ID and outer branch index.
 */
export function buildClonedSubflowId(originalId: string, branchIndex: number): string {
  return `${originalId}__obranch-${branchIndex}`
}

/**
 * Strips outer-branch clone suffixes (`__obranch-N`) from an ID,
 * returning the original workflow-level subflow ID.
 */
export function stripOuterBranchSuffix(id: string): string {
  return id.replace(OUTER_BRANCH_STRIP_PATTERN, '').replace(CLONE_SEQ_STRIP_PATTERN, '')
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
  executionMap: Map<string, unknown>
): string {
  // Prefer the cloned variant when currentNodeId carries an __obranch-N suffix.
  // During concurrent parallel-in-loop execution both the original (branch 0)
  // and cloned variants coexist in the map; the clone is the correct scope.
  const match = currentNodeId.match(OUTER_BRANCH_PATTERN)
  if (match) {
    const candidateId = buildClonedSubflowId(originalId, Number.parseInt(match[1], 10))
    if (executionMap.has(candidateId)) {
      return candidateId
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

/**
 * Validates that a count doesn't exceed a maximum limit.
 * Returns an error message if validation fails, undefined otherwise.
 */
export function validateMaxCount(count: number, max: number, itemType: string): string | undefined {
  if (count > max) {
    return `${itemType} (${count}) exceeds maximum allowed (${max}). Execution blocked.`
  }
  return undefined
}

/**
 * Resolves array input at runtime. Handles arrays, objects, references, and JSON strings.
 * Used by both loop forEach and parallel distribution resolution.
 * Throws an error if resolution fails.
 */
export function resolveArrayInput(
  ctx: ExecutionContext,
  items: any,
  resolver: VariableResolver | null
): any[] {
  if (Array.isArray(items)) {
    return items
  }

  if (typeof items === 'object' && items !== null) {
    return Object.entries(items)
  }

  if (typeof items === 'string') {
    if (items.startsWith(REFERENCE.START) && items.endsWith(REFERENCE.END) && resolver) {
      try {
        const resolved = resolver.resolveSingleReference(ctx, '', items)
        if (Array.isArray(resolved)) {
          return resolved
        }
        if (typeof resolved === 'object' && resolved !== null) {
          return Object.entries(resolved)
        }
        if (resolved === null) {
          return []
        }
        throw new Error(`Reference "${items}" did not resolve to an array or object`)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Reference "')) {
          throw error
        }
        throw new Error(
          `Failed to resolve reference "${items}": ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    try {
      const normalized = items.replace(/'/g, '"')
      const parsed = JSON.parse(normalized)
      if (Array.isArray(parsed)) {
        return parsed
      }
      if (typeof parsed === 'object' && parsed !== null) {
        return Object.entries(parsed)
      }
      throw new Error(`Parsed value is not an array or object`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Parsed value')) {
        throw error
      }
      throw new Error(`Failed to parse items as JSON: "${items}"`)
    }
  }

  if (resolver) {
    try {
      const resolved = resolver.resolveInputs(ctx, 'subflow_items', { items }).items
      if (Array.isArray(resolved)) {
        return resolved
      }
      throw new Error(`Resolved items is not an array`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Resolved items')) {
        throw error
      }
      throw new Error(
        `Failed to resolve items: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  return []
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
        error: error instanceof Error ? error.message : String(error),
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
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * Emits block log + SSE events for a loop/parallel that was skipped due to an
 * empty collection or false initial condition. This ensures the container block
 * appears in terminal logs, execution snapshots, and edge highlighting.
 */
export async function emitEmptySubflowEvents(
  ctx: ExecutionContext,
  blockId: string,
  blockType: 'loop' | 'parallel',
  contextExtensions: ContextExtensions | null
): Promise<void> {
  const now = new Date().toISOString()
  const executionOrder = getNextExecutionOrder(ctx)
  const output = { results: [] }
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

  if (contextExtensions?.onBlockStart) {
    try {
      await contextExtensions.onBlockStart(blockId, blockName, blockType, executionOrder)
    } catch (error) {
      logger.warn('Empty subflow start callback failed', {
        blockId,
        blockType,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

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
      logger.warn('Empty subflow completion callback failed', {
        blockId,
        blockType,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * Emits the BlockLog + onBlockComplete callback for a loop/parallel container that
 * finished successfully with at least one iteration. Without this, successful container
 * runs produce no top-level BlockLog, which forces the trace-span builder to fall back
 * to generic counter-based names ("Loop 1", "Parallel 1") instead of the user-configured
 * block name.
 */
export async function emitSubflowSuccessEvents(
  ctx: ExecutionContext,
  blockId: string,
  blockType: 'loop' | 'parallel',
  output: { results: any[] },
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
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
