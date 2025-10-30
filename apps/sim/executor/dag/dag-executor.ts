/**
 * DAGExecutor
 * 
 * Main orchestrator for DAG-based workflow execution.
 * Coordinates the construction and execution phases.
 */

import { createLogger } from '@/lib/logs/console/logger'
import type {
  BlockHandler,
  ExecutionContext,
  ExecutionResult,
} from '@/executor/types'
import type { BlockOutput } from '@/blocks/types'
import type { SerializedWorkflow } from '@/serializer/types'
import {
  AgentBlockHandler,
  ApiBlockHandler,
  ConditionBlockHandler,
  EvaluatorBlockHandler,
  FunctionBlockHandler,
  GenericBlockHandler,
  ResponseBlockHandler,
  RouterBlockHandler,
  TriggerBlockHandler,
  VariablesBlockHandler,
  WaitBlockHandler,
  WorkflowBlockHandler,
} from '@/executor/handlers'
import {
  buildResolutionFromBlock,
  buildStartBlockOutput,
  resolveExecutorStartBlock,
} from '@/executor/utils/start-block'
import { DAGBuilder } from './dag-builder'
import { ExecutionState } from './execution-state'
import { VariableResolver } from './variable-resolver'
import { SubflowManager } from './subflow-manager'
import { BlockExecutor } from './block-executor'
import { ExecutionEngine } from './execution-engine'

const logger = createLogger('DAGExecutor')

export interface DAGExecutorOptions {
  workflow: SerializedWorkflow
  currentBlockStates?: Record<string, BlockOutput>
  envVarValues?: Record<string, string>
  workflowInput?: any
  workflowVariables?: Record<string, any>
  contextExtensions?: any
}

export class DAGExecutor {
  private workflow: SerializedWorkflow
  private initialBlockStates: Record<string, BlockOutput>
  private environmentVariables: Record<string, string>
  private workflowInput: any
  private workflowVariables: Record<string, any>
  private contextExtensions: any
  private isCancelled = false

  private blockHandlers: BlockHandler[]
  private dagBuilder: DAGBuilder

  constructor(options: DAGExecutorOptions) {
    this.workflow = options.workflow
    this.initialBlockStates = options.currentBlockStates || {}
    this.environmentVariables = options.envVarValues || {}
    this.workflowInput = options.workflowInput || {}
    this.workflowVariables = options.workflowVariables || {}
    this.contextExtensions = options.contextExtensions || {}

    this.dagBuilder = new DAGBuilder()
    this.blockHandlers = this.initializeBlockHandlers()
  }

  async execute(workflowId: string, startBlockId?: string): Promise<ExecutionResult> {
    try {
      const dag = this.dagBuilder.build(this.workflow, startBlockId)
      
      const context = this.createExecutionContext(workflowId)
      
      const state = new ExecutionState()
      
      const resolver = new VariableResolver(this.workflow, this.workflowVariables, state)
      
      const subflowManager = new SubflowManager(this.workflow, dag, state, resolver)
      
      const blockExecutor = new BlockExecutor(this.blockHandlers, resolver, this.contextExtensions)
      
      const engine = new ExecutionEngine(
        this.workflow,
        dag,
        state,
        blockExecutor,
        subflowManager,
        context
      )
      
      const result = await engine.run(startBlockId)
      
      return result
    } catch (error) {
      logger.error('Execution failed', { workflowId, error })
      
      return {
        success: false,
        output: {},
        logs: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
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

  private createExecutionContext(workflowId: string): ExecutionContext {
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

    // Initialize starter block output with processed inputFormat
    this.initializeStarterBlock(context)

    return context
  }

  private initializeStarterBlock(context: ExecutionContext): void {
    logger.info('Attempting to initialize starter block', {
      workflowBlockCount: this.workflow.blocks.length,
      workflowInputKeys: Object.keys(this.workflowInput || {}),
    })

    try {
      // Resolve the start block type and build its output
      const startResolution = resolveExecutorStartBlock(this.workflow.blocks, {
        execution: 'manual',
        isChildWorkflow: false,
      })

      logger.info('resolveExecutorStartBlock result', {
        hasResolution: !!startResolution,
        hasBlock: !!startResolution?.block,
        blockId: startResolution?.block?.id,
        blockType: startResolution?.block?.metadata?.id,
      })

      if (startResolution && startResolution.block) {
        const blockOutput = buildStartBlockOutput({
          resolution: startResolution,
          workflowInput: this.workflowInput,
          isDeployedExecution: this.contextExtensions?.isDeployedContext === true,
        })

        logger.info('buildStartBlockOutput result', {
          outputKeys: Object.keys(blockOutput),
          output: blockOutput,
        })

        context.blockStates.set(startResolution.block.id, {
          output: blockOutput,
          executed: true,
          executionTime: 0,
        })

        logger.info('Initialized starter block with inputFormat', {
          blockId: startResolution.block.id,
          blockType: startResolution.block.metadata?.id,
          outputKeys: Object.keys(blockOutput),
        })
      } else {
        logger.warn('No start resolution found')
      }
    } catch (error) {
      logger.error('Error initializing starter block:', error)
      // Try to find any start/trigger block as fallback
      const starterBlock = this.workflow.blocks.find(
        (b) => b.metadata?.id === 'starter' || 
               b.metadata?.id === 'start_trigger' || 
               b.metadata?.category === 'triggers'
      )
      if (starterBlock) {
        logger.info('Using fallback starter block', {
          blockId: starterBlock.id,
          blockType: starterBlock.metadata?.id,
        })
        context.blockStates.set(starterBlock.id, {
          output: this.workflowInput || {},
          executed: true,
          executionTime: 0,
        })
      }
    }
  }

  private initializeBlockHandlers(): BlockHandler[] {
    return [
      new TriggerBlockHandler(),
      new FunctionBlockHandler(),
      new ApiBlockHandler(),
      new ConditionBlockHandler(),
      new RouterBlockHandler(),
      new ResponseBlockHandler(),
      new AgentBlockHandler(),
      new VariablesBlockHandler(),
      new WorkflowBlockHandler(),
      new WaitBlockHandler(),
      new EvaluatorBlockHandler(),
      new GenericBlockHandler(),
    ]
  }
}

