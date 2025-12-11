import { createLogger } from '@/lib/logs/console/logger'
import type { DAG } from '@/executor/dag/builder'
import type { ParallelScope } from '@/executor/execution/state'
import type { BlockStateWriter } from '@/executor/execution/types'
import type { ExecutionContext, NormalizedBlockOutput } from '@/executor/types'
import type { ParallelConfigWithNodes } from '@/executor/types/parallel'
import {
  calculateBranchCount,
  extractBaseBlockId,
  extractBranchIndex,
  parseDistributionItems,
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

  constructor(
    private dag: DAG,
    private state: BlockStateWriter
  ) {}

  setResolver(resolver: VariableResolver): void {
    this.resolver = resolver
  }

  initializeParallelScope(
    ctx: ExecutionContext,
    parallelId: string,
    totalBranches: number,
    terminalNodesCount = 1
  ): ParallelScope {
    const parallelConfig = this.dag.parallelConfigs.get(parallelId)
    const items = parallelConfig ? this.resolveDistributionItems(ctx, parallelConfig) : undefined

    const scope: ParallelScope = {
      parallelId,
      totalBranches,
      branchOutputs: new Map(),
      completedCount: 0,
      totalExpectedNodes: totalBranches * terminalNodesCount,
      items,
    }
    if (!ctx.parallelExecutions) {
      ctx.parallelExecutions = new Map()
    }
    ctx.parallelExecutions.set(parallelId, scope)
    return scope
  }

  /**
   * Resolve distribution items at runtime, handling references like <previousBlock.items>
   * This mirrors how LoopOrchestrator.resolveForEachItems works.
   */
  private resolveDistributionItems(ctx: ExecutionContext, config: SerializedParallel): any[] {
    const rawItems = config.distribution

    if (rawItems === undefined || rawItems === null) {
      return []
    }

    // Already an array - return as-is
    if (Array.isArray(rawItems)) {
      return rawItems
    }

    // Object - convert to entries array (consistent with loop forEach behavior)
    if (typeof rawItems === 'object') {
      return Object.entries(rawItems)
    }

    // String handling
    if (typeof rawItems === 'string') {
      // Resolve references at runtime using the variable resolver
      if (rawItems.startsWith('<') && rawItems.endsWith('>') && this.resolver) {
        const resolved = this.resolver.resolveSingleReference(ctx, '', rawItems)
        if (Array.isArray(resolved)) {
          return resolved
        }
        if (typeof resolved === 'object' && resolved !== null) {
          return Object.entries(resolved)
        }
        logger.warn('Distribution reference did not resolve to array or object', {
          rawItems,
          resolved,
        })
        return []
      }

      // Try to parse as JSON
      try {
        const normalized = rawItems.replace(/'/g, '"')
        const parsed = JSON.parse(normalized)
        if (Array.isArray(parsed)) {
          return parsed
        }
        if (typeof parsed === 'object' && parsed !== null) {
          return Object.entries(parsed)
        }
        return []
      } catch (error) {
        logger.error('Failed to parse distribution items', { rawItems, error })
        return []
      }
    }

    return []
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
