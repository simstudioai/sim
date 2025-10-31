import { createLogger } from '@/lib/logs/console/logger'
import type { BlockOutput } from '@/blocks/types'
import { createBlockHandlers } from '@/executor/handlers/registry'
import type { ExecutionContext, ExecutionResult } from '@/executor/types'
import {
  buildResolutionFromBlock,
  buildStartBlockOutput,
  resolveExecutorStartBlock,
} from '@/executor/utils/start-block'
import type { SerializedWorkflow } from '@/serializer/types'
import { DAGBuilder } from '../dag/builder'
import { LoopOrchestrator } from '../orchestrators/loop'
import { NodeExecutionOrchestrator } from '../orchestrators/node'
import { ParallelOrchestrator } from '../orchestrators/parallel'
import { VariableResolver } from '../variables/resolver'
import { BlockExecutor } from './block-executor'
import { EdgeManager } from './edge-manager'
import { ExecutionEngine } from './engine'
import { ExecutionState } from './state'
import type { ContextExtensions, WorkflowInput } from './types'

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
  private initialBlockStates: Record<string, BlockOutput>
  private environmentVariables: Record<string, string>
  private workflowInput: WorkflowInput
  private workflowVariables: Record<string, unknown>
  private contextExtensions: ContextExtensions
  private isCancelled = false
  private dagBuilder: DAGBuilder

  constructor(options: DAGExecutorOptions) {
    this.workflow = options.workflow
    this.initialBlockStates = options.currentBlockStates || {}
    this.environmentVariables = options.envVarValues || {}
    this.workflowInput = options.workflowInput || {}
    this.workflowVariables = options.workflowVariables || {}
    this.contextExtensions = options.contextExtensions || {}
    this.dagBuilder = new DAGBuilder()
  }

  async execute(workflowId: string, triggerBlockId?: string): Promise<ExecutionResult> {
    const dag = this.dagBuilder.build(this.workflow, triggerBlockId)
    const context = this.createExecutionContext(workflowId, triggerBlockId)
    const state = new ExecutionState()
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
    const engine = new ExecutionEngine(dag, edgeManager, nodeOrchestrator, context)
    return await engine.run(triggerBlockId)
  }

  cancel(): void {
    this.isCancelled = true
  }

  async continueExecution(
    pendingBlocks: string[],
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    logger.warn('Debug mode (continueExecution) is not yet implemented in the refactored executor')
    return {
      success: false,
      output: {},
      logs: context.blockLogs || [],
      error: 'Debug mode is not yet supported in the refactored executor',
      metadata: {
        duration: 0,
        startTime: new Date().toISOString(),
      },
    }
  }

  private createExecutionContext(workflowId: string, triggerBlockId?: string): ExecutionContext {
    const context: ExecutionContext = {
      workflowId,
      blockStates: new Map(),
      blockLogs: [],
      metadata: {
        startTime: new Date().toISOString(),
        duration: 0,
      },
      environmentVariables: this.environmentVariables,
      workflowVariables: this.workflowVariables,
      decisions: {
        router: new Map(),
        condition: new Map(),
      },
      loopIterations: new Map(),
      loopItems: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      workflow: this.workflow,
      stream: this.contextExtensions.stream || false,
      selectedOutputs: this.contextExtensions.selectedOutputs || [],
      edges: this.contextExtensions.edges || [],
      onStream: this.contextExtensions.onStream,
      onBlockStart: this.contextExtensions.onBlockStart,
      onBlockComplete: this.contextExtensions.onBlockComplete,
    }

    this.initializeStarterBlock(context, triggerBlockId)
    return context
  }

  private initializeStarterBlock(context: ExecutionContext, triggerBlockId?: string): void {
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
        logger.debug('Creating generic resolution for trigger block', {
          triggerBlockId,
          blockType: triggerBlock.metadata?.id,
        })
        startResolution = {
          blockId: triggerBlock.id,
          block: triggerBlock,
          path: 'split_manual' as any,
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

    const blockOutput = buildStartBlockOutput({
      resolution: startResolution,
      workflowInput: this.workflowInput,
      isDeployedExecution: this.contextExtensions?.isDeployedContext === true,
    })

    context.blockStates.set(startResolution.block.id, {
      output: blockOutput,
      executed: true,
      executionTime: 0,
    })

    logger.debug('Initialized start block', {
      blockId: startResolution.block.id,
      blockType: startResolution.block.metadata?.id,
    })
  }
}
