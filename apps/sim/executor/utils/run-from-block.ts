import { createLogger } from '@sim/logger'
import { LOOP, PARALLEL } from '@/executor/constants'
import type { DAG } from '@/executor/dag/builder'

const logger = createLogger('run-from-block')

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
 * Computes all blocks that need re-execution when running from a specific block.
 * Uses BFS to find all downstream blocks reachable via outgoing edges.
 *
 * For loop/parallel containers, starts from the sentinel-start node and includes
 * the container ID itself in the dirty set.
 *
 * @param dag - The workflow DAG
 * @param startBlockId - The block to start execution from
 * @returns Set of block IDs that are "dirty" and need re-execution
 */
export function computeDirtySet(dag: DAG, startBlockId: string): Set<string> {
  const dirty = new Set<string>([startBlockId])

  // For loop/parallel containers, resolve to sentinel-start for BFS traversal
  const sentinelStartId = resolveContainerToSentinelStart(startBlockId, dag)
  const traversalStartId = sentinelStartId ?? startBlockId

  if (sentinelStartId) {
    dirty.add(sentinelStartId)
  }

  const queue = [traversalStartId]

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    const node = dag.nodes.get(nodeId)
    if (!node) continue

    for (const [, edge] of node.outgoingEdges) {
      if (!dirty.has(edge.target)) {
        dirty.add(edge.target)
        queue.push(edge.target)
      }
    }
  }

  logger.debug('Computed dirty set', {
    startBlockId,
    traversalStartId,
    dirtySetSize: dirty.size,
    dirtyBlocks: Array.from(dirty),
  })

  return dirty
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

  // Check if this is a loop or parallel container (not in dag.nodes but in configs)
  const isLoopContainer = dag.loopConfigs.has(blockId)
  const isParallelContainer = dag.parallelConfigs.has(blockId)
  const isContainer = isLoopContainer || isParallelContainer

  if (!node && !isContainer) {
    return { valid: false, error: `Block not found in workflow: ${blockId}` }
  }

  // For containers, verify the sentinel-start exists
  if (isContainer) {
    const sentinelStartId = resolveContainerToSentinelStart(blockId, dag)
    if (!sentinelStartId || !dag.nodes.has(sentinelStartId)) {
      return {
        valid: false,
        error: `Container sentinel not found for: ${blockId}`,
      }
    }
  }

  // For regular nodes, check if inside loop/parallel
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

    // Check if all upstream dependencies have been executed (have cached outputs)
    // If no incoming edges (trigger/start block), dependencies are satisfied
    if (node.incomingEdges.size > 0) {
      for (const sourceId of node.incomingEdges.keys()) {
        if (!executedBlocks.has(sourceId)) {
          return {
            valid: false,
            error: `Upstream dependency not executed: ${sourceId}`,
          }
        }
      }
    }
  }

  return { valid: true }
}
