import { createLogger } from '@sim/logger'
import { LOOP, PARALLEL, PARSING, REFERENCE } from '@/executor/constants'
import type { ContextExtensions } from '@/executor/execution/types'
import { type BlockLog, type ExecutionContext, getNextExecutionOrder } from '@/executor/types'
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
  return nodeId.includes(LOOP.SENTINEL.START_SUFFIX) || nodeId.includes(LOOP.SENTINEL.END_SUFFIX)
}

export function isParallelSentinelNodeId(nodeId: string): boolean {
  return (
    nodeId.includes(PARALLEL.SENTINEL.START_SUFFIX) || nodeId.includes(PARALLEL.SENTINEL.END_SUFFIX)
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
  return match ? Number.parseInt(match[1], PARSING.JSON_RADIX) : null
}

export function isBranchNodeId(nodeId: string): boolean {
  return BRANCH_PATTERN.test(nodeId)
}

export function isLoopNode(nodeId: string): boolean {
  return isLoopSentinelNodeId(nodeId) || nodeId.startsWith(LOOP.SENTINEL.PREFIX)
}

export function isParallelNode(nodeId: string): boolean {
  return isBranchNodeId(nodeId) || isParallelSentinelNodeId(nodeId)
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
export function addSubflowErrorLog(
  ctx: ExecutionContext,
  blockId: string,
  blockType: 'loop' | 'parallel',
  errorMessage: string,
  inputData: Record<string, any>,
  contextExtensions: ContextExtensions | null
): void {
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
    contextExtensions.onBlockStart(blockId, blockName, blockType, execOrder)
  }

  if (contextExtensions?.onBlockComplete) {
    contextExtensions.onBlockComplete(blockId, blockName, blockType, {
      input: inputData,
      output: { error: errorMessage },
      executionTime: 0,
      startedAt: now,
      executionOrder: execOrder,
      endedAt: now,
    })
  }
}
