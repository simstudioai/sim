import { LOOP, PARALLEL } from '@/executor/constants'

/**
 * Single source of truth for parsing and building subflow node IDs.
 *
 * Runtime node IDs layer several encodings onto a workflow-level block ID:
 * - Branch subscripts `₍N₎` mark a parallel branch instance.
 * - Loop/parallel sentinels wrap a container ID (`loop-{id}-sentinel-start`).
 * - Outer-branch clone suffixes `__obranch-N` and clone digests `__clone{hex}`
 *   scope a cloned subflow to a global outer parallel branch.
 * - Loop digests `_loopN` scope a block output to a loop iteration.
 *
 * All regexes and string templates for these encodings live here so callers
 * never reconstruct them inline.
 */

const SENTINEL = {
  LOOP_START: new RegExp(`${LOOP.SENTINEL.PREFIX}(.+)${LOOP.SENTINEL.START_SUFFIX}`),
  LOOP_END: new RegExp(`${LOOP.SENTINEL.PREFIX}(.+)${LOOP.SENTINEL.END_SUFFIX}`),
  PARALLEL_START: new RegExp(`${PARALLEL.SENTINEL.PREFIX}(.+)${PARALLEL.SENTINEL.START_SUFFIX}`),
  PARALLEL_END: new RegExp(`${PARALLEL.SENTINEL.PREFIX}(.+)${PARALLEL.SENTINEL.END_SUFFIX}`),
} as const

const BRANCH = {
  MATCH: new RegExp(`${PARALLEL.BRANCH.PREFIX}\\d+${PARALLEL.BRANCH.SUFFIX}$`),
  INDEX: new RegExp(`${PARALLEL.BRANCH.PREFIX}(\\d+)${PARALLEL.BRANCH.SUFFIX}$`),
  SUFFIX: /₍\d+₎/u,
  SUFFIX_GLOBAL: /₍\d+₎/gu,
} as const

const OUTER_BRANCH = {
  MATCH: /__obranch-(\d+)/,
  MATCH_GLOBAL: /__obranch-(\d+)/g,
  STRIP: /__obranch-\d+/g,
} as const

const CLONE = {
  DIGEST_STRIP: /__clone[0-9a-f]+/gi,
  MARKER: '__clone',
} as const

const LOOP_DIGEST = {
  MATCH: /_loop\d+/,
  STRIP: /_loop\d+/g,
} as const

/**
 * Builds the loop sentinel-start node ID for a container.
 */
function buildLoopSentinelStartId(loopId: string): string {
  return `${LOOP.SENTINEL.PREFIX}${loopId}${LOOP.SENTINEL.START_SUFFIX}`
}

/**
 * Builds the loop sentinel-end node ID for a container.
 */
function buildLoopSentinelEndId(loopId: string): string {
  return `${LOOP.SENTINEL.PREFIX}${loopId}${LOOP.SENTINEL.END_SUFFIX}`
}

/**
 * Builds the parallel sentinel-start node ID for a container.
 */
function buildParallelSentinelStartId(parallelId: string): string {
  return `${PARALLEL.SENTINEL.PREFIX}${parallelId}${PARALLEL.SENTINEL.START_SUFFIX}`
}

/**
 * Builds the parallel sentinel-end node ID for a container.
 */
function buildParallelSentinelEndId(parallelId: string): string {
  return `${PARALLEL.SENTINEL.PREFIX}${parallelId}${PARALLEL.SENTINEL.END_SUFFIX}`
}

function isLoopSentinelNodeId(nodeId: string): boolean {
  return (
    nodeId.startsWith(LOOP.SENTINEL.PREFIX) &&
    (nodeId.endsWith(LOOP.SENTINEL.START_SUFFIX) || nodeId.endsWith(LOOP.SENTINEL.END_SUFFIX))
  )
}

function isParallelSentinelNodeId(nodeId: string): boolean {
  return (
    nodeId.startsWith(PARALLEL.SENTINEL.PREFIX) &&
    (nodeId.endsWith(PARALLEL.SENTINEL.START_SUFFIX) ||
      nodeId.endsWith(PARALLEL.SENTINEL.END_SUFFIX))
  )
}

function extractLoopIdFromSentinel(sentinelId: string): string | null {
  const startMatch = sentinelId.match(SENTINEL.LOOP_START)
  if (startMatch) return startMatch[1]
  const endMatch = sentinelId.match(SENTINEL.LOOP_END)
  if (endMatch) return endMatch[1]
  return null
}

function extractParallelIdFromSentinel(sentinelId: string): string | null {
  const startMatch = sentinelId.match(SENTINEL.PARALLEL_START)
  if (startMatch) return startMatch[1]
  const endMatch = sentinelId.match(SENTINEL.PARALLEL_END)
  if (endMatch) return endMatch[1]
  return null
}

function buildBranchNodeId(baseId: string, branchIndex: number): string {
  return `${baseId}${PARALLEL.BRANCH.PREFIX}${branchIndex}${PARALLEL.BRANCH.SUFFIX}`
}

function extractBaseBlockId(branchNodeId: string): string {
  return branchNodeId.replace(BRANCH.MATCH, '')
}

function extractBranchIndex(branchNodeId: string): number | null {
  const match = branchNodeId.match(BRANCH.INDEX)
  return match ? Number.parseInt(match[1], 10) : null
}

function isBranchNodeId(nodeId: string): boolean {
  return BRANCH.MATCH.test(nodeId)
}

function extractOuterBranchIndex(clonedId: string): number | undefined {
  const match = clonedId.match(OUTER_BRANCH.MATCH)
  return match ? Number.parseInt(match[1], 10) : undefined
}

function extractInnermostOuterBranchIndex(clonedId: string): number | undefined {
  const matches = Array.from(clonedId.matchAll(OUTER_BRANCH.MATCH_GLOBAL))
  const lastMatch = matches.at(-1)
  return lastMatch ? Number.parseInt(lastMatch[1], 10) : undefined
}

function stripCloneSuffixes(nodeId: string): string {
  return extractBaseBlockId(nodeId.replace(OUTER_BRANCH.STRIP, '').replace(CLONE.DIGEST_STRIP, ''))
}

function buildOuterBranchScopedId(originalId: string, branchIndex: number): string {
  return `${originalId}__obranch-${branchIndex}`
}

function stripOuterBranchSuffix(id: string): string {
  return id.replace(OUTER_BRANCH.STRIP, '').replace(CLONE.DIGEST_STRIP, '')
}

function hasCloneMarker(id: string): boolean {
  return id.includes(CLONE.MARKER)
}

function normalizeNodeId(nodeId: string): string {
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

function findEffectiveContainerId(
  originalId: string,
  currentNodeId: string,
  executionMap: Map<string, unknown>,
  mappedBranchIndex?: number
): string {
  if (mappedBranchIndex !== undefined && mappedBranchIndex > 0) {
    const cloneSuffix = `__obranch-${mappedBranchIndex}`
    const candidateId = buildOuterBranchScopedId(originalId, mappedBranchIndex)
    if (executionMap.has(candidateId)) {
      return candidateId
    }

    for (const scopeId of executionMap.keys()) {
      if (scopeId.endsWith(cloneSuffix) && stripOuterBranchSuffix(scopeId) === originalId) {
        return scopeId
      }
    }
  }

  const match = currentNodeId.match(OUTER_BRANCH.MATCH)
  if (match) {
    const branchIndex = Number.parseInt(match[1], 10)
    const cloneSuffix = `__obranch-${branchIndex}`
    if (hasCloneMarker(currentNodeId)) {
      for (const scopeId of executionMap.keys()) {
        if (
          hasCloneMarker(scopeId) &&
          scopeId.endsWith(cloneSuffix) &&
          stripOuterBranchSuffix(scopeId) === originalId
        ) {
          return scopeId
        }
      }
    }

    const candidateId = buildOuterBranchScopedId(originalId, branchIndex)
    if (executionMap.has(candidateId)) {
      return candidateId
    }

    for (const scopeId of executionMap.keys()) {
      if (scopeId.endsWith(cloneSuffix) && stripOuterBranchSuffix(scopeId) === originalId) {
        return scopeId
      }
    }
  }

  return originalId
}

/**
 * Strips branch subscripts (`₍N₎`) and loop digests (`_loopN`) from a node ID,
 * yielding the lookup key used by execution-state block-output resolution.
 */
function normalizeLookupId(id: string): string {
  return id.replace(BRANCH.SUFFIX_GLOBAL, '').replace(LOOP_DIGEST.STRIP, '')
}

/**
 * Returns the leading branch subscript (`₍N₎`) of a node ID, or '' when absent.
 */
function extractBranchSuffix(id: string): string {
  return id.match(BRANCH.SUFFIX)?.[0] ?? ''
}

/**
 * Returns the loop digest segment (`_loopN`) of a node ID, or '' when absent.
 */
function extractLoopSuffix(id: string): string {
  return id.match(LOOP_DIGEST.MATCH)?.[0] ?? ''
}

/**
 * Codec exposing all subflow node-ID parsing/building operations as a single,
 * pattern-free interface. Implementation owns every regex and string template.
 */
export const SubflowNodeIdCodec = {
  buildLoopSentinelStartId,
  buildLoopSentinelEndId,
  buildParallelSentinelStartId,
  buildParallelSentinelEndId,
  isLoopSentinelNodeId,
  isParallelSentinelNodeId,
  extractLoopIdFromSentinel,
  extractParallelIdFromSentinel,
  buildBranchNodeId,
  extractBaseBlockId,
  extractBranchIndex,
  isBranchNodeId,
  extractOuterBranchIndex,
  extractInnermostOuterBranchIndex,
  stripCloneSuffixes,
  buildOuterBranchScopedId,
  stripOuterBranchSuffix,
  normalizeNodeId,
  findEffectiveContainerId,
  normalizeLookupId,
  extractBranchSuffix,
  extractLoopSuffix,
} as const
