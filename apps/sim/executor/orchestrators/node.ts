import { createLogger } from '@sim/logger'
import { EDGE } from '@/executor/constants'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { BlockExecutor } from '@/executor/execution/block-executor'
import type { BlockStateController } from '@/executor/execution/types'
import type { LoopOrchestrator } from '@/executor/orchestrators/loop'
import type { ParallelOrchestrator } from '@/executor/orchestrators/parallel'
import type { ExecutionContext, NormalizedBlockOutput } from '@/executor/types'
import { extractBaseBlockId } from '@/executor/utils/subflow-utils'

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

    if (ctx.runFromBlockContext && !ctx.runFromBlockContext.dirtySet.has(nodeId)) {
      const cachedOutput = this.state.getBlockOutput(nodeId) || {}
      logger.debug('Skipping non-dirty block in run-from-block mode', { nodeId })
      return {
        nodeId,
        output: cachedOutput,
        isFinalOutput: false,
      }
    }

    const isDirtyBlock = ctx.runFromBlockContext?.dirtySet.has(nodeId) ?? false
    if (!isDirtyBlock && this.state.hasExecuted(nodeId)) {
      const output = this.state.getBlockOutput(nodeId) || {}
      return {
        nodeId,
        output,
        isFinalOutput: false,
      }
    }

    const loopId = node.metadata.loopId
    if (loopId && !this.loopOrchestrator.getLoopScope(ctx, loopId)) {
      this.loopOrchestrator.initializeLoopScope(ctx, loopId)
    }

    if (loopId && !this.loopOrchestrator.shouldExecuteLoopNode(ctx, nodeId, loopId)) {
      return {
        nodeId,
        output: {},
        isFinalOutput: false,
      }
    }

    const parallelId = node.metadata.parallelId
    if (parallelId && !this.parallelOrchestrator.getParallelScope(ctx, parallelId)) {
      const parallelConfig = this.dag.parallelConfigs.get(parallelId)
      const nodesInParallel = parallelConfig?.nodes?.length || 1
      this.parallelOrchestrator.initializeParallelScope(ctx, parallelId, nodesInParallel)
    }

    if (node.metadata.isSentinel) {
      const output = await this.handleSentinel(ctx, node)
      const isFinalOutput = node.outgoingEdges.size === 0
      return {
        nodeId,
        output,
        isFinalOutput,
      }
    }

    const output = await this.blockExecutor.execute(ctx, node, node.block)
    const isFinalOutput = node.outgoingEdges.size === 0
    return {
      nodeId,
      output,
      isFinalOutput,
    }
  }

  private async handleSentinel(
    ctx: ExecutionContext,
    node: DAGNode
  ): Promise<NormalizedBlockOutput> {
    const sentinelType = node.metadata.sentinelType
    const loopId = node.metadata.loopId
    const parallelId = node.metadata.parallelId
    const isParallelSentinel = node.metadata.isParallelSentinel

    if (isParallelSentinel) {
      return this.handleParallelSentinel(ctx, node, sentinelType, parallelId)
    }

    switch (sentinelType) {
      case 'start': {
        if (loopId) {
          const shouldExecute = await this.loopOrchestrator.evaluateInitialCondition(ctx, loopId)
          if (!shouldExecute) {
            logger.info('Loop initial condition false, skipping loop body', { loopId })
            return {
              sentinelStart: true,
              shouldExit: true,
              selectedRoute: EDGE.LOOP_EXIT,
            }
          }
        }
        return { sentinelStart: true }
      }

      case 'end': {
        if (!loopId) {
          logger.warn('Sentinel end called without loopId')
          return { shouldExit: true, selectedRoute: EDGE.LOOP_EXIT }
        }

        const continuationResult = await this.loopOrchestrator.evaluateLoopContinuation(ctx, loopId)

        if (continuationResult.shouldContinue) {
          return {
            shouldContinue: true,
            shouldExit: false,
            selectedRoute: continuationResult.selectedRoute,
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

  private handleParallelSentinel(
    ctx: ExecutionContext,
    node: DAGNode,
    sentinelType: string | undefined,
    parallelId: string | undefined
  ): NormalizedBlockOutput {
    if (!parallelId) {
      logger.warn('Parallel sentinel called without parallelId')
      return {}
    }

    if (sentinelType === 'start') {
      if (!this.parallelOrchestrator.getParallelScope(ctx, parallelId)) {
        const parallelConfig = this.dag.parallelConfigs.get(parallelId)
        if (parallelConfig) {
          const nodesInParallel = parallelConfig.nodes?.length || 1
          this.parallelOrchestrator.initializeParallelScope(ctx, parallelId, nodesInParallel)
        }
      }

      const scope = this.parallelOrchestrator.getParallelScope(ctx, parallelId)
      if (scope?.isEmpty) {
        logger.info('Parallel has empty distribution, skipping parallel body', { parallelId })
        return {
          sentinelStart: true,
          shouldExit: true,
          selectedRoute: EDGE.PARALLEL_EXIT,
        }
      }

      return { sentinelStart: true }
    }

    if (sentinelType === 'end') {
      const result = this.parallelOrchestrator.aggregateParallelResults(ctx, parallelId)
      return {
        results: result.results || [],
        sentinelEnd: true,
        selectedRoute: EDGE.PARALLEL_EXIT,
        totalBranches: result.totalBranches,
      }
    }

    logger.warn('Unknown parallel sentinel type', { sentinelType })
    return {}
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

    const loopId = node.metadata.loopId
    const isParallelBranch = node.metadata.isParallelBranch
    const isSentinel = node.metadata.isSentinel
    if (isSentinel) {
      this.handleRegularNodeCompletion(ctx, node, output)
    } else if (loopId) {
      this.handleLoopNodeCompletion(ctx, node, output, loopId)
    } else if (isParallelBranch) {
      const parallelId = this.findParallelIdForNode(node.id)
      if (parallelId) {
        this.handleParallelNodeCompletion(ctx, node, output, parallelId)
      } else {
        this.handleRegularNodeCompletion(ctx, node, output)
      }
    } else {
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
      const parallelConfig = this.dag.parallelConfigs.get(parallelId)
      const nodesInParallel = parallelConfig?.nodes?.length || 1
      this.parallelOrchestrator.initializeParallelScope(ctx, parallelId, nodesInParallel)
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
