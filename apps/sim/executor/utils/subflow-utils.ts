/**
 * Subflow Utilities
 * 
 * Common utilities for loop and parallel (subflow) configurations.
 * Consolidates logic for:
 * - Loop sentinel ID construction
 * - Parallel branch ID construction
 * - Distribution item parsing
 * - Branch count calculation
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { SerializedParallel } from '@/serializer/types'
import { LOOP, PARALLEL, REFERENCE } from '@/executor/consts'

const logger = createLogger('SubflowUtils')

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

/**
 * Extract loop ID from sentinel node ID
 * Example: "loop-abc123-sentinel-start" → "abc123"
 */
export function extractLoopIdFromSentinel(sentinelId: string): string | null {
  const startMatch = sentinelId.match(
    new RegExp(`${LOOP.SENTINEL.PREFIX}(.+)${LOOP.SENTINEL.START_SUFFIX}`)
  )
  if (startMatch) return startMatch[1]
  
  const endMatch = sentinelId.match(
    new RegExp(`${LOOP.SENTINEL.PREFIX}(.+)${LOOP.SENTINEL.END_SUFFIX}`)
  )
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
 * Handles: arrays, JSON strings, and references
 */
export function parseDistributionItems(config: SerializedParallel): any[] {
  const rawItems = config.distribution ?? []

  // If it's a reference (e.g., <block.output>), return empty (will be resolved at runtime)
  if (typeof rawItems === 'string' && rawItems.startsWith(REFERENCE.START)) {
    return []
  }

  // If it's a JSON string, parse it
  if (typeof rawItems === 'string') {
    try {
      const normalizedJSON = rawItems.replace(/'/g, '"')
      return JSON.parse(normalizedJSON)
    } catch (error) {
      logger.error('Failed to parse distribution items', { 
        rawItems,
        error: error instanceof Error ? error.message : String(error)
      })
      return []
    }
  }

  // If it's already an array
  if (Array.isArray(rawItems)) {
    return rawItems
  }

  // If it's an object, wrap in array
  if (typeof rawItems === 'object' && rawItems !== null) {
    return [rawItems]
  }

  return []
}

/**
 * Calculate branch count from parallel config
 */
export function calculateBranchCount(
  config: SerializedParallel, 
  distributionItems: any[]
): number {
  const explicitCount = config.count ?? PARALLEL.DEFAULT_COUNT
  
  // For collection type, use distribution item count
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

/**
 * Extract base block ID from branch ID
 * Example: "blockId₍2₎" → "blockId"
 */
export function extractBaseBlockId(branchNodeId: string): string {
  const branchPattern = new RegExp(`${PARALLEL.BRANCH.PREFIX}\\d+${PARALLEL.BRANCH.SUFFIX}$`)
  return branchNodeId.replace(branchPattern, '')
}

/**
 * Extract branch index from branch node ID
 * Example: "blockId₍2₎" → 2
 */
export function extractBranchIndex(branchNodeId: string): number | null {
  const match = branchNodeId.match(
    new RegExp(`${PARALLEL.BRANCH.PREFIX}(\\d+)${PARALLEL.BRANCH.SUFFIX}$`)
  )
  return match ? parseInt(match[1], 10) : null
}

/**
 * Check if a node ID is a branch node
 */
export function isBranchNodeId(nodeId: string): boolean {
  const branchPattern = new RegExp(`${PARALLEL.BRANCH.PREFIX}\\d+${PARALLEL.BRANCH.SUFFIX}$`)
  return branchPattern.test(nodeId)
}

