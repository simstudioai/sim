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
  /** Monotonically increasing counter for generating unique pre-expansion clone IDs. */
  private cloneSeq = 0

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
   * Generates a unique clone ID for pre-expansion cloning.
   *
   * Pre-expansion clones use `{originalId}__clone{N}__obranch-{branchIndex}` instead
   * of the plain `{originalId}__obranch-{branchIndex}` used by runtime expansion.
   * The `__clone{N}` segment (from a monotonic counter) prevents naming collisions
   * when the original (branch-0) subflow later expands at runtime and creates
   * `{child}__obranch-{branchIndex}`.
   */
  private buildPreCloneId(originalId: string, outerBranchIndex: number): string {
    return `${originalId}__clone${this.cloneSeq++}__obranch-${outerBranchIndex}`
  }

  /**
   * Clones an entire nested subflow graph for a specific outer branch.
   *
   * The top-level subflow gets a standard `__obranch-{N}` clone ID (needed by
   * `findEffectiveContainerId` at runtime). All deeper children — both containers
   * and regular blocks — receive unique `__clone{N}__obranch-{M}` IDs via
   * {@link buildPreCloneId} to avoid collisions with runtime expansion.
   */
  private cloneNestedSubflow(
    dag: DAG,
    subflowId: string,
    outerBranchIndex: number,
    clonedSubflows: ClonedSubflowInfo[]
  ): { startId: string; endId: string; clonedId: string; idMap: Map<string, string> } {
    const clonedId = buildClonedSubflowId(subflowId, outerBranchIndex)
    const { startId, endId, idMap } = this.cloneSubflowGraph(
      dag,
      subflowId,
      clonedId,
      outerBranchIndex,
      clonedSubflows
    )
    return { startId, endId, clonedId, idMap }
  }

  /**
   * Core recursive cloning: duplicates a subflow's sentinels, config, child blocks,
   * and DAG nodes under the given `clonedId`. Nested containers are recursively
   * cloned with unique pre-clone IDs.
   */
  private cloneSubflowGraph(
    dag: DAG,
    originalId: string,
    clonedId: string,
    outerBranchIndex: number,
    clonedSubflows: ClonedSubflowInfo[]
  ): { startId: string; endId: string; idMap: Map<string, string> } {
    const isParallel = dag.parallelConfigs.has(originalId)
    const config = isParallel
      ? dag.parallelConfigs.get(originalId)!
      : dag.loopConfigs.get(originalId)!
    const blockIds = config.nodes || []
    const idMap = new Map<string, string>()

    // Map sentinel nodes
    const origStartId = isParallel
      ? buildParallelSentinelStartId(originalId)
      : buildSentinelStartId(originalId)
    const origEndId = isParallel
      ? buildParallelSentinelEndId(originalId)
      : buildSentinelEndId(originalId)
    const clonedStartId = isParallel
      ? buildParallelSentinelStartId(clonedId)
      : buildSentinelStartId(clonedId)
    const clonedEndId = isParallel
      ? buildParallelSentinelEndId(clonedId)
      : buildSentinelEndId(clonedId)

    idMap.set(origStartId, clonedStartId)
    idMap.set(origEndId, clonedEndId)

    // Process child blocks — recurse into nested containers, remap regular blocks
    const clonedBlockIds: string[] = []

    for (const blockId of blockIds) {
      const isNestedParallel = dag.parallelConfigs.has(blockId)
      const isNestedLoop = dag.loopConfigs.has(blockId)

      if (isNestedParallel || isNestedLoop) {
        const nestedClonedId = this.buildPreCloneId(blockId, outerBranchIndex)
        clonedBlockIds.push(nestedClonedId)

        const innerResult = this.cloneSubflowGraph(
          dag,
          blockId,
          nestedClonedId,
          outerBranchIndex,
          clonedSubflows
        )
        for (const [k, v] of innerResult.idMap) {
          idMap.set(k, v)
        }

        clonedSubflows.push({
          clonedId: nestedClonedId,
          originalId: blockId,
          outerBranchIndex,
        })
      } else {
        const clonedBlockId = this.buildPreCloneId(blockId, outerBranchIndex)
        clonedBlockIds.push(clonedBlockId)

        if (isParallel) {
          idMap.set(buildBranchNodeId(blockId, 0), buildBranchNodeId(clonedBlockId, 0))
        } else {
          idMap.set(blockId, clonedBlockId)
        }
      }
    }

    // Register cloned config
    if (isParallel) {
      dag.parallelConfigs.set(clonedId, {
        ...dag.parallelConfigs.get(originalId)!,
        id: clonedId,
        nodes: clonedBlockIds,
      })
    } else {
      dag.loopConfigs.set(clonedId, {
        ...dag.loopConfigs.get(originalId)!,
        id: clonedId,
        nodes: clonedBlockIds,
      })
    }

    // Clone DAG nodes (sentinels + regular blocks) with remapped edges
    const origNodeIds = [origStartId, origEndId]
    for (const blockId of blockIds) {
      if (dag.parallelConfigs.has(blockId) || dag.loopConfigs.has(blockId)) continue
      if (isParallel) {
        origNodeIds.push(buildBranchNodeId(blockId, 0))
      } else {
        origNodeIds.push(blockId)
      }
    }

    for (const origId of origNodeIds) {
      const origNode = dag.nodes.get(origId)
      if (!origNode) continue

      const clonedNodeId = idMap.get(origId)!
      this.cloneDAGNode(dag, origNode, clonedNodeId, clonedId, isParallel, idMap)
    }

    return { startId: clonedStartId, endId: clonedEndId, idMap }
  }

  /**
   * Clones a single DAG node with remapped edges and updated metadata.
   */
  private cloneDAGNode(
    dag: DAG,
    origNode: DAGNode,
    clonedNodeId: string,
    parentClonedId: string,
    parentIsParallel: boolean,
    idMap: Map<string, string>
  ): void {
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

    const metadataOverride = parentIsParallel
      ? { parallelId: parentClonedId }
      : { loopId: parentClonedId }

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
