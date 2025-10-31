/**
 * NodeCreationPhase
 * 
 * Creates DAG nodes for blocks in the workflow.
 * Handles:
 * - Regular blocks (1:1 mapping)
 * - Parallel blocks (expands into N branches: blockId₍0₎, blockId₍1₎, etc.)
 * - Loop blocks (preserves original IDs, marked with loop metadata)
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { SerializedWorkflow } from '@/serializer/types'
import type { DAG } from '../dag-builder'

const logger = createLogger('NodeCreationPhase')

export class NodeCreationPhase {
  /**
   * Create all DAG nodes
   */
  execute(
    workflow: SerializedWorkflow,
    dag: DAG,
    reachableBlocks: Set<string>
  ): { blocksInLoops: Set<string>; blocksInParallels: Set<string> } {
    const blocksInLoops = new Set<string>()
    const blocksInParallels = new Set<string>()

    // Determine which blocks are in loops vs parallels
    this.categorizeBlocks(dag, reachableBlocks, blocksInLoops, blocksInParallels)

    // Create nodes for each block
    for (const block of workflow.blocks) {
      if (!block.enabled) continue

      // Skip unreachable blocks
      if (!reachableBlocks.has(block.id)) {
        logger.debug('Skipping unreachable block:', block.id)
        continue
      }

      // Skip loop and parallel blocks - they're metadata only, not executable nodes
      if (block.metadata?.id === 'loop' || block.metadata?.id === 'parallel') {
        logger.debug('Skipping loop/parallel block (metadata only):', block.id)
        continue
      }

      // Check if this block is in a parallel
      const parallelId = this.findParallelForBlock(block.id, dag)

      if (parallelId) {
        this.createParallelBranchNodes(block, parallelId, dag)
      } else {
        this.createRegularOrLoopNode(block, blocksInLoops, dag)
      }
    }

    return { blocksInLoops, blocksInParallels }
  }

  /**
   * Categorize blocks into loops and parallels
   */
  private categorizeBlocks(
    dag: DAG,
    reachableBlocks: Set<string>,
    blocksInLoops: Set<string>,
    blocksInParallels: Set<string>
  ): void {
    for (const [loopId, loopConfig] of dag.loopConfigs) {
      for (const nodeId of (loopConfig as any).nodes || []) {
        if (reachableBlocks.has(nodeId)) {
          blocksInLoops.add(nodeId)
        }
      }
    }

    for (const [parallelId, parallelConfig] of dag.parallelConfigs) {
      for (const nodeId of (parallelConfig as any).nodes || []) {
        if (reachableBlocks.has(nodeId)) {
          blocksInParallels.add(nodeId)
        }
      }
    }
  }

  /**
   * Create parallel branch nodes (expand into N branches)
   */
  private createParallelBranchNodes(block: any, parallelId: string, dag: DAG): void {
    const parallelConfig = dag.parallelConfigs.get(parallelId) as any

    logger.debug('Expanding parallel:', {
      parallelId,
      config: parallelConfig,
    })

    let distributionItems = parallelConfig.distributionItems || parallelConfig.distribution || []

    // Parse if string
    if (typeof distributionItems === 'string' && !distributionItems.startsWith('<')) {
      try {
        distributionItems = JSON.parse(distributionItems.replace(/'/g, '"'))
      } catch (e) {
        logger.error('Failed to parse parallel distribution:', distributionItems)
        distributionItems = []
      }
    }

    // Calculate branch count
    let count = parallelConfig.parallelCount || parallelConfig.count || 1
    if (parallelConfig.parallelType === 'collection' && Array.isArray(distributionItems)) {
      count = distributionItems.length
    }

    logger.debug('Creating parallel branches:', {
      parallelId,
      count,
      parsedDistributionItems: distributionItems,
      distributionItemsLength: Array.isArray(distributionItems) ? distributionItems.length : 0,
    })

    // Create a node for each branch
    for (let branchIndex = 0; branchIndex < count; branchIndex++) {
      const branchNodeId = `${block.id}₍${branchIndex}₎`

      dag.nodes.set(branchNodeId, {
        id: branchNodeId,
        block: { ...block },
        incomingEdges: new Set(),
        outgoingEdges: new Map(),
        metadata: {
          isParallelBranch: true,
          branchIndex,
          branchTotal: count,
          distributionItem: distributionItems[branchIndex],
        },
      })
    }
  }

  /**
   * Create regular or loop node
   */
  private createRegularOrLoopNode(block: any, blocksInLoops: Set<string>, dag: DAG): void {
    const isLoopNode = blocksInLoops.has(block.id)
    let loopId: string | undefined

    if (isLoopNode) {
      for (const [lid, lconfig] of dag.loopConfigs) {
        if ((lconfig as any).nodes.includes(block.id)) {
          loopId = lid
          break
        }
      }
    }

    dag.nodes.set(block.id, {
      id: block.id,
      block,
      incomingEdges: new Set(),
      outgoingEdges: new Map(),
      metadata: {
        isLoopNode,
        loopId,
      },
    })
  }

  /**
   * Find which parallel a block belongs to
   */
  private findParallelForBlock(blockId: string, dag: DAG): string | null {
    for (const [parallelId, parallelConfig] of dag.parallelConfigs) {
      if ((parallelConfig as any).nodes.includes(blockId)) {
        return parallelId
      }
    }
    return null
  }
}

