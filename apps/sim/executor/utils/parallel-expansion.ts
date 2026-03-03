import { createLogger } from '@sim/logger'
import { EDGE } from '@/executor/constants'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { SerializedBlock } from '@/serializer/types'
import {
  buildBranchNodeId,
  buildParallelSentinelEndId,
  buildParallelSentinelStartId,
  buildSentinelEndId,
  buildSentinelStartId,
  extractBaseBlockId,
} from './subflow-utils'

const logger = createLogger('ParallelExpansion')

export interface ClonedSubflowInfo {
  clonedId: string
  originalId: string
  outerBranchIndex: number
}

export interface ExpansionResult {
  entryNodes: string[]
  terminalNodes: string[]
  allBranchNodes: string[]
  clonedSubflows: ClonedSubflowInfo[]
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
      return { entryNodes: [], terminalNodes: [], allBranchNodes: [], clonedSubflows: [] }
    }

    // Separate nested subflow containers from regular expandable blocks.
    // Nested parallels/loops have sentinel nodes instead of branch template nodes,
    // so they cannot be cloned per-branch like regular blocks.
    const regularBlocks: string[] = []
    const nestedSubflows: string[] = []

    for (const blockId of blocksInParallel) {
      if (dag.parallelConfigs.has(blockId) || dag.loopConfigs.has(blockId)) {
        nestedSubflows.push(blockId)
      } else {
        regularBlocks.push(blockId)
      }
    }

    const regularSet = new Set(regularBlocks)
    const allBranchNodes: string[] = []

    for (const blockId of regularBlocks) {
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

    this.wireInternalEdges(dag, regularBlocks, regularSet, branchCount)

    const { entryNodes, terminalNodes } =
      regularBlocks.length > 0
        ? this.identifyBoundaryNodes(dag, regularBlocks, regularSet, branchCount)
        : { entryNodes: [] as string[], terminalNodes: [] as string[] }

    // Clone nested subflow graphs per outer branch so each branch runs independently.
    // Branch 0 uses the original sentinel/template nodes; branches 1..N get full clones.
    const clonedSubflows: Array<{
      clonedId: string
      originalId: string
      outerBranchIndex: number
    }> = []

    for (const subflowId of nestedSubflows) {
      const isParallel = dag.parallelConfigs.has(subflowId)
      const startId = isParallel
        ? buildParallelSentinelStartId(subflowId)
        : buildSentinelStartId(subflowId)
      const endId = isParallel
        ? buildParallelSentinelEndId(subflowId)
        : buildSentinelEndId(subflowId)

      // Branch 0 uses original nodes
      if (dag.nodes.has(startId)) entryNodes.push(startId)
      if (dag.nodes.has(endId)) terminalNodes.push(endId)

      // Branches 1..N clone the entire subflow graph (recursively for deep nesting)
      for (let i = 1; i < branchCount; i++) {
        const cloned = this.cloneNestedSubflow(dag, subflowId, i, clonedSubflows)

        entryNodes.push(cloned.startId)
        terminalNodes.push(cloned.endId)
        clonedSubflows.push({
          clonedId: cloned.clonedId,
          originalId: subflowId,
          outerBranchIndex: i,
        })
      }
    }

    this.wireSentinelEdges(dag, parallelId, entryNodes, terminalNodes, branchCount)

    logger.info('Parallel expanded', {
      parallelId,
      branchCount,
      blocksCount: blocksInParallel.length,
      nestedSubflows: nestedSubflows.length,
      totalNodes: allBranchNodes.length,
    })

    return { entryNodes, terminalNodes, allBranchNodes, clonedSubflows }
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

  /**
   * Clones an entire nested subflow graph for a specific outer branch.
   * Recursively handles arbitrarily deep nesting (parallel-in-parallel-in-loop, etc.).
   * Returns an ID mapping (original → cloned) so the caller can remap edges.
   */
  private cloneNestedSubflow(
    dag: DAG,
    subflowId: string,
    outerBranchIndex: number,
    clonedSubflows: ClonedSubflowInfo[]
  ): { startId: string; endId: string; clonedId: string; idMap: Map<string, string> } {
    const isParallel = dag.parallelConfigs.has(subflowId)
    const config = isParallel
      ? dag.parallelConfigs.get(subflowId)!
      : dag.loopConfigs.get(subflowId)!
    const blockIds = config.nodes || []

    const clonedSubflowId = `${subflowId}__obranch-${outerBranchIndex}`
    const origStartId = isParallel
      ? buildParallelSentinelStartId(subflowId)
      : buildSentinelStartId(subflowId)
    const origEndId = isParallel
      ? buildParallelSentinelEndId(subflowId)
      : buildSentinelEndId(subflowId)
    const clonedStartId = isParallel
      ? buildParallelSentinelStartId(clonedSubflowId)
      : buildSentinelStartId(clonedSubflowId)
    const clonedEndId = isParallel
      ? buildParallelSentinelEndId(clonedSubflowId)
      : buildSentinelEndId(clonedSubflowId)

    // Build ID mapping: original node IDs → cloned node IDs
    const idMap = new Map<string, string>()
    idMap.set(origStartId, clonedStartId)
    idMap.set(origEndId, clonedEndId)

    const clonedBlockIds: string[] = []
    const allOrigIds: string[] = [origStartId, origEndId]

    for (const blockId of blockIds) {
      const clonedBlockId = `${blockId}__obranch-${outerBranchIndex}`
      clonedBlockIds.push(clonedBlockId)

      const isNestedParallel = dag.parallelConfigs.has(blockId)
      const isNestedLoop = dag.loopConfigs.has(blockId)

      if (isNestedParallel || isNestedLoop) {
        // Recursively clone deeper nested subflows
        const deeper = this.cloneNestedSubflow(dag, blockId, outerBranchIndex, clonedSubflows)
        // Merge the deeper ID map into ours so edge remapping covers all levels
        for (const [origId, clonedId] of deeper.idMap) {
          idMap.set(origId, clonedId)
        }
        clonedSubflows.push({
          clonedId: deeper.clonedId,
          originalId: blockId,
          outerBranchIndex,
        })
      } else if (isParallel) {
        // Regular block inside a parallel → uses branch-0 template node
        const origTemplateId = buildBranchNodeId(blockId, 0)
        const clonedTemplateId = buildBranchNodeId(clonedBlockId, 0)
        idMap.set(origTemplateId, clonedTemplateId)
        allOrigIds.push(origTemplateId)
      } else {
        // Regular block inside a loop → uses the block ID directly
        idMap.set(blockId, clonedBlockId)
        allOrigIds.push(blockId)
      }
    }

    // Clone all non-recursively-handled nodes (sentinels + regular blocks)
    for (const origId of allOrigIds) {
      const origNode = dag.nodes.get(origId)
      if (!origNode) continue

      const clonedId = idMap.get(origId)!
      const clonedOutgoing = new Map<
        string,
        { target: string; sourceHandle?: string; targetHandle?: string }
      >()
      for (const [, edge] of origNode.outgoingEdges) {
        const clonedTarget = idMap.get(edge.target) ?? edge.target
        const edgeId = edge.sourceHandle
          ? `${clonedId}→${clonedTarget}-${edge.sourceHandle}`
          : `${clonedId}→${clonedTarget}`
        clonedOutgoing.set(edgeId, {
          target: clonedTarget,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        })
      }

      const clonedIncoming = new Set<string>()
      for (const incomingId of origNode.incomingEdges) {
        clonedIncoming.add(idMap.get(incomingId) ?? incomingId)
      }

      const metadataOverride = isParallel
        ? { parallelId: clonedSubflowId }
        : { loopId: clonedSubflowId }

      dag.nodes.set(clonedId, {
        id: clonedId,
        block: { ...origNode.block, id: clonedId },
        incomingEdges: clonedIncoming,
        outgoingEdges: clonedOutgoing,
        metadata: {
          ...origNode.metadata,
          ...metadataOverride,
          ...(origNode.metadata.originalBlockId && {
            originalBlockId: origNode.metadata.originalBlockId,
          }),
        },
      })
    }

    // Register cloned config with proper type narrowing
    if (isParallel) {
      const parallelConfig = dag.parallelConfigs.get(subflowId)!
      dag.parallelConfigs.set(clonedSubflowId, {
        ...parallelConfig,
        id: clonedSubflowId,
        nodes: clonedBlockIds,
      })
    } else {
      const loopConfig = dag.loopConfigs.get(subflowId)!
      dag.loopConfigs.set(clonedSubflowId, {
        ...loopConfig,
        id: clonedSubflowId,
        nodes: clonedBlockIds,
      })
    }

    return { startId: clonedStartId, endId: clonedEndId, clonedId: clonedSubflowId, idMap }
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

      const edgeId = `${terminalNodeId}→${sentinelEndId}-${EDGE.PARALLEL_EXIT}`
      terminalNode.outgoingEdges.set(edgeId, {
        target: sentinelEndId,
        sourceHandle: EDGE.PARALLEL_EXIT,
      })
      sentinelEnd.incomingEdges.add(terminalNodeId)
    }
  }
}
