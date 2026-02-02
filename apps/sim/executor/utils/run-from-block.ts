import { LOOP, PARALLEL } from '@/executor/constants'
import type { DAG } from '@/executor/dag/builder'

/**
 * Builds the sentinel-start node ID for a loop.
 */
function buildLoopSentinelStartId(loopId: string): string {
  return `${LOOP.SENTINEL.PREFIX}${loopId}${LOOP.SENTINEL.START_SUFFIX}`
}

/**
 * Builds the sentinel-start node ID for a parallel.
 */
function buildParallelSentinelStartId(parallelId: string): string {
  return `${PARALLEL.SENTINEL.PREFIX}${parallelId}${PARALLEL.SENTINEL.START_SUFFIX}`
}

/**
 * Checks if a block ID is a loop or parallel container and returns the sentinel-start ID if so.
 * Returns null if the block is not a container.
 */
export function resolveContainerToSentinelStart(blockId: string, dag: DAG): string | null {
  if (dag.loopConfigs.has(blockId)) {
    return buildLoopSentinelStartId(blockId)
  }
  if (dag.parallelConfigs.has(blockId)) {
    return buildParallelSentinelStartId(blockId)
  }
  return null
}

/**
 * Result of validating a block for run-from-block execution.
 */
export interface RunFromBlockValidation {
  valid: boolean
  error?: string
}

/**
 * Context for run-from-block execution mode.
 */
export interface RunFromBlockContext {
  /** The block ID to start execution from */
  startBlockId: string
  /** Set of block IDs that need re-execution (start block + all downstream) */
  dirtySet: Set<string>
}

/**
 * Result of computing execution sets for run-from-block mode.
 */
export interface ExecutionSets {
  /** Blocks that need re-execution (start block + all downstream) */
  dirtySet: Set<string>
  /** Blocks that are upstream (ancestors) of the start block */
  upstreamSet: Set<string>
  /** Blocks that are upstream of any dirty block (for snapshot preservation) */
  reachableUpstreamSet: Set<string>
}

/**
 * Computes the dirty set, upstream set, and reachable upstream set.
 * - Dirty set: start block + all blocks reachable via outgoing edges (need re-execution)
 * - Upstream set: all blocks reachable via incoming edges from the start block
 * - Reachable upstream set: all non-dirty blocks that are upstream of ANY dirty block
 *   (includes sibling branches that dirty blocks may reference)
 *
 * For loop/parallel containers, starts from the sentinel-start node and includes
 * the container ID itself in the dirty set.
 *
 * @param dag - The workflow DAG
 * @param startBlockId - The block to start execution from
 * @returns Object containing dirtySet, upstreamSet, and reachableUpstreamSet
 */
export function computeExecutionSets(dag: DAG, startBlockId: string): ExecutionSets {
  const dirty = new Set<string>([startBlockId])
  const upstream = new Set<string>()
  const sentinelStartId = resolveContainerToSentinelStart(startBlockId, dag)
  const traversalStartId = sentinelStartId ?? startBlockId

  if (sentinelStartId) {
    dirty.add(sentinelStartId)
  }

  // BFS downstream for dirty set
  const downstreamQueue = [traversalStartId]
  while (downstreamQueue.length > 0) {
    const nodeId = downstreamQueue.shift()!
    const node = dag.nodes.get(nodeId)
    if (!node) continue

    for (const [, edge] of node.outgoingEdges) {
      if (!dirty.has(edge.target)) {
        dirty.add(edge.target)
        downstreamQueue.push(edge.target)
      }
    }
  }

  // BFS upstream from start block for upstream set
  const upstreamQueue = [traversalStartId]
  while (upstreamQueue.length > 0) {
    const nodeId = upstreamQueue.shift()!
    const node = dag.nodes.get(nodeId)
    if (!node) continue

    for (const sourceId of node.incomingEdges) {
      if (!upstream.has(sourceId)) {
        upstream.add(sourceId)
        upstreamQueue.push(sourceId)
      }
    }
  }

  // Compute reachable upstream: all non-dirty blocks upstream of ANY dirty block
  // This handles the case where a dirty block (like C in A->C, B->C) may reference
  // sibling branches (like B when running from A)
  const reachableUpstream = new Set<string>()
  for (const dirtyNodeId of dirty) {
    const node = dag.nodes.get(dirtyNodeId)
    if (!node) continue

    // BFS upstream from this dirty node
    const queue = [...node.incomingEdges]
    while (queue.length > 0) {
      const sourceId = queue.shift()!
      if (reachableUpstream.has(sourceId) || dirty.has(sourceId)) continue

      reachableUpstream.add(sourceId)
      const sourceNode = dag.nodes.get(sourceId)
      if (sourceNode) {
        queue.push(...sourceNode.incomingEdges)
      }
    }
  }

  return { dirtySet: dirty, upstreamSet: upstream, reachableUpstreamSet: reachableUpstream }
}

/**
 * Validates that a block can be used as a run-from-block starting point.
 *
 * Validation rules:
 * - Block must exist in the DAG (or be a loop/parallel container)
 * - Block cannot be inside a loop (but loop containers are allowed)
 * - Block cannot be inside a parallel (but parallel containers are allowed)
 * - Block cannot be a sentinel node
 * - All upstream dependencies must have been executed (have cached outputs)
 *
 * @param blockId - The block ID to validate
 * @param dag - The workflow DAG
 * @param executedBlocks - Set of blocks that were executed in the source run
 * @returns Validation result with error message if invalid
 */
export function validateRunFromBlock(
  blockId: string,
  dag: DAG,
  executedBlocks: Set<string>
): RunFromBlockValidation {
  const node = dag.nodes.get(blockId)
  const isLoopContainer = dag.loopConfigs.has(blockId)
  const isParallelContainer = dag.parallelConfigs.has(blockId)
  const isContainer = isLoopContainer || isParallelContainer

  if (!node && !isContainer) {
    return { valid: false, error: `Block not found in workflow: ${blockId}` }
  }

  if (isContainer) {
    const sentinelStartId = resolveContainerToSentinelStart(blockId, dag)
    if (!sentinelStartId || !dag.nodes.has(sentinelStartId)) {
      return {
        valid: false,
        error: `Container sentinel not found for: ${blockId}`,
      }
    }
  }

  if (node) {
    if (node.metadata.isLoopNode) {
      return {
        valid: false,
        error: `Cannot run from block inside loop: ${node.metadata.loopId}`,
      }
    }

    if (node.metadata.isParallelBranch) {
      return {
        valid: false,
        error: `Cannot run from block inside parallel: ${node.metadata.parallelId}`,
      }
    }

    if (node.metadata.isSentinel) {
      return { valid: false, error: 'Cannot run from sentinel node' }
    }

    // Check immediate upstream dependencies were executed
    for (const sourceId of node.incomingEdges) {
      const sourceNode = dag.nodes.get(sourceId)
      // Skip sentinel nodes - they're internal and not in executedBlocks
      if (sourceNode?.metadata.isSentinel) continue

      // Skip trigger nodes - they're entry points and don't need prior execution
      // A trigger node has no incoming edges
      if (sourceNode && sourceNode.incomingEdges.size === 0) continue

      if (!executedBlocks.has(sourceId)) {
        return {
          valid: false,
          error: `Upstream dependency not executed: ${sourceId}`,
        }
      }
    }
  }

  return { valid: true }
}
