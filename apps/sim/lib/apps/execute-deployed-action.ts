import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { APP_RESPONSE_BODY_MAX_BYTES } from '@/lib/apps/manifest'
import { validateAppActionOutputs } from '@/lib/apps/schema-validate'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import { createTimeoutAbortController, getTimeoutErrorMessage } from '@/lib/core/execution-limits'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { sanitizePublicValue } from '@/lib/interfaces/compiler/output-response'
import { workflowHasHitlBlocks } from '@/lib/interfaces/spec/validate'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { handlePostExecutionPauseState } from '@/lib/workflows/executor/pause-persistence'
import {
  type DeployedWorkflowData,
  loadDeployedWorkflowState,
  loadWorkflowDeploymentVersionState,
} from '@/lib/workflows/persistence/utils'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata } from '@/executor/execution/types'
import type { CoreTriggerType } from '@/stores/logs/filters/types'

const logger = createLogger('ExecuteDeployedAction')

export type DeploymentGate = 'active' | 'pinned'

export type NamedOutputConfig = {
  key: string
  blockId: string
  path: string
  /** JSON Schema 2020-12 snapshot from the action allowlist — validated after projection. */
  schema?: unknown
}

export type ExecuteDeployedActionParams = {
  workflowId: string
  userId: string
  workspaceId: string
  deploymentGate: DeploymentGate
  /** Required when deploymentGate === 'pinned'. */
  deploymentVersionId?: string
  /**
   * Optional preloaded deployment snapshot (Interface drift validation).
   * When set, skips a second load to avoid TOCTOU with active redeploys.
   */
  preloadedDeployedState?: DeployedWorkflowData
  input: Record<string, unknown>
  outputConfigs: NamedOutputConfig[]
  executionPolicy: 'sync' | 'async'
  triggerIdentity: 'app' | 'interface'
  requestId: string
  executionId?: string
  abortSignal?: AbortSignal
}

export type ExecuteDeployedActionResult =
  | {
      success: true
      executionId: string
      status: string
      outputs: Record<string, unknown>
      rawResult: unknown
    }
  | {
      success: false
      statusCode: number
      code?: string
      message: string
      needsRepublishing?: boolean
    }

function getByPath(obj: unknown, path: string): unknown {
  if (!path || path === '.') return obj
  const parts = path.split('.').filter(Boolean)
  let cur: unknown = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function projectOutputs(
  blockOutputs: Record<string, unknown>,
  configs: NamedOutputConfig[]
): Record<string, unknown> {
  if (configs.length === 0) {
    return { success: true }
  }
  const out: Record<string, unknown> = {}
  for (const c of configs) {
    const block = blockOutputs[c.blockId]
    // Public boundary: never leak nested LargeValueRef storage pointers.
    out[c.key] = sanitizePublicValue(getByPath(block, c.path))
  }
  return out
}

function blockOutputsFromLogs(
  logs: Array<{ blockId?: string; output?: unknown }> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!logs) return out
  for (const log of logs) {
    if (log.blockId && log.output !== undefined) {
      out[log.blockId] = log.output
    }
  }
  return out
}

function enforceResponseSize(outputs: Record<string, unknown>): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(outputs)).length <= APP_RESPONSE_BODY_MAX_BYTES
  } catch {
    return false
  }
}

/**
 * Shared public-surface execution core.
 * Interface: deploymentGate 'active' (current deploy + drift).
 * Apps: deploymentGate 'pinned' (ignore workflow.isDeployed; archive still rejects).
 */
export async function executeDeployedAction(
  params: ExecuteDeployedActionParams
): Promise<ExecuteDeployedActionResult> {
  const {
    workflowId,
    userId,
    workspaceId,
    deploymentGate,
    deploymentVersionId,
    preloadedDeployedState,
    input,
    outputConfigs,
    executionPolicy,
    triggerIdentity,
    requestId,
    abortSignal,
  } = params

  if (executionPolicy !== 'sync') {
    return {
      success: false,
      statusCode: 400,
      code: 'ASYNC_NOT_SUPPORTED',
      message: 'Async execution is not available yet',
    }
  }

  if (deploymentGate === 'pinned' && !deploymentVersionId && !preloadedDeployedState) {
    return {
      success: false,
      statusCode: 500,
      message: 'Pinned execution requires deploymentVersionId',
    }
  }

  const executionId = params.executionId || generateId()
  const triggerType = triggerIdentity as CoreTriggerType
  const loggingSession = new LoggingSession(workflowId, executionId, triggerType, requestId)

  const preprocessResult = await preprocessExecution({
    workflowId,
    userId,
    triggerType,
    executionId,
    requestId,
    checkRateLimit: true,
    checkDeployment: deploymentGate === 'active',
    loggingSession,
  })

  if (!preprocessResult.success) {
    await releaseExecutionSlot(executionId)
    return {
      success: false,
      statusCode: preprocessResult.error?.statusCode || 429,
      message: preprocessResult.error?.message || 'Too many requests',
    }
  }

  const { actorUserId, billingAttribution, workflowRecord } = preprocessResult

  if ((workflowRecord as { archivedAt?: Date | null } | undefined)?.archivedAt) {
    await releaseExecutionSlot(executionId)
    return { success: false, statusCode: 404, message: 'Workflow is not available' }
  }

  if (!actorUserId) {
    await releaseExecutionSlot(executionId)
    return { success: false, statusCode: 500, message: 'Execution actor missing' }
  }

  let deployed: DeployedWorkflowData
  try {
    if (preloadedDeployedState) {
      deployed = preloadedDeployedState
    } else if (deploymentGate === 'pinned') {
      deployed = await loadWorkflowDeploymentVersionState(
        workflowId,
        deploymentVersionId!,
        workspaceId
      )
    } else {
      deployed = await loadDeployedWorkflowState(workflowId, workspaceId)
    }
  } catch (error) {
    await releaseExecutionSlot(executionId)
    logger.warn(`[${requestId}] Failed to load deployment state`, { error, deploymentGate })
    return {
      success: false,
      statusCode: 409,
      needsRepublishing: deploymentGate === 'active',
      message:
        deploymentGate === 'active'
          ? 'Interface needs republishing'
          : 'The workflow version this action was bound to no longer exists; rebind and rebuild.',
      code: 'DEPLOYMENT_VERSION_MISSING',
    }
  }

  // Reject HITL before execution — Apps/Interface sync paths cannot resume pauses.
  if (workflowHasHitlBlocks(deployed.blocks as Record<string, { type: string }>)) {
    await releaseExecutionSlot(executionId)
    return {
      success: false,
      statusCode: 400,
      code: 'HITL_NOT_SUPPORTED',
      message: 'Human-in-the-loop workflows are not supported on this execution path',
    }
  }

  const timeoutController = createTimeoutAbortController(preprocessResult.executionTimeout?.sync)
  const onAbort = () => timeoutController.abort()
  if (abortSignal) {
    if (abortSignal.aborted) timeoutController.abort()
    else abortSignal.addEventListener('abort', onAbort, { once: true })
  }

  const metadata: ExecutionMetadata = {
    requestId,
    executionId,
    workflowId,
    workspaceId,
    userId: actorUserId,
    billingAttribution,
    workflowUserId: workflowRecord?.userId,
    triggerType,
    useDraftState: false,
    startTime: new Date().toISOString(),
    isClientSession: false,
    executionMode: 'sync',
    workflowStateOverride: {
      blocks: deployed.blocks,
      edges: deployed.edges,
      loops: deployed.loops || {},
      parallels: deployed.parallels || {},
      deploymentVersionId: deployed.deploymentVersionId,
    },
  }

  const deployedVariables =
    (deployed.variables as Record<string, unknown> | undefined) ??
    (workflowRecord?.variables as Record<string, unknown>) ??
    {}

  const workflowForExecution = {
    id: workflowId,
    userId,
    workspaceId,
    isDeployed: true,
    variables: deployedVariables,
  }

  const snapshot = new ExecutionSnapshot(
    metadata,
    workflowForExecution,
    input,
    deployedVariables,
    []
  )

  try {
    const result = await executeWorkflowCore({
      snapshot,
      callbacks: {},
      loggingSession,
      abortSignal: timeoutController.signal,
    })

    if (result.status === 'paused') {
      await loggingSession.markAsFailed('Interactive pause is not supported on this surface')
      await loggingSession.waitForPostExecution().catch(() => undefined)
      return {
        success: false,
        statusCode: 400,
        message: 'Human-in-the-loop workflows are not supported',
      }
    }

    if (result.status === 'cancelled' && timeoutController.isTimedOut()) {
      const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
      await loggingSession.markAsFailed(timeoutErrorMessage)
      await loggingSession.waitForPostExecution().catch(() => undefined)
      return {
        success: false,
        statusCode: 408,
        code: 'TIMEOUT',
        message: 'Request timed out',
      }
    }

    if (result.status === 'cancelled') {
      await loggingSession.markAsFailed('Client cancelled request')
      await loggingSession.waitForPostExecution().catch(() => undefined)
      return {
        success: false,
        statusCode: 499,
        code: 'CLIENT_CANCELLED',
        message: 'Client cancelled request',
      }
    }

    if (!result.success) {
      await loggingSession.waitForPostExecution().catch(() => undefined)
      return {
        success: false,
        statusCode: 500,
        code: 'EXECUTION_FAILED',
        message: 'Workflow execution failed',
      }
    }

    // Project + validate the public boundary before finalizing success logs so
    // INVALID_OUTPUT / RESPONSE_TOO_LARGE cannot show as successful executions.
    const logs = (result as { logs?: Array<{ blockId?: string; output?: unknown }> }).logs
    const blockOutputs = blockOutputsFromLogs(logs)
    const outputs = projectOutputs(blockOutputs, outputConfigs)

    const outputSchemas = outputConfigs
      .filter((c) => c.schema != null)
      .map((c) => ({ key: c.key, schema: c.schema }))
    if (outputSchemas.length > 0) {
      const outputValidation = validateAppActionOutputs({ outputs, outputSchemas })
      if (!outputValidation.ok) {
        await loggingSession.markAsFailed(outputValidation.message)
        await loggingSession.waitForPostExecution().catch(() => undefined)
        return {
          success: false,
          statusCode: 500,
          code: 'INVALID_OUTPUT',
          message: outputValidation.message,
        }
      }
    }

    if (!enforceResponseSize(outputs)) {
      await loggingSession.markAsFailed('Response exceeds size limit')
      await loggingSession.waitForPostExecution().catch(() => undefined)
      return {
        success: false,
        statusCode: 413,
        code: 'RESPONSE_TOO_LARGE',
        message: 'Response exceeds size limit',
      }
    }

    await handlePostExecutionPauseState({
      result,
      workflowId,
      executionId,
      loggingSession,
    })
    await loggingSession.waitForPostExecution().catch(() => undefined)

    return {
      success: true,
      executionId,
      status: String(result.status ?? 'completed'),
      outputs,
      rawResult: result,
    }
  } catch (error) {
    logger.error(`[${requestId}] executeDeployedAction failed`, { error })
    await releaseExecutionSlot(executionId).catch(() => undefined)
    return {
      success: false,
      statusCode: 500,
      message: 'Execution failed',
    }
  } finally {
    if (abortSignal) {
      abortSignal.removeEventListener('abort', onAbort)
    }
    timeoutController.cleanup()
  }
}
