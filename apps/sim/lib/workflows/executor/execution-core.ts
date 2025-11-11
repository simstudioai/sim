/**
 * Core workflow execution logic - shared by all execution paths
 * This is the SINGLE source of truth for workflow execution
 */

import type { Edge } from 'reactflow'
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
import { TriggerUtils } from '@/lib/workflows/triggers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { Executor } from '@/executor'
import type { ExecutionCallbacks, ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionResult } from '@/executor/types'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

const logger = createLogger('ExecutionCore')

const EnvVarsSchema = z.record(z.string())

export interface ExecuteWorkflowCoreOptions {
  snapshot: ExecutionSnapshot
  callbacks: ExecutionCallbacks
  loggingSession: LoggingSession
  skipLogCreation?: boolean // For resume executions - reuse existing log entry
}

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

export async function executeWorkflowCore(
  options: ExecuteWorkflowCoreOptions
): Promise<ExecutionResult> {
  const { snapshot, callbacks, loggingSession, skipLogCreation } = options
  const { metadata, workflow, input, environmentVariables, workflowVariables, selectedOutputs } =
    snapshot
  const { requestId, workflowId, userId, triggerType, executionId, triggerBlockId, useDraftState } =
    metadata
  const { onBlockStart, onBlockComplete, onStream, onExecutorCreated } = callbacks

  const providedWorkspaceId = metadata.workspaceId

  let processedInput = input || {}

  try {
    let blocks
    let edges: Edge[]
    let loops
    let parallels

    // Use workflowStateOverride if provided (for diff workflows)
    if (metadata.workflowStateOverride) {
      blocks = metadata.workflowStateOverride.blocks
      edges = metadata.workflowStateOverride.edges
      loops = metadata.workflowStateOverride.loops || {}
      parallels = metadata.workflowStateOverride.parallels || {}

      logger.info(`[${requestId}] Using workflow state override (diff workflow execution)`, {
        blocksCount: Object.keys(blocks).length,
        edgesCount: edges.length,
      })
    } else if (useDraftState) {
      const draftData = await loadWorkflowFromNormalizedTables(workflowId)

      if (!draftData) {
        throw new Error('Workflow not found or not yet saved')
      }

      blocks = draftData.blocks
      edges = draftData.edges
      loops = draftData.loops
      parallels = draftData.parallels

      logger.info(
        `[${requestId}] Using draft workflow state from normalized tables (client execution)`
      )
    } else {
      const deployedData = await loadDeployedWorkflowState(workflowId)
      blocks = deployedData.blocks
      edges = deployedData.edges
      loops = deployedData.loops
      parallels = deployedData.parallels

      logger.info(`[${requestId}] Using deployed workflow state (deployed execution)`)
    }

    // Merge block states
    const mergedStates = mergeSubblockState(blocks)

    // Get and decrypt environment variables
    const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
      userId,
      providedWorkspaceId
    )
    const variables = EnvVarsSchema.parse({ ...personalEncrypted, ...workspaceEncrypted })

    await loggingSession.safeStart({
      userId,
      workspaceId: providedWorkspaceId,
      variables,
      skipLogCreation, // Skip if resuming an existing execution
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

    // Use edges directly - trigger-to-trigger edges are prevented at creation time
    const filteredEdges = edges

    // Check if this is a resume execution before trigger resolution
    const resumeFromSnapshot = (metadata as any).resumeFromSnapshot === true
    const resumePendingQueue = snapshot.state?.pendingQueue

    let resolvedTriggerBlockId = triggerBlockId

    // For resume executions, skip trigger resolution since we have a pending queue
    if (resumeFromSnapshot && resumePendingQueue?.length) {
      resolvedTriggerBlockId = undefined
      logger.info(`[${requestId}] Skipping trigger resolution for resume execution`, {
        pendingQueueLength: resumePendingQueue.length,
      })
    } else if (!triggerBlockId) {
      const executionKind =
        triggerType === 'api' || triggerType === 'chat' ? (triggerType as 'api' | 'chat') : 'manual'

      const startBlock = TriggerUtils.findStartBlock(mergedStates, executionKind, false)

      if (!startBlock) {
        const errorMsg =
          executionKind === 'api'
            ? 'No API trigger block found. Add an API Trigger block to this workflow.'
            : executionKind === 'chat'
              ? 'No chat trigger block found. Add a Chat Trigger block to this workflow.'
              : 'No trigger block found for this workflow.'
        logger.error(`[${requestId}] ${errorMsg}`)
        throw new Error(errorMsg)
      }

      resolvedTriggerBlockId = startBlock.blockId
      logger.info(`[${requestId}] Identified trigger block for ${executionKind} execution:`, {
        blockId: resolvedTriggerBlockId,
        blockType: startBlock.block.type,
        path: startBlock.path,
      })
    }

    // Serialize workflow
    const serializedWorkflow = new Serializer().serializeWorkflow(
      mergedStates,
      filteredEdges,
      loops,
      parallels,
      true
    )

    processedInput = input || {}

    // Create and execute workflow with callbacks
    if (resumeFromSnapshot) {
      logger.info(`[${requestId}] Resume execution detected`, {
        resumePendingQueue,
        hasState: !!snapshot.state,
        stateBlockStatesCount: snapshot.state
          ? Object.keys(snapshot.state.blockStates || {}).length
          : 0,
        executedBlocksCount: snapshot.state?.executedBlocks?.length ?? 0,
        useDraftState,
      })
    }

    const contextExtensions: any = {
      stream: !!onStream,
      selectedOutputs,
      executionId,
      workspaceId: providedWorkspaceId,
      userId,
      isDeployedContext: triggerType !== 'manual',
      onBlockStart,
      onBlockComplete,
      onStream,
      resumeFromSnapshot,
      resumePendingQueue,
      remainingEdges: snapshot.state?.remainingEdges,
      dagIncomingEdges: snapshot.state?.dagIncomingEdges,
      snapshotState: snapshot.state,
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

    if (onExecutorCreated) {
      onExecutorCreated(executorInstance)
    }

    const result = (await executorInstance.execute(
      workflowId,
      resolvedTriggerBlockId
    )) as ExecutionResult

    // Build trace spans for logging from the full execution result
    const { traceSpans, totalDuration } = buildTraceSpans(result)

    // Update workflow run counts
    if (result.success && result.status !== 'paused') {
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

    // Extract execution result from error if available
    const executionResult = (error as any)?.executionResult
    const { traceSpans } = executionResult ? buildTraceSpans(executionResult) : { traceSpans: [] }

    await loggingSession.safeCompleteWithError({
      endedAt: new Date().toISOString(),
      totalDurationMs: executionResult?.metadata?.duration || 0,
      error: {
        message: error.message || 'Execution failed',
        stackTrace: error.stack,
      },
      traceSpans,
    })

    throw error
  }
}
