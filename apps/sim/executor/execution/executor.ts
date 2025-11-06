import { createLogger } from '@/lib/logs/console/logger'
import { StartBlockPath } from '@/lib/workflows/triggers'
import type { BlockOutput } from '@/blocks/types'
import { DAGBuilder } from '@/executor/dag/builder'
import { BlockExecutor } from '@/executor/execution/block-executor'
import { EdgeManager } from '@/executor/execution/edge-manager'
import { ExecutionEngine } from '@/executor/execution/engine'
import { ExecutionState } from '@/executor/execution/state'
import type { ContextExtensions, WorkflowInput } from '@/executor/execution/types'
import { createBlockHandlers } from '@/executor/handlers/registry'
import { LoopOrchestrator } from '@/executor/orchestrators/loop'
import { NodeExecutionOrchestrator } from '@/executor/orchestrators/node'
import { ParallelOrchestrator } from '@/executor/orchestrators/parallel'
import type { BlockState, ExecutionContext, ExecutionResult } from '@/executor/types'
import {
  buildResolutionFromBlock,
  buildStartBlockOutput,
  resolveExecutorStartBlock,
} from '@/executor/utils/start-block'
import { VariableResolver } from '@/executor/variables/resolver'
import type { SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('DAGExecutor')

export interface DAGExecutorOptions {
  workflow: SerializedWorkflow
  currentBlockStates?: Record<string, BlockOutput>
  envVarValues?: Record<string, string>
  workflowInput?: WorkflowInput
  workflowVariables?: Record<string, unknown>
  contextExtensions?: ContextExtensions
}

export class DAGExecutor {
  private workflow: SerializedWorkflow
  private environmentVariables: Record<string, string>
  private workflowInput: WorkflowInput
  private workflowVariables: Record<string, unknown>
  private contextExtensions: ContextExtensions
  private isCancelled = false
  private dagBuilder: DAGBuilder

  constructor(options: DAGExecutorOptions) {
    this.workflow = options.workflow
    this.environmentVariables = options.envVarValues ?? {}
    this.workflowInput = options.workflowInput ?? {}
    this.workflowVariables = options.workflowVariables ?? {}
    this.contextExtensions = options.contextExtensions ?? {}
    this.dagBuilder = new DAGBuilder()
  }

  async execute(workflowId: string, triggerBlockId?: string): Promise<ExecutionResult> {
    const savedIncomingEdges = this.contextExtensions.dagIncomingEdges
    const dag = this.dagBuilder.build(this.workflow, triggerBlockId, savedIncomingEdges)
    const { context, state } = this.createExecutionContext(workflowId, triggerBlockId)

    // Link cancellation flag to context
    Object.defineProperty(context, 'isCancelled', {
      get: () => this.isCancelled,
      enumerable: true,
      configurable: true,
    })

    const resolver = new VariableResolver(this.workflow, this.workflowVariables, state)
    const loopOrchestrator = new LoopOrchestrator(dag, state, resolver)
    const parallelOrchestrator = new ParallelOrchestrator(dag, state)
    const allHandlers = createBlockHandlers()
    const blockExecutor = new BlockExecutor(allHandlers, resolver, this.contextExtensions, state)
    const edgeManager = new EdgeManager(dag)
    const nodeOrchestrator = new NodeExecutionOrchestrator(
      dag,
      state,
      blockExecutor,
      loopOrchestrator,
      parallelOrchestrator
    )
    const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
    return await engine.run(triggerBlockId)
  }

  cancel(): void {
    this.isCancelled = true
  }

  async continueExecution(
    _pendingBlocks: string[],
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    logger.warn('Debug mode (continueExecution) is not yet implemented in the refactored executor')
    return {
      success: false,
      output: {},
      logs: context.blockLogs ?? [],
      error: 'Debug mode is not yet supported in the refactored executor',
      metadata: {
        duration: 0,
        startTime: new Date().toISOString(),
      },
    }
  }

  private createExecutionContext(
    workflowId: string,
    triggerBlockId?: string
  ): { context: ExecutionContext; state: ExecutionState } {
    const snapshotState = this.contextExtensions.snapshotState
    const blockStates = snapshotState?.blockStates
      ? new Map(Object.entries(snapshotState.blockStates))
      : new Map<string, BlockState>()
    const executedBlocks = snapshotState?.executedBlocks
      ? new Set(snapshotState.executedBlocks)
      : new Set<string>()
    const state = new ExecutionState(blockStates, executedBlocks)

    const context: ExecutionContext = {
      workflowId,
      workspaceId: this.contextExtensions.workspaceId,
      executionId: this.contextExtensions.executionId,
      userId: this.contextExtensions.userId,
      isDeployedContext: this.contextExtensions.isDeployedContext,
      blockStates: state.getBlockStates(),
      blockLogs: snapshotState?.blockLogs ?? [],
      metadata: {
        startTime: new Date().toISOString(),
        duration: 0,
        useDraftState: this.contextExtensions.isDeployedContext !== true,
      },
      environmentVariables: this.environmentVariables,
      workflowVariables: this.workflowVariables,
      decisions: {
        router: snapshotState?.decisions?.router
          ? new Map(Object.entries(snapshotState.decisions.router))
          : new Map(),
        condition: snapshotState?.decisions?.condition
          ? new Map(Object.entries(snapshotState.decisions.condition))
          : new Map(),
      },
      completedLoops: snapshotState?.completedLoops
        ? new Set(snapshotState.completedLoops)
        : new Set(),
      loopExecutions: snapshotState?.loopExecutions
        ? new Map(
            Object.entries(snapshotState.loopExecutions).map(([loopId, scope]) => [
              loopId,
              {
                ...scope,
                currentIterationOutputs: scope.currentIterationOutputs
                  ? new Map(Object.entries(scope.currentIterationOutputs))
                  : new Map(),
              },
            ])
          )
        : new Map(),
      parallelExecutions: snapshotState?.parallelExecutions
        ? new Map(
            Object.entries(snapshotState.parallelExecutions).map(([parallelId, scope]) => [
              parallelId,
              {
                ...scope,
                branchOutputs: scope.branchOutputs
                  ? new Map(Object.entries(scope.branchOutputs).map(([k, v]) => [Number(k), v]))
                  : new Map(),
              },
            ])
          )
        : new Map(),
      executedBlocks: state.getExecutedBlocks(),
      activeExecutionPath: snapshotState?.activeExecutionPath
        ? new Set(snapshotState.activeExecutionPath)
        : new Set(),
      workflow: this.workflow,
      stream: this.contextExtensions.stream ?? false,
      selectedOutputs: this.contextExtensions.selectedOutputs ?? [],
      edges: this.contextExtensions.edges ?? [],
      onStream: this.contextExtensions.onStream,
      onBlockStart: this.contextExtensions.onBlockStart,
      onBlockComplete: this.contextExtensions.onBlockComplete,
    }

    if (this.contextExtensions.resumeFromSnapshot) {
      context.metadata.resumeFromSnapshot = true
      logger.info('Resume from snapshot enabled', {
        resumePendingQueue: this.contextExtensions.resumePendingQueue,
        remainingEdges: this.contextExtensions.remainingEdges,
        triggerBlockId,
      })
    }

    if (this.contextExtensions.remainingEdges) {
      ;(context.metadata as any).remainingEdges = this.contextExtensions.remainingEdges
      logger.info('Set remaining edges for resume', {
        edgeCount: this.contextExtensions.remainingEdges.length,
      })
    }

    if (this.contextExtensions.resumePendingQueue?.length) {
      context.metadata.pendingBlocks = [...this.contextExtensions.resumePendingQueue]
      logger.info('Set pending blocks from resume queue', {
        pendingBlocks: context.metadata.pendingBlocks,
        skipStarterBlockInit: true,
      })
    } else {
      this.initializeStarterBlock(context, state, triggerBlockId)
    }

    return { context, state }
  }

  private initializeStarterBlock(
    context: ExecutionContext,
    state: ExecutionState,
    triggerBlockId?: string
  ): void {
    let startResolution: ReturnType<typeof resolveExecutorStartBlock> | null = null

    if (triggerBlockId) {
      const triggerBlock = this.workflow.blocks.find((b) => b.id === triggerBlockId)
      if (!triggerBlock) {
        logger.error('Specified trigger block not found in workflow', {
          triggerBlockId,
        })
        throw new Error(`Trigger block not found: ${triggerBlockId}`)
      }

      startResolution = buildResolutionFromBlock(triggerBlock)

      if (!startResolution) {
        startResolution = {
          blockId: triggerBlock.id,
          block: triggerBlock,
          path: StartBlockPath.SPLIT_MANUAL,
        }
      }
    } else {
      startResolution = resolveExecutorStartBlock(this.workflow.blocks, {
        execution: 'manual',
        isChildWorkflow: false,
      })

      if (!startResolution?.block) {
        logger.warn('No start block found in workflow')
        return
      }
    }

    if (state.getBlockStates().has(startResolution.block.id)) {
      return
    }

    const blockOutput = buildStartBlockOutput({
      resolution: startResolution,
      workflowInput: this.workflowInput,
      isDeployedExecution: this.contextExtensions?.isDeployedContext === true,
    })

    state.setBlockState(startResolution.block.id, {
      output: blockOutput,
      executed: false,
      executionTime: 0,
    })
  }
}
