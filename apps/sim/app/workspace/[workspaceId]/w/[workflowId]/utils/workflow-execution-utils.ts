import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import type { BlockOutput } from '@/blocks/types'
import { Executor } from '@/executor'
import type { ExecutionResult, StreamingExecution } from '@/executor/types'
import { Serializer } from '@/serializer'
import type { SerializedWorkflow } from '@/serializer/types'
import { useExecutionStore } from '@/stores/execution/store'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('WorkflowExecutionUtils')

/**
 * Interface for executor options
 */
interface ExecutorOptions {
  workflow: SerializedWorkflow
  currentBlockStates?: Record<string, BlockOutput>
  envVarValues?: Record<string, string>
  workflowInput?: any
  workflowVariables?: Record<string, any>
  contextExtensions?: {
    stream?: boolean
    selectedOutputs?: string[]
    edges?: Array<{ source: string; target: string }>
    onStream?: (streamingExecution: StreamingExecution) => Promise<void>
    executionId?: string
  }
}

/**
 * Workflow execution options
 */
export interface WorkflowExecutionOptions {
  workflowInput?: any
  executionId?: string
  onStream?: (se: StreamingExecution) => Promise<void>
}

/**
 * Standalone functions for workflow execution (used in tools, API routes, etc.)
 */

/**
 * Get the current workflow execution context from stores
 */
export function getWorkflowExecutionContext() {
  const { activeWorkflowId } = useWorkflowRegistry.getState()
  if (!activeWorkflowId) {
    throw new Error('No active workflow found')
  }

  const workflowState = useWorkflowStore.getState().getWorkflowState()
  const { isShowingDiff, isDiffReady, diffWorkflow } = useWorkflowDiffStore.getState()

  // Determine which workflow to use - same logic as useCurrentWorkflow
  const hasDiffBlocks = !!diffWorkflow && Object.keys((diffWorkflow as any).blocks || {}).length > 0
  const shouldUseDiff = isShowingDiff && isDiffReady && hasDiffBlocks
  const currentWorkflow = shouldUseDiff ? diffWorkflow : workflowState

  const { getAllVariables } = useEnvironmentStore.getState()
  const { getVariablesByWorkflowId } = useVariablesStore.getState()
  const { setExecutor } = useExecutionStore.getState()

  return {
    activeWorkflowId,
    currentWorkflow,
    getAllVariables,
    getVariablesByWorkflowId,
    setExecutor,
  }
}

/**
 * Execute a workflow with proper state management and logging
 */
export async function executeWorkflowWithLogging(
  options: WorkflowExecutionOptions = {}
): Promise<ExecutionResult | StreamingExecution> {
  const context = getWorkflowExecutionContext()
  const {
    activeWorkflowId,
    currentWorkflow,
    getAllVariables,
    getVariablesByWorkflowId,
    setExecutor,
  } = context
  const { workflowInput, onStream, executionId } = options

  const {
    blocks: workflowBlocks,
    edges: workflowEdges,
    loops: workflowLoops,
    parallels: workflowParallels,
  } = currentWorkflow

  // Filter out blocks without type (these are layout-only blocks)
  const validBlocks = Object.entries(workflowBlocks).reduce(
    (acc, [blockId, block]) => {
      if (block && typeof block === 'object' && 'type' in block && block.type) {
        acc[blockId] = block
      }
      return acc
    },
    {} as typeof workflowBlocks
  )

  const isExecutingFromChat =
    workflowInput && typeof workflowInput === 'object' && 'input' in workflowInput

  logger.info('Executing workflow', {
    isDiffMode: (currentWorkflow as any).isDiffMode,
    isExecutingFromChat,
    totalBlocksCount: Object.keys(workflowBlocks).length,
    validBlocksCount: Object.keys(validBlocks).length,
    edgesCount: workflowEdges.length,
  })

  // Merge subblock states from the appropriate store
  const mergedStates = mergeSubblockState(validBlocks)
  const filteredStates = mergedStates

  const currentBlockStates = Object.entries(filteredStates).reduce(
    (acc, [id, block]) => {
      acc[id] = Object.entries(block.subBlocks).reduce(
        (subAcc, [key, subBlock]) => {
          subAcc[key] = subBlock.value
          return subAcc
        },
        {} as Record<string, any>
      )
      return acc
    },
    {} as Record<string, Record<string, any>>
  )

  // Get environment variables
  const envVars = getAllVariables()
  const envVarValues = Object.entries(envVars).reduce(
    (acc, [key, variable]: [string, any]) => {
      acc[key] = variable.value
      return acc
    },
    {} as Record<string, string>
  )

  // Get workflow variables
  const workflowVars = getVariablesByWorkflowId(activeWorkflowId)
  const workflowVariables = workflowVars.reduce(
    (acc, variable: any) => {
      acc[variable.id] = variable
      return acc
    },
    {} as Record<string, any>
  )

  const filteredEdges = workflowEdges

  // Create serialized workflow
  const workflow = new Serializer().serializeWorkflow(
    filteredStates,
    filteredEdges,
    workflowLoops,
    workflowParallels
  )

  // If this is a chat execution, get the selected outputs
  let selectedOutputs: string[] | undefined
  if (isExecutingFromChat) {
    const chatStore = await import('@/stores/panel/chat/store').then((mod) => mod.useChatStore)
    selectedOutputs = chatStore.getState().getSelectedWorkflowOutput(activeWorkflowId)
  }

  // Create executor options
  const executorOptions: ExecutorOptions = {
    workflow,
    currentBlockStates,
    envVarValues,
    workflowInput,
    workflowVariables,
    contextExtensions: {
      stream: isExecutingFromChat,
      selectedOutputs,
      edges: workflow.connections.map((conn) => ({
        source: conn.source,
        target: conn.target,
      })),
      onStream,
      executionId,
    },
  }

  // Create executor and store in global state
  const newExecutor = new Executor(executorOptions)
  setExecutor(newExecutor)

  // Execute workflow
  return newExecutor.execute(activeWorkflowId)
}

/**
 * Persist execution logs to the backend
 */
export async function persistExecutionLogs(
  activeWorkflowId: string,
  executionId: string,
  result: ExecutionResult,
  streamContent?: string
): Promise<string> {
  try {
    // Build trace spans from execution logs
    const { traceSpans, totalDuration } = buildTraceSpans(result)

    // Add trace spans to the execution result
    const enrichedResult = {
      ...result,
      traceSpans,
      totalDuration,
    }

    // If this was a streaming response and we have the final content, update it
    if (streamContent && result.output && typeof streamContent === 'string') {
      enrichedResult.output.content = streamContent

      // Also update any block logs to include the content where appropriate
      if (enrichedResult.logs) {
        const streamingBlockId = (result.metadata as any)?.streamingBlockId || null

        for (const log of enrichedResult.logs) {
          const isStreamingBlock = streamingBlockId && log.blockId === streamingBlockId
          if (
            isStreamingBlock &&
            (log.blockType === 'agent' || log.blockType === 'router') &&
            log.output
          ) {
            log.output.content = streamContent
          }
        }
      }
    }

    const response = await fetch(`/api/workflows/${activeWorkflowId}/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        executionId,
        result: enrichedResult,
      }),
    })

    if (!response.ok) {
      throw new Error('Failed to persist logs')
    }

    return executionId
  } catch (error) {
    logger.error('Error persisting logs:', error)
    return executionId
  }
}

/**
 * Execute workflow with full logging support
 * Combines execution + log persistence in a single function
 */
export async function executeWorkflowWithFullLogging(
  options: WorkflowExecutionOptions = {}
): Promise<ExecutionResult | StreamingExecution> {
  const executionId = options.executionId || uuidv4()

  const context = getWorkflowExecutionContext()
  const { activeWorkflowId } = context

  try {
    const result = await executeWorkflowWithLogging({
      ...options,
      executionId,
    })

    // For ExecutionResult (not streaming), persist logs
    if (result && 'success' in result) {
      // Don't await log persistence to avoid blocking the UI
      persistExecutionLogs(activeWorkflowId, executionId, result as ExecutionResult).catch(
        (err) => {
          logger.error('Error persisting logs:', { error: err })
        }
      )
    }

    return result
  } catch (error: any) {
    // Create error result and persist it
    const errorResult: ExecutionResult = {
      success: false,
      output: { error: error?.message || 'Unknown error' },
      logs: [],
      metadata: { duration: 0, startTime: new Date().toISOString() },
    }

    persistExecutionLogs(activeWorkflowId, executionId, errorResult).catch((err) => {
      logger.error('Error persisting logs:', { error: err })
    })

    throw error
  }
}
