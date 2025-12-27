import { createLogger } from '@sim/logger'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { SerializedBlock } from '@/serializer/types'
import {
  buildBranchNodeId,
  buildParallelSentinelEndId,
  buildParallelSentinelStartId,
  extractBaseBlockId,
} from './subflow-utils'

const logger = createLogger('ParallelExpansion')

export interface ExpansionResult {
  entryNodes: string[]
  terminalNodes: string[]
  allBranchNodes: string[]
}

export class ParallelExpander {
  expandParallel(
    dag: DAG,
    parallelId: string,
    branchCount: number,
    distributionItems?: any[]
  ): ExpansionResult {
    const config = dag.parallelConfigs.get(parallelId)
    if (!config) {
      throw new Error(`Parallel config not found: ${parallelId}`)
    }

    const blocksInParallel = config.nodes || []
    if (blocksInParallel.length === 0) {
      return { entryNodes: [], terminalNodes: [], allBranchNodes: [] }
    }

    const blocksSet = new Set(blocksInParallel)
    const allBranchNodes: string[] = []

    for (const blockId of blocksInParallel) {
      const templateId = buildBranchNodeId(blockId, 0)
      const templateNode = dag.nodes.get(templateId)

      if (!templateNode) {
        logger.warn('Template node not found', { blockId, templateId })
        continue
      }

      for (let i = 0; i < branchCount; i++) {
        const branchNodeId = buildBranchNodeId(blockId, i)
        allBranchNodes.push(branchNodeId)

        if (i === 0) {
          this.updateBranchMetadata(templateNode, i, branchCount, distributionItems?.[i])
          continue
        }

        const branchNode = this.cloneTemplateNode(
          templateNode,
          blockId,
          i,
          branchCount,
          distributionItems?.[i]
        )
        dag.nodes.set(branchNodeId, branchNode)
      }
    }

    this.wireInternalEdges(dag, blocksInParallel, blocksSet, branchCount)

    const { entryNodes, terminalNodes } = this.identifyBoundaryNodes(
      dag,
      blocksInParallel,
      blocksSet,
      branchCount
    )

    this.wireSentinelEdges(dag, parallelId, entryNodes, terminalNodes, branchCount)

    logger.info('Parallel expanded', {
      parallelId,
      branchCount,
      blocksCount: blocksInParallel.length,
      totalNodes: allBranchNodes.length,
    })

    return { entryNodes, terminalNodes, allBranchNodes }
  }

  private updateBranchMetadata(
    node: DAGNode,
    branchIndex: number,
    branchTotal: number,
    distributionItem?: any
  ): void {
    node.metadata.branchIndex = branchIndex
    node.metadata.branchTotal = branchTotal
    if (distributionItem !== undefined) {
      node.metadata.distributionItem = distributionItem
    }
  }

  private cloneTemplateNode(
    template: DAGNode,
    originalBlockId: string,
    branchIndex: number,
    branchTotal: number,
    distributionItem?: any
  ): DAGNode {
    const branchNodeId = buildBranchNodeId(originalBlockId, branchIndex)
    const blockClone: SerializedBlock = {
      ...template.block,
      id: branchNodeId,
    }

    return {
      id: branchNodeId,
      block: blockClone,
      incomingEdges: new Set(),
      outgoingEdges: new Map(),
      metadata: {
        ...template.metadata,
        branchIndex,
        branchTotal,
        distributionItem,
        originalBlockId,
      },
    }
  }

  private wireInternalEdges(
    dag: DAG,
    blocksInParallel: string[],
    blocksSet: Set<string>,
    branchCount: number
  ): void {
    for (const blockId of blocksInParallel) {
      const templateId = buildBranchNodeId(blockId, 0)
      const templateNode = dag.nodes.get(templateId)
      if (!templateNode) continue

      for (const [, edge] of templateNode.outgoingEdges) {
        const baseTargetId = extractBaseBlockId(edge.target)
        if (!blocksSet.has(baseTargetId)) continue

        for (let i = 1; i < branchCount; i++) {
          const sourceNodeId = buildBranchNodeId(blockId, i)
          const targetNodeId = buildBranchNodeId(baseTargetId, i)
          const sourceNode = dag.nodes.get(sourceNodeId)
          const targetNode = dag.nodes.get(targetNodeId)

          if (!sourceNode || !targetNode) continue

          const edgeId = edge.sourceHandle
            ? `${sourceNodeId}→${targetNodeId}-${edge.sourceHandle}`
            : `${sourceNodeId}→${targetNodeId}`

          sourceNode.outgoingEdges.set(edgeId, {
            target: targetNodeId,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
          })
          targetNode.incomingEdges.add(sourceNodeId)
        }
      }
    }
  }

  private identifyBoundaryNodes(
    dag: DAG,
    blocksInParallel: string[],
    blocksSet: Set<string>,
    branchCount: number
  ): { entryNodes: string[]; terminalNodes: string[] } {
    const entryNodes: string[] = []
    const terminalNodes: string[] = []

    for (const blockId of blocksInParallel) {
      const templateId = buildBranchNodeId(blockId, 0)
      const templateNode = dag.nodes.get(templateId)
      if (!templateNode) continue

      const hasInternalIncoming = this.hasInternalIncomingEdge(templateNode, blocksSet)
      const hasInternalOutgoing = this.hasInternalOutgoingEdge(templateNode, blocksSet)

      for (let i = 0; i < branchCount; i++) {
        const branchNodeId = buildBranchNodeId(blockId, i)
        if (!hasInternalIncoming) {
          entryNodes.push(branchNodeId)
        }
        if (!hasInternalOutgoing) {
          terminalNodes.push(branchNodeId)
        }
      }
    }

    return { entryNodes, terminalNodes }
  }

  private hasInternalIncomingEdge(node: DAGNode, blocksSet: Set<string>): boolean {
    for (const incomingId of node.incomingEdges) {
      const baseId = extractBaseBlockId(incomingId)
      if (blocksSet.has(baseId)) {
        return true
      }
    }
    return false
  }

  private hasInternalOutgoingEdge(node: DAGNode, blocksSet: Set<string>): boolean {
    for (const [, edge] of node.outgoingEdges) {
      const baseId = extractBaseBlockId(edge.target)
      if (blocksSet.has(baseId)) {
        return true
      }
    }
    return false
  }

  private wireSentinelEdges(
    dag: DAG,
    parallelId: string,
    entryNodes: string[],
    terminalNodes: string[],
    branchCount: number
  ): void {
    const sentinelStartId = buildParallelSentinelStartId(parallelId)
    const sentinelEndId = buildParallelSentinelEndId(parallelId)
    const sentinelStart = dag.nodes.get(sentinelStartId)
    const sentinelEnd = dag.nodes.get(sentinelEndId)

    if (!sentinelStart || !sentinelEnd) {
      logger.warn('Sentinel nodes not found', { parallelId, sentinelStartId, sentinelEndId })
      return
    }

    sentinelStart.outgoingEdges.clear()
    for (const entryNodeId of entryNodes) {
      const entryNode = dag.nodes.get(entryNodeId)
      if (!entryNode) continue

      const edgeId = `${sentinelStartId}→${entryNodeId}`
      sentinelStart.outgoingEdges.set(edgeId, { target: entryNodeId })
      entryNode.incomingEdges.add(sentinelStartId)
    }

    for (const terminalNodeId of terminalNodes) {
      const terminalNode = dag.nodes.get(terminalNodeId)
      if (!terminalNode) continue

      const edgeId = `${terminalNodeId}→${sentinelEndId}`
      terminalNode.outgoingEdges.set(edgeId, { target: sentinelEndId })
      sentinelEnd.incomingEdges.add(terminalNodeId)
    }
  }
}
