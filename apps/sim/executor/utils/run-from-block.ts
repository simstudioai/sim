import { createLogger } from '@sim/logger'
import type { DAG } from '@/executor/dag/builder'

const logger = createLogger('run-from-block')

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
 * @param dag - The workflow DAG
 * @param startBlockId - The block to start execution from
 * @returns Set of block IDs that are "dirty" and need re-execution
 */
export function computeDirtySet(dag: DAG, startBlockId: string): Set<string> {
  const dirty = new Set<string>([startBlockId])
  const queue = [startBlockId]

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
    dirtySetSize: dirty.size,
    dirtyBlocks: Array.from(dirty),
  })

  return dirty
}

/**
 * Validates that a block can be used as a run-from-block starting point.
 *
 * Validation rules:
 * - Block must exist in the DAG
 * - Block cannot be inside a loop
 * - Block cannot be inside a parallel
 * - Block cannot be a sentinel node
 * - Block must have been executed in the source run
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

  if (!node) {
    return { valid: false, error: `Block not found in workflow: ${blockId}` }
  }

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

  if (!executedBlocks.has(blockId)) {
    return {
      valid: false,
      error: `Block was not executed in source run: ${blockId}`,
    }
  }

  return { valid: true }
}
