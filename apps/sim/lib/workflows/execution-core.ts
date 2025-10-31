/**
 * Core workflow execution logic - shared by all execution paths
 * This is the SINGLE source of truth for workflow execution
 */

import { z } from 'zod'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import type { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { decryptSecret } from '@/lib/utils'
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/db-helpers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { Executor } from '@/executor' // Now exports DAGExecutor
import type { ExecutionResult } from '@/executor/types'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

const logger = createLogger('ExecutionCore')

const EnvVarsSchema = z.record(z.string())

export interface ExecuteWorkflowCoreOptions {
  requestId: string
  workflowId: string
  userId: string
  workflow: any
  input: any
  triggerType: string
  loggingSession: LoggingSession
  executionId: string
  selectedOutputs?: string[]
  workspaceId?: string
  startBlockId?: string // Optional: start from specific block (for webhooks/schedules)
  // Callbacks for SSE streaming (optional)
  onBlockStart?: (blockId: string, blockName: string, blockType: string) => Promise<void>
  onBlockComplete?: (
    blockId: string,
    blockName: string,
    blockType: string,
    output: any
  ) => Promise<void>
  onStream?: (streamingExec: any) => Promise<void>
  onExecutorCreated?: (executor: any) => void // Callback when executor is created (for cancellation)
}

/**
 * Convert variable value to its native type
 */
function parseVariableValueByType(value: any, type: string): any {
  if (value === null || value === undefined) {
    switch (type) {
      case 'number':
        return 0
      case 'boolean':
        return false
      case 'array':
        return []
      case 'object':
        return {}
      default:
        return ''
    }
  }

  if (type === 'number') {
    if (typeof value === 'number') return value
    if (typeof value === 'string') {
      const num = Number(value)
      return Number.isNaN(num) ? 0 : num
    }
    return 0
  }

  if (type === 'boolean') {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true'
    }
    return Boolean(value)
  }

  if (type === 'array') {
    if (Array.isArray(value)) return value
    if (typeof value === 'string' && value.trim()) {
      try {
        return JSON.parse(value)
      } catch {
        return []
      }
    }
    return []
  }

  if (type === 'object') {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value
    if (typeof value === 'string' && value.trim()) {
      try {
        return JSON.parse(value)
      } catch {
        return {}
      }
    }
    return {}
  }

  // string or plain
  return typeof value === 'string' ? value : String(value)
}

/**
 * Core execution function - used by HTTP endpoint, background jobs, webhooks, schedules
 * This is the ONLY place where Executor is instantiated and executed
 */
export async function executeWorkflowCore(
  options: ExecuteWorkflowCoreOptions
): Promise<ExecutionResult> {
  const {
    requestId,
    workflowId,
    userId,
    workflow,
    input,
    triggerType,
    loggingSession,
    executionId,
    selectedOutputs,
    workspaceId: providedWorkspaceId,
    onBlockStart,
    onBlockComplete,
    onStream,
  } = options

  let processedInput = input || {}

  try {
    const startTime = new Date()

    // Load workflow state based on trigger type
    let blocks
    let edges
    let loops
    let parallels

    if (triggerType === 'manual') {
      // Load draft state from normalized tables
      const draftData = await loadWorkflowFromNormalizedTables(workflowId)

      if (!draftData) {
        throw new Error('Workflow not found or not yet saved')
      }

      blocks = draftData.blocks
      edges = draftData.edges
      loops = draftData.loops
      parallels = draftData.parallels

      logger.info(`[${requestId}] Using draft workflow state from normalized tables`)
    } else {
      // Use deployed state for API/webhook/schedule executions
      const deployedData = await loadDeployedWorkflowState(workflowId)
      blocks = deployedData.blocks
      edges = deployedData.edges
      loops = deployedData.loops
      parallels = deployedData.parallels

      logger.info(`[${requestId}] Using deployed workflow state`)
    }

    // Merge block states
    const mergedStates = mergeSubblockState(blocks)

    // Get and decrypt environment variables
    const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
      userId,
      providedWorkspaceId || workflow.workspaceId || undefined
    )
    const variables = EnvVarsSchema.parse({ ...personalEncrypted, ...workspaceEncrypted })

    await loggingSession.safeStart({
      userId,
      workspaceId: providedWorkspaceId || workflow.workspaceId,
      variables,
    })

    // Process block states with env var substitution
    const currentBlockStates = await Object.entries(mergedStates).reduce(
      async (accPromise, [id, block]) => {
        const acc = await accPromise
        acc[id] = await Object.entries(block.subBlocks).reduce(
          async (subAccPromise, [key, subBlock]) => {
            const subAcc = await subAccPromise
            let value = subBlock.value

            if (typeof value === 'string' && value.includes('{{') && value.includes('}}')) {
              const matches = value.match(/{{([^}]+)}}/g)
              if (matches) {
                for (const match of matches) {
                  const varName = match.slice(2, -2)
                  const encryptedValue = variables[varName]
                  if (encryptedValue) {
                    const { decrypted } = await decryptSecret(encryptedValue)
                    value = (value as string).replace(match, decrypted)
                  }
                }
              }
            }

            subAcc[key] = value
            return subAcc
          },
          Promise.resolve({} as Record<string, any>)
        )
        return acc
      },
      Promise.resolve({} as Record<string, Record<string, any>>)
    )

    // Decrypt all env vars
    const decryptedEnvVars: Record<string, string> = {}
    for (const [key, encryptedValue] of Object.entries(variables)) {
      const { decrypted } = await decryptSecret(encryptedValue)
      decryptedEnvVars[key] = decrypted
    }

    // Process response format
    const processedBlockStates = Object.entries(currentBlockStates).reduce(
      (acc, [blockId, blockState]) => {
        if (blockState.responseFormat && typeof blockState.responseFormat === 'string') {
          const responseFormatValue = blockState.responseFormat.trim()
          if (responseFormatValue && !responseFormatValue.startsWith('<')) {
            try {
              acc[blockId] = {
                ...blockState,
                responseFormat: JSON.parse(responseFormatValue),
              }
            } catch {
              acc[blockId] = {
                ...blockState,
                responseFormat: undefined,
              }
            }
          } else {
            acc[blockId] = blockState
          }
        } else {
          acc[blockId] = blockState
        }
        return acc
      },
      {} as Record<string, Record<string, any>>
    )

    const workflowVariables = (workflow.variables as Record<string, any>) || {}

    // Serialize workflow
    const serializedWorkflow = new Serializer().serializeWorkflow(
      mergedStates,
      edges,
      loops,
      parallels,
      true
    )

    processedInput = input || {}

    // Create and execute workflow with callbacks
    const contextExtensions: any = {
      stream: !!onStream,
      selectedOutputs,
      executionId,
      workspaceId: providedWorkspaceId || workflow.workspaceId,
      isDeployedContext: triggerType !== 'manual',
      onBlockStart,
      onBlockComplete, // Pass through directly - executor calls with 4 params
      onStream,
    }

    const executorInstance = new Executor({
      workflow: serializedWorkflow,
      currentBlockStates: processedBlockStates,
      envVarValues: decryptedEnvVars,
      workflowInput: processedInput,
      workflowVariables,
      contextExtensions,
    })

    loggingSession.setupExecutor(executorInstance)

    // Convert initial workflow variables to their native types
    if (workflowVariables) {
      for (const [varId, variable] of Object.entries(workflowVariables)) {
        const v = variable as any
        if (v.value !== undefined && v.type) {
          v.value = parseVariableValueByType(v.value, v.type)
        }
      }
    }

    // Store executor in options for potential cancellation
    if (options.onExecutorCreated) {
      options.onExecutorCreated(executorInstance)
    }

    const result = (await executorInstance.execute(
      workflowId,
      options.startBlockId
    )) as ExecutionResult

    // Build trace spans for logging
    const { traceSpans, totalDuration } = buildTraceSpans(result)

    // Update workflow run counts
    if (result.success) {
      await updateWorkflowRunCounts(workflowId)
    }

    // Complete logging session
    await loggingSession.safeComplete({
      endedAt: new Date().toISOString(),
      totalDurationMs: totalDuration || 0,
      finalOutput: result.output || {},
      traceSpans: traceSpans || [],
      workflowInput: processedInput,
    })

    logger.info(`[${requestId}] Workflow execution completed`, {
      success: result.success,
      duration: result.metadata?.duration,
    })

    return result
  } catch (error: any) {
    logger.error(`[${requestId}] Execution failed:`, error)

    await loggingSession.safeComplete({
      endedAt: new Date().toISOString(),
      totalDurationMs: 0,
      finalOutput: {},
      traceSpans: [],
      workflowInput: processedInput,
    })

    throw error
  }
}
