import { createLogger } from '@/lib/logs/console/logger'
import { EDGE } from '@/executor/consts'
import type { NormalizedBlockOutput } from '@/executor/types'
import { extractBaseBlockId } from '@/executor/utils/subflow-utils'
import type { DAG, DAGNode } from '../dag/builder'
import type { BlockExecutor } from '../execution/block-executor'
import type { ExecutionState } from '../execution/state'
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
    private state: ExecutionState,
    private blockExecutor: BlockExecutor,
    private loopOrchestrator: LoopOrchestrator,
    private parallelOrchestrator: ParallelOrchestrator
  ) {}

  async executeNode(nodeId: string, context: any): Promise<NodeExecutionResult> {
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
    if (loopId && !this.loopOrchestrator.getLoopScope(loopId)) {
      logger.debug('Initializing loop scope before first execution', { loopId, nodeId })
      this.loopOrchestrator.initializeLoopScope(loopId, context)
    }

    if (loopId && !this.loopOrchestrator.shouldExecuteLoopNode(nodeId, loopId, context)) {
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
      const output = this.handleSentinel(node, context)
      const isFinalOutput = node.outgoingEdges.size === 0
      return {
        nodeId,
        output,
        isFinalOutput,
      }
    }

    logger.debug('Executing node', { nodeId, blockType: node.block.metadata?.id })
    const output = await this.blockExecutor.execute(node, node.block, context)
    const isFinalOutput = node.outgoingEdges.size === 0
    return {
      nodeId,
      output,
      isFinalOutput,
    }
  }

  private handleSentinel(node: DAGNode, context: any): NormalizedBlockOutput {
    const sentinelType = node.metadata.sentinelType
    const loopId = node.metadata.loopId
    if (sentinelType === 'start') {
      logger.debug('Sentinel start - loop entry', { nodeId: node.id, loopId })
      return { sentinelStart: true }
    }

    if (sentinelType === 'end') {
      logger.debug('Sentinel end - evaluating loop continuation', { nodeId: node.id, loopId })
      if (!loopId) {
        logger.warn('Sentinel end called without loopId')
        return { shouldExit: true, selectedRoute: EDGE.LOOP_EXIT }
      }

      const continuationResult = this.loopOrchestrator.evaluateLoopContinuation(loopId, context)
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
    logger.warn('Unknown sentinel type', { sentinelType })
    return {}
  }

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

  private handleLoopNodeCompletion(
    node: DAGNode,
    output: NormalizedBlockOutput,
    loopId: string
  ): void {
    this.loopOrchestrator.storeLoopNodeOutput(loopId, node.id, output)
    this.state.setBlockOutput(node.id, output)
  }

  private handleParallelNodeCompletion(
    node: DAGNode,
    output: NormalizedBlockOutput,
    parallelId: string
  ): void {
    const scope = this.parallelOrchestrator.getParallelScope(parallelId)
    if (!scope) {
      const totalBranches = node.metadata.branchTotal || 1
      const parallelConfig = this.dag.parallelConfigs.get(parallelId)
      const nodesInParallel = (parallelConfig as any)?.nodes?.length || 1
      this.parallelOrchestrator.initializeParallelScope(parallelId, totalBranches, nodesInParallel)
    }
    const allComplete = this.parallelOrchestrator.handleParallelBranchCompletion(
      parallelId,
      node.id,
      output
    )
    if (allComplete) {
      this.parallelOrchestrator.aggregateParallelResults(parallelId)
    }

    this.state.setBlockOutput(node.id, output)
  }

  private handleRegularNodeCompletion(
    node: DAGNode,
    output: NormalizedBlockOutput,
    context: any
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
        this.loopOrchestrator.clearLoopExecutionState(loopId, this.state.executedBlocks)
        this.loopOrchestrator.restoreLoopEdges(loopId)
      }
    }
  }

  private findParallelIdForNode(nodeId: string): string | undefined {
    const baseId = extractBaseBlockId(nodeId)
    return this.parallelOrchestrator.findParallelIdForNode(baseId)
  }
}
