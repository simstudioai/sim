/**
 * Standalone workflow execution utilities
 * This allows workflow execution with proper logging from both React hooks and tools
 */

import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { getBlock } from '@/blocks'
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

// Interface for executor options (copied from useWorkflowExecution)
interface ExecutorOptions {
  workflow: SerializedWorkflow
  currentBlockStates?: Record<string, BlockOutput>
  envVarValues?: Record<string, string>
  workflowInput?: any
  workflowVariables?: Record<string, any>
  contextExtensions?: {
    stream?: boolean
    selectedOutputIds?: string[]
    edges?: Array<{ source: string; target: string }>
    onStream?: (streamingExecution: StreamingExecution) => Promise<void>
    executionId?: string
  }
}

export interface WorkflowExecutionOptions {
  workflowInput?: any
  executionId?: string
  onStream?: (se: StreamingExecution) => Promise<void>
}

export interface WorkflowExecutionContext {
  activeWorkflowId: string
  currentWorkflow: any
  getAllVariables: () => any
  getVariablesByWorkflowId: (workflowId: string) => any[]
  setExecutor: (executor: Executor) => void
}

/**
 * Get the current workflow execution context from stores
 */
export function getWorkflowExecutionContext(): WorkflowExecutionContext {
  const { activeWorkflowId } = useWorkflowRegistry.getState()
  if (!activeWorkflowId) {
    throw new Error('No active workflow found')
  }

  const workflowState = useWorkflowStore.getState().getWorkflowState()
  const { isShowingDiff, isDiffReady, diffWorkflow } = useWorkflowDiffStore.getState()

  // Determine which workflow to use - same logic as useCurrentWorkflow
  const shouldUseDiff = isShowingDiff && isDiffReady && !!diffWorkflow
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
 * This is the core execution logic extracted from useWorkflowExecution
 */
export async function executeWorkflowWithLogging(
  context: WorkflowExecutionContext,
  options: WorkflowExecutionOptions = {}
): Promise<ExecutionResult | StreamingExecution> {
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

  // Filter out trigger blocks for manual execution
  const filteredStates = Object.entries(mergedStates).reduce(
    (acc, [id, block]) => {
      // Skip blocks with undefined type
      if (!block || !block.type) {
        logger.warn(`Skipping block with undefined type: ${id}`, block)
        return acc
      }

      const blockConfig = getBlock(block.type)
      const isTriggerBlock = blockConfig?.category === 'triggers'

      // Skip trigger blocks during manual execution
      if (!isTriggerBlock) {
        acc[id] = block
      }
      return acc
    },
    {} as typeof mergedStates
  )

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

  // Filter edges to exclude connections to/from trigger blocks
  const triggerBlockIds = Object.keys(mergedStates).filter((id) => {
    const blockConfig = getBlock(mergedStates[id].type)
    return blockConfig?.category === 'triggers'
  })

  const filteredEdges = workflowEdges.filter(
    (edge: any) => !triggerBlockIds.includes(edge.source) && !triggerBlockIds.includes(edge.target)
  )

  // Create serialized workflow with filtered blocks and edges
  const workflow = new Serializer().serializeWorkflow(
    filteredStates,
    filteredEdges,
    workflowLoops,
    workflowParallels
  )

  // If this is a chat execution, get the selected outputs
  let selectedOutputIds: string[] | undefined
  if (isExecutingFromChat) {
    // Get selected outputs from chat store
    const chatStore = await import('@/stores/panel/chat/store').then((mod) => mod.useChatStore)
    selectedOutputIds = chatStore.getState().getSelectedWorkflowOutput(activeWorkflowId)
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
      selectedOutputIds,
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
      // Update the content with the final streaming content
      enrichedResult.output.content = streamContent

      // Also update any block logs to include the content where appropriate
      if (enrichedResult.logs) {
        // Get the streaming block ID from metadata if available
        const streamingBlockId = (result.metadata as any)?.streamingBlockId || null

        for (const log of enrichedResult.logs) {
          // Only update the specific LLM block (agent/router) that was streamed
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
 * This combines execution + log persistence in a single function
 */
export async function executeWorkflowWithFullLogging(
  options: WorkflowExecutionOptions = {}
): Promise<ExecutionResult | StreamingExecution> {
  const context = getWorkflowExecutionContext()
  const executionId = options.executionId || uuidv4()

  try {
    const result = await executeWorkflowWithLogging(context, {
      ...options,
      executionId,
    })

    // For ExecutionResult (not streaming), persist logs
    if (result && 'success' in result) {
      // Don't await log persistence to avoid blocking the UI
      persistExecutionLogs(context.activeWorkflowId, executionId, result as ExecutionResult).catch(
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

    persistExecutionLogs(context.activeWorkflowId, executionId, errorResult).catch((err) => {
      logger.error('Error persisting logs:', { error: err })
    })

    throw error
  }
}
