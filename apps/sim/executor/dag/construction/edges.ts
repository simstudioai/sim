import { createLogger } from '@sim/logger'
import {
  EDGE,
  isConditionBlockType,
  isRouterBlockType,
  isRouterV2BlockType,
} from '@/executor/constants'
import type { DAG } from '@/executor/dag/builder'
import {
  buildBranchNodeId,
  buildParallelSentinelEndId,
  buildParallelSentinelStartId,
  buildSentinelEndId,
  buildSentinelStartId,
  extractBaseBlockId,
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

    this.wireLoopSentinels(dag, reachableBlocks)
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

      if (this.edgeCrossesLoopBoundary(source, target, blocksInLoops, dag)) {
        continue
      }

      if (loopSentinelStartId && !blocksInLoops.has(originalTarget)) {
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

  private wireLoopSentinels(dag: DAG, reachableBlocks: Set<string>): void {
    for (const [loopId, loopConfig] of dag.loopConfigs) {
      const nodes = loopConfig.nodes

      if (nodes.length === 0) continue

      const sentinelStartId = buildSentinelStartId(loopId)
      const sentinelEndId = buildSentinelEndId(loopId)

      if (!dag.nodes.has(sentinelStartId) || !dag.nodes.has(sentinelEndId)) {
        continue
      }

      const { startNodes, terminalNodes } = this.findLoopBoundaryNodes(nodes, dag, reachableBlocks)

      for (const startNodeId of startNodes) {
        this.addEdge(dag, sentinelStartId, startNodeId)
      }

      for (const terminalNodeId of terminalNodes) {
        this.addEdge(dag, terminalNodeId, sentinelEndId)
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
        const templateNodeId = buildBranchNodeId(entryNodeId, 0)
        if (dag.nodes.has(templateNodeId)) {
          this.addEdge(dag, sentinelStartId, templateNodeId)
        }
      }

      for (const terminalNodeId of terminalNodes) {
        const templateNodeId = buildBranchNodeId(terminalNodeId, 0)
        if (dag.nodes.has(templateNodeId)) {
          this.addEdge(dag, templateNodeId, sentinelEndId)
        }
      }
    }
  }

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

    let sourceLoopId: string | undefined
    let targetLoopId: string | undefined

    for (const [loopId, loopConfig] of dag.loopConfigs) {
      if (loopConfig.nodes.includes(source)) {
        sourceLoopId = loopId
      }

      if (loopConfig.nodes.includes(target)) {
        targetLoopId = loopId
      }
    }

    return sourceLoopId !== targetLoopId
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

  private findLoopBoundaryNodes(
    nodes: string[],
    dag: DAG,
    reachableBlocks: Set<string>
  ): { startNodes: string[]; terminalNodes: string[] } {
    const nodesSet = new Set(nodes)
    const startNodesSet = new Set<string>()
    const terminalNodesSet = new Set<string>()

    for (const nodeId of nodes) {
      const node = dag.nodes.get(nodeId)

      if (!node) continue

      let hasIncomingFromLoop = false

      for (const incomingNodeId of node.incomingEdges) {
        if (nodesSet.has(incomingNodeId)) {
          hasIncomingFromLoop = true
          break
        }
      }

      if (!hasIncomingFromLoop) {
        startNodesSet.add(nodeId)
      }
    }

    for (const nodeId of nodes) {
      const node = dag.nodes.get(nodeId)

      if (!node) continue

      let hasOutgoingToLoop = false

      for (const [_, edge] of node.outgoingEdges) {
        if (nodesSet.has(edge.target)) {
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
      const templateId = buildBranchNodeId(nodeId, 0)
      const templateNode = dag.nodes.get(templateId)

      if (!templateNode) continue

      let hasIncomingFromParallel = false
      for (const incomingNodeId of templateNode.incomingEdges) {
        const originalNodeId = extractBaseBlockId(incomingNodeId)
        if (nodesSet.has(originalNodeId)) {
          hasIncomingFromParallel = true
          break
        }
      }
      if (!hasIncomingFromParallel) {
        entryNodes.push(nodeId)
      }

      let hasOutgoingToParallel = false
      for (const [, edge] of templateNode.outgoingEdges) {
        const originalTargetId = extractBaseBlockId(edge.target)
        if (nodesSet.has(originalTargetId)) {
          hasOutgoingToParallel = true
          break
        }
      }
      if (!hasOutgoingToParallel) {
        terminalNodes.push(nodeId)
      }
    }

    return { entryNodes, terminalNodes }
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
