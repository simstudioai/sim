import { createLogger } from '@/lib/logs/console/logger'
import { LOOP, PARALLEL, PARSING, REFERENCE } from '@/executor/consts'
import type { SerializedParallel } from '@/serializer/types'

const logger = createLogger('SubflowUtils')

const BRANCH_PATTERN = new RegExp(`${PARALLEL.BRANCH.PREFIX}\\d+${PARALLEL.BRANCH.SUFFIX}$`)
const BRANCH_INDEX_PATTERN = new RegExp(`${PARALLEL.BRANCH.PREFIX}(\\d+)${PARALLEL.BRANCH.SUFFIX}$`)
const SENTINEL_START_PATTERN = new RegExp(
  `${LOOP.SENTINEL.PREFIX}(.+)${LOOP.SENTINEL.START_SUFFIX}`
)
const SENTINEL_END_PATTERN = new RegExp(`${LOOP.SENTINEL.PREFIX}(.+)${LOOP.SENTINEL.END_SUFFIX}`)
/**
 * ==================
 * LOOP UTILITIES
 * ==================
 */
/**
 * Build sentinel start node ID
 */
export function buildSentinelStartId(loopId: string): string {
  return `${LOOP.SENTINEL.PREFIX}${loopId}${LOOP.SENTINEL.START_SUFFIX}`
}
/**
 * Build sentinel end node ID
 */
export function buildSentinelEndId(loopId: string): string {
  return `${LOOP.SENTINEL.PREFIX}${loopId}${LOOP.SENTINEL.END_SUFFIX}`
}
/**
 * Check if a node ID is a sentinel node
 */
export function isSentinelNodeId(nodeId: string): boolean {
  return nodeId.includes(LOOP.SENTINEL.START_SUFFIX) || nodeId.includes(LOOP.SENTINEL.END_SUFFIX)
}

export function extractLoopIdFromSentinel(sentinelId: string): string | null {
  const startMatch = sentinelId.match(SENTINEL_START_PATTERN)
  if (startMatch) return startMatch[1]
  const endMatch = sentinelId.match(SENTINEL_END_PATTERN)
  if (endMatch) return endMatch[1]
  return null
}
/**
 * ==================
 * PARALLEL UTILITIES
 * ==================
 */
/**
 * Parse distribution items from parallel config
 * Handles: arrays, JSON strings, objects, and references
 * Note: References (starting with '<') cannot be resolved at DAG construction time,
 * they must be resolved at runtime. This function returns [] for references.
 */
export function parseDistributionItems(config: SerializedParallel): any[] {
  const rawItems = config.distribution ?? []

  // Already an array - return as-is
  if (Array.isArray(rawItems)) {
    return rawItems
  }

  // Object - convert to entries array (consistent with loop forEach behavior)
  if (typeof rawItems === 'object' && rawItems !== null) {
    return Object.entries(rawItems)
  }

  // String handling
  if (typeof rawItems === 'string') {
    // References cannot be resolved at DAG construction time
    if (rawItems.startsWith(REFERENCE.START) && rawItems.endsWith(REFERENCE.END)) {
      return []
    }

    // Try to parse as JSON
    try {
      const normalizedJSON = rawItems.replace(/'/g, '"')
      const parsed = JSON.parse(normalizedJSON)
      if (Array.isArray(parsed)) {
        return parsed
      }
      // Parsed to non-array (e.g. object) - convert to entries
      if (typeof parsed === 'object' && parsed !== null) {
        return Object.entries(parsed)
      }
      return []
    } catch (error) {
      logger.error('Failed to parse distribution items', {
        rawItems,
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }

  return []
}
/**
 * Calculate branch count from parallel config
 */
export function calculateBranchCount(config: SerializedParallel, distributionItems: any[]): number {
  const explicitCount = config.count ?? PARALLEL.DEFAULT_COUNT
  if (config.parallelType === PARALLEL.TYPE.COLLECTION && distributionItems.length > 0) {
    return distributionItems.length
  }
  return explicitCount
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
  return isSentinelNodeId(nodeId) || nodeId.startsWith(LOOP.SENTINEL.PREFIX)
}

export function isParallelNode(nodeId: string): boolean {
  return isBranchNodeId(nodeId)
}

export function normalizeNodeId(nodeId: string): string {
  if (isBranchNodeId(nodeId)) {
    return extractBaseBlockId(nodeId)
  }
  if (isSentinelNodeId(nodeId)) {
    return extractLoopIdFromSentinel(nodeId) || nodeId
  }
  return nodeId
}
