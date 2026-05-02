import { createLogger, type Logger } from '@sim/logger'
import { StartBlockPath } from '@/lib/workflows/triggers/triggers'
import type { DAG } from '@/executor/dag/builder'
import { DAGBuilder } from '@/executor/dag/builder'
import { BlockExecutor } from '@/executor/execution/block-executor'
import { EdgeManager } from '@/executor/execution/edge-manager'
import { ExecutionEngine } from '@/executor/execution/engine'
import { ExecutionState } from '@/executor/execution/state'
import type {
  ContextExtensions,
  SerializableExecutionState,
  WorkflowInput,
} from '@/executor/execution/types'
import { createBlockHandlers } from '@/executor/handlers/registry'
import { LoopOrchestrator } from '@/executor/orchestrators/loop'
import { NodeExecutionOrchestrator } from '@/executor/orchestrators/node'
import { ParallelOrchestrator } from '@/executor/orchestrators/parallel'
import type { BlockState, ExecutionContext, ExecutionResult } from '@/executor/types'
import {
  computeExecutionSets,
  type RunFromBlockContext,
  resolveContainerToSentinelStart,
  validateRunFromBlock,
} from '@/executor/utils/run-from-block'
import {
  buildResolutionFromBlock,
  buildStartBlockOutput,
  resolveExecutorStartBlock,
} from '@/executor/utils/start-block'
import {
  extractLoopIdFromSentinel,
  extractParallelIdFromSentinel,
} from '@/executor/utils/subflow-utils'
import { VariableResolver } from '@/executor/variables/resolver'
import type { SerializedWorkflow } from '@/serializer/types'
import type { SubflowType } from '@/stores/workflows/workflow/types'

const logger = createLogger('DAGExecutor')

export interface DAGExecutorOptions {
  workflow: SerializedWorkflow
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
  private dagBuilder: DAGBuilder
  private execLogger: Logger

  constructor(options: DAGExecutorOptions) {
    this.workflow = options.workflow
    this.environmentVariables = options.envVarValues ?? {}
    this.workflowInput = options.workflowInput ?? {}
    this.workflowVariables = options.workflowVariables ?? {}
    this.contextExtensions = options.contextExtensions ?? {}
    this.dagBuilder = new DAGBuilder()
    this.execLogger = logger.withMetadata({
      workflowId: this.contextExtensions.metadata?.workflowId,
      workspaceId: this.contextExtensions.workspaceId,
      executionId: this.contextExtensions.executionId,
      userId: this.contextExtensions.userId,
      requestId: this.contextExtensions.metadata?.requestId,
    })
  }

  async execute(workflowId: string, triggerBlockId?: string): Promise<ExecutionResult> {
    const savedIncomingEdges = this.contextExtensions.dagIncomingEdges
    const dag = this.dagBuilder.build(this.workflow, {
      triggerBlockId,
      savedIncomingEdges,
    })
    const { context, state } = this.createExecutionContext(workflowId, triggerBlockId)
    context.subflowParentMap = this.buildSubflowParentMap(dag)

    const engine = this.buildExecutionPipeline(context, dag, state)
    return await engine.run(triggerBlockId)
  }

  async continueExecution(
    _pendingBlocks: string[],
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    this.execLogger.warn(
      'Debug mode (continueExecution) is not yet implemented in the refactored executor'
    )
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

  /**
   * Execute from a specific block using cached outputs for upstream blocks.
   */
  async executeFromBlock(
    workflowId: string,
    startBlockId: string,
    sourceSnapshot: SerializableExecutionState
  ): Promise<ExecutionResult> {
    // Build full DAG with all blocks to compute upstream set for snapshot filtering
    // includeAllBlocks is needed because the startBlockId might be a trigger not reachable from the main trigger
    const dag = this.dagBuilder.build(this.workflow, { includeAllBlocks: true })

    const executedBlocks = new Set(sourceSnapshot.executedBlocks)
    const validation = validateRunFromBlock(startBlockId, dag, executedBlocks)
    if (!validation.valid) {
      throw new Error(validation.error)
    }

    const { dirtySet, upstreamSet, reachableUpstreamSet } = computeExecutionSets(dag, startBlockId)
    const effectiveStartBlockId = resolveContainerToSentinelStart(startBlockId, dag) ?? startBlockId

    // Extract container IDs from sentinel IDs in reachable upstream set
    // Use reachableUpstreamSet (not upstreamSet) to preserve sibling branch outputs
    // Example: A->C, B->C where C references A.result || B.result
    // When running from A, B's output should be preserved for C to reference
    const reachableContainerIds = new Set<string>()
    for (const nodeId of reachableUpstreamSet) {
      const loopId = extractLoopIdFromSentinel(nodeId)
      if (loopId) reachableContainerIds.add(loopId)
      const parallelId = extractParallelIdFromSentinel(nodeId)
      if (parallelId) reachableContainerIds.add(parallelId)
    }

    // Filter snapshot to include all blocks reachable from dirty blocks
    // This preserves sibling branch outputs that dirty blocks may reference
    const filteredBlockStates: Record<string, any> = {}
    for (const [blockId, state] of Object.entries(sourceSnapshot.blockStates)) {
      if (reachableUpstreamSet.has(blockId) || reachableContainerIds.has(blockId)) {
        filteredBlockStates[blockId] = state
      }
    }
    const filteredExecutedBlocks = sourceSnapshot.executedBlocks.filter(
      (id) => reachableUpstreamSet.has(id) || reachableContainerIds.has(id)
    )

    // Filter loop/parallel executions to only include reachable containers
    const filteredLoopExecutions: Record<string, any> = {}
    if (sourceSnapshot.loopExecutions) {
      for (const [loopId, execution] of Object.entries(sourceSnapshot.loopExecutions)) {
        if (reachableContainerIds.has(loopId)) {
          filteredLoopExecutions[loopId] = execution
        }
      }
    }
    const filteredParallelExecutions: Record<string, any> = {}
    if (sourceSnapshot.parallelExecutions) {
      for (const [parallelId, execution] of Object.entries(sourceSnapshot.parallelExecutions)) {
        if (reachableContainerIds.has(parallelId)) {
          filteredParallelExecutions[parallelId] = execution
        }
      }
    }

    const filteredSnapshot: SerializableExecutionState = {
      ...sourceSnapshot,
      blockStates: filteredBlockStates,
      executedBlocks: filteredExecutedBlocks,
      loopExecutions: filteredLoopExecutions,
      parallelExecutions: filteredParallelExecutions,
    }

    this.execLogger.info('Executing from block', {
      workflowId,
      startBlockId,
      effectiveStartBlockId,
      dirtySetSize: dirtySet.size,
      upstreamSetSize: upstreamSet.size,
      reachableUpstreamSetSize: reachableUpstreamSet.size,
    })

    // Remove incoming edges from non-dirty sources so convergent blocks don't wait for cached upstream
    for (const nodeId of dirtySet) {
      const node = dag.nodes.get(nodeId)
      if (!node) continue

      const nonDirtyIncoming: string[] = []
      for (const sourceId of node.incomingEdges) {
        if (!dirtySet.has(sourceId)) {
          nonDirtyIncoming.push(sourceId)
        }
      }

      for (const sourceId of nonDirtyIncoming) {
        node.incomingEdges.delete(sourceId)
      }
    }

    const runFromBlockContext = { startBlockId: effectiveStartBlockId, dirtySet }
    const { context, state } = this.createExecutionContext(workflowId, undefined, {
      snapshotState: filteredSnapshot,
      runFromBlockContext,
    })
    context.subflowParentMap = this.buildSubflowParentMap(dag)

    const engine = this.buildExecutionPipeline(context, dag, state)
    return await engine.run()
  }

  private buildExecutionPipeline(context: ExecutionContext, dag: DAG, state: ExecutionState) {
    const resolver = new VariableResolver(this.workflow, this.workflowVariables, state)
    const allHandlers = createBlockHandlers()
    const blockExecutor = new BlockExecutor(allHandlers, resolver, this.contextExtensions, state)
    const edgeManager = new EdgeManager(dag)
    const loopOrchestrator = new LoopOrchestrator(
      dag,
      state,
      resolver,
      this.contextExtensions,
      edgeManager
    )
    const parallelOrchestrator = new ParallelOrchestrator(
      dag,
      state,
      resolver,
      this.contextExtensions
    )
    const nodeOrchestrator = new NodeExecutionOrchestrator(
      dag,
      state,
      blockExecutor,
      loopOrchestrator,
      parallelOrchestrator
    )
    return new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
  }

  private createExecutionContext(
    workflowId: string,
    triggerBlockId?: string,
    overrides?: {
      snapshotState?: SerializableExecutionState
      runFromBlockContext?: RunFromBlockContext
    }
  ): { context: ExecutionContext; state: ExecutionState } {
    const snapshotState = overrides?.snapshotState ?? this.contextExtensions.snapshotState
    const blockStates = snapshotState?.blockStates
      ? new Map(Object.entries(snapshotState.blockStates))
      : new Map<string, BlockState>()
    let executedBlocks = snapshotState?.executedBlocks
      ? new Set(snapshotState.executedBlocks)
      : new Set<string>()

    if (overrides?.runFromBlockContext) {
      const { dirtySet } = overrides.runFromBlockContext
      executedBlocks = new Set([...executedBlocks].filter((id) => !dirtySet.has(id)))
      this.execLogger.info('Cleared executed status for dirty blocks', {
        dirtySetSize: dirtySet.size,
        remainingExecutedBlocks: executedBlocks.size,
      })
    }

    const state = new ExecutionState(blockStates, executedBlocks)

    const context: ExecutionContext = {
      workflowId,
      workspaceId: this.contextExtensions.workspaceId,
      executionId: this.contextExtensions.executionId,
      userId: this.contextExtensions.userId,
      isDeployedContext: this.contextExtensions.isDeployedContext,
      enforceCredentialAccess: this.contextExtensions.enforceCredentialAccess,
      blockStates: state.getBlockStates(),
      blockLogs: overrides?.runFromBlockContext ? [] : (snapshotState?.blockLogs ?? []),
      metadata: {
        ...this.contextExtensions.metadata,
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
      onChildWorkflowInstanceReady: this.contextExtensions.onChildWorkflowInstanceReady,
      abortSignal: this.contextExtensions.abortSignal,
      childWorkflowContext: this.contextExtensions.childWorkflowContext,
      includeFileBase64: this.contextExtensions.includeFileBase64,
      base64MaxBytes: this.contextExtensions.base64MaxBytes,
      runFromBlockContext: overrides?.runFromBlockContext,
      stopAfterBlockId: this.contextExtensions.stopAfterBlockId,
      callChain: this.contextExtensions.callChain,
    }

    if (this.contextExtensions.resumeFromSnapshot) {
      context.metadata.resumeFromSnapshot = true
      this.execLogger.info('Resume from snapshot enabled', {
        resumePendingQueue: this.contextExtensions.resumePendingQueue,
        remainingEdges: this.contextExtensions.remainingEdges,
        triggerBlockId,
      })
    }

    if (this.contextExtensions.remainingEdges) {
      ;(context.metadata as any).remainingEdges = this.contextExtensions.remainingEdges
      this.execLogger.info('Set remaining edges for resume', {
        edgeCount: this.contextExtensions.remainingEdges.length,
      })
    }

    if (this.contextExtensions.resumePendingQueue?.length) {
      context.metadata.pendingBlocks = [...this.contextExtensions.resumePendingQueue]
      this.execLogger.info('Set pending blocks from resume queue', {
        pendingBlocks: context.metadata.pendingBlocks,
        skipStarterBlockInit: true,
      })
    } else if (overrides?.runFromBlockContext) {
      // In run-from-block mode, initialize the start block only if it's a regular block
      // Skip for sentinels/containers (loop/parallel) which aren't real blocks
      const startBlockId = overrides.runFromBlockContext.startBlockId
      const isRegularBlock = this.workflow.blocks.some((b) => b.id === startBlockId)

      if (isRegularBlock) {
        this.initializeStarterBlock(context, state, startBlockId)
      }
    } else {
      this.initializeStarterBlock(context, state, triggerBlockId)
    }

    return { context, state }
  }

  /**
   * Builds a unified child-subflow → parent-subflow mapping that covers all nesting
   * combinations: loop-in-loop, parallel-in-parallel, loop-in-parallel, parallel-in-loop.
   * Used by the iteration context builder to walk the full ancestor chain for SSE events.
   */
  private buildSubflowParentMap(
    dag: DAG
  ): Map<string, { parentId: string; parentType: SubflowType }> {
    const parentMap = new Map<string, { parentId: string; parentType: SubflowType }>()

    // Scan loop configs: children can be loops or parallels
    for (const [loopId, config] of dag.loopConfigs) {
      for (const nodeId of config.nodes) {
        if (dag.loopConfigs.has(nodeId) || dag.parallelConfigs.has(nodeId)) {
          parentMap.set(nodeId, { parentId: loopId, parentType: 'loop' })
        }
      }
    }

    // Scan parallel configs: children can be parallels or loops
    for (const [parallelId, config] of dag.parallelConfigs) {
      for (const nodeId of config.nodes ?? []) {
        if (dag.parallelConfigs.has(nodeId) || dag.loopConfigs.has(nodeId)) {
          parentMap.set(nodeId, { parentId: parallelId, parentType: 'parallel' })
        }
      }
    }

    return parentMap
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
        this.execLogger.error('Specified trigger block not found in workflow', {
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
        this.execLogger.warn('No start block found in workflow')
        return
      }
    }

    if (state.getBlockStates().has(startResolution.block.id)) {
      return
    }

    const blockOutput = buildStartBlockOutput({
      resolution: startResolution,
      workflowInput: this.workflowInput,
    })

    state.setBlockState(startResolution.block.id, {
      output: blockOutput,
      executed: false,
      executionTime: 0,
    })
  }
}
