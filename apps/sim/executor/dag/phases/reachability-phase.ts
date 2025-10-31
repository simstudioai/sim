/**
 * ReachabilityPhase
 * 
 * Finds all blocks reachable from the trigger/start block using BFS traversal.
 * This ensures we only build DAG nodes for blocks that will actually execute.
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('ReachabilityPhase')

export class ReachabilityPhase {
  /**
   * Find all blocks reachable from a trigger block
   * Uses BFS to traverse the connection graph
   */
  execute(workflow: SerializedWorkflow, startBlockId?: string): Set<string> {
    const reachable = new Set<string>()

    // Find a trigger block to start traversal from
    let triggerBlockId = startBlockId

    // Validate that startBlockId (if provided) is actually a trigger block
    if (triggerBlockId) {
      const triggerBlock = workflow.blocks.find((b) => b.id === triggerBlockId)
      const blockType = triggerBlock?.metadata?.id
      const isTrigger =
        blockType === 'start_trigger' || blockType === 'starter' || blockType === 'trigger'

      if (!isTrigger) {
        logger.warn('Provided startBlockId is not a trigger block, finding trigger automatically', {
          startBlockId: triggerBlockId,
          blockType,
        })
        triggerBlockId = undefined // Clear it and find a valid trigger
      }
    }

    if (!triggerBlockId) {
      triggerBlockId = this.findTriggerBlock(workflow)
    }

    if (!triggerBlockId) {
      logger.warn('No trigger block found, including all enabled blocks')
      return new Set(workflow.blocks.filter((b) => b.enabled).map((b) => b.id))
    }

    logger.debug('Starting reachability traversal from trigger block', { triggerBlockId })

    // Build adjacency map
    const adjacency = this.buildAdjacencyMap(workflow)

    // Perform BFS traversal
    return this.bfsTraversal(triggerBlockId, adjacency)
  }

  /**
   * Find a trigger block in the workflow
   */
  private findTriggerBlock(workflow: SerializedWorkflow): string | undefined {
    // First priority: Find an explicit trigger block
    for (const block of workflow.blocks) {
      const blockType = block.metadata?.id
      if (
        block.enabled &&
        (blockType === 'start_trigger' || blockType === 'starter' || blockType === 'trigger')
      ) {
        logger.debug('Found trigger block for reachability traversal', {
          blockId: block.id,
          blockType,
        })
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
        logger.debug('Found block with no incoming connections as trigger', {
          blockId: block.id,
          blockType,
        })
        return block.id
      }
    }

    return undefined
  }

  /**
   * Build adjacency map including loop/parallel internal connections
   */
  private buildAdjacencyMap(workflow: SerializedWorkflow): Map<string, string[]> {
    const adjacency = new Map<string, string[]>()

    // Add explicit connections
    for (const conn of workflow.connections) {
      if (!adjacency.has(conn.source)) {
        adjacency.set(conn.source, [])
      }
      adjacency.get(conn.source)!.push(conn.target)
    }

    // Find reachable loop/parallel blocks first
    const { reachableLoopBlocks, reachableParallelBlocks } = this.findReachableLoopsAndParallels(
      workflow,
      adjacency
    )

    // Add loop internal connections (only for reachable loops)
    if (workflow.loops) {
      for (const [loopId, loopConfig] of Object.entries(workflow.loops)) {
        if (reachableLoopBlocks.has(loopId)) {
          const nodes = (loopConfig as any).nodes || []
          
          // Add connections within loop
          for (let i = 0; i < nodes.length - 1; i++) {
            if (!adjacency.has(nodes[i])) {
              adjacency.set(nodes[i], [])
            }
            adjacency.get(nodes[i])!.push(nodes[i + 1])
          }

          // Loop block itself connects to first node
          if (nodes.length > 0) {
            if (!adjacency.has(loopId)) {
              adjacency.set(loopId, [])
            }
            adjacency.get(loopId)!.push(nodes[0])
          }
        }
      }
    }

    return adjacency
  }

  /**
   * Find reachable loop and parallel blocks
   */
  private findReachableLoopsAndParallels(
    workflow: SerializedWorkflow,
    adjacency: Map<string, string[]>
  ): { reachableLoopBlocks: Set<string>; reachableParallelBlocks: Set<string> } {
    const reachableLoopBlocks = new Set<string>()
    const reachableParallelBlocks = new Set<string>()

    // Find a trigger to start from
    const triggerBlockId = this.findTriggerBlock(workflow)
    if (!triggerBlockId) {
      return { reachableLoopBlocks, reachableParallelBlocks }
    }

    const tempQueue = [triggerBlockId]
    const tempReachable = new Set([triggerBlockId])

    while (tempQueue.length > 0) {
      const current = tempQueue.shift()!
      const neighbors = adjacency.get(current) || []

      for (const neighbor of neighbors) {
        if (!tempReachable.has(neighbor)) {
          tempReachable.add(neighbor)
          tempQueue.push(neighbor)

          // Track if this is a loop or parallel block
          if (workflow.loops && (workflow.loops as any)[neighbor]) {
            reachableLoopBlocks.add(neighbor)
          }
          if (workflow.parallels && (workflow.parallels as any)[neighbor]) {
            reachableParallelBlocks.add(neighbor)
          }
        }
      }
    }

    logger.debug('Reachable loops and parallels:', {
      reachableLoops: Array.from(reachableLoopBlocks),
      reachableParallels: Array.from(reachableParallelBlocks),
    })

    return { reachableLoopBlocks, reachableParallelBlocks }
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
    })

    return reachable
  }
}

