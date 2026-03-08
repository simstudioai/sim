import { createLogger } from '@sim/logger'
import {
  EDGE,
  isConditionBlockType,
  isRouterBlockType,
  isRouterV2BlockType,
} from '@/executor/constants'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import {
  buildBranchNodeId,
  buildParallelSentinelEndId,
  buildParallelSentinelStartId,
  buildSentinelEndId,
  buildSentinelStartId,
  normalizeNodeId,
} from '@/executor/utils/subflow-utils'
import type { SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('EdgeConstructor')

interface ConditionConfig {
  id: string
  label?: string
  condition: string
}

interface RouterV2RouteConfig {
  id: string
  title: string
  description: string
}

interface EdgeMetadata {
  blockTypeMap: Map<string, string>
  conditionConfigMap: Map<string, ConditionConfig[]>
  routerBlockIds: Set<string>
  routerV2ConfigMap: Map<string, RouterV2RouteConfig[]>
}

export class EdgeConstructor {
  execute(
    workflow: SerializedWorkflow,
    dag: DAG,
    blocksInParallels: Set<string>,
    blocksInLoops: Set<string>,
    reachableBlocks: Set<string>,
    pauseTriggerMapping: Map<string, string>
  ): void {
    const loopBlockIds = new Set(dag.loopConfigs.keys())
    const parallelBlockIds = new Set(dag.parallelConfigs.keys())
    const metadata = this.buildMetadataMaps(workflow)

    this.wireRegularEdges(
      workflow,
      dag,
      blocksInParallels,
      blocksInLoops,
      reachableBlocks,
      loopBlockIds,
      parallelBlockIds,
      metadata,
      pauseTriggerMapping
    )

    this.wireLoopSentinels(dag)
    this.wireParallelSentinels(dag)
  }

  private buildMetadataMaps(workflow: SerializedWorkflow): EdgeMetadata {
    const blockTypeMap = new Map<string, string>()
    const conditionConfigMap = new Map<string, ConditionConfig[]>()
    const routerBlockIds = new Set<string>()
    const routerV2ConfigMap = new Map<string, RouterV2RouteConfig[]>()

    for (const block of workflow.blocks) {
      const blockType = block.metadata?.id ?? ''
      blockTypeMap.set(block.id, blockType)

      if (isConditionBlockType(blockType)) {
        const conditions = this.parseConditionConfig(block)

        if (conditions) {
          conditionConfigMap.set(block.id, conditions)
        }
      } else if (isRouterV2BlockType(blockType)) {
        // Router V2 uses port-based routing with route configs
        const routes = this.parseRouterV2Config(block)
        if (routes) {
          routerV2ConfigMap.set(block.id, routes)
        }
      } else if (isRouterBlockType(blockType)) {
        // Legacy router uses target block IDs
        routerBlockIds.add(block.id)
      }
    }

    return { blockTypeMap, conditionConfigMap, routerBlockIds, routerV2ConfigMap }
  }

  private parseConditionConfig(block: any): ConditionConfig[] | null {
    try {
      const conditionsJson = block.config.params?.conditions

      if (typeof conditionsJson === 'string') {
        return JSON.parse(conditionsJson)
      }

      if (Array.isArray(conditionsJson)) {
        return conditionsJson
      }

      return null
    } catch (error) {
      logger.warn('Failed to parse condition config', {
        blockId: block.id,
        error: error instanceof Error ? error.message : String(error),
      })

      return null
    }
  }

  private parseRouterV2Config(block: any): RouterV2RouteConfig[] | null {
    try {
      const routesJson = block.config.params?.routes

      if (typeof routesJson === 'string') {
        return JSON.parse(routesJson)
      }

      if (Array.isArray(routesJson)) {
        return routesJson
      }

      return null
    } catch (error) {
      logger.warn('Failed to parse router v2 config', {
        blockId: block.id,
        error: error instanceof Error ? error.message : String(error),
      })

      return null
    }
  }

  private generateSourceHandle(
    source: string,
    target: string,
    sourceHandle: string | undefined,
    metadata: EdgeMetadata,
    workflow: SerializedWorkflow
  ): string | undefined {
    let handle = sourceHandle

    if (!handle && isConditionBlockType(metadata.blockTypeMap.get(source) ?? '')) {
      const conditions = metadata.conditionConfigMap.get(source)

      if (conditions && conditions.length > 0) {
        const edgesFromCondition = workflow.connections.filter((c) => c.source === source)
        const edgeIndex = edgesFromCondition.findIndex((e) => e.target === target)

        if (edgeIndex >= 0 && edgeIndex < conditions.length) {
          const correspondingCondition = conditions[edgeIndex]
          handle = `${EDGE.CONDITION_PREFIX}${correspondingCondition.id}`
        }
      }
    }

    // Router V2 uses port-based routing - handle is already set from UI (router-{routeId})
    // We don't modify it here, just validate it exists
    if (metadata.routerV2ConfigMap.has(source)) {
      // For router_v2, the sourceHandle should already be set from the UI
      // If not set and not an error handle, generate based on route index
      if (!handle || (!handle.startsWith(EDGE.ROUTER_PREFIX) && handle !== EDGE.ERROR)) {
        const routes = metadata.routerV2ConfigMap.get(source)
        if (routes && routes.length > 0) {
          const edgesFromRouter = workflow.connections.filter((c) => c.source === source)
          const edgeIndex = edgesFromRouter.findIndex((e) => e.target === target)

          if (edgeIndex >= 0 && edgeIndex < routes.length) {
            const correspondingRoute = routes[edgeIndex]
            handle = `${EDGE.ROUTER_PREFIX}${correspondingRoute.id}`
          }
        }
      }
    }

    // Legacy router uses target block ID
    if (metadata.routerBlockIds.has(source) && handle !== EDGE.ERROR) {
      handle = `${EDGE.ROUTER_PREFIX}${target}`
    }

    return handle
  }

  private wireRegularEdges(
    workflow: SerializedWorkflow,
    dag: DAG,
    blocksInParallels: Set<string>,
    blocksInLoops: Set<string>,
    reachableBlocks: Set<string>,
    loopBlockIds: Set<string>,
    parallelBlockIds: Set<string>,
    metadata: EdgeMetadata,
    pauseTriggerMapping: Map<string, string>
  ): void {
    for (const connection of workflow.connections) {
      let { source, target } = connection
      const originalSource = source
      const originalTarget = target
      let sourceHandle = this.generateSourceHandle(
        source,
        target,
        connection.sourceHandle,
        metadata,
        workflow
      )
      const targetHandle = connection.targetHandle
      const sourceIsLoopBlock = loopBlockIds.has(source)
      const targetIsLoopBlock = loopBlockIds.has(target)
      const sourceIsParallelBlock = parallelBlockIds.has(source)
      const targetIsParallelBlock = parallelBlockIds.has(target)

      let loopSentinelStartId: string | undefined

      if (sourceIsLoopBlock) {
        const sentinelEndId = buildSentinelEndId(originalSource)
        loopSentinelStartId = buildSentinelStartId(originalSource)
        if (!dag.nodes.has(sentinelEndId) || !dag.nodes.has(loopSentinelStartId)) {
          continue
        }
        source = sentinelEndId
        sourceHandle = EDGE.LOOP_EXIT
      }

      if (targetIsLoopBlock) {
        const sentinelStartId = buildSentinelStartId(target)
        if (!dag.nodes.has(sentinelStartId)) {
          continue
        }
        target = sentinelStartId
      }

      if (sourceIsParallelBlock) {
        // Skip intra-parallel edges (start → child); handled by wireParallelSentinels
        const sourceParallelNodes = dag.parallelConfigs.get(originalSource)?.nodes
        if (sourceParallelNodes?.includes(originalTarget)) {
          continue
        }
        const sentinelEndId = buildParallelSentinelEndId(originalSource)
        if (!dag.nodes.has(sentinelEndId)) {
          continue
        }
        source = sentinelEndId
        sourceHandle = EDGE.PARALLEL_EXIT
      }

      if (targetIsParallelBlock) {
        const sentinelStartId = buildParallelSentinelStartId(target)
        if (!dag.nodes.has(sentinelStartId)) {
          continue
        }
        target = sentinelStartId
      }

      if (this.edgeCrossesLoopBoundary(originalSource, originalTarget, blocksInLoops, dag)) {
        continue
      }

      const sourceLoopNodes = dag.loopConfigs.get(originalSource)?.nodes
      if (loopSentinelStartId && !sourceLoopNodes?.includes(originalTarget)) {
        this.addEdge(dag, loopSentinelStartId, target, EDGE.LOOP_EXIT, targetHandle)
      }

      if (!this.isEdgeReachable(source, target, reachableBlocks, dag)) {
        continue
      }

      if (blocksInParallels.has(source) && blocksInParallels.has(target)) {
        const sourceParallelId = this.getParallelId(source, dag)
        const targetParallelId = this.getParallelId(target, dag)

        if (sourceParallelId === targetParallelId) {
          this.wireParallelTemplateEdge(source, target, dag, sourceHandle, targetHandle)
        } else {
          logger.warn('Edge between different parallels - invalid workflow', { source, target })
        }
      } else if (blocksInParallels.has(source) || blocksInParallels.has(target)) {
        // Skip - will be handled by sentinel wiring
      } else {
        const resolvedSource = pauseTriggerMapping.get(originalSource) ?? source
        this.addEdge(dag, resolvedSource, target, sourceHandle, targetHandle)
      }
    }
  }

  private wireLoopSentinels(dag: DAG): void {
    for (const [loopId, loopConfig] of dag.loopConfigs) {
      const nodes = loopConfig.nodes

      if (nodes.length === 0) continue

      const sentinelStartId = buildSentinelStartId(loopId)
      const sentinelEndId = buildSentinelEndId(loopId)

      if (!dag.nodes.has(sentinelStartId) || !dag.nodes.has(sentinelEndId)) {
        continue
      }

      const { startNodes, terminalNodes } = this.findLoopBoundaryNodes(nodes, dag)

      for (const startNodeId of startNodes) {
        const resolvedId = this.resolveLoopBlockToSentinelStart(startNodeId, dag)
        this.addEdge(dag, sentinelStartId, resolvedId)
      }

      for (const terminalNodeId of terminalNodes) {
        const resolvedId = this.resolveLoopBlockToSentinelEnd(terminalNodeId, dag)
        if (resolvedId !== terminalNodeId) {
          // Use the sourceHandle that matches the nested subflow's exit route.
          // Parallel sentinel-end outputs selectedRoute "parallel_exit",
          // loop sentinel-end outputs "loop_exit". The edge manager only activates
          // edges whose sourceHandle matches the source node's selectedRoute.
          const handle = dag.parallelConfigs.has(terminalNodeId)
            ? EDGE.PARALLEL_EXIT
            : EDGE.LOOP_EXIT
          this.addEdge(dag, resolvedId, sentinelEndId, handle)
        } else {
          this.addEdge(dag, resolvedId, sentinelEndId)
        }
      }

      this.addEdge(dag, sentinelEndId, sentinelStartId, EDGE.LOOP_CONTINUE, undefined, true)
    }
  }

  private wireParallelSentinels(dag: DAG): void {
    for (const [parallelId, parallelConfig] of dag.parallelConfigs) {
      const nodes = parallelConfig.nodes

      if (nodes.length === 0) continue

      const sentinelStartId = buildParallelSentinelStartId(parallelId)
      const sentinelEndId = buildParallelSentinelEndId(parallelId)

      if (!dag.nodes.has(sentinelStartId) || !dag.nodes.has(sentinelEndId)) {
        continue
      }

      const { entryNodes, terminalNodes } = this.findParallelBoundaryNodes(nodes, dag)

      for (const entryNodeId of entryNodes) {
        const targetId = this.resolveSubflowToSentinelStart(entryNodeId, dag)
        if (dag.nodes.has(targetId)) {
          this.addEdge(dag, sentinelStartId, targetId)
        }
      }

      for (const terminalNodeId of terminalNodes) {
        const sourceId = this.resolveSubflowToSentinelEnd(terminalNodeId, dag)
        if (dag.nodes.has(sourceId)) {
          // Use the sourceHandle that matches the nested subflow's exit route.
          // A nested loop sentinel-end outputs "loop_exit", not "parallel_exit".
          const handle = dag.loopConfigs.has(terminalNodeId) ? EDGE.LOOP_EXIT : EDGE.PARALLEL_EXIT
          this.addEdge(dag, sourceId, sentinelEndId, handle)
        }
      }
    }
  }

  /**
   * Resolves a node ID to the appropriate entry point for sentinel wiring.
   * Nested parallels → their sentinel-start, nested loops → their sentinel-start,
   * regular blocks → their branch template node.
   */
  private resolveSubflowToSentinelStart(nodeId: string, dag: DAG): string {
    if (dag.parallelConfigs.has(nodeId)) {
      return buildParallelSentinelStartId(nodeId)
    }
    if (dag.loopConfigs.has(nodeId)) {
      return buildSentinelStartId(nodeId)
    }
    return buildBranchNodeId(nodeId, 0)
  }

  /**
   * Resolves a node ID to the appropriate exit point for sentinel wiring.
   * Nested parallels → their sentinel-end, nested loops → their sentinel-end,
   * regular blocks → their branch template node.
   */
  private resolveSubflowToSentinelEnd(nodeId: string, dag: DAG): string {
    if (dag.parallelConfigs.has(nodeId)) {
      return buildParallelSentinelEndId(nodeId)
    }
    if (dag.loopConfigs.has(nodeId)) {
      return buildSentinelEndId(nodeId)
    }
    return buildBranchNodeId(nodeId, 0)
  }

  /**
   * Checks whether an edge crosses a loop boundary (source and target are in
   * different loops, or one is inside a loop and the other is not). Uses the
   * original block IDs (pre-sentinel-remapping) because `blocksInLoops` and
   * `loopConfigs.nodes` reference original block IDs from the serialized workflow.
   */
  private edgeCrossesLoopBoundary(
    source: string,
    target: string,
    blocksInLoops: Set<string>,
    dag: DAG
  ): boolean {
    const sourceInLoop = blocksInLoops.has(source)
    const targetInLoop = blocksInLoops.has(target)

    if (sourceInLoop !== targetInLoop) {
      return true
    }

    if (!sourceInLoop && !targetInLoop) {
      return false
    }

    // Find the innermost loop for each block. In nested loops a block appears
    // in multiple loop configs; we need the most deeply nested one.
    const sourceLoopId = this.findInnermostLoop(source, dag)
    const targetLoopId = this.findInnermostLoop(target, dag)

    return sourceLoopId !== targetLoopId
  }

  /**
   * Finds the innermost loop containing a block. When a block is in nested
   * loops (A contains B, both list the block), returns B (the one that
   * doesn't contain any other candidate loop).
   */
  private findInnermostLoop(blockId: string, dag: DAG): string | undefined {
    const candidates: string[] = []
    for (const [loopId, loopConfig] of dag.loopConfigs) {
      if (loopConfig.nodes.includes(blockId)) {
        candidates.push(loopId)
      }
    }
    if (candidates.length <= 1) return candidates[0]

    return candidates.find((candidateId) =>
      candidates.every((otherId) => {
        if (otherId === candidateId) return true
        const candidateConfig = dag.loopConfigs.get(candidateId)
        return !candidateConfig?.nodes.includes(otherId)
      })
    )
  }

  private isEdgeReachable(
    source: string,
    target: string,
    reachableBlocks: Set<string>,
    dag: DAG
  ): boolean {
    if (!reachableBlocks.has(source) && !dag.nodes.has(source)) {
      return false
    }
    if (!reachableBlocks.has(target) && !dag.nodes.has(target)) {
      return false
    }
    return true
  }

  private wireParallelTemplateEdge(
    source: string,
    target: string,
    dag: DAG,
    sourceHandle?: string,
    targetHandle?: string
  ): void {
    const sourceNodeId = buildBranchNodeId(source, 0)
    const targetNodeId = buildBranchNodeId(target, 0)
    this.addEdge(dag, sourceNodeId, targetNodeId, sourceHandle, targetHandle)
  }

  /**
   * Resolves the DAG node to inspect for a given loop child.
   * If the child is a nested subflow (loop or parallel), returns its sentinel node;
   * otherwise returns the regular DAG node.
   */
  private resolveLoopChildNode(
    nodeId: string,
    dag: DAG,
    sentinel: 'start' | 'end'
  ): { resolvedId: string; node: DAGNode | undefined } {
    if (dag.loopConfigs.has(nodeId)) {
      const resolvedId =
        sentinel === 'start' ? buildSentinelStartId(nodeId) : buildSentinelEndId(nodeId)
      return { resolvedId, node: dag.nodes.get(resolvedId) }
    }
    if (dag.parallelConfigs.has(nodeId)) {
      const resolvedId =
        sentinel === 'start'
          ? buildParallelSentinelStartId(nodeId)
          : buildParallelSentinelEndId(nodeId)
      return { resolvedId, node: dag.nodes.get(resolvedId) }
    }
    return { resolvedId: nodeId, node: dag.nodes.get(nodeId) }
  }

  private resolveLoopBlockToSentinelStart(nodeId: string, dag: DAG): string {
    return this.resolveLoopChildNode(nodeId, dag, 'start').resolvedId
  }

  private resolveLoopBlockToSentinelEnd(nodeId: string, dag: DAG): string {
    return this.resolveLoopChildNode(nodeId, dag, 'end').resolvedId
  }

  /**
   * Builds the set of effective DAG node IDs for a loop's children,
   * mapping nested subflow block IDs (loops and parallels) to their sentinel IDs.
   */
  private buildEffectiveNodeSet(nodes: string[], dag: DAG): Set<string> {
    const effective = new Set<string>()
    for (const nodeId of nodes) {
      if (dag.loopConfigs.has(nodeId)) {
        effective.add(buildSentinelStartId(nodeId))
        effective.add(buildSentinelEndId(nodeId))
      } else if (dag.parallelConfigs.has(nodeId)) {
        effective.add(buildParallelSentinelStartId(nodeId))
        effective.add(buildParallelSentinelEndId(nodeId))
      } else {
        effective.add(nodeId)
      }
    }
    return effective
  }

  private findLoopBoundaryNodes(
    nodes: string[],
    dag: DAG
  ): { startNodes: string[]; terminalNodes: string[] } {
    const effectiveNodeSet = this.buildEffectiveNodeSet(nodes, dag)
    const startNodesSet = new Set<string>()
    const terminalNodesSet = new Set<string>()

    for (const nodeId of nodes) {
      const { node } = this.resolveLoopChildNode(nodeId, dag, 'start')

      if (!node) continue

      let hasIncomingFromLoop = false
      for (const incomingNodeId of node.incomingEdges) {
        if (effectiveNodeSet.has(incomingNodeId)) {
          hasIncomingFromLoop = true
          break
        }
      }

      if (!hasIncomingFromLoop) {
        startNodesSet.add(nodeId)
      }
    }

    for (const nodeId of nodes) {
      const { node } = this.resolveLoopChildNode(nodeId, dag, 'end')

      if (!node) continue

      let hasOutgoingToLoop = false
      for (const [, edge] of node.outgoingEdges) {
        const isBackEdge =
          edge.sourceHandle === EDGE.LOOP_CONTINUE || edge.sourceHandle === EDGE.LOOP_CONTINUE_ALT
        if (isBackEdge) continue

        if (effectiveNodeSet.has(edge.target)) {
          hasOutgoingToLoop = true
          break
        }
      }

      if (!hasOutgoingToLoop) {
        terminalNodesSet.add(nodeId)
      }
    }

    return {
      startNodes: Array.from(startNodesSet),
      terminalNodes: Array.from(terminalNodesSet),
    }
  }

  private findParallelBoundaryNodes(
    nodes: string[],
    dag: DAG
  ): { entryNodes: string[]; terminalNodes: string[] } {
    const nodesSet = new Set(nodes)
    const entryNodes: string[] = []
    const terminalNodes: string[] = []

    for (const nodeId of nodes) {
      // For nested subflow containers, use their sentinel nodes for boundary detection
      const { startNode, endNode } = this.resolveParallelChildNodes(nodeId, dag)

      if (!startNode && !endNode) continue

      // Entry detection: check if the start-facing node has incoming edges from within the parallel
      if (startNode) {
        let hasIncomingFromParallel = false
        for (const incomingNodeId of startNode.incomingEdges) {
          const originalNodeId = normalizeNodeId(incomingNodeId)
          if (nodesSet.has(originalNodeId)) {
            hasIncomingFromParallel = true
            break
          }
        }
        if (!hasIncomingFromParallel) {
          entryNodes.push(nodeId)
        }
      }

      // Terminal detection: check if the end-facing node has outgoing edges to within the parallel
      if (endNode) {
        let hasOutgoingToParallel = false
        for (const [, edge] of endNode.outgoingEdges) {
          // Skip loop back-edges — they don't count as forward edges within the parallel
          const isBackEdge =
            edge.sourceHandle === EDGE.LOOP_CONTINUE || edge.sourceHandle === EDGE.LOOP_CONTINUE_ALT
          if (isBackEdge) continue

          const originalTargetId = normalizeNodeId(edge.target)
          if (nodesSet.has(originalTargetId)) {
            hasOutgoingToParallel = true
            break
          }
        }
        if (!hasOutgoingToParallel) {
          terminalNodes.push(nodeId)
        }
      }
    }

    return { entryNodes, terminalNodes }
  }

  /**
   * Resolves a child node inside a parallel to the correct DAG nodes for boundary detection.
   * For regular blocks, returns the branch template node for both start and end.
   * For nested parallels, returns the inner parallel's sentinel-start and sentinel-end.
   * For nested loops, returns the inner loop's sentinel-start and sentinel-end.
   */
  private resolveParallelChildNodes(
    nodeId: string,
    dag: DAG
  ): { startNode: DAGNode | undefined; endNode: DAGNode | undefined } {
    if (dag.parallelConfigs.has(nodeId)) {
      return {
        startNode: dag.nodes.get(buildParallelSentinelStartId(nodeId)),
        endNode: dag.nodes.get(buildParallelSentinelEndId(nodeId)),
      }
    }
    if (dag.loopConfigs.has(nodeId)) {
      return {
        startNode: dag.nodes.get(buildSentinelStartId(nodeId)),
        endNode: dag.nodes.get(buildSentinelEndId(nodeId)),
      }
    }
    // Regular block — use branch template node for both
    const templateNode = dag.nodes.get(buildBranchNodeId(nodeId, 0))
    return { startNode: templateNode, endNode: templateNode }
  }

  private getParallelId(blockId: string, dag: DAG): string | null {
    for (const [parallelId, parallelConfig] of dag.parallelConfigs) {
      if (parallelConfig.nodes.includes(blockId)) {
        return parallelId
      }
    }
    return null
  }

  private addEdge(
    dag: DAG,
    sourceId: string,
    targetId: string,
    sourceHandle?: string,
    targetHandle?: string,
    isLoopBackEdge = false
  ): void {
    const sourceNode = dag.nodes.get(sourceId)
    const targetNode = dag.nodes.get(targetId)

    if (!sourceNode || !targetNode) {
      logger.warn('Edge references non-existent node', { sourceId, targetId })
      return
    }

    const edgeId = `${sourceId}→${targetId}${sourceHandle ? `-${sourceHandle}` : ''}`

    sourceNode.outgoingEdges.set(edgeId, {
      target: targetId,
      sourceHandle,
      targetHandle,
      isActive: isLoopBackEdge ? false : undefined,
    })

    if (!isLoopBackEdge) {
      targetNode.incomingEdges.add(sourceId)
    }
  }
}
