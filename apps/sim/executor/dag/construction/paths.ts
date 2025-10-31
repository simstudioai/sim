/**
 * PathConstructor
 * 
 * Constructs the set of reachable paths from the trigger/start block using BFS traversal.
 * Uses ONLY the actual workflow connections (single source of truth).
 * Loop/parallel configs are just metadata - connections determine structure.
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('PathConstructor')

export class PathConstructor {
  /**
   * Find all blocks reachable from trigger using actual connections
   */
  execute(workflow: SerializedWorkflow, startBlockId?: string): Set<string> {
    // Find the trigger block
    const triggerBlockId = this.findTriggerBlock(workflow, startBlockId)

    if (!triggerBlockId) {
      logger.warn('No trigger block found, including all enabled blocks')
      return new Set(workflow.blocks.filter((b) => b.enabled).map((b) => b.id))
    }

    logger.debug('Starting reachability traversal from trigger block', { triggerBlockId })

    // Build adjacency map from ACTUAL connections only
    const adjacency = this.buildAdjacencyMap(workflow)

    // Perform BFS traversal
    const reachable = this.bfsTraversal(triggerBlockId, adjacency)

    logger.debug('Reachability analysis complete', {
      triggerBlockId,
      reachableCount: reachable.size,
      totalBlocks: workflow.blocks.length,
    })

    return reachable
  }

  /**
   * Find a trigger block in the workflow
   */
  private findTriggerBlock(workflow: SerializedWorkflow, startBlockId?: string): string | undefined {
    // Use provided startBlockId if it's a valid trigger
    if (startBlockId) {
      const triggerBlock = workflow.blocks.find((b) => b.id === startBlockId)
      const blockType = triggerBlock?.metadata?.id
      const isTrigger =
        blockType === 'start_trigger' || blockType === 'starter' || blockType === 'trigger'

      if (isTrigger) {
        return startBlockId
      } else {
        logger.warn('Provided startBlockId is not a trigger block, finding trigger automatically', {
          startBlockId,
          blockType,
        })
      }
    }

    // First priority: Find an explicit trigger block
    for (const block of workflow.blocks) {
      const blockType = block.metadata?.id
      if (
        block.enabled &&
        (blockType === 'start_trigger' || blockType === 'starter' || blockType === 'trigger')
      ) {
        logger.debug('Found trigger block', { blockId: block.id, blockType })
        return block.id
      }
    }

    // Second priority: Find a block with no incoming connections
    const hasIncoming = new Set(workflow.connections.map((c) => c.target))

    for (const block of workflow.blocks) {
      const blockType = block.metadata?.id
      if (
        !hasIncoming.has(block.id) &&
        block.enabled &&
        blockType !== 'loop' &&
        blockType !== 'parallel'
      ) {
        logger.debug('Found block with no incoming connections', {
          blockId: block.id,
          blockType,
        })
        return block.id
      }
    }

    return undefined
  }

  /**
   * Build adjacency map from ACTUAL workflow connections
   * No assumptions about loop/parallel structure - just follow the connections!
   */
  private buildAdjacencyMap(workflow: SerializedWorkflow): Map<string, string[]> {
    const adjacency = new Map<string, string[]>()

    for (const conn of workflow.connections) {
      if (!adjacency.has(conn.source)) {
        adjacency.set(conn.source, [])
      }
      adjacency.get(conn.source)!.push(conn.target)
    }

    logger.debug('Built adjacency map from connections', {
      nodeCount: adjacency.size,
      connectionCount: workflow.connections.length,
    })

    return adjacency
  }

  /**
   * Perform BFS traversal to find all reachable blocks
   */
  private bfsTraversal(startBlockId: string, adjacency: Map<string, string[]>): Set<string> {
    const reachable = new Set<string>()
    const queue = [startBlockId]
    reachable.add(startBlockId)

    while (queue.length > 0) {
      const current = queue.shift()!
      const neighbors = adjacency.get(current) || []

      for (const neighbor of neighbors) {
        if (!reachable.has(neighbor)) {
          reachable.add(neighbor)
          queue.push(neighbor)
        }
      }
    }

    logger.debug('BFS traversal complete', {
      startBlockId,
      reachableCount: reachable.size,
      reachableBlocks: Array.from(reachable),
    })

    return reachable
  }
}
