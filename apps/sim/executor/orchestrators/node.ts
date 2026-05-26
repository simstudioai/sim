import { createLogger } from '@sim/logger'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { EDGE } from '@/executor/constants'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { BlockExecutor } from '@/executor/execution/block-executor'
import type { BlockStateController } from '@/executor/execution/types'
import type { LoopOrchestrator } from '@/executor/orchestrators/loop'
import type { ParallelOrchestrator } from '@/executor/orchestrators/parallel'
import type { ExecutionContext, NormalizedBlockOutput } from '@/executor/types'
import {
  buildOuterBranchScopedId,
  extractBaseBlockId,
  extractOuterBranchIndex,
} from '@/executor/utils/subflow-utils'

const logger = createLogger('NodeExecutionOrchestrator')

function getResultCount(value: unknown): number {
  if (isLargeValueRef(value)) {
    const preview = value.preview
    if (
      preview &&
      typeof preview === 'object' &&
      typeof (preview as Record<string, unknown>).length === 'number'
    ) {
      return (preview as { length: number }).length
    }
  }
  return Array.isArray(value) ? value.length : 0
}

function getSubflowResultOutput(output: NormalizedBlockOutput): NormalizedBlockOutput {
  return { results: output.results ?? [] }
}

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

    const loopId = node.metadata.subflowType === 'loop' ? node.metadata.subflowId : undefined
    if (loopId && !this.loopOrchestrator.getLoopScope(ctx, loopId)) {
      await this.loopOrchestrator.initializeLoopScope(ctx, loopId)
    }

    const parallelId =
      node.metadata.subflowType === 'parallel' ? node.metadata.subflowId : undefined
    if (parallelId && !this.parallelOrchestrator.getParallelScope(ctx, parallelId)) {
      await this.parallelOrchestrator.initializeParallelScope(ctx, parallelId)
    }

    if (node.metadata.isSentinel) {
      const output = await this.handleSentinel(ctx, node)
      const isFinalOutput = this.isFinalSentinelOutput(node, output)
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

  private isFinalSentinelOutput(node: DAGNode, output: NormalizedBlockOutput): boolean {
    const selectedRoute = output.selectedRoute
    if (selectedRoute === EDGE.LOOP_CONTINUE || selectedRoute === EDGE.PARALLEL_CONTINUE) {
      return false
    }

    if (selectedRoute === EDGE.LOOP_EXIT || selectedRoute === EDGE.PARALLEL_EXIT) {
      return !Array.from(node.outgoingEdges.values()).some(
        (edge) => edge.sourceHandle === selectedRoute
      )
    }

    return node.outgoingEdges.size === 0
  }

  private async handleSentinel(
    ctx: ExecutionContext,
    node: DAGNode
  ): Promise<NormalizedBlockOutput> {
    const sentinelType = node.metadata.sentinelType
    const subflowType = node.metadata.subflowType
    const subflowId = node.metadata.subflowId

    if (!subflowType || !subflowId) {
      logger.warn('Sentinel missing subflow metadata', { nodeId: node.id, sentinelType })
      return {}
    }

    if (subflowType === 'parallel') {
      return await this.handleParallelSentinel(ctx, node, sentinelType, subflowId)
    }

    switch (sentinelType) {
      case 'start': {
        const shouldExecute = await this.loopOrchestrator.evaluateInitialCondition(ctx, subflowId)
        if (!shouldExecute) {
          logger.info('Loop initial condition false, skipping loop body', { loopId: subflowId })
          return {
            sentinelStart: true,
            shouldExit: true,
            selectedRoute: EDGE.LOOP_EXIT,
          }
        }
        return { sentinelStart: true }
      }

      case 'end': {
        const continuationResult = await this.loopOrchestrator.evaluateLoopContinuation(
          ctx,
          subflowId
        )

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
          totalIterations:
            continuationResult.totalIterations ??
            getResultCount(continuationResult.aggregatedResults),
        }
      }

      default:
        logger.warn('Unknown sentinel type', { sentinelType })
        return {}
    }
  }

  private async handleParallelSentinel(
    ctx: ExecutionContext,
    node: DAGNode,
    sentinelType: string | undefined,
    parallelId: string
  ): Promise<NormalizedBlockOutput> {
    if (sentinelType === 'start') {
      if (!this.parallelOrchestrator.getParallelScope(ctx, parallelId)) {
        const parallelConfig = this.dag.parallelConfigs.get(parallelId)
        if (parallelConfig) {
          await this.parallelOrchestrator.initializeParallelScope(ctx, parallelId)
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

      this.parallelOrchestrator.prepareCurrentBatch(ctx, parallelId)
      return { sentinelStart: true }
    }

    if (sentinelType === 'end') {
      const result = await this.parallelOrchestrator.aggregateParallelResults(ctx, parallelId)
      if (!result.allBranchesComplete) {
        return {
          results: [],
          sentinelEnd: true,
          selectedRoute: EDGE.PARALLEL_CONTINUE,
          totalBranches: result.totalBranches,
        }
      }
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

    const loopId = node.metadata.subflowType === 'loop' ? node.metadata.subflowId : undefined
    const isParallelBranch = node.metadata.isParallelBranch
    const isSentinel = node.metadata.isSentinel
    if (isSentinel) {
      this.handleRegularNodeCompletion(ctx, node, output)
      this.handleParentSubflowCompletion(ctx, node, output)
    } else if (loopId) {
      this.handleLoopNodeCompletion(ctx, node, output, loopId)
    } else if (isParallelBranch) {
      const parallelId =
        node.metadata.subflowType === 'parallel' ? node.metadata.subflowId : undefined
      if (parallelId) {
        await this.handleParallelNodeCompletion(ctx, node, output, parallelId)
      } else {
        logger.warn('Parallel branch missing subflow metadata', { nodeId: node.id })
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

  private async handleParallelNodeCompletion(
    ctx: ExecutionContext,
    node: DAGNode,
    output: NormalizedBlockOutput,
    parallelId: string
  ): Promise<void> {
    const scope = this.parallelOrchestrator.getParallelScope(ctx, parallelId)
    if (!scope) {
      await this.parallelOrchestrator.initializeParallelScope(ctx, parallelId)
    }
    this.parallelOrchestrator.handleParallelBranchCompletion(ctx, parallelId, node.id, output)
    const branchIndex = node.metadata.branchIndex
    if (branchIndex !== undefined && extractOuterBranchIndex(node.id) === undefined) {
      const originalBlockId = node.metadata.originalBlockId ?? extractBaseBlockId(node.id)
      this.state.setBlockOutput(buildOuterBranchScopedId(originalBlockId, branchIndex), output)
    }
    this.state.setBlockOutput(node.id, output)
  }

  private handleParentSubflowCompletion(
    ctx: ExecutionContext,
    node: DAGNode,
    output: NormalizedBlockOutput
  ): void {
    if (node.metadata.sentinelType !== 'end' || !node.metadata.subflowId) {
      return
    }

    if (
      output.selectedRoute === EDGE.LOOP_CONTINUE ||
      output.selectedRoute === EDGE.LOOP_CONTINUE_ALT ||
      output.selectedRoute === EDGE.PARALLEL_CONTINUE
    ) {
      return
    }

    const subflowId = node.metadata.subflowId
    const parentEntry = ctx.subflowParentMap?.get(subflowId)
    if (!parentEntry) {
      return
    }

    if (parentEntry.parentType === 'parallel') {
      if (parentEntry.branchIndex === undefined) {
        return
      }

      this.parallelOrchestrator.handleParallelBranchCompletion(
        ctx,
        parentEntry.parentId,
        node.id,
        getSubflowResultOutput(output),
        parentEntry.branchIndex
      )
      return
    }

    this.loopOrchestrator.storeLoopNodeOutput(
      ctx,
      parentEntry.parentId,
      subflowId,
      getSubflowResultOutput(output)
    )
  }

  private handleRegularNodeCompletion(
    ctx: ExecutionContext,
    node: DAGNode,
    output: NormalizedBlockOutput
  ): void {
    this.state.setBlockOutput(node.id, output)

    if (
      node.metadata.isSentinel &&
      node.metadata.subflowType === 'loop' &&
      node.metadata.sentinelType === 'end' &&
      output.selectedRoute === 'loop_continue'
    ) {
      const loopId = node.metadata.subflowId
      if (!loopId) {
        logger.warn('Loop sentinel missing subflow metadata', { nodeId: node.id })
        return
      }
      this.loopOrchestrator.clearLoopExecutionState(loopId, ctx)
      this.loopOrchestrator.restoreLoopEdges(loopId)
    }

    if (
      node.metadata.subflowType === 'parallel' &&
      node.metadata.sentinelType === 'end' &&
      output.selectedRoute === EDGE.PARALLEL_CONTINUE
    ) {
      const parallelId = node.metadata.subflowId
      if (!parallelId) {
        logger.warn('Parallel sentinel missing subflow metadata', { nodeId: node.id })
        return
      }
      this.parallelOrchestrator.prepareForBatchContinuation(parallelId)
    }
  }
}
