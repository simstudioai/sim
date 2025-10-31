/**
 * NodeExecutionOrchestrator
 * 
 * Manages the lifecycle of individual node execution:
 * - Node execution delegation to BlockExecutor
 * - Completion handling (loop vs parallel vs regular nodes)
 * - Detection of node types (loop, parallel, sentinel)
 * - Coordination with LoopOrchestrator and ParallelOrchestrator
 * 
 * This is the single source of truth for node execution lifecycle.
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { NormalizedBlockOutput } from '@/executor/types'
import type { DAG, DAGNode } from './dag-builder'
import type { ExecutionState } from './execution-state'
import type { BlockExecutor } from './block-executor'
import type { LoopOrchestrator } from './loop-orchestrator'
import type { ParallelOrchestrator } from './parallel-orchestrator'

const logger = createLogger('NodeExecutionOrchestrator')

/**
 * Result from node execution
 */
export interface NodeExecutionResult {
  nodeId: string
  output: NormalizedBlockOutput
  isFinalOutput: boolean
}

/**
 * Orchestrates the execution lifecycle of nodes
 */
export class NodeExecutionOrchestrator {
  constructor(
    private dag: DAG,
    private state: ExecutionState,
    private blockExecutor: BlockExecutor,
    private loopOrchestrator: LoopOrchestrator,
    private parallelOrchestrator: ParallelOrchestrator
  ) {}

  /**
   * Execute a single node
   * Returns the output and whether this should be the final output
   */
  async executeNode(nodeId: string, context: any): Promise<NodeExecutionResult> {
    const node = this.dag.nodes.get(nodeId)
    if (!node) {
      throw new Error(`Node not found in DAG: ${nodeId}`)
    }

    if (this.state.hasExecuted(nodeId)) {
      logger.debug('Node already executed, skipping', { nodeId })
      
      // Return cached output
      const output = this.state.getBlockOutput(nodeId) || {}
      return {
        nodeId,
        output,
        isFinalOutput: false,
      }
    }

    // Initialize loop scope if needed
    const loopId = node.metadata.loopId
    if (loopId && !this.loopOrchestrator.getLoopScope(loopId)) {
      logger.debug('Initializing loop scope before first execution', { loopId, nodeId })
      this.loopOrchestrator.initializeLoopScope(loopId, context)
    }

    // Check if loop node should execute
    if (loopId && !this.loopOrchestrator.shouldExecuteLoopNode(nodeId, loopId, context)) {
      logger.debug('Loop node should not execute', { nodeId, loopId })
      return {
        nodeId,
        output: {},
        isFinalOutput: false,
      }
    }

    logger.debug('Executing node', { nodeId, blockType: node.block.metadata?.id })

    // Execute the node using BlockExecutor
    const output = await this.blockExecutor.execute(node, node.block, context)

    // Determine if this is the final output (no outgoing edges)
    const isFinalOutput = node.outgoingEdges.size === 0

    return {
      nodeId,
      output,
      isFinalOutput,
    }
  }

  /**
   * Handle node completion
   * Determines if node is loop, parallel, or regular and handles accordingly
   */
  async handleNodeCompletion(
    nodeId: string,
    output: NormalizedBlockOutput,
    context: any
  ): Promise<void> {
    const node = this.dag.nodes.get(nodeId)
    if (!node) {
      logger.error('Node not found during completion handling', { nodeId })
      return
    }

    logger.debug('Handling node completion', {
      nodeId: node.id,
      hasLoopId: !!node.metadata.loopId,
      isParallelBranch: !!node.metadata.isParallelBranch,
      isSentinel: !!node.metadata.isSentinel,
    })

    const loopId = node.metadata.loopId
    const isParallelBranch = node.metadata.isParallelBranch
    const isSentinel = node.metadata.isSentinel

    // Sentinel nodes are handled as regular nodes
    // They manage their own loop logic via LoopOrchestrator
    if (isSentinel) {
      logger.debug('Handling sentinel node', { nodeId: node.id, loopId })
      this.handleRegularNodeCompletion(node, output, context)
    } else if (loopId) {
      logger.debug('Handling loop node', { nodeId: node.id, loopId })
      this.handleLoopNodeCompletion(node, output, loopId)
    } else if (isParallelBranch) {
      const parallelId = this.findParallelIdForNode(node.id)
      if (parallelId) {
        logger.debug('Handling parallel node', { nodeId: node.id, parallelId })
        this.handleParallelNodeCompletion(node, output, parallelId)
      } else {
        this.handleRegularNodeCompletion(node, output, context)
      }
    } else {
      logger.debug('Handling regular node', { nodeId: node.id })
      this.handleRegularNodeCompletion(node, output, context)
    }
  }

  /**
   * PRIVATE METHODS
   */

  /**
   * Handle completion of a loop node
   */
  private handleLoopNodeCompletion(
    node: DAGNode,
    output: NormalizedBlockOutput,
    loopId: string
  ): void {
    // Delegate to LoopOrchestrator for output storage
    this.loopOrchestrator.storeLoopNodeOutput(loopId, node.id, output)

    // Store output in execution state
    this.state.setBlockOutput(node.id, output)
  }

  /**
   * Handle completion of a parallel node
   */
  private handleParallelNodeCompletion(
    node: DAGNode,
    output: NormalizedBlockOutput,
    parallelId: string
  ): void {
    let scope = this.parallelOrchestrator.getParallelScope(parallelId)

    if (!scope) {
      // Initialize parallel scope using ParallelOrchestrator
      const totalBranches = node.metadata.branchTotal || 1

      const parallelConfig = this.dag.parallelConfigs.get(parallelId)
      const nodesInParallel = (parallelConfig as any)?.nodes?.length || 1

      this.parallelOrchestrator.initializeParallelScope(parallelId, totalBranches, nodesInParallel)
    }

    // Delegate to ParallelOrchestrator for branch completion handling
    const allComplete = this.parallelOrchestrator.handleParallelBranchCompletion(
      parallelId,
      node.id,
      output
    )

    if (allComplete) {
      // Aggregate results when all branches complete
      this.parallelOrchestrator.aggregateParallelResults(parallelId)
    }

    // Store output (parallel edges will be processed separately)
    this.state.setBlockOutput(node.id, output)
  }

  /**
   * Handle completion of a regular node
   */
  private handleRegularNodeCompletion(
    node: DAGNode,
    output: NormalizedBlockOutput,
    context: any
  ): void {
    // Store output in execution state
    this.state.setBlockOutput(node.id, output)

    // If this is a sentinel_end with loop_continue, clear state for next iteration
    if (
      node.metadata.isSentinel &&
      node.metadata.sentinelType === 'end' &&
      output.selectedRoute === 'loop_continue'
    ) {
      const loopId = node.metadata.loopId
      if (loopId) {
        logger.debug('Preparing loop for next iteration', { loopId })

        // Delegate to LoopOrchestrator for state clearing and edge restoration
        this.loopOrchestrator.clearLoopExecutionState(loopId, this.state.executedBlocks)
        this.loopOrchestrator.restoreLoopEdges(loopId)
      }
    }
  }

  /**
   * Find which parallel configuration a node belongs to
   */
  private findParallelIdForNode(nodeId: string): string | undefined {
    const baseId = nodeId.replace(/₍\d+₎$/, '')
    return this.parallelOrchestrator.findParallelIdForNode(baseId)
  }
}

