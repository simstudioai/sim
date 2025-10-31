/**
 * ParallelOrchestrator
 * 
 * Consolidates ALL parallel-related logic in one place:
 * - Parallel scope initialization
 * - Branch tracking and completion detection
 * - Output collection from all branches
 * - Result aggregation
 * - Branch metadata management
 * 
 * This is the single source of truth for parallel execution.
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { NormalizedBlockOutput } from '@/executor/types'
import type { SerializedParallel } from '@/serializer/types'
import type { ExecutionState, ParallelScope } from '../dag/execution-state'
import type { DAG } from '../dag/dag-builder'

const logger = createLogger('ParallelOrchestrator')

/**
 * Metadata about a parallel branch
 */
export interface ParallelBranchMetadata {
  branchIndex: number
  branchTotal: number
  distributionItem?: any
  parallelId: string
}

/**
 * Result of parallel aggregation
 */
export interface ParallelAggregationResult {
  allBranchesComplete: boolean
  results?: NormalizedBlockOutput[][]
  completedBranches?: number
  totalBranches?: number
}

/**
 * Manages all aspects of parallel execution throughout the workflow lifecycle
 */
export class ParallelOrchestrator {
  constructor(
    private dag: DAG,
    private state: ExecutionState
  ) {}

  /**
   * Initialize a parallel scope before execution
   * 
   * @param parallelId - ID of the parallel configuration
   * @param totalBranches - Total number of parallel branches
   * @param terminalNodesCount - Number of terminal nodes per branch (for completion tracking)
   */
  initializeParallelScope(
    parallelId: string,
    totalBranches: number,
    terminalNodesCount: number = 1
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

  /**
   * Handle completion of a parallel branch node
   * Tracks outputs and detects when all branches complete
   * 
   * @returns True if all branches are now complete, false otherwise
   */
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

    // Initialize branch output array if needed
    if (!scope.branchOutputs.has(branchIndex)) {
      scope.branchOutputs.set(branchIndex, [])
    }

    // Append output to this branch's output array
    scope.branchOutputs.get(branchIndex)!.push(output)
    scope.completedCount++

    logger.debug('Recorded parallel branch output', {
      parallelId,
      branchIndex,
      nodeId,
      completedCount: scope.completedCount,
      totalExpected: scope.totalExpectedNodes,
    })

    // Check if all branches complete
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

  /**
   * Aggregate results from all parallel branches
   * Creates a 2D array: results[branchIndex][nodeOutputIndex]
   * 
   * Stores aggregated results in ExecutionState
   */
  aggregateParallelResults(parallelId: string): ParallelAggregationResult {
    const scope = this.state.getParallelScope(parallelId)
    if (!scope) {
      logger.error('Parallel scope not found for aggregation', { parallelId })
      return { allBranchesComplete: false }
    }

    // Collect outputs from all branches in order
    const results: NormalizedBlockOutput[][] = []

    for (let i = 0; i < scope.totalBranches; i++) {
      const branchOutputs = scope.branchOutputs.get(i) || []
      results.push(branchOutputs)
    }

    // Store aggregated results
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

  /**
   * Extract branch metadata from a node ID
   * Returns null if node is not a parallel branch
   */
  extractBranchMetadata(nodeId: string): ParallelBranchMetadata | null {
    const branchIndex = this.extractBranchIndex(nodeId)
    if (branchIndex === null) {
      return null
    }

    // Find which parallel this node belongs to
    const baseId = this.extractBaseId(nodeId)
    const parallelId = this.findParallelIdForNode(baseId)
    if (!parallelId) {
      return null
    }

    const parallelConfig = this.dag.parallelConfigs.get(parallelId)
    if (!parallelConfig) {
      return null
    }

    // Get branch total and distribution item
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

  /**
   * Get the parallel scope for a parallel ID
   */
  getParallelScope(parallelId: string): ParallelScope | undefined {
    return this.state.getParallelScope(parallelId)
  }

  /**
   * Find which parallel configuration a node belongs to
   */
  findParallelIdForNode(baseNodeId: string): string | undefined {
    for (const [parallelId, config] of this.dag.parallelConfigs) {
      const nodes = (config as any).nodes || []
      if (nodes.includes(baseNodeId)) {
        return parallelId
      }
    }
    return undefined
  }

  /**
   * Check if a node ID represents a parallel branch
   */
  isParallelBranchNode(nodeId: string): boolean {
    return /₍\d+₎$/.test(nodeId)
  }

  /**
   * PRIVATE METHODS
   */

  /**
   * Extract branch index from node ID
   * Example: "blockId₍2₎" → 2
   */
  private extractBranchIndex(nodeId: string): number | null {
    const match = nodeId.match(/₍(\d+)₎$/)
    return match ? parseInt(match[1], 10) : null
  }

  /**
   * Extract base ID from node ID (removes parallel branch suffix)
   * Example: "blockId₍2₎" → "blockId"
   */
  private extractBaseId(nodeId: string): string {
    return nodeId.replace(/₍\d+₎$/, '')
  }

  /**
   * Get parallel configuration information for a specific branch
   */
  private getParallelConfigInfo(
    parallelConfig: SerializedParallel,
    branchIndex: number
  ): { totalBranches: number; distributionItem?: any } {
    const config = parallelConfig as any

    // Parse distribution items
    let distributionItems = config.distributionItems || config.distribution || []

    if (typeof distributionItems === 'string' && !distributionItems.startsWith('<')) {
      try {
        distributionItems = JSON.parse(distributionItems.replace(/'/g, '"'))
      } catch (e) {
        logger.error('Failed to parse distribution items', { distributionItems })
        distributionItems = []
      }
    }

    // Calculate total branches
    let totalBranches = config.parallelCount || config.count || 1
    if (config.parallelType === 'collection' && Array.isArray(distributionItems)) {
      totalBranches = distributionItems.length
    }

    // Get distribution item for this branch
    let distributionItem: any = undefined
    if (Array.isArray(distributionItems) && branchIndex < distributionItems.length) {
      distributionItem = distributionItems[branchIndex]
    }

    return { totalBranches, distributionItem }
  }
}

