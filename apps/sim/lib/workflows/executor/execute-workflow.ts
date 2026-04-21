import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { captureServerEvent } from '@/lib/posthog/server'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { handlePostExecutionPauseState } from '@/lib/workflows/executor/pause-persistence'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata, SerializableExecutionState } from '@/executor/execution/types'
import type { ExecutionResult, StreamingExecution } from '@/executor/types'

const logger = createLogger('WorkflowExecution')

export interface ExecuteWorkflowOptions {
  enabled: boolean
  selectedOutputs?: string[]
  isSecureMode?: boolean
  workflowTriggerType?: 'api' | 'chat' | 'copilot'
  triggerBlockId?: string
  onStream?: (streamingExec: StreamingExecution) => Promise<void>
  onBlockComplete?: (blockId: string, output: unknown) => Promise<void>
  skipLoggingComplete?: boolean
  includeFileBase64?: boolean
  base64MaxBytes?: number
  abortSignal?: AbortSignal
  /** Use the live/draft workflow state instead of the deployed state. Used by copilot. */
  useDraftState?: boolean
  /** Stop execution after this block completes. Used for "run until block" feature. */
  stopAfterBlockId?: string
  /** Run-from-block configuration using a prior execution snapshot. */
  runFromBlock?: {
    startBlockId: string
    sourceSnapshot: SerializableExecutionState
  }
  executionMode?: 'sync' | 'stream' | 'async'
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
  const executionId = providedExecutionId || generateId()
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
      triggerBlockId: streamConfig?.triggerBlockId,
      useDraftState: streamConfig?.useDraftState ?? false,
      startTime: new Date().toISOString(),
      isClientSession: false,
      executionMode: streamConfig?.executionMode,
    }

    const snapshot = new ExecutionSnapshot(
      metadata,
      workflow,
      input,
      workflow.variables || {},
      streamConfig?.selectedOutputs || []
    )

    const executionStartMs = Date.now()

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
      stopAfterBlockId: streamConfig?.stopAfterBlockId,
      runFromBlock: streamConfig?.runFromBlock,
    })

    const blockTypes = [
      ...new Set(
        (result.logs ?? [])
          .map((log) => log.blockType)
          .filter((t): t is string => typeof t === 'string')
      ),
    ]
    if (result.status !== 'paused') {
      captureServerEvent(
        actorUserId,
        'workflow_executed',
        {
          workflow_id: workflowId,
          workspace_id: workspaceId,
          trigger_type: triggerType,
          success: result.success,
          block_count: result.logs?.length ?? 0,
          block_types: blockTypes.join(','),
          duration_ms: Date.now() - executionStartMs,
        },
        {
          groups: { workspace: workspaceId },
          setOnce: { first_execution_at: new Date().toISOString() },
        }
      )
    }

    await handlePostExecutionPauseState({ result, workflowId, executionId, loggingSession })

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

    captureServerEvent(
      actorUserId,
      'workflow_execution_failed',
      {
        workflow_id: workflow.id,
        workspace_id: workspaceId,
        trigger_type: streamConfig?.workflowTriggerType || 'api',
        error_message: toError(error).message,
      },
      { groups: { workspace: workspaceId } }
    )

    throw error
  }
}
