import { createLogger } from '@/lib/logs/console/logger'
import { BlockType, isMetadataOnlyBlockType } from '@/executor/consts'
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
  execute(
    workflow: SerializedWorkflow,
    dag: DAG,
    reachableBlocks: Set<string>
  ): {
    blocksInLoops: Set<string>
    blocksInParallels: Set<string>
    pauseTriggerMapping: Map<string, string>
  } {
    const blocksInLoops = new Set<string>()
    const blocksInParallels = new Set<string>()
    const pauseTriggerMapping = new Map<string, string>()
    this.categorizeBlocks(dag, reachableBlocks, blocksInLoops, blocksInParallels)
    for (const block of workflow.blocks) {
      if (!this.shouldProcessBlock(block, reachableBlocks)) {
        continue
      }
      const parallelId = this.findParallelForBlock(block.id, dag)
      if (parallelId) {
        this.createParallelBranchNodes(block, parallelId, dag, pauseTriggerMapping)
      } else {
        this.createRegularOrLoopNode(block, blocksInLoops, dag, pauseTriggerMapping)
      }
    }
    return { blocksInLoops, blocksInParallels, pauseTriggerMapping }
  }

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

  private categorizeBlocks(
    dag: DAG,
    reachableBlocks: Set<string>,
    blocksInLoops: Set<string>,
    blocksInParallels: Set<string>
  ): void {
    this.categorizeLoopBlocks(dag, reachableBlocks, blocksInLoops)
    this.categorizeParallelBlocks(dag, reachableBlocks, blocksInParallels)
  }

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

  private createParallelBranchNodes(
    block: SerializedBlock,
    parallelId: string,
    dag: DAG,
    pauseTriggerMapping: Map<string, string>
  ): void {
    const expansion = this.calculateParallelExpansion(parallelId, dag)
    logger.debug('Creating parallel branches', {
      blockId: block.id,
      parallelId: expansion.parallelId,
      branchCount: expansion.branchCount,
    })
    for (let branchIndex = 0; branchIndex < expansion.branchCount; branchIndex++) {
      const branchNode = this.createParallelBranchNode(block, branchIndex, expansion)
      dag.nodes.set(branchNode.id, branchNode)

      if (block.metadata?.id === BlockType.PAUSE_RESUME) {
        const triggerId = `${branchNode.id}__trigger`
        const triggerNode = this.createTriggerNode(block, triggerId, {
          isParallelBranch: true,
          parallelId: expansion.parallelId,
          branchIndex,
          branchTotal: expansion.branchCount,
          loopId: branchNode.metadata.loopId,
        })
        dag.nodes.set(triggerId, triggerNode)
        pauseTriggerMapping.set(branchNode.id, triggerId)
      }
    }
  }

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

  private createParallelBranchNode(
    baseBlock: SerializedBlock,
    branchIndex: number,
    expansion: ParallelExpansion
  ): DAGNode {
    const branchNodeId = buildBranchNodeId(baseBlock.id, branchIndex)
    const blockClone: SerializedBlock = {
      ...baseBlock,
      id: branchNodeId,
    }
    return {
      id: branchNodeId,
      block: blockClone,
      incomingEdges: new Set(),
      outgoingEdges: new Map(),
      metadata: {
        isParallelBranch: true,
        parallelId: expansion.parallelId,
        branchIndex,
        branchTotal: expansion.branchCount,
        distributionItem: expansion.distributionItems[branchIndex],
        isPauseResponse: baseBlock.metadata?.id === BlockType.PAUSE_RESUME,
        originalBlockId: baseBlock.id,
      },
    }
  }

  private createRegularOrLoopNode(
    block: SerializedBlock,
    blocksInLoops: Set<string>,
    dag: DAG,
    pauseTriggerMapping: Map<string, string>
  ): void {
    const isLoopNode = blocksInLoops.has(block.id)
    const loopId = isLoopNode ? this.findLoopIdForBlock(block.id, dag) : undefined
    const isPauseBlock = block.metadata?.id === BlockType.PAUSE_RESUME
    dag.nodes.set(block.id, {
      id: block.id,
      block,
      incomingEdges: new Set(),
      outgoingEdges: new Map(),
      metadata: {
        isLoopNode,
        loopId,
        isPauseResponse: isPauseBlock,
        originalBlockId: block.id,
      },
    })

    if (isPauseBlock) {
      const triggerId = `${block.id}__trigger`
      const triggerNode = this.createTriggerNode(block, triggerId, {
        loopId,
      })
      dag.nodes.set(triggerId, triggerNode)
      pauseTriggerMapping.set(block.id, triggerId)
    }
  }

  private createTriggerNode(
    block: SerializedBlock,
    triggerId: string,
    options: {
      loopId?: string
      isParallelBranch?: boolean
      parallelId?: string
      branchIndex?: number
      branchTotal?: number
    }
  ): DAGNode {
    const triggerBlock: SerializedBlock = {
      ...block,
      id: triggerId,
      enabled: true,
    }

    return {
      id: triggerId,
      block: triggerBlock,
      incomingEdges: new Set(),
      outgoingEdges: new Map(),
      metadata: {
        isResumeTrigger: true,
        originalBlockId: block.id,
        loopId: options.loopId,
        isParallelBranch: options.isParallelBranch,
        parallelId: options.parallelId,
        branchIndex: options.branchIndex,
        branchTotal: options.branchTotal,
      },
    }
  }

  private findLoopIdForBlock(blockId: string, dag: DAG): string | undefined {
    for (const [loopId, loopConfig] of dag.loopConfigs) {
      if (loopConfig.nodes.includes(blockId)) {
        return loopId
      }
    }
    return undefined
  }

  private findParallelForBlock(blockId: string, dag: DAG): string | null {
    for (const [parallelId, parallelConfig] of dag.parallelConfigs) {
      if (parallelConfig.nodes.includes(blockId)) {
        return parallelId
      }
    }
    return null
  }
}
