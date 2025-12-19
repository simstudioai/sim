import { createLogger } from '@/lib/logs/console/logger'
import { DEFAULTS } from '@/executor/constants'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { ParallelScope } from '@/executor/execution/state'
import type { BlockStateWriter, ContextExtensions } from '@/executor/execution/types'
import type { ExecutionContext, NormalizedBlockOutput } from '@/executor/types'
import type { ParallelConfigWithNodes } from '@/executor/types/parallel'
import {
  addSubflowErrorLog,
  buildBranchNodeId,
  calculateBranchCount,
  extractBaseBlockId,
  extractBranchIndex,
  parseDistributionItems,
  resolveArrayInput,
  validateMaxCount,
} from '@/executor/utils/subflow-utils'
import type { VariableResolver } from '@/executor/variables/resolver'
import type { SerializedParallel } from '@/serializer/types'

const logger = createLogger('ParallelOrchestrator')

export interface ParallelBranchMetadata {
  branchIndex: number
  branchTotal: number
  distributionItem?: any
  parallelId: string
}

export interface ParallelAggregationResult {
  allBranchesComplete: boolean
  results?: NormalizedBlockOutput[][]
  completedBranches?: number
  totalBranches?: number
}

export class ParallelOrchestrator {
  private resolver: VariableResolver | null = null
  private contextExtensions: ContextExtensions | null = null

  constructor(
    private dag: DAG,
    private state: BlockStateWriter
  ) {}

  setResolver(resolver: VariableResolver): void {
    this.resolver = resolver
  }

  setContextExtensions(contextExtensions: ContextExtensions): void {
    this.contextExtensions = contextExtensions
  }

  initializeParallelScope(
    ctx: ExecutionContext,
    parallelId: string,
    totalBranches: number,
    terminalNodesCount = 1
  ): ParallelScope {
    const parallelConfig = this.dag.parallelConfigs.get(parallelId)

    let items: any[] | undefined
    if (parallelConfig) {
      try {
        items = this.resolveDistributionItems(ctx, parallelConfig)
      } catch (error) {
        const errorMessage = `Parallel distribution resolution failed: ${error instanceof Error ? error.message : String(error)}`
        logger.error(errorMessage, {
          parallelId,
          distribution: parallelConfig.distribution,
        })
        this.addParallelErrorLog(ctx, parallelId, errorMessage, {
          distribution: parallelConfig.distribution,
        })
        this.setErrorScope(ctx, parallelId, errorMessage)
        throw new Error(errorMessage)
      }
    }

    const actualBranchCount = items && items.length > totalBranches ? items.length : totalBranches

    const branchError = validateMaxCount(
      actualBranchCount,
      DEFAULTS.MAX_PARALLEL_BRANCHES,
      'Parallel branch count'
    )
    if (branchError) {
      logger.error(branchError, { parallelId, actualBranchCount })
      this.addParallelErrorLog(ctx, parallelId, branchError, {
        distribution: parallelConfig?.distribution,
        branchCount: actualBranchCount,
      })
      this.setErrorScope(ctx, parallelId, branchError)
      throw new Error(branchError)
    }

    const scope: ParallelScope = {
      parallelId,
      totalBranches: actualBranchCount,
      branchOutputs: new Map(),
      completedCount: 0,
      totalExpectedNodes: actualBranchCount * terminalNodesCount,
      items,
    }
    if (!ctx.parallelExecutions) {
      ctx.parallelExecutions = new Map()
    }
    ctx.parallelExecutions.set(parallelId, scope)

    // Dynamically expand DAG if needed
    if (items && items.length > totalBranches && parallelConfig) {
      logger.info('Dynamically expanding parallel branches', {
        parallelId,
        existingBranches: totalBranches,
        targetBranches: items.length,
        itemsCount: items.length,
      })

      const newEntryNodes = this.expandParallelBranches(
        parallelId,
        parallelConfig,
        totalBranches,
        items.length
      )

      logger.info('Parallel expansion complete', {
        parallelId,
        newEntryNodes,
        totalNodesInDag: this.dag.nodes.size,
      })

      // Add new entry nodes to pending dynamic nodes so the engine can schedule them
      if (newEntryNodes.length > 0) {
        if (!ctx.pendingDynamicNodes) {
          ctx.pendingDynamicNodes = []
        }
        ctx.pendingDynamicNodes.push(...newEntryNodes)
      }
    } else {
      logger.info('No parallel expansion needed', {
        parallelId,
        itemsLength: items?.length,
        totalBranches,
        hasParallelConfig: !!parallelConfig,
      })
    }

    return scope
  }

  private addParallelErrorLog(
    ctx: ExecutionContext,
    parallelId: string,
    errorMessage: string,
    inputData?: any
  ): void {
    addSubflowErrorLog(
      ctx,
      parallelId,
      'parallel',
      errorMessage,
      inputData || {},
      this.contextExtensions
    )
  }

  private setErrorScope(ctx: ExecutionContext, parallelId: string, errorMessage: string): void {
    const scope: ParallelScope = {
      parallelId,
      totalBranches: 0,
      branchOutputs: new Map(),
      completedCount: 0,
      totalExpectedNodes: 0,
      items: [],
      validationError: errorMessage,
    }
    if (!ctx.parallelExecutions) {
      ctx.parallelExecutions = new Map()
    }
    ctx.parallelExecutions.set(parallelId, scope)
  }

  /**
   * Dynamically expand the DAG to include additional branch nodes when
   * the resolved item count exceeds the pre-built branch count.
   */
  private expandParallelBranches(
    parallelId: string,
    config: SerializedParallel,
    existingBranchCount: number,
    targetBranchCount: number
  ): string[] {
    // Get all blocks that are part of this parallel
    const blocksInParallel = config.nodes
    const blocksInParallelSet = new Set(blocksInParallel)

    // Step 1: Create all new nodes first
    for (const blockId of blocksInParallel) {
      const branch0NodeId = buildBranchNodeId(blockId, 0)
      const templateNode = this.dag.nodes.get(branch0NodeId)

      if (!templateNode) {
        logger.warn('Template node not found for parallel expansion', { blockId, branch0NodeId })
        continue
      }

      for (let branchIndex = existingBranchCount; branchIndex < targetBranchCount; branchIndex++) {
        const newNodeId = buildBranchNodeId(blockId, branchIndex)

        const newNode: DAGNode = {
          id: newNodeId,
          block: {
            ...templateNode.block,
            id: newNodeId,
          },
          incomingEdges: new Set(),
          outgoingEdges: new Map(),
          metadata: {
            ...templateNode.metadata,
            branchIndex,
            branchTotal: targetBranchCount,
            originalBlockId: blockId,
          },
        }

        this.dag.nodes.set(newNodeId, newNode)
      }
    }

    // Step 2: Wire edges between the new branch nodes
    this.wireExpandedBranchEdges(
      parallelId,
      blocksInParallel,
      existingBranchCount,
      targetBranchCount
    )

    // Step 3: Update metadata on existing nodes to reflect new total
    this.updateExistingBranchMetadata(blocksInParallel, existingBranchCount, targetBranchCount)

    // Step 4: Identify entry nodes AFTER edges are wired
    // Entry nodes are those with no INTERNAL incoming edges (edges from outside parallel don't count)
    const newEntryNodes: string[] = []
    for (const blockId of blocksInParallel) {
      const branch0NodeId = buildBranchNodeId(blockId, 0)
      const templateNode = this.dag.nodes.get(branch0NodeId)
      if (!templateNode) continue

      // Check if template has any INTERNAL incoming edges
      let hasInternalIncoming = false
      for (const incomingId of templateNode.incomingEdges) {
        const baseIncomingId = extractBaseBlockId(incomingId)
        if (blocksInParallelSet.has(baseIncomingId)) {
          hasInternalIncoming = true
          break
        }
      }

      // If no internal incoming edges, the new branches of this block are entry nodes
      if (!hasInternalIncoming) {
        for (
          let branchIndex = existingBranchCount;
          branchIndex < targetBranchCount;
          branchIndex++
        ) {
          newEntryNodes.push(buildBranchNodeId(blockId, branchIndex))
        }
      }
    }

    return newEntryNodes
  }

  /**
   * Wire edges between expanded branch nodes by replicating the edge pattern from branch 0.
   * Handles both internal edges (within the parallel) and exit edges (to blocks after the parallel).
   */
  private wireExpandedBranchEdges(
    parallelId: string,
    blocksInParallel: string[],
    existingBranchCount: number,
    targetBranchCount: number
  ): void {
    const blocksInParallelSet = new Set(blocksInParallel)

    // For each block, look at branch 0's outgoing edges and replicate for new branches
    for (const blockId of blocksInParallel) {
      const branch0NodeId = buildBranchNodeId(blockId, 0)
      const branch0Node = this.dag.nodes.get(branch0NodeId)

      if (!branch0Node) continue

      // Replicate outgoing edges for each new branch
      for (const [, edge] of branch0Node.outgoingEdges) {
        // Use edge.target (the actual target node ID), not the Map key which may be a formatted edge ID
        const actualTargetNodeId = edge.target

        // Extract the base target block ID
        const baseTargetId = extractBaseBlockId(actualTargetNodeId)

        // Check if target is inside or outside the parallel
        const isInternalEdge = blocksInParallelSet.has(baseTargetId)

        for (
          let branchIndex = existingBranchCount;
          branchIndex < targetBranchCount;
          branchIndex++
        ) {
          const sourceNodeId = buildBranchNodeId(blockId, branchIndex)
          const sourceNode = this.dag.nodes.get(sourceNodeId)

          if (!sourceNode) continue

          if (isInternalEdge) {
            // Internal edge: wire to the corresponding branch of the target
            const newTargetNodeId = buildBranchNodeId(baseTargetId, branchIndex)
            const targetNode = this.dag.nodes.get(newTargetNodeId)

            if (targetNode) {
              sourceNode.outgoingEdges.set(newTargetNodeId, {
                target: newTargetNodeId,
                sourceHandle: edge.sourceHandle,
                targetHandle: edge.targetHandle,
              })
              targetNode.incomingEdges.add(sourceNodeId)
            }
          } else {
            // Exit edge: wire to the same external target (blocks after the parallel)
            // All branches point to the same external node
            const externalTargetNode = this.dag.nodes.get(actualTargetNodeId)

            if (externalTargetNode) {
              sourceNode.outgoingEdges.set(actualTargetNodeId, {
                target: actualTargetNodeId,
                sourceHandle: edge.sourceHandle,
                targetHandle: edge.targetHandle,
              })
              // Add incoming edge from this new branch to the external node
              externalTargetNode.incomingEdges.add(sourceNodeId)
            }
          }
        }
      }
    }
  }

  /**
   * Update existing branch nodes' metadata to reflect the new total branch count.
   */
  private updateExistingBranchMetadata(
    blocksInParallel: string[],
    existingBranchCount: number,
    targetBranchCount: number
  ): void {
    for (const blockId of blocksInParallel) {
      for (let branchIndex = 0; branchIndex < existingBranchCount; branchIndex++) {
        const nodeId = buildBranchNodeId(blockId, branchIndex)
        const node = this.dag.nodes.get(nodeId)
        if (node) {
          node.metadata.branchTotal = targetBranchCount
        }
      }
    }
  }

  private resolveDistributionItems(ctx: ExecutionContext, config: SerializedParallel): any[] {
    if (config.distribution === undefined || config.distribution === null) {
      return []
    }
    return resolveArrayInput(ctx, config.distribution, this.resolver)
  }

  handleParallelBranchCompletion(
    ctx: ExecutionContext,
    parallelId: string,
    nodeId: string,
    output: NormalizedBlockOutput
  ): boolean {
    const scope = ctx.parallelExecutions?.get(parallelId)
    if (!scope) {
      logger.warn('Parallel scope not found for branch completion', { parallelId, nodeId })
      return false
    }

    const branchIndex = extractBranchIndex(nodeId)
    if (branchIndex === null) {
      logger.warn('Could not extract branch index from node ID', { nodeId })
      return false
    }

    if (!scope.branchOutputs.has(branchIndex)) {
      scope.branchOutputs.set(branchIndex, [])
    }
    scope.branchOutputs.get(branchIndex)!.push(output)
    scope.completedCount++

    const allComplete = scope.completedCount >= scope.totalExpectedNodes
    return allComplete
  }

  aggregateParallelResults(ctx: ExecutionContext, parallelId: string): ParallelAggregationResult {
    const scope = ctx.parallelExecutions?.get(parallelId)
    if (!scope) {
      logger.error('Parallel scope not found for aggregation', { parallelId })
      return { allBranchesComplete: false }
    }

    const results: NormalizedBlockOutput[][] = []
    for (let i = 0; i < scope.totalBranches; i++) {
      const branchOutputs = scope.branchOutputs.get(i) || []
      results.push(branchOutputs)
    }
    this.state.setBlockOutput(parallelId, {
      results,
    })
    return {
      allBranchesComplete: true,
      results,
      completedBranches: scope.totalBranches,
      totalBranches: scope.totalBranches,
    }
  }
  extractBranchMetadata(nodeId: string): ParallelBranchMetadata | null {
    const branchIndex = extractBranchIndex(nodeId)
    if (branchIndex === null) {
      return null
    }

    const baseId = extractBaseBlockId(nodeId)
    const parallelId = this.findParallelIdForNode(baseId)
    if (!parallelId) {
      return null
    }
    const parallelConfig = this.dag.parallelConfigs.get(parallelId)
    if (!parallelConfig) {
      return null
    }
    const { totalBranches, distributionItem } = this.getParallelConfigInfo(
      parallelConfig,
      branchIndex
    )
    return {
      branchIndex,
      branchTotal: totalBranches,
      distributionItem,
      parallelId,
    }
  }

  getParallelScope(ctx: ExecutionContext, parallelId: string): ParallelScope | undefined {
    return ctx.parallelExecutions?.get(parallelId)
  }

  findParallelIdForNode(baseNodeId: string): string | undefined {
    for (const [parallelId, config] of this.dag.parallelConfigs) {
      const parallelConfig = config as ParallelConfigWithNodes
      if (parallelConfig.nodes?.includes(baseNodeId)) {
        return parallelId
      }
    }
    return undefined
  }

  private getParallelConfigInfo(
    parallelConfig: SerializedParallel,
    branchIndex: number
  ): { totalBranches: number; distributionItem?: any } {
    const distributionItems = parseDistributionItems(parallelConfig)
    const totalBranches = calculateBranchCount(parallelConfig, distributionItems)

    let distributionItem: any
    if (Array.isArray(distributionItems) && branchIndex < distributionItems.length) {
      distributionItem = distributionItems[branchIndex]
    }
    return { totalBranches, distributionItem }
  }
}
