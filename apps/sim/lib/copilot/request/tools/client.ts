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
  unsealClientToolCompletion,
  unsealClientToolContext,
} from '@/lib/copilot/request/tools/client-completion-seal.server'
import { projectToolResultForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import {
  createStructuralWorkflowToolCompletionData,
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
  timeoutMs: number,
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
  timeoutMs: number
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

  const genericMessage = getGenericCompletionMessage(completion.status)
  const binding = runId ? { toolCallId, runId, userId } : undefined
  const registryCanImport = registry !== undefined && !registry.isPermanentlyIncomplete()
  const finishPendingActivation = registry?.beginPendingActivation()
  let content: Awaited<ReturnType<typeof unsealClientToolCompletion>> = null
  try {
    const [sealedContent, sealedContext] =
      binding && registry && registryCanImport
        ? await Promise.all([
            unsealClientToolCompletion(completion.data, binding),
            unsealClientToolContext(completion.data, binding, registry),
          ])
        : [null, null]
    if (registry && registryCanImport) {
      if (!sealedContent || !sealedContext) {
        registry.markIncomplete()
      } else {
        const imported = await registry.importProvenance(sealedContext.provenance, {
          trusted: true,
        })
        if (!imported || !sealedContext.provenance.complete) {
          registry.markIncomplete()
        } else {
          content = sealedContent
        }
      }
    }
  } catch {
    registry?.markIncomplete()
  } finally {
    finishPendingActivation?.()
  }
  if (!registry?.isComplete()) content = null

  const rawOutput: Record<string, unknown> = {
    ...(content?.message !== undefined ? { message: content.message } : {}),
    ...(content && Object.hasOwn(content, 'data') ? { data: content.data } : {}),
  }
  const succeeded = completion.status === MothershipStreamV1ToolOutcome.success
  const projected = projectToolResultForCopilot(
    {
      success: succeeded,
      output: rawOutput,
      ...(!succeeded ? { error: content?.message ?? genericMessage } : {}),
    },
    registry
  )
  const projectedOutput = isPlainRecord(projected.output) ? projected.output : undefined
  const message =
    typeof projectedOutput?.message === 'string'
      ? projectedOutput.message
      : !succeeded && projected.error
        ? projected.error
        : genericMessage
  const data =
    projectedOutput && Object.hasOwn(projectedOutput, 'data') ? projectedOutput.data : undefined

  if (completion.status !== ASYNC_TOOL_CONFIRMATION_STATUS.background) {
    const status =
      completion.status === MothershipStreamV1ToolOutcome.success
        ? 'completed'
        : completion.status === MothershipStreamV1ToolOutcome.cancelled
          ? 'cancelled'
          : 'failed'
    try {
      const updated = await replaceTerminalAsyncToolCallResult({
        toolCallId,
        status,
        result: data ?? null,
        error: succeeded ? null : message,
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

  return {
    status: completion.status,
    message,
    ...(data !== undefined ? { data } : {}),
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
  executionId?: string
): AsyncTerminalCompletionSnapshot {
  return {
    status,
    message: getWorkflowToolCompletionMessage(status),
    data: createStructuralWorkflowToolCompletionData(status, workflowId, executionId),
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
  const finishPendingActivation = registry?.beginPendingActivation()
  let completion: AsyncTerminalCompletionSnapshot | null = null
  let trustedExecution: Awaited<ReturnType<typeof getTrustedWorkflowToolExecution>> = null

  try {
    completion = await waitForToolCompletion(toolCallId, timeoutMs, abortSignal)
    if (!completion) {
      registry?.markIncomplete()
      return null
    }

    const executionId = getWorkflowToolCompletionExecutionId(completion.data)
    if (completion.status === ASYNC_TOOL_CONFIRMATION_STATUS.background) {
      registry?.markIncomplete()
      return structuralWorkflowCompletion(completion.status, workflowId, executionId)
    }
    if (!workflowId || !executionId) {
      registry?.markIncomplete()
      const structuralStatus =
        completion.status === MothershipStreamV1ToolOutcome.success
          ? MothershipStreamV1ToolOutcome.error
          : completion.status
      return structuralWorkflowCompletion(structuralStatus, workflowId, executionId)
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
      registry?.markIncomplete()
      return structuralWorkflowCompletion(completion.status, workflowId, executionId)
    }

    if (!trustedExecution.contentAvailable) {
      registry?.markIncomplete()
      return structuralWorkflowCompletion(
        getWorkflowToolConfirmationStatus(trustedExecution.status),
        workflowId,
        executionId
      )
    }

    if (!registry || registry.isPermanentlyIncomplete() || !trustedExecution.provenance.complete) {
      if (!trustedExecution.provenance.complete) registry?.markIncomplete()
      return structuralWorkflowCompletion(
        getWorkflowToolConfirmationStatus(trustedExecution.status),
        workflowId,
        executionId
      )
    }

    try {
      const imported = await registry.importCrossingProvenance(
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
      if (!imported) registry.markIncomplete()
    } catch (error) {
      registry.markIncomplete()
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
  const projected = projectToolResultForCopilot(
    {
      success: status === MothershipStreamV1ToolOutcome.success,
      output: rawData,
      ...(status !== MothershipStreamV1ToolOutcome.success
        ? { error: trustedExecution.error ?? genericMessage }
        : {}),
    },
    registry
  )
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

  return { status, message, data }
}
