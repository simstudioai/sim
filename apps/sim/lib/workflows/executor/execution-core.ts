/**
 * Core workflow execution logic - shared by all execution paths
 * This is the SINGLE source of truth for workflow execution
 */

import { createLogger } from '@sim/logger'
import type { Edge } from 'reactflow'
import { z } from 'zod'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { clearExecutionCancellation } from '@/lib/execution/cancellation'
import type { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { Executor } from '@/executor'
import { REFERENCE } from '@/executor/constants'
import type { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type {
  ContextExtensions,
  ExecutionCallbacks,
  IterationContext,
} from '@/executor/execution/types'
import type { ExecutionResult, NormalizedBlockOutput } from '@/executor/types'
import { createEnvVarPattern } from '@/executor/utils/reference-validation'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

const logger = createLogger('ExecutionCore')

const EnvVarsSchema = z.record(z.string())

export interface ExecuteWorkflowCoreOptions {
  snapshot: ExecutionSnapshot
  callbacks: ExecutionCallbacks
  loggingSession: LoggingSession
  skipLogCreation?: boolean // For resume executions - reuse existing log entry
  /**
   * AbortSignal for cancellation support.
   * When aborted (e.g., client disconnects from SSE), execution stops gracefully.
   */
  abortSignal?: AbortSignal
}

function parseVariableValueByType(value: unknown, type: string): unknown {
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
  const { snapshot, callbacks, loggingSession, skipLogCreation, abortSignal } = options
  const { metadata, workflow, input, workflowVariables, selectedOutputs } = snapshot
  const { requestId, workflowId, userId, triggerType, executionId, triggerBlockId, useDraftState } =
    metadata
  const { onBlockStart, onBlockComplete, onStream } = callbacks

  const providedWorkspaceId = metadata.workspaceId
  if (!providedWorkspaceId) {
    throw new Error(`Execution metadata missing workspaceId for workflow ${workflowId}`)
  }

  let processedInput = input || {}

  try {
    let blocks
    let edges: Edge[]
    let loops
    let parallels
    let deploymentVersionId: string | undefined

    // Use workflowStateOverride if provided (for diff workflows)
    if (metadata.workflowStateOverride) {
      blocks = metadata.workflowStateOverride.blocks
      edges = metadata.workflowStateOverride.edges
      loops = metadata.workflowStateOverride.loops || {}
      parallels = metadata.workflowStateOverride.parallels || {}
      deploymentVersionId = metadata.workflowStateOverride.deploymentVersionId

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
      deploymentVersionId = deployedData.deploymentVersionId

      logger.info(`[${requestId}] Using deployed workflow state (deployed execution)`)
    }

    // Merge block states
    const mergedStates = mergeSubblockState(blocks)

    const personalEnvUserId =
      metadata.isClientSession && metadata.sessionUserId
        ? metadata.sessionUserId
        : metadata.workflowUserId

    if (!personalEnvUserId) {
      throw new Error('Missing workflowUserId in execution metadata')
    }

    const { personalEncrypted, workspaceEncrypted, personalDecrypted, workspaceDecrypted } =
      await getPersonalAndWorkspaceEnv(personalEnvUserId, providedWorkspaceId)

    // Use encrypted values for logging (don't log decrypted secrets)
    const variables = EnvVarsSchema.parse({ ...personalEncrypted, ...workspaceEncrypted })

    // Use already-decrypted values for execution (no redundant decryption)
    const decryptedEnvVars: Record<string, string> = { ...personalDecrypted, ...workspaceDecrypted }

    await loggingSession.safeStart({
      userId,
      workspaceId: providedWorkspaceId,
      variables,
      skipLogCreation,
      deploymentVersionId,
    })

    // Process block states with env var substitution using pre-decrypted values
    const currentBlockStates = Object.entries(mergedStates).reduce(
      (acc, [id, block]) => {
        acc[id] = Object.entries(block.subBlocks).reduce(
          (subAcc, [key, subBlock]) => {
            let value = subBlock.value

            if (
              typeof value === 'string' &&
              value.includes(REFERENCE.ENV_VAR_START) &&
              value.includes(REFERENCE.ENV_VAR_END)
            ) {
              const envVarPattern = createEnvVarPattern()
              const matches = value.match(envVarPattern)
              if (matches) {
                for (const match of matches) {
                  const varName = match.slice(
                    REFERENCE.ENV_VAR_START.length,
                    -REFERENCE.ENV_VAR_END.length
                  )
                  const decryptedValue = decryptedEnvVars[varName]
                  if (decryptedValue !== undefined) {
                    value = (value as string).replace(match, decryptedValue)
                  }
                }
              }
            }

            subAcc[key] = value
            return subAcc
          },
          {} as Record<string, any>
        )
        return acc
      },
      {} as Record<string, Record<string, any>>
    )

    // Process response format
    const processedBlockStates = Object.entries(currentBlockStates).reduce(
      (acc, [blockId, blockState]) => {
        if (blockState.responseFormat && typeof blockState.responseFormat === 'string') {
          const responseFormatValue = blockState.responseFormat.trim()
          if (responseFormatValue && !responseFormatValue.startsWith(REFERENCE.START)) {
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
    const resumeFromSnapshot = metadata.resumeFromSnapshot === true
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
        const errorMsg = 'No start block found. Add a start block to this workflow.'
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

    const wrappedOnBlockComplete = async (
      blockId: string,
      blockName: string,
      blockType: string,
      output: { input?: unknown; output: NormalizedBlockOutput; executionTime: number },
      iterationContext?: IterationContext
    ) => {
      await loggingSession.onBlockComplete(blockId, blockName, blockType, output)
      if (onBlockComplete) {
        await onBlockComplete(blockId, blockName, blockType, output, iterationContext)
      }
    }

    const contextExtensions: ContextExtensions = {
      stream: !!onStream,
      selectedOutputs,
      executionId,
      workspaceId: providedWorkspaceId,
      userId,
      isDeployedContext: triggerType !== 'manual',
      onBlockStart,
      onBlockComplete: wrappedOnBlockComplete,
      onStream,
      resumeFromSnapshot,
      resumePendingQueue,
      remainingEdges: snapshot.state?.remainingEdges?.map((edge) => ({
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? undefined,
        targetHandle: edge.targetHandle ?? undefined,
      })),
      dagIncomingEdges: snapshot.state?.dagIncomingEdges,
      snapshotState: snapshot.state,
      metadata,
      abortSignal,
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
        const v = variable as { value?: unknown; type?: string }
        if (v.value !== undefined && v.type) {
          v.value = parseVariableValueByType(v.value, v.type)
        }
      }
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

    if (result.status === 'cancelled') {
      await loggingSession.safeCompleteWithCancellation({
        endedAt: new Date().toISOString(),
        totalDurationMs: totalDuration || 0,
        traceSpans: traceSpans || [],
      })

      await clearExecutionCancellation(executionId)

      logger.info(`[${requestId}] Workflow execution cancelled`, {
        duration: result.metadata?.duration,
      })

      return result
    }

    if (result.status === 'paused') {
      await loggingSession.safeCompleteWithPause({
        endedAt: new Date().toISOString(),
        totalDurationMs: totalDuration || 0,
        traceSpans: traceSpans || [],
        workflowInput: processedInput,
      })

      await clearExecutionCancellation(executionId)

      logger.info(`[${requestId}] Workflow execution paused`, {
        duration: result.metadata?.duration,
      })

      return result
    }

    await loggingSession.safeComplete({
      endedAt: new Date().toISOString(),
      totalDurationMs: totalDuration || 0,
      finalOutput: result.output || {},
      traceSpans: traceSpans || [],
      workflowInput: processedInput,
    })

    await clearExecutionCancellation(executionId)

    logger.info(`[${requestId}] Workflow execution completed`, {
      success: result.success,
      duration: result.metadata?.duration,
    })

    return result
  } catch (error: unknown) {
    logger.error(`[${requestId}] Execution failed:`, error)

    const errorWithResult = error as {
      executionResult?: ExecutionResult
      message?: string
      stack?: string
    }
    const executionResult = errorWithResult?.executionResult
    const { traceSpans } = executionResult ? buildTraceSpans(executionResult) : { traceSpans: [] }

    await loggingSession.safeCompleteWithError({
      endedAt: new Date().toISOString(),
      totalDurationMs: executionResult?.metadata?.duration || 0,
      error: {
        message: errorWithResult?.message || 'Execution failed',
        stackTrace: errorWithResult?.stack,
      },
      traceSpans,
    })

    await clearExecutionCancellation(executionId)

    throw error
  }
}
