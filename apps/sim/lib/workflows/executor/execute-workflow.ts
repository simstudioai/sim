import { createLogger } from '@sim/logger'
import { v4 as uuidv4 } from 'uuid'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata } from '@/executor/execution/types'
import type { ExecutionResult, StreamingExecution } from '@/executor/types'

const logger = createLogger('WorkflowExecution')

export interface ExecuteWorkflowOptions {
  enabled: boolean
  selectedOutputs?: string[]
  isSecureMode?: boolean
  workflowTriggerType?: 'api' | 'chat'
  onStream?: (streamingExec: StreamingExecution) => Promise<void>
  onBlockComplete?: (blockId: string, output: unknown) => Promise<void>
  skipLoggingComplete?: boolean
  includeFileBase64?: boolean
  base64MaxBytes?: number
  abortSignal?: AbortSignal
}

export interface WorkflowInfo {
  id: string
  userId: string
  workspaceId?: string | null
  isDeployed?: boolean
  variables?: Record<string, any>
}

export async function executeWorkflow(
  workflow: WorkflowInfo,
  requestId: string,
  input: unknown | undefined,
  actorUserId: string,
  streamConfig?: ExecuteWorkflowOptions,
  providedExecutionId?: string
): Promise<ExecutionResult> {
  if (!workflow.workspaceId) {
    throw new Error(`Workflow ${workflow.id} has no workspaceId`)
  }

  const workflowId = workflow.id
  const workspaceId = workflow.workspaceId
  const executionId = providedExecutionId || uuidv4()
  const triggerType = streamConfig?.workflowTriggerType || 'api'
  const loggingSession = new LoggingSession(workflowId, executionId, triggerType, requestId)

  try {
    const metadata: ExecutionMetadata = {
      requestId,
      executionId,
      workflowId,
      workspaceId,
      userId: actorUserId,
      workflowUserId: workflow.userId,
      triggerType,
      useDraftState: false,
      startTime: new Date().toISOString(),
      isClientSession: false,
    }

    const snapshot = new ExecutionSnapshot(
      metadata,
      workflow,
      input,
      workflow.variables || {},
      streamConfig?.selectedOutputs || []
    )

    const result = await executeWorkflowCore({
      snapshot,
      callbacks: {
        onStream: streamConfig?.onStream,
        onBlockComplete: streamConfig?.onBlockComplete
          ? async (blockId: string, _blockName: string, _blockType: string, output: unknown) => {
              await streamConfig.onBlockComplete!(blockId, output)
            }
          : undefined,
      },
      loggingSession,
      includeFileBase64: streamConfig?.includeFileBase64,
      base64MaxBytes: streamConfig?.base64MaxBytes,
      abortSignal: streamConfig?.abortSignal,
    })

    if (result.status === 'paused') {
      if (!result.snapshotSeed) {
        logger.error(`[${requestId}] Missing snapshot seed for paused execution`, {
          executionId,
        })
        await loggingSession.markAsFailed('Missing snapshot seed for paused execution')
      } else {
        try {
          await PauseResumeManager.persistPauseResult({
            workflowId,
            executionId,
            pausePoints: result.pausePoints || [],
            snapshotSeed: result.snapshotSeed,
            executorUserId: result.metadata?.userId,
          })
        } catch (pauseError) {
          logger.error(`[${requestId}] Failed to persist pause result`, {
            executionId,
            error: pauseError instanceof Error ? pauseError.message : String(pauseError),
          })
          await loggingSession.markAsFailed(
            `Failed to persist pause state: ${pauseError instanceof Error ? pauseError.message : String(pauseError)}`
          )
        }
      }
    } else {
      await PauseResumeManager.processQueuedResumes(executionId)
    }

    if (streamConfig?.skipLoggingComplete) {
      return {
        ...result,
        _streamingMetadata: {
          loggingSession,
          processedInput: input,
        },
      }
    }

    return result
  } catch (error: unknown) {
    logger.error(`[${requestId}] Workflow execution failed:`, error)
    throw error
  }
}
