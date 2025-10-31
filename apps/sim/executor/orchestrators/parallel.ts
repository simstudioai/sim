import { createLogger } from '@/lib/logs/console/logger'
import type { NormalizedBlockOutput } from '@/executor/types'
import { calculateBranchCount, parseDistributionItems } from '@/executor/utils/subflow-utils'
import type { SerializedParallel } from '@/serializer/types'
import type { DAG } from '../dag/builder'
import type { ExecutionState, ParallelScope } from '../execution/state'

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
  constructor(
    private dag: DAG,
    private state: ExecutionState
  ) {}

  initializeParallelScope(
    parallelId: string,
    totalBranches: number,
    terminalNodesCount = 1
  ): ParallelScope {
    const scope: ParallelScope = {
      parallelId,
      totalBranches,
      branchOutputs: new Map(),
      completedCount: 0,
      totalExpectedNodes: totalBranches * terminalNodesCount,
    }
    this.state.setParallelScope(parallelId, scope)
    logger.debug('Initialized parallel scope', {
      parallelId,
      totalBranches,
      terminalNodesCount,
      totalExpectedNodes: scope.totalExpectedNodes,
    })
    return scope
  }

  handleParallelBranchCompletion(
    parallelId: string,
    nodeId: string,
    output: NormalizedBlockOutput
  ): boolean {
    const scope = this.state.getParallelScope(parallelId)
    if (!scope) {
      logger.warn('Parallel scope not found for branch completion', { parallelId, nodeId })
      return false
    }

    const branchIndex = this.extractBranchIndex(nodeId)
    if (branchIndex === null) {
      logger.warn('Could not extract branch index from node ID', { nodeId })
      return false
    }

    if (!scope.branchOutputs.has(branchIndex)) {
      scope.branchOutputs.set(branchIndex, [])
    }
    scope.branchOutputs.get(branchIndex)!.push(output)
    scope.completedCount++
    logger.debug('Recorded parallel branch output', {
      parallelId,
      branchIndex,
      nodeId,
      completedCount: scope.completedCount,
      totalExpected: scope.totalExpectedNodes,
    })

    const allComplete = scope.completedCount >= scope.totalExpectedNodes
    if (allComplete) {
      logger.debug('All parallel branches completed', {
        parallelId,
        totalBranches: scope.totalBranches,
        completedNodes: scope.completedCount,
      })
    }
    return allComplete
  }

  aggregateParallelResults(parallelId: string): ParallelAggregationResult {
    const scope = this.state.getParallelScope(parallelId)
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
    logger.debug('Aggregated parallel results', {
      parallelId,
      totalBranches: scope.totalBranches,
      nodesPerBranch: results[0]?.length || 0,
      totalOutputs: scope.completedCount,
    })
    return {
      allBranchesComplete: true,
      results,
      completedBranches: scope.totalBranches,
      totalBranches: scope.totalBranches,
    }
  }
  extractBranchMetadata(nodeId: string): ParallelBranchMetadata | null {
    const branchIndex = this.extractBranchIndex(nodeId)
    if (branchIndex === null) {
      return null
    }

    const baseId = this.extractBaseId(nodeId)
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

  getParallelScope(parallelId: string): ParallelScope | undefined {
    return this.state.getParallelScope(parallelId)
  }

  findParallelIdForNode(baseNodeId: string): string | undefined {
    for (const [parallelId, config] of this.dag.parallelConfigs) {
      const nodes = (config as any).nodes || []
      if (nodes.includes(baseNodeId)) {
        return parallelId
      }
    }
    return undefined
  }

  isParallelBranchNode(nodeId: string): boolean {
    return /₍\d+₎$/.test(nodeId)
  }

  private extractBranchIndex(nodeId: string): number | null {
    const match = nodeId.match(/₍(\d+)₎$/)
    return match ? Number.parseInt(match[1], 10) : null
  }

  private extractBaseId(nodeId: string): string {
    return nodeId.replace(/₍\d+₎$/, '')
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
