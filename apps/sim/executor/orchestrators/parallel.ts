import { createLogger } from '@sim/logger'
import { DEFAULTS } from '@/executor/constants'
import type { DAG } from '@/executor/dag/builder'
import type { ParallelScope } from '@/executor/execution/state'
import type { BlockStateWriter, ContextExtensions } from '@/executor/execution/types'
import {
  type ExecutionContext,
  getNextExecutionOrder,
  type NormalizedBlockOutput,
} from '@/executor/types'
import type { ParallelConfigWithNodes } from '@/executor/types/parallel'
import { ParallelExpander } from '@/executor/utils/parallel-expansion'
import {
  addSubflowErrorLog,
  extractBranchIndex,
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
  private expander = new ParallelExpander()

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
    terminalNodesCount = 1
  ): ParallelScope {
    const parallelConfig = this.dag.parallelConfigs.get(parallelId)
    if (!parallelConfig) {
      throw new Error(`Parallel config not found: ${parallelId}`)
    }

    let items: any[] | undefined
    let branchCount: number
    let isEmpty = false

    try {
      const resolved = this.resolveBranchCount(ctx, parallelConfig, parallelId)
      branchCount = resolved.branchCount
      items = resolved.items
      isEmpty = resolved.isEmpty ?? false
    } catch (error) {
      const errorMessage = `Parallel Items did not resolve: ${error instanceof Error ? error.message : String(error)}`
      logger.error(errorMessage, { parallelId, distribution: parallelConfig.distribution })
      this.addParallelErrorLog(ctx, parallelId, errorMessage, {
        distribution: parallelConfig.distribution,
      })
      this.setErrorScope(ctx, parallelId, errorMessage)
      throw new Error(errorMessage)
    }

    const branchError = validateMaxCount(
      branchCount,
      DEFAULTS.MAX_PARALLEL_BRANCHES,
      'Parallel branch count'
    )
    if (branchError) {
      logger.error(branchError, { parallelId, branchCount })
      this.addParallelErrorLog(ctx, parallelId, branchError, {
        distribution: parallelConfig.distribution,
        branchCount,
      })
      this.setErrorScope(ctx, parallelId, branchError)
      throw new Error(branchError)
    }

    // Handle empty distribution - skip parallel body
    if (isEmpty || branchCount === 0) {
      const scope: ParallelScope = {
        parallelId,
        totalBranches: 0,
        branchOutputs: new Map(),
        completedCount: 0,
        totalExpectedNodes: 0,
        items: [],
        isEmpty: true,
      }

      if (!ctx.parallelExecutions) {
        ctx.parallelExecutions = new Map()
      }
      ctx.parallelExecutions.set(parallelId, scope)

      // Set empty output for the parallel
      this.state.setBlockOutput(parallelId, { results: [] })

      logger.info('Parallel scope initialized with empty distribution, skipping body', {
        parallelId,
        branchCount: 0,
      })

      return scope
    }

    const { entryNodes } = this.expander.expandParallel(this.dag, parallelId, branchCount, items)

    const scope: ParallelScope = {
      parallelId,
      totalBranches: branchCount,
      branchOutputs: new Map(),
      completedCount: 0,
      totalExpectedNodes: branchCount * terminalNodesCount,
      items,
    }

    if (!ctx.parallelExecutions) {
      ctx.parallelExecutions = new Map()
    }
    ctx.parallelExecutions.set(parallelId, scope)

    const newEntryNodes = entryNodes.filter((nodeId) => !nodeId.endsWith('__branch-0'))
    if (newEntryNodes.length > 0) {
      if (!ctx.pendingDynamicNodes) {
        ctx.pendingDynamicNodes = []
      }
      ctx.pendingDynamicNodes.push(...newEntryNodes)
    }

    logger.info('Parallel scope initialized', {
      parallelId,
      branchCount,
      entryNodeCount: entryNodes.length,
      newEntryNodes: newEntryNodes.length,
    })

    return scope
  }

  private resolveBranchCount(
    ctx: ExecutionContext,
    config: SerializedParallel,
    parallelId: string
  ): { branchCount: number; items?: any[]; isEmpty?: boolean } {
    if (config.parallelType === 'count') {
      return { branchCount: config.count ?? 1 }
    }

    const items = this.resolveDistributionItems(ctx, config)
    if (items.length === 0) {
      logger.info('Parallel has empty distribution, skipping parallel body', { parallelId })
      return { branchCount: 0, items: [], isEmpty: true }
    }

    return { branchCount: items.length, items }
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

  private resolveDistributionItems(ctx: ExecutionContext, config: SerializedParallel): any[] {
    if (config.parallelType === 'count') {
      return []
    }

    if (
      config.distribution === undefined ||
      config.distribution === null ||
      config.distribution === ''
    ) {
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
    const output = { results }
    this.state.setBlockOutput(parallelId, output)

    // Emit onBlockComplete for the parallel container so the UI can track it
    if (this.contextExtensions?.onBlockComplete) {
      const now = new Date().toISOString()
      this.contextExtensions.onBlockComplete(parallelId, 'Parallel', 'parallel', {
        output,
        executionTime: 0,
        startedAt: now,
        executionOrder: getNextExecutionOrder(ctx),
        endedAt: now,
      })
    }

    return {
      allBranchesComplete: true,
      results,
      completedBranches: scope.totalBranches,
      totalBranches: scope.totalBranches,
    }
  }
  extractBranchMetadata(nodeId: string): ParallelBranchMetadata | null {
    const node = this.dag.nodes.get(nodeId)
    if (!node?.metadata.isParallelBranch) {
      return null
    }

    const branchIndex = extractBranchIndex(nodeId)
    if (branchIndex === null) {
      return null
    }

    const parallelId = node.metadata.parallelId
    if (!parallelId) {
      return null
    }

    return {
      branchIndex,
      branchTotal: node.metadata.branchTotal ?? 1,
      distributionItem: node.metadata.distributionItem,
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
}
