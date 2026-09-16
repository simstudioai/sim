import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import {
  ASYNC_TOOL_CONFIRMATION_STATUS,
  type AsyncTerminalCompletionSnapshot,
  isAsyncTerminalConfirmationStatus,
} from '@/lib/copilot/async-runs/lifecycle'
import { replaceTerminalAsyncToolCallResult } from '@/lib/copilot/async-runs/repository'
import { MothershipStreamV1ToolOutcome } from '@/lib/copilot/generated/mothership-stream-v1'
import { waitForToolConfirmation } from '@/lib/copilot/persistence/tool-confirm'
import {
  type ClientToolUnsealFailureReason,
  unsealClientToolCompletion,
  unsealClientToolContext,
} from '@/lib/copilot/request/tools/client-completion-seal.server'
import { inspectToolResultForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import {
  type AsyncWorkflowDeploymentError,
  createStructuralWorkflowToolCompletionData,
  getAsyncWorkflowDeploymentError,
  getWorkflowToolCompletionExecutionId,
  getWorkflowToolCompletionMessage,
  getWorkflowToolConfirmationStatus,
} from '@/lib/copilot/tools/workflow-tools'
import { getTrustedWorkflowToolExecution } from '@/lib/workflows/executor/execution-state'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('CopilotClientToolWaiter')

/**
 * Wait for a client-executable workflow tool to report back.
 *
 * Current browser runtime outcomes are:
 * - `success`, `error`, `cancelled`: the workflow finished in the browser
 * - `background`: the browser detached on `pagehide`, so the server should stop
 *   waiting for a foreground result
 */
export async function waitForToolCompletion(
  toolCallId: string,
  timeoutMs: number | null,
  abortSignal?: AbortSignal
): Promise<AsyncTerminalCompletionSnapshot | null> {
  const decision = await waitForToolConfirmation(toolCallId, timeoutMs, abortSignal, {
    acceptStatus: (status) =>
      status === MothershipStreamV1ToolOutcome.success ||
      status === MothershipStreamV1ToolOutcome.error ||
      status === ASYNC_TOOL_CONFIRMATION_STATUS.background ||
      status === MothershipStreamV1ToolOutcome.cancelled,
  })
  if (decision && isAsyncTerminalConfirmationStatus(decision.status)) {
    return { ...decision, status: decision.status }
  }
  return null
}

interface WaitForClientToolCompletionOptions {
  toolCallId: string
  runId?: string
  userId: string
  /** Null for a durable human-interaction wait that ends only on answer or abort. */
  timeoutMs: number | null
  abortSignal?: AbortSignal
  registry?: ResolvedSecretTraceRegistry
}

function getGenericCompletionMessage(status: AsyncTerminalCompletionSnapshot['status']): string {
  if (status === MothershipStreamV1ToolOutcome.success) return 'Tool completed'
  if (status === ASYNC_TOOL_CONFIRMATION_STATUS.background) return 'Tool is running in background'
  if (status === MothershipStreamV1ToolOutcome.cancelled) return 'Tool cancelled'
  return 'Tool failed'
}

/**
 * Restores a generic browser/terminal result from its sealed transport envelope,
 * projects active Secrets values, then replaces the durable row before delivery.
 */
export async function waitForClientToolCompletion({
  toolCallId,
  runId,
  userId,
  timeoutMs,
  abortSignal,
  registry,
}: WaitForClientToolCompletionOptions): Promise<AsyncTerminalCompletionSnapshot | null> {
  const completion = await waitForToolCompletion(toolCallId, timeoutMs, abortSignal)
  if (!completion) return null

  const toolRegistry = registry?.forkForInputPaths([])
  const genericMessage = getGenericCompletionMessage(completion.status)
  const binding = runId ? { toolCallId, runId, userId } : undefined
  const registryCanImport = toolRegistry !== undefined && !toolRegistry.isPermanentlyIncomplete()
  const finishPendingActivation = toolRegistry?.beginPendingActivation()
  let content: Awaited<ReturnType<typeof unsealClientToolCompletion>> = null
  let completionFailure: ClientToolUnsealFailureReason | undefined
  let contextFailure: ClientToolUnsealFailureReason | undefined
  try {
    /**
     * A tool invoked without a run id has no binding to unseal against, which is a configuration
     * rather than a fault. Tracking whether unsealing was even attempted keeps that ordinary case
     * out of the error stream while a genuine unseal failure stays in it.
     */
    const sealingAttempted = Boolean(binding && registry && toolRegistry && registryCanImport)
    const [sealedContent, sealedContext] =
      sealingAttempted && binding && registry
        ? await Promise.all([
            unsealClientToolCompletion(completion.data, binding, (reason) => {
              completionFailure = reason
            }),
            unsealClientToolContext(completion.data, binding, registry, (reason) => {
              contextFailure = reason
            }),
          ])
        : [null, null]
    if (toolRegistry && registryCanImport) {
      if (!sealedContent || !sealedContext) {
        if (sealingAttempted) {
          /** The durable row is replaced below, so report the failing guard before it is lost. */
          logger.error('Client tool provenance could not be restored', {
            toolCallId,
            runId,
            ...(completionFailure ? { completionFailure } : {}),
            ...(contextFailure ? { contextFailure } : {}),
          })
        }
        toolRegistry.markIncomplete(
          sealingAttempted ? 'client-tool-seal-failed' : 'client-tool-seal-absent'
        )
      } else {
        const imported = await toolRegistry.importProvenance(sealedContext.provenance, {
          origin: 'copilotToolClient.sealedContext',
          trusted: true,
        })
        if (!imported || !sealedContext.provenance.complete) {
          toolRegistry.markIncomplete('source-provenance-incomplete', {
            origin: 'copilotToolClient.sealedContext',
          })
        } else {
          content = sealedContent
        }
      }
    }
  } catch {
    logger.error('Client tool provenance could not be restored', {
      toolCallId,
      runId,
      cause: 'unexpected-unseal-error',
    })
    toolRegistry?.markIncomplete('client-tool-seal-failed', {
      origin: 'copilotToolClient.sealedContext',
    })
  } finally {
    finishPendingActivation?.()
  }
  if (!toolRegistry?.isComplete()) content = null

  const rawOutput: Record<string, unknown> = {
    ...(content?.message !== undefined ? { message: content.message } : {}),
    ...(content && Object.hasOwn(content, 'data') ? { data: content.data } : {}),
  }
  const succeeded = completion.status === MothershipStreamV1ToolOutcome.success
  const projection = inspectToolResultForCopilot(
    {
      success: succeeded,
      output: rawOutput,
      ...(!succeeded ? { error: content?.message ?? genericMessage } : {}),
    },
    toolRegistry
  )
  const projected = projection.result
  const projectedOutput = isPlainRecord(projected.output) ? projected.output : undefined
  const modelSucceeded = succeeded && projected.success
  const message =
    typeof projectedOutput?.message === 'string'
      ? projectedOutput.message
      : !projected.success && projected.error
        ? projected.error
        : genericMessage
  const data =
    projectedOutput && Object.hasOwn(projectedOutput, 'data') ? projectedOutput.data : undefined
  const terminalData =
    data === undefined
      ? modelSucceeded
        ? { success: true }
        : { error: message }
      : data === null && modelSucceeded
        ? { success: true, data: null }
        : data

  if (completion.status !== ASYNC_TOOL_CONFIRMATION_STATUS.background) {
    const status =
      completion.status === MothershipStreamV1ToolOutcome.success
        ? modelSucceeded
          ? 'completed'
          : 'failed'
        : completion.status === MothershipStreamV1ToolOutcome.cancelled
          ? 'cancelled'
          : 'failed'
    try {
      const updated = await replaceTerminalAsyncToolCallResult({
        toolCallId,
        status,
        result: terminalData,
        error: modelSucceeded ? null : message,
      })
      if (!updated) {
        logger.warn('Client tool row was no longer terminal during safe payload update', {
          toolCallId,
        })
      }
    } catch (error) {
      logger.warn('Failed to persist projected client tool result', {
        toolCallId,
        error: getErrorMessage(error),
      })
    }
  }

  if (projection.safe && registry && toolRegistry?.isComplete()) {
    registry.mergeToolCallRegistry(toolRegistry)
  }

  return {
    status:
      completion.status === MothershipStreamV1ToolOutcome.success && !modelSucceeded
        ? MothershipStreamV1ToolOutcome.error
        : completion.status,
    message,
    data: terminalData,
  }
}

interface WaitForWorkflowToolCompletionOptions {
  toolCallId: string
  workflowId?: string
  timeoutMs: number
  abortSignal?: AbortSignal
  registry?: ResolvedSecretTraceRegistry
}

function structuralWorkflowCompletion(
  status: AsyncTerminalCompletionSnapshot['status'],
  workflowId?: string,
  executionId?: string,
  deploymentError?: AsyncWorkflowDeploymentError
): AsyncTerminalCompletionSnapshot {
  return {
    status,
    message: deploymentError?.message ?? getWorkflowToolCompletionMessage(status),
    data: createStructuralWorkflowToolCompletionData(
      status,
      workflowId,
      executionId,
      deploymentError
    ),
  }
}

/**
 * Restores a client-run workflow result from the bound server execution log.
 * The browser confirmation is only a wakeup and structural identity carrier.
 */
export async function waitForWorkflowToolCompletion({
  toolCallId,
  workflowId,
  timeoutMs,
  abortSignal,
  registry,
}: WaitForWorkflowToolCompletionOptions): Promise<AsyncTerminalCompletionSnapshot | null> {
  const toolRegistry = registry?.forkForInputPaths([])
  const finishPendingActivation = toolRegistry?.beginPendingActivation()
  let completion: AsyncTerminalCompletionSnapshot | null = null
  let trustedExecution: Awaited<ReturnType<typeof getTrustedWorkflowToolExecution>> = null

  try {
    completion = await waitForToolCompletion(toolCallId, timeoutMs, abortSignal)
    if (!completion) {
      toolRegistry?.markIncomplete('client-tool-completion-missing')
      return null
    }

    const executionId = getWorkflowToolCompletionExecutionId(completion.data)
    const deploymentError = getAsyncWorkflowDeploymentError(completion.data)
    if (completion.status === ASYNC_TOOL_CONFIRMATION_STATUS.background) {
      toolRegistry?.markIncomplete('client-tool-completion-deferred')
      return structuralWorkflowCompletion(completion.status, workflowId, executionId)
    }
    if (!workflowId || !executionId) {
      toolRegistry?.markIncomplete('client-tool-completion-unidentified')
      const structuralStatus =
        completion.status === MothershipStreamV1ToolOutcome.success
          ? MothershipStreamV1ToolOutcome.error
          : completion.status
      return structuralWorkflowCompletion(
        structuralStatus,
        workflowId,
        executionId,
        deploymentError
      )
    }

    try {
      trustedExecution = await getTrustedWorkflowToolExecution(executionId, workflowId, toolCallId)
    } catch (error) {
      logger.warn('Failed to restore bound workflow tool execution', {
        toolCallId,
        workflowId,
        executionId,
        error: getErrorMessage(error),
      })
    }

    if (!trustedExecution) {
      toolRegistry?.markIncomplete('client-tool-execution-untrusted')
      return structuralWorkflowCompletion(completion.status, workflowId, executionId)
    }

    if (!trustedExecution.contentAvailable) {
      toolRegistry?.markIncomplete('client-tool-content-unavailable')
      return structuralWorkflowCompletion(
        getWorkflowToolConfirmationStatus(trustedExecution.status),
        workflowId,
        executionId
      )
    }

    if (
      !toolRegistry ||
      toolRegistry.isPermanentlyIncomplete() ||
      !trustedExecution.provenance.complete
    ) {
      if (!trustedExecution.provenance.complete)
        toolRegistry?.markIncomplete('source-provenance-incomplete', {
          origin: 'copilotToolClient.workflowExecution',
        })
      return structuralWorkflowCompletion(
        getWorkflowToolConfirmationStatus(trustedExecution.status),
        workflowId,
        executionId
      )
    }

    try {
      const imported = await toolRegistry.importCrossingProvenance(
        trustedExecution.provenance,
        {
          ...(Object.hasOwn(trustedExecution, 'finalOutput')
            ? { finalOutput: trustedExecution.finalOutput }
            : {}),
          blockLogs: trustedExecution.blockLogs,
          ...(trustedExecution.error !== undefined ? { error: trustedExecution.error } : {}),
        },
        { trusted: true }
      )
      if (!imported)
        toolRegistry.markIncomplete('value-provenance-import-failed', {
          origin: 'copilotToolClient.workflowExecution',
        })
    } catch (error) {
      toolRegistry.markIncomplete('value-provenance-import-failed', {
        origin: 'copilotToolClient.workflowExecution',
      })
      logger.warn('Failed to import bound workflow provenance', {
        toolCallId,
        workflowId,
        executionId,
        error: getErrorMessage(error),
      })
    }
  } finally {
    finishPendingActivation?.()
  }

  if (!completion || !trustedExecution || !workflowId) return completion

  const executionId = trustedExecution.executionId
  const status = getWorkflowToolConfirmationStatus(trustedExecution.status)
  const genericMessage = getWorkflowToolCompletionMessage(status)
  const rawData: Record<string, unknown> = {
    success: status === MothershipStreamV1ToolOutcome.success,
    workflowId,
    executionId,
    ...(Object.hasOwn(trustedExecution, 'finalOutput')
      ? { output: trustedExecution.finalOutput }
      : {}),
    logs: trustedExecution.blockLogs,
    ...(trustedExecution.error !== undefined ? { error: trustedExecution.error } : {}),
    ...(status === MothershipStreamV1ToolOutcome.cancelled
      ? { reason: 'user_cancelled', cancelledByUser: true }
      : {}),
  }
  const projection = inspectToolResultForCopilot(
    {
      success: status === MothershipStreamV1ToolOutcome.success,
      output: rawData,
      ...(status !== MothershipStreamV1ToolOutcome.success
        ? { error: trustedExecution.error ?? genericMessage }
        : {}),
    },
    toolRegistry
  )
  const projected = projection.result
  const projectedData = isPlainRecord(projected.output) ? projected.output : {}
  const data = {
    ...projectedData,
    ...createStructuralWorkflowToolCompletionData(status, workflowId, executionId),
  }
  const message =
    status === MothershipStreamV1ToolOutcome.success
      ? genericMessage
      : Object.hasOwn(projected, 'output') && projected.error
        ? projected.error
        : genericMessage

  try {
    const updated = await replaceTerminalAsyncToolCallResult({
      toolCallId,
      status: trustedExecution.status,
      result: data,
      error: status === MothershipStreamV1ToolOutcome.success ? null : message,
    })
    if (!updated) {
      logger.warn('Bound workflow tool row was no longer terminal during safe payload update', {
        toolCallId,
        workflowId,
        executionId,
      })
    }
  } catch (error) {
    logger.warn('Failed to persist projected workflow tool result', {
      toolCallId,
      workflowId,
      executionId,
      error: getErrorMessage(error),
    })
  }

  if (projection.safe && registry && toolRegistry?.isComplete()) {
    registry.mergeToolCallRegistry(toolRegistry)
  }

  return { status, message, data }
}
