import { BlockType, isMetadataOnlyBlockType } from '@/executor/constants'
import type { DAG } from '@/executor/dag/builder'
import { buildBranchNodeId } from '@/executor/utils/subflow-utils'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

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
        this.createParallelTemplateNode(block, parallelId, dag)
      } else {
        this.createRegularOrLoopNode(block, blocksInLoops, dag)
      }
    }

    return { blocksInLoops, blocksInParallels, pauseTriggerMapping }
  }

  private shouldProcessBlock(block: SerializedBlock, reachableBlocks: Set<string>): boolean {
    if (!block.enabled) {
      return false
    }

    if (!reachableBlocks.has(block.id)) {
      return false
    }

    if (isMetadataOnlyBlockType(block.metadata?.id)) {
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

  private createParallelTemplateNode(block: SerializedBlock, parallelId: string, dag: DAG): void {
    const templateNodeId = buildBranchNodeId(block.id, 0)
    const blockClone: SerializedBlock = {
      ...block,
      id: templateNodeId,
    }

    dag.nodes.set(templateNodeId, {
      id: templateNodeId,
      block: blockClone,
      incomingEdges: new Set(),
      outgoingEdges: new Map(),
      metadata: {
        isParallelBranch: true,
        parallelId,
        branchIndex: 0,
        branchTotal: 1,
        isPauseResponse: block.metadata?.id === BlockType.HUMAN_IN_THE_LOOP,
        originalBlockId: block.id,
      },
    })
  }

  private createRegularOrLoopNode(
    block: SerializedBlock,
    blocksInLoops: Set<string>,
    dag: DAG
  ): void {
    const isLoopNode = blocksInLoops.has(block.id)
    const loopId = isLoopNode ? this.findLoopIdForBlock(block.id, dag) : undefined
    const isPauseBlock = block.metadata?.id === BlockType.HUMAN_IN_THE_LOOP

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
