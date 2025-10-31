/**
 * EdgeWiringPhase
 * 
 * Wires all edges in the DAG.
 * Handles:
 * - Regular edges between nodes
 * - Loop boundary edges (redirect to sentinels)
 * - Parallel boundary edges (connect to all branches)
 * - Backward edges for loop continuation
 * - SourceHandle generation for condition/router blocks
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { SerializedWorkflow } from '@/serializer/types'
import type { DAG } from '../dag-builder'
import type { DAGEdge } from '../types'

const logger = createLogger('EdgeWiringPhase')

export class EdgeWiringPhase {
  /**
   * Wire all edges in the DAG
   */
  execute(
    workflow: SerializedWorkflow,
    dag: DAG,
    blocksInParallels: Set<string>,
    blocksInLoops: Set<string>,
    reachableBlocks: Set<string>
  ): void {
    const loopBlockIds = new Set(dag.loopConfigs.keys())
    const parallelBlockIds = new Set(dag.parallelConfigs.keys())

    // Build metadata maps for sourceHandle generation
    const { blockTypeMap, conditionConfigMap, routerBlockIds } = this.buildMetadataMaps(workflow)

    // Process regular connections
    this.wireRegularEdges(
      workflow,
      dag,
      blocksInParallels,
      blocksInLoops,
      reachableBlocks,
      loopBlockIds,
      parallelBlockIds,
      blockTypeMap,
      conditionConfigMap,
      routerBlockIds
    )

    // Wire loop sentinels
    this.wireLoopSentinels(dag, reachableBlocks)

    // Wire parallel blocks
    this.wireParallelBlocks(workflow, dag, loopBlockIds, parallelBlockIds)
  }

  /**
   * Build metadata maps for edge processing
   */
  private buildMetadataMaps(workflow: SerializedWorkflow): {
    blockTypeMap: Map<string, string>
    conditionConfigMap: Map<string, any[]>
    routerBlockIds: Set<string>
  } {
    const blockTypeMap = new Map<string, string>()
    const conditionConfigMap = new Map<string, any[]>()
    const routerBlockIds = new Set<string>()

    for (const block of workflow.blocks) {
      blockTypeMap.set(block.id, block.metadata?.id || '')

      if (block.metadata?.id === 'condition') {
        try {
          const conditionsJson = block.config.params?.conditions
          if (typeof conditionsJson === 'string') {
            const conditions = JSON.parse(conditionsJson)
            conditionConfigMap.set(block.id, conditions)
          } else if (Array.isArray(conditionsJson)) {
            conditionConfigMap.set(block.id, conditionsJson)
          }
        } catch (error) {
          logger.warn('Failed to parse condition config:', { blockId: block.id })
        }
      } else if (block.metadata?.id === 'router') {
        routerBlockIds.add(block.id)
      }
    }

    return { blockTypeMap, conditionConfigMap, routerBlockIds }
  }

  /**
   * Generate sourceHandle for condition/router blocks
   */
  private generateSourceHandle(
    source: string,
    target: string,
    sourceHandle: string | undefined,
    blockTypeMap: Map<string, string>,
    conditionConfigMap: Map<string, any[]>,
    routerBlockIds: Set<string>,
    workflow: SerializedWorkflow
  ): string | undefined {
    let handle = sourceHandle

    // Generate sourceHandle for condition blocks if not provided
    if (!handle && blockTypeMap.get(source) === 'condition') {
      const conditions = conditionConfigMap.get(source)
      if (conditions && conditions.length > 0) {
        const edgesFromCondition = workflow.connections.filter((c) => c.source === source)
        const edgeIndex = edgesFromCondition.findIndex((e) => e.target === target)

        if (edgeIndex >= 0 && edgeIndex < conditions.length) {
          const correspondingCondition = conditions[edgeIndex]
          handle = `condition-${correspondingCondition.id}`
        }
      }
    }

    // Generate sourceHandle for router blocks
    if (routerBlockIds.has(source)) {
      handle = `router-${target}`
      logger.debug('Set router sourceHandle:', { source, target, sourceHandle: handle })
    }

    return handle
  }

  /**
   * Wire regular edges (between normal nodes, handling loop/parallel boundaries)
   */
  private wireRegularEdges(
    workflow: SerializedWorkflow,
    dag: DAG,
    blocksInParallels: Set<string>,
    blocksInLoops: Set<string>,
    reachableBlocks: Set<string>,
    loopBlockIds: Set<string>,
    parallelBlockIds: Set<string>,
    blockTypeMap: Map<string, string>,
    conditionConfigMap: Map<string, any[]>,
    routerBlockIds: Set<string>
  ): void {
    for (const connection of workflow.connections) {
      let { source, target } = connection
      let sourceHandle = this.generateSourceHandle(
        source,
        target,
        connection.sourceHandle,
        blockTypeMap,
        conditionConfigMap,
        routerBlockIds,
        workflow
      )
      let targetHandle = connection.targetHandle

      const sourceIsLoopBlock = loopBlockIds.has(source)
      const targetIsLoopBlock = loopBlockIds.has(target)
      const sourceIsParallelBlock = parallelBlockIds.has(source)
      const targetIsParallelBlock = parallelBlockIds.has(target)

      // Handle loop/parallel block redirections
      if (sourceIsLoopBlock || targetIsLoopBlock || sourceIsParallelBlock || targetIsParallelBlock) {
        if (sourceIsLoopBlock) {
          // Redirect FROM loop block to sentinel_end
          const sentinelEndId = `loop-${source}-sentinel-end`
          if (!dag.nodes.has(sentinelEndId)) {
            logger.debug('Skipping loop exit edge - sentinel not found', { source, target })
            continue
          }
          source = sentinelEndId
          sourceHandle = 'loop_exit'
          logger.debug('Redirected loop exit edge', { from: sentinelEndId, to: target })
        }

        if (targetIsLoopBlock) {
          // Redirect TO loop block to sentinel_start
          const sentinelStartId = `loop-${target}-sentinel-start`
          if (!dag.nodes.has(sentinelStartId)) {
            logger.debug('Skipping loop entry edge - sentinel not found', { source, target })
            continue
          }
          target = sentinelStartId
          logger.debug('Redirected loop entry edge', { from: source, to: sentinelStartId })
        }

        if (sourceIsParallelBlock || targetIsParallelBlock) {
          continue // Handle in wireParallelBlocks
        }
      }

      // Check if edge crosses loop boundary
      if (this.edgeCrossesLoopBoundary(source, target, blocksInLoops, dag)) {
        logger.debug('Skipping edge that crosses loop boundary', { source, target })
        continue
      }

      // Check reachability
      if (!this.isEdgeReachable(source, target, reachableBlocks, dag)) {
        logger.debug('Skipping edge - not reachable', { source, target })
        continue
      }

      // Handle parallel edges
      if (blocksInParallels.has(source) && blocksInParallels.has(target)) {
        const sourceParallelId = this.getParallelId(source, dag)
        const targetParallelId = this.getParallelId(target, dag)

        if (sourceParallelId === targetParallelId) {
          // Same parallel - expand edge across all branches
          this.wireParallelInternalEdge(source, target, sourceParallelId!, dag, sourceHandle, targetHandle)
        } else {
          logger.warn('Edge between different parallels - invalid workflow', { source, target })
        }
      } else if (blocksInParallels.has(source) || blocksInParallels.has(target)) {
        logger.debug('Skipping internal-to-external edge (handled by parallel wiring)', {
          source,
          target,
        })
        continue
      } else {
        // Regular edge
        this.addEdge(dag, source, target, sourceHandle, targetHandle)
      }
    }
  }

  /**
   * Wire loop sentinel nodes
   */
  private wireLoopSentinels(dag: DAG, reachableBlocks: Set<string>): void {
    for (const [loopId, loopConfig] of dag.loopConfigs) {
      const config = loopConfig as any
      const nodes = config.nodes || []

      if (nodes.length === 0) continue

      const sentinelStartId = `loop-${loopId}-sentinel-start`
      const sentinelEndId = `loop-${loopId}-sentinel-end`

      // Skip if sentinel nodes don't exist
      if (!dag.nodes.has(sentinelStartId) || !dag.nodes.has(sentinelEndId)) {
        logger.debug('Skipping sentinel wiring for unreachable loop', { loopId })
        continue
      }

      const { startNodes, terminalNodes } = this.findLoopBoundaryNodes(
        nodes,
        dag,
        reachableBlocks
      )

      logger.debug('Wiring sentinel nodes for loop', {
        loopId,
        startNodes,
        terminalNodes,
      })

      // Connect sentinel_start to all start nodes
      for (const startNodeId of startNodes) {
        this.addEdge(dag, sentinelStartId, startNodeId)
      }

      // Connect all terminal nodes to sentinel_end
      for (const terminalNodeId of terminalNodes) {
        this.addEdge(dag, terminalNodeId, sentinelEndId)
      }

      // Add backward edge from sentinel_end to sentinel_start
      this.addEdge(dag, sentinelEndId, sentinelStartId, 'loop_continue', undefined, true)
      logger.debug('Added backward edge for loop', { loopId })
    }
  }

  /**
   * Wire parallel blocks to external nodes
   */
  private wireParallelBlocks(
    workflow: SerializedWorkflow,
    dag: DAG,
    loopBlockIds: Set<string>,
    parallelBlockIds: Set<string>
  ): void {
    for (const [parallelId, parallelConfig] of dag.parallelConfigs) {
      const config = parallelConfig as any
      const nodes = config.nodes || []

      if (nodes.length === 0) continue

      const { entryNodes, terminalNodes, branchCount } = this.findParallelBoundaryNodes(
        nodes,
        parallelId,
        dag
      )

      logger.info('Wiring parallel block edges', {
        parallelId,
        entryNodes,
        terminalNodes,
        branchCount,
      })

      // Process edges targeting or sourcing the parallel block
      for (const connection of workflow.connections) {
        const { source, target, sourceHandle, targetHandle } = connection

        // Edge TO parallel block
        if (target === parallelId) {
          if (loopBlockIds.has(source) || parallelBlockIds.has(source)) continue
          if (nodes.includes(source)) {
            logger.warn('Invalid: parallel block connected from its own internal node', {
              parallelId,
              source,
            })
            continue
          }

          logger.info('Wiring edge to parallel block', { source, parallelId, entryNodes })

          for (const entryNodeId of entryNodes) {
            for (let i = 0; i < branchCount; i++) {
              const branchNodeId = `${entryNodeId}₍${i}₎`
              if (dag.nodes.has(branchNodeId)) {
                this.addEdge(dag, source, branchNodeId, sourceHandle, targetHandle)
              }
            }
          }
        }

        // Edge FROM parallel block
        if (source === parallelId) {
          if (loopBlockIds.has(target) || parallelBlockIds.has(target)) continue
          if (nodes.includes(target)) {
            logger.warn('Invalid: parallel block connected to its own internal node', {
              parallelId,
              target,
            })
            continue
          }

          logger.info('Wiring edge from parallel block', { parallelId, target, terminalNodes })

          for (const terminalNodeId of terminalNodes) {
            for (let i = 0; i < branchCount; i++) {
              const branchNodeId = `${terminalNodeId}₍${i}₎`
              if (dag.nodes.has(branchNodeId)) {
                this.addEdge(dag, branchNodeId, target, sourceHandle, targetHandle)
              }
            }
          }
        }
      }
    }
  }

  /**
   * HELPER METHODS
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
      return true // One in loop, one outside
    }

    if (!sourceInLoop && !targetInLoop) {
      return false // Both outside loops
    }

    // Both in loops - check if same loop
    let sourceLoopId: string | undefined
    let targetLoopId: string | undefined

    for (const [loopId, loopConfig] of dag.loopConfigs) {
      if ((loopConfig as any).nodes.includes(source)) {
        sourceLoopId = loopId
      }
      if ((loopConfig as any).nodes.includes(target)) {
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

  private wireParallelInternalEdge(
    source: string,
    target: string,
    parallelId: string,
    dag: DAG,
    sourceHandle?: string,
    targetHandle?: string
  ): void {
    const parallelConfig = dag.parallelConfigs.get(parallelId) as any

    // Calculate branch count
    let distributionItems = parallelConfig.distributionItems || parallelConfig.distribution || []
    if (typeof distributionItems === 'string' && !distributionItems.startsWith('<')) {
      try {
        distributionItems = JSON.parse(distributionItems.replace(/'/g, '"'))
      } catch (e) {
        distributionItems = []
      }
    }

    let count = parallelConfig.parallelCount || parallelConfig.count || 1
    if (parallelConfig.parallelType === 'collection' && Array.isArray(distributionItems)) {
      count = distributionItems.length
    }

    // Add edge for each branch
    for (let i = 0; i < count; i++) {
      const sourceNodeId = `${source}₍${i}₎`
      const targetNodeId = `${target}₍${i}₎`
      this.addEdge(dag, sourceNodeId, targetNodeId, sourceHandle, targetHandle)
    }
  }

  private findLoopBoundaryNodes(
    nodes: string[],
    dag: DAG,
    reachableBlocks: Set<string>
  ): { startNodes: string[]; terminalNodes: string[] } {
    const nodesSet = new Set(nodes)
    const startNodesSet = new Set<string>()
    const terminalNodesSet = new Set<string>()

    // Find start nodes: nodes with no incoming edges from within the loop
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

    // Find terminal nodes: nodes with no outgoing edges to other loop nodes
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
    parallelId: string,
    dag: DAG
  ): { entryNodes: string[]; terminalNodes: string[]; branchCount: number } {
    const nodesSet = new Set(nodes)
    const entryNodesSet = new Set<string>()
    const terminalNodesSet = new Set<string>()

    const parallelConfig = dag.parallelConfigs.get(parallelId) as any

    // Calculate branch count
    let distributionItems = parallelConfig.distributionItems || parallelConfig.distribution || []
    if (typeof distributionItems === 'string' && !distributionItems.startsWith('<')) {
      try {
        distributionItems = JSON.parse(distributionItems.replace(/'/g, '"'))
      } catch (e) {
        distributionItems = []
      }
    }

    let branchCount = parallelConfig.parallelCount || parallelConfig.count || 1
    if (parallelConfig.parallelType === 'collection' && Array.isArray(distributionItems)) {
      branchCount = distributionItems.length
    }

    // Find entry nodes: nodes with no incoming edges from within parallel
    for (const nodeId of nodes) {
      // Check if any branch exists in DAG
      let hasAnyBranch = false
      for (let i = 0; i < branchCount; i++) {
        if (dag.nodes.has(`${nodeId}₍${i}₎`)) {
          hasAnyBranch = true
          break
        }
      }

      if (!hasAnyBranch) continue

      // Check first branch for incoming edges
      const firstBranchId = `${nodeId}₍0₎`
      const firstBranchNode = dag.nodes.get(firstBranchId)
      if (!firstBranchNode) continue

      let hasIncomingFromParallel = false
      for (const incomingNodeId of firstBranchNode.incomingEdges) {
        const originalNodeId = incomingNodeId.includes('₍')
          ? incomingNodeId.substring(0, incomingNodeId.indexOf('₍'))
          : incomingNodeId

        if (nodesSet.has(originalNodeId)) {
          hasIncomingFromParallel = true
          break
        }
      }

      if (!hasIncomingFromParallel) {
        entryNodesSet.add(nodeId)
      }
    }

    // Find terminal nodes: nodes with no outgoing edges to other parallel nodes
    for (const nodeId of nodes) {
      // Check if any branch exists in DAG
      let hasAnyBranch = false
      for (let i = 0; i < branchCount; i++) {
        if (dag.nodes.has(`${nodeId}₍${i}₎`)) {
          hasAnyBranch = true
          break
        }
      }

      if (!hasAnyBranch) continue

      // Check first branch for outgoing edges
      const firstBranchId = `${nodeId}₍0₎`
      const firstBranchNode = dag.nodes.get(firstBranchId)
      if (!firstBranchNode) continue

      let hasOutgoingToParallel = false
      for (const [_, edge] of firstBranchNode.outgoingEdges) {
        const originalTargetId = edge.target.includes('₍')
          ? edge.target.substring(0, edge.target.indexOf('₍'))
          : edge.target

        if (nodesSet.has(originalTargetId)) {
          hasOutgoingToParallel = true
          break
        }
      }

      if (!hasOutgoingToParallel) {
        terminalNodesSet.add(nodeId)
      }
    }

    return {
      entryNodes: Array.from(entryNodesSet),
      terminalNodes: Array.from(terminalNodesSet),
      branchCount,
    }
  }

  private getParallelId(blockId: string, dag: DAG): string | null {
    for (const [parallelId, parallelConfig] of dag.parallelConfigs) {
      if ((parallelConfig as any).nodes.includes(blockId)) {
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
      logger.warn('Edge references non-existent node:', { sourceId, targetId })
      return
    }

    const edgeId = `${sourceId}→${targetId}`

    sourceNode.outgoingEdges.set(edgeId, {
      target: targetId,
      sourceHandle,
      targetHandle,
      isActive: isLoopBackEdge ? false : undefined,
    })

    // Only add to incoming edges if not a loop back-edge
    if (!isLoopBackEdge) {
      targetNode.incomingEdges.add(sourceId)
      logger.debug('Added incoming edge:', { from: sourceId, to: targetId })
    } else {
      logger.debug('Skipped adding backwards-edge to incomingEdges:', { from: sourceId, to: targetId })
    }
  }
}

