import { createLogger } from '@sim/logger'
import { EDGE } from '@/executor/constants'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { SerializedBlock } from '@/serializer/types'
import {
  buildBranchNodeId,
  buildClonedSubflowId,
  buildParallelSentinelEndId,
  buildParallelSentinelStartId,
  buildSentinelEndId,
  buildSentinelStartId,
  extractBaseBlockId,
  isLoopSentinelNodeId,
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
    const clonedSubflows: ClonedSubflowInfo[] = []

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
   * Uses iterative BFS to handle arbitrarily deep nesting without ID collisions.
   * Each subflow level's sentinels, config, and regular blocks are cloned, but
   * nested subflows within are queued for processing rather than recursed into.
   */
  private cloneNestedSubflow(
    dag: DAG,
    subflowId: string,
    outerBranchIndex: number,
    clonedSubflows: ClonedSubflowInfo[]
  ): { startId: string; endId: string; clonedId: string; idMap: Map<string, string> } {
    const idMap = new Map<string, string>()
    const allOrigIds: string[] = []

    // BFS queue of subflows to clone: [originalId, parentIsParallel]
    const queue: Array<{ id: string; parentIsParallel: boolean }> = [
      { id: subflowId, parentIsParallel: dag.parallelConfigs.has(subflowId) },
    ]
    const processed = new Set<string>()

    while (queue.length > 0) {
      const { id: currentId, parentIsParallel } = queue.shift()!
      if (processed.has(currentId)) continue
      processed.add(currentId)

      const isParallel = dag.parallelConfigs.has(currentId)
      const config = isParallel
        ? dag.parallelConfigs.get(currentId)!
        : dag.loopConfigs.get(currentId)!
      const blockIds = config.nodes || []

      const clonedId = buildClonedSubflowId(currentId, outerBranchIndex)
      const origStartId = isParallel
        ? buildParallelSentinelStartId(currentId)
        : buildSentinelStartId(currentId)
      const origEndId = isParallel
        ? buildParallelSentinelEndId(currentId)
        : buildSentinelEndId(currentId)
      const clonedStartId = isParallel
        ? buildParallelSentinelStartId(clonedId)
        : buildSentinelStartId(clonedId)
      const clonedEndId = isParallel
        ? buildParallelSentinelEndId(clonedId)
        : buildSentinelEndId(clonedId)

      idMap.set(origStartId, clonedStartId)
      idMap.set(origEndId, clonedEndId)
      allOrigIds.push(origStartId, origEndId)

      const clonedBlockIds: string[] = []

      for (const blockId of blockIds) {
        const clonedBlockId = buildClonedSubflowId(blockId, outerBranchIndex)
        clonedBlockIds.push(clonedBlockId)

        const isNestedParallel = dag.parallelConfigs.has(blockId)
        const isNestedLoop = dag.loopConfigs.has(blockId)

        if (isNestedParallel || isNestedLoop) {
          // Queue the deeper subflow for processing (sentinels + config clone)
          queue.push({ id: blockId, parentIsParallel: isParallel })
          clonedSubflows.push({
            clonedId: clonedBlockId,
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

      // Register cloned config
      if (isParallel) {
        dag.parallelConfigs.set(clonedId, {
          ...dag.parallelConfigs.get(currentId)!,
          id: clonedId,
          nodes: clonedBlockIds,
        })
      } else {
        dag.loopConfigs.set(clonedId, {
          ...dag.loopConfigs.get(currentId)!,
          id: clonedId,
          nodes: clonedBlockIds,
        })
      }
    }

    // Clone all collected nodes (sentinels + regular blocks) with remapped edges
    const topIsParallel = dag.parallelConfigs.has(subflowId)
    const topClonedId = buildClonedSubflowId(subflowId, outerBranchIndex)

    for (const origId of allOrigIds) {
      const origNode = dag.nodes.get(origId)
      if (!origNode) continue

      const clonedNodeId = idMap.get(origId)!
      const clonedOutgoing = new Map<
        string,
        { target: string; sourceHandle?: string; targetHandle?: string }
      >()
      for (const [, edge] of origNode.outgoingEdges) {
        const clonedTarget = idMap.get(edge.target) ?? edge.target
        const edgeId = edge.sourceHandle
          ? `${clonedNodeId}→${clonedTarget}-${edge.sourceHandle}`
          : `${clonedNodeId}→${clonedTarget}`
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

      // Determine which cloned subflow this node belongs to for metadata override
      const nodeParallelId = origNode.metadata.parallelId
      const nodeLoopId = origNode.metadata.loopId
      let metadataOverride: Record<string, string> = {}
      if (nodeParallelId && processed.has(nodeParallelId)) {
        metadataOverride = { parallelId: buildClonedSubflowId(nodeParallelId, outerBranchIndex) }
      } else if (nodeLoopId && processed.has(nodeLoopId)) {
        metadataOverride = { loopId: buildClonedSubflowId(nodeLoopId, outerBranchIndex) }
      } else if (topIsParallel) {
        metadataOverride = { parallelId: topClonedId }
      } else {
        metadataOverride = { loopId: topClonedId }
      }

      dag.nodes.set(clonedNodeId, {
        id: clonedNodeId,
        block: { ...origNode.block, id: clonedNodeId },
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

    const topStartId = topIsParallel
      ? buildParallelSentinelStartId(topClonedId)
      : buildSentinelStartId(topClonedId)
    const topEndId = topIsParallel
      ? buildParallelSentinelEndId(topClonedId)
      : buildSentinelEndId(topClonedId)

    return { startId: topStartId, endId: topEndId, clonedId: topClonedId, idMap }
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

      const handle = isLoopSentinelNodeId(terminalNodeId) ? EDGE.LOOP_EXIT : EDGE.PARALLEL_EXIT
      const edgeId = `${terminalNodeId}→${sentinelEndId}-${handle}`
      terminalNode.outgoingEdges.set(edgeId, {
        target: sentinelEndId,
        sourceHandle: handle,
      })
      sentinelEnd.incomingEdges.add(terminalNodeId)
    }
  }
}
