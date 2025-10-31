/**
 * Workflow execution utilities for client-side execution triggers
 * This is now a thin wrapper around the server-side executor
 */

<<<<<<< HEAD
import { createLogger } from '@/lib/logs/console/logger'
=======
import type { Edge } from 'reactflow'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { TriggerUtils } from '@/lib/workflows/triggers'
import type { BlockOutput } from '@/blocks/types'
import { Executor } from '@/executor'
>>>>>>> origin/improvement/sim-294
import type { ExecutionResult, StreamingExecution } from '@/executor/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowExecutionUtils')

export interface WorkflowExecutionOptions {
  workflowInput?: any
  onStream?: (se: StreamingExecution) => Promise<void>
  executionId?: string
  onBlockComplete?: (blockId: string, output: any) => Promise<void>
  overrideTriggerType?: 'chat' | 'manual' | 'api'
}

/**
<<<<<<< HEAD
 * Execute workflow with full logging (used by copilot tools)
 * This now delegates to the server-side executor via API
=======
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
 * Filter out edges between trigger blocks.
 * Trigger blocks are independent entry points and should not have edges to other trigger blocks.
 * However, trigger blocks can have edges to regular blocks.
 */
export function filterEdgesFromTriggerBlocks(blocks: Record<string, any>, edges: Edge[]): Edge[] {
  return edges.filter((edge) => {
    const sourceBlock = blocks[edge.source]
    const targetBlock = blocks[edge.target]

    // If either block not found, keep the edge (might be in a different state structure)
    if (!sourceBlock || !targetBlock) {
      return true
    }

    const sourceIsTrigger = TriggerUtils.isTriggerBlock({
      type: sourceBlock.type,
      triggerMode: sourceBlock.triggerMode,
    })

    const targetIsTrigger = TriggerUtils.isTriggerBlock({
      type: targetBlock.type,
      triggerMode: targetBlock.triggerMode,
    })

    // Filter out edges where source is trigger AND target is trigger
    // Keep edges from triggers to regular blocks
    return !(sourceIsTrigger && targetIsTrigger)
  })
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

  // Don't filter out trigger blocks - let the executor handle them properly
  // The standard executor has TriggerBlockHandler that knows how to handle triggers
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

  // Filter out edges from trigger blocks - triggers are independent entry points
  // and should not have edges to other trigger blocks
  const filteredEdges = filterEdgesFromTriggerBlocks(validBlocks, workflowEdges)

  // Create serialized workflow with filtered blocks and edges
  const workflow = new Serializer().serializeWorkflow(
    filteredStates,
    filteredEdges,
    workflowLoops,
    workflowParallels
  )

  // If this is a chat execution, get the selected outputs
  let selectedOutputs: string[] | undefined
  if (isExecutingFromChat) {
    // Get selected outputs from chat store
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
>>>>>>> origin/improvement/sim-294
 */
export async function executeWorkflowWithFullLogging(
  options: WorkflowExecutionOptions = {}
): Promise<ExecutionResult | StreamingExecution> {
  const { activeWorkflowId } = useWorkflowRegistry.getState()

  if (!activeWorkflowId) {
    throw new Error('No active workflow')
  }

  // For copilot tool calls, we use non-SSE execution to get a simple result
  const response = await fetch(`/api/workflows/${activeWorkflowId}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: options.workflowInput,
      stream: false, // Copilot doesn't need SSE streaming
      triggerType: options.overrideTriggerType || 'manual',
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Workflow execution failed')
  }

  const result = await response.json()
  return result as ExecutionResult
}
