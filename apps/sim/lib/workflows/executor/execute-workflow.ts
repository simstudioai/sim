import { createLogger } from '@sim/logger'
import { v4 as uuidv4 } from 'uuid'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { type ExecutionMetadata, ExecutionSnapshot } from '@/executor/execution/snapshot'

const logger = createLogger('WorkflowExecution')

export interface ExecuteWorkflowOptions {
  enabled: boolean
  selectedOutputs?: string[]
  isSecureMode?: boolean
  workflowTriggerType?: 'api' | 'chat'
  onStream?: (streamingExec: any) => Promise<void>
  onBlockComplete?: (blockId: string, output: any) => Promise<void>
  skipLoggingComplete?: boolean
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
  input: any | undefined,
  actorUserId: string,
  streamConfig?: ExecuteWorkflowOptions,
  providedExecutionId?: string
): Promise<any> {
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
          ? async (blockId: string, _blockName: string, _blockType: string, output: any) => {
              await streamConfig.onBlockComplete!(blockId, output)
            }
          : undefined,
      },
      loggingSession,
    })

    if (result.status === 'paused') {
      if (!result.snapshotSeed) {
        logger.error(`[${requestId}] Missing snapshot seed for paused execution`, {
          executionId,
        })
      } else {
        await PauseResumeManager.persistPauseResult({
          workflowId,
          executionId,
          pausePoints: result.pausePoints || [],
          snapshotSeed: result.snapshotSeed,
          executorUserId: result.metadata?.userId,
        })
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
  } catch (error: any) {
    logger.error(`[${requestId}] Workflow execution failed:`, error)
    throw error
  }
}
