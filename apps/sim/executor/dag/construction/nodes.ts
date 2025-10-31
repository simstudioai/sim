/**
 * NodeConstructor
 *
 * Creates DAG nodes for blocks in the workflow:
 * - Regular blocks → 1:1 mapping
 * - Parallel blocks → Expanded into N branches (blockId₍0₎, blockId₍1₎, etc.)
 * - Loop blocks → Regular nodes with loop metadata
 */

import { createLogger } from '@/lib/logs/console/logger'
import { isMetadataOnlyBlockType } from '@/executor/consts'
import {
  buildBranchNodeId,
  calculateBranchCount,
  parseDistributionItems,
} from '@/executor/utils/subflow-utils'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import type { DAG, DAGNode } from '../builder'

const logger = createLogger('NodeConstructor')

interface ParallelExpansion {
  parallelId: string
  branchCount: number
  distributionItems: any[]
}

export class NodeConstructor {
  /**
   * Create all DAG nodes from workflow blocks
   */
  execute(
    workflow: SerializedWorkflow,
    dag: DAG,
    reachableBlocks: Set<string>
  ): { blocksInLoops: Set<string>; blocksInParallels: Set<string> } {
    const blocksInLoops = new Set<string>()
    const blocksInParallels = new Set<string>()

    this.categorizeBlocks(dag, reachableBlocks, blocksInLoops, blocksInParallels)

    for (const block of workflow.blocks) {
      if (!this.shouldProcessBlock(block, reachableBlocks)) {
        continue
      }

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
   * Check if block should be processed
   */
  private shouldProcessBlock(block: SerializedBlock, reachableBlocks: Set<string>): boolean {
    if (!block.enabled) {
      return false
    }

    if (!reachableBlocks.has(block.id)) {
      logger.debug('Skipping unreachable block', { blockId: block.id })
      return false
    }

    if (isMetadataOnlyBlockType(block.metadata?.id)) {
      logger.debug('Skipping metadata-only block', {
        blockId: block.id,
        blockType: block.metadata?.id,
      })
      return false
    }

    return true
  }

  /**
   * Categorize blocks as belonging to loops or parallels
   */
  private categorizeBlocks(
    dag: DAG,
    reachableBlocks: Set<string>,
    blocksInLoops: Set<string>,
    blocksInParallels: Set<string>
  ): void {
    this.categorizeLoopBlocks(dag, reachableBlocks, blocksInLoops)
    this.categorizeParallelBlocks(dag, reachableBlocks, blocksInParallels)
  }

  /**
   * Categorize blocks belonging to loops
   */
  private categorizeLoopBlocks(
    dag: DAG,
    reachableBlocks: Set<string>,
    blocksInLoops: Set<string>
  ): void {
    for (const [, loopConfig] of dag.loopConfigs) {
      for (const nodeId of loopConfig.nodes) {
        if (reachableBlocks.has(nodeId)) {
          blocksInLoops.add(nodeId)
        }
      }
    }
  }

  /**
   * Categorize blocks belonging to parallels
   */
  private categorizeParallelBlocks(
    dag: DAG,
    reachableBlocks: Set<string>,
    blocksInParallels: Set<string>
  ): void {
    for (const [, parallelConfig] of dag.parallelConfigs) {
      for (const nodeId of parallelConfig.nodes) {
        if (reachableBlocks.has(nodeId)) {
          blocksInParallels.add(nodeId)
        }
      }
    }
  }

  /**
   * Create parallel branch nodes (1 block → N nodes)
   */
  private createParallelBranchNodes(block: SerializedBlock, parallelId: string, dag: DAG): void {
    const expansion = this.calculateParallelExpansion(parallelId, dag)

    logger.debug('Creating parallel branches', {
      blockId: block.id,
      parallelId: expansion.parallelId,
      branchCount: expansion.branchCount,
    })

    for (let branchIndex = 0; branchIndex < expansion.branchCount; branchIndex++) {
      const branchNode = this.createParallelBranchNode(block, branchIndex, expansion)
      dag.nodes.set(branchNode.id, branchNode)
    }
  }

  /**
   * Calculate how many branches to create for a parallel
   */
  private calculateParallelExpansion(parallelId: string, dag: DAG): ParallelExpansion {
    const config = dag.parallelConfigs.get(parallelId)
    if (!config) {
      throw new Error(`Parallel config not found: ${parallelId}`)
    }

    const distributionItems = parseDistributionItems(config)
    const branchCount = calculateBranchCount(config, distributionItems)

    return {
      parallelId,
      branchCount,
      distributionItems,
    }
  }

  /**
   * Create a single parallel branch node
   */
  private createParallelBranchNode(
    baseBlock: SerializedBlock,
    branchIndex: number,
    expansion: ParallelExpansion
  ): DAGNode {
    const branchNodeId = buildBranchNodeId(baseBlock.id, branchIndex)

    return {
      id: branchNodeId,
      block: { ...baseBlock },
      incomingEdges: new Set(),
      outgoingEdges: new Map(),
      metadata: {
        isParallelBranch: true,
        branchIndex,
        branchTotal: expansion.branchCount,
        distributionItem: expansion.distributionItems[branchIndex],
      },
    }
  }

  /**
   * Create regular node or loop node
   */
  private createRegularOrLoopNode(
    block: SerializedBlock,
    blocksInLoops: Set<string>,
    dag: DAG
  ): void {
    const isLoopNode = blocksInLoops.has(block.id)
    const loopId = isLoopNode ? this.findLoopIdForBlock(block.id, dag) : undefined

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
   * Find which loop a block belongs to
   */
  private findLoopIdForBlock(blockId: string, dag: DAG): string | undefined {
    for (const [loopId, loopConfig] of dag.loopConfigs) {
      if (loopConfig.nodes.includes(blockId)) {
        return loopId
      }
    }
    return undefined
  }

  /**
   * Find which parallel a block belongs to
   */
  private findParallelForBlock(blockId: string, dag: DAG): string | null {
    for (const [parallelId, parallelConfig] of dag.parallelConfigs) {
      if (parallelConfig.nodes.includes(blockId)) {
        return parallelId
      }
    }
    return null
  }
}
