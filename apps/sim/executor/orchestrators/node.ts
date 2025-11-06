import { createLogger } from '@/lib/logs/console/logger'
import { EDGE } from '@/executor/consts'
import type { ExecutionContext, NormalizedBlockOutput } from '@/executor/types'
import { extractBaseBlockId } from '@/executor/utils/subflow-utils'
import type { DAG, DAGNode } from '../dag/builder'
import type { BlockExecutor } from '../execution/block-executor'
import type { BlockStateController } from '../execution/types'
import type { LoopOrchestrator } from './loop'
import type { ParallelOrchestrator } from './parallel'

const logger = createLogger('NodeExecutionOrchestrator')

export interface NodeExecutionResult {
  nodeId: string
  output: NormalizedBlockOutput
  isFinalOutput: boolean
}

export class NodeExecutionOrchestrator {
  constructor(
    private dag: DAG,
    private state: BlockStateController,
    private blockExecutor: BlockExecutor,
    private loopOrchestrator: LoopOrchestrator,
    private parallelOrchestrator: ParallelOrchestrator
  ) {}

  async executeNode(ctx: ExecutionContext, nodeId: string): Promise<NodeExecutionResult> {
    const node = this.dag.nodes.get(nodeId)
    if (!node) {
      throw new Error(`Node not found in DAG: ${nodeId}`)
    }

    if (this.state.hasExecuted(nodeId)) {
      logger.debug('Node already executed, skipping', { nodeId })
      const output = this.state.getBlockOutput(nodeId) || {}
      return {
        nodeId,
        output,
        isFinalOutput: false,
      }
    }

    const loopId = node.metadata.loopId
    if (loopId && !this.loopOrchestrator.getLoopScope(ctx, loopId)) {
      logger.debug('Initializing loop scope before first execution', { loopId, nodeId })
      this.loopOrchestrator.initializeLoopScope(ctx, loopId)
    }

    if (loopId && !this.loopOrchestrator.shouldExecuteLoopNode(ctx, nodeId, loopId)) {
      logger.debug('Loop node should not execute', { nodeId, loopId })
      return {
        nodeId,
        output: {},
        isFinalOutput: false,
      }
    }

    if (node.metadata.isSentinel) {
      logger.debug('Executing sentinel node', {
        nodeId,
        sentinelType: node.metadata.sentinelType,
        loopId,
      })
      const output = this.handleSentinel(ctx, node)
      const isFinalOutput = node.outgoingEdges.size === 0
      return {
        nodeId,
        output,
        isFinalOutput,
      }
    }

    logger.debug('Executing node', { nodeId, blockType: node.block.metadata?.id })
    const output = await this.blockExecutor.execute(ctx, node, node.block)
    const isFinalOutput = node.outgoingEdges.size === 0
    return {
      nodeId,
      output,
      isFinalOutput,
    }
  }

  private handleSentinel(ctx: ExecutionContext, node: DAGNode): NormalizedBlockOutput {
    const sentinelType = node.metadata.sentinelType
    const loopId = node.metadata.loopId

    switch (sentinelType) {
      case 'start': {
        logger.debug('Sentinel start - loop entry', { nodeId: node.id, loopId })
        return { sentinelStart: true }
      }

      case 'end': {
        logger.debug('Sentinel end - evaluating loop continuation', { nodeId: node.id, loopId })
        if (!loopId) {
          logger.warn('Sentinel end called without loopId')
          return { shouldExit: true, selectedRoute: EDGE.LOOP_EXIT }
        }

        const continuationResult = this.loopOrchestrator.evaluateLoopContinuation(ctx, loopId)
        logger.debug('Loop continuation evaluated', {
          loopId,
          shouldContinue: continuationResult.shouldContinue,
          shouldExit: continuationResult.shouldExit,
          iteration: continuationResult.currentIteration,
        })

        if (continuationResult.shouldContinue) {
          return {
            shouldContinue: true,
            shouldExit: false,
            selectedRoute: continuationResult.selectedRoute,
            loopIteration: continuationResult.currentIteration,
          }
        }

        return {
          results: continuationResult.aggregatedResults || [],
          shouldContinue: false,
          shouldExit: true,
          selectedRoute: continuationResult.selectedRoute,
          totalIterations: continuationResult.aggregatedResults?.length || 0,
        }
      }

      default:
        logger.warn('Unknown sentinel type', { sentinelType })
        return {}
    }
  }

  async handleNodeCompletion(
    ctx: ExecutionContext,
    nodeId: string,
    output: NormalizedBlockOutput
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
    if (isSentinel) {
      logger.debug('Handling sentinel node', { nodeId: node.id, loopId })
      this.handleRegularNodeCompletion(ctx, node, output)
    } else if (loopId) {
      logger.debug('Handling loop node', { nodeId: node.id, loopId })
      this.handleLoopNodeCompletion(ctx, node, output, loopId)
    } else if (isParallelBranch) {
      const parallelId = this.findParallelIdForNode(node.id)
      if (parallelId) {
        logger.debug('Handling parallel node', { nodeId: node.id, parallelId })
        this.handleParallelNodeCompletion(ctx, node, output, parallelId)
      } else {
        this.handleRegularNodeCompletion(ctx, node, output)
      }
    } else {
      logger.debug('Handling regular node', { nodeId: node.id })
      this.handleRegularNodeCompletion(ctx, node, output)
    }
  }

  private handleLoopNodeCompletion(
    ctx: ExecutionContext,
    node: DAGNode,
    output: NormalizedBlockOutput,
    loopId: string
  ): void {
    this.loopOrchestrator.storeLoopNodeOutput(ctx, loopId, node.id, output)
    this.state.setBlockOutput(node.id, output)
  }

  private handleParallelNodeCompletion(
    ctx: ExecutionContext,
    node: DAGNode,
    output: NormalizedBlockOutput,
    parallelId: string
  ): void {
    const scope = this.parallelOrchestrator.getParallelScope(ctx, parallelId)
    if (!scope) {
      const totalBranches = node.metadata.branchTotal || 1
      const parallelConfig = this.dag.parallelConfigs.get(parallelId)
      const nodesInParallel = (parallelConfig as any)?.nodes?.length || 1
      this.parallelOrchestrator.initializeParallelScope(ctx, parallelId, totalBranches, nodesInParallel)
    }
    const allComplete = this.parallelOrchestrator.handleParallelBranchCompletion(
      ctx,
      parallelId,
      node.id,
      output
    )
    if (allComplete) {
      this.parallelOrchestrator.aggregateParallelResults(ctx, parallelId)
    }

    this.state.setBlockOutput(node.id, output)
  }

  private handleRegularNodeCompletion(
    ctx: ExecutionContext,
    node: DAGNode,
    output: NormalizedBlockOutput
  ): void {
    this.state.setBlockOutput(node.id, output)

    if (
      node.metadata.isSentinel &&
      node.metadata.sentinelType === 'end' &&
      output.selectedRoute === 'loop_continue'
    ) {
      const loopId = node.metadata.loopId
      if (loopId) {
        logger.debug('Preparing loop for next iteration', { loopId })
        this.loopOrchestrator.clearLoopExecutionState(loopId)
        this.loopOrchestrator.restoreLoopEdges(loopId)
      }
    }
  }

  private findParallelIdForNode(nodeId: string): string | undefined {
    const baseId = extractBaseBlockId(nodeId)
    return this.parallelOrchestrator.findParallelIdForNode(baseId)
  }
}
