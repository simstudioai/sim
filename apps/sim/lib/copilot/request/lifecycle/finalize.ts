import { createLogger } from '@sim/logger'
import { updateRunStatus } from '@/lib/copilot/async-runs/repository'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamWriter } from '@/lib/copilot/request/session'
import type { OrchestratorResult } from '@/lib/copilot/request/types'
import { toError } from '@/lib/core/utils/helpers'

const logger = createLogger('CopilotStreamFinalize')

/**
 * Single finalization path for stream results.
 * Handles abort / error / success and publishes the terminal event.
 * Replaces duplicated blocks in the old chat-streaming.ts.
 */
export async function finalizeStream(
  result: OrchestratorResult,
  publisher: StreamWriter,
  runId: string,
  aborted: boolean,
  requestId: string
): Promise<void> {
  if (aborted) {
    return handleAborted(result, publisher, runId, requestId)
  }
  if (!result.success) {
    return handleError(result, publisher, runId, requestId)
  }
  return handleSuccess(publisher, runId, requestId)
}

async function handleAborted(
  result: OrchestratorResult,
  publisher: StreamWriter,
  runId: string,
  requestId: string
): Promise<void> {
  const partialContentLen = result.content?.length ?? 0
  const toolCallCount = result.toolCalls?.length ?? 0
  const blockCount = result.contentBlocks?.length ?? 0
  logger.info(`[${requestId}] Stream aborted by explicit stop`, {
    partialContentLen,
    toolCallCount,
    blockCount,
  })
  if (!publisher.sawComplete) {
    const partialContent = result.content || undefined
    await publisher.publish({
      type: MothershipStreamV1EventType.complete,
      payload: {
        status: MothershipStreamV1CompletionStatus.cancelled,
        ...(partialContent ? { partialContent } : {}),
        ...(partialContentLen ? { partialContentLen } : {}),
        ...(toolCallCount ? { toolCallCount } : {}),
      },
    })
  }
  await publisher.flush()
  await loggedRunStatusUpdate(runId, MothershipStreamV1CompletionStatus.cancelled, requestId, {
    completedAt: new Date(),
  })
}

async function handleError(
  result: OrchestratorResult,
  publisher: StreamWriter,
  runId: string,
  requestId: string
): Promise<void> {
  const errorMessage =
    result.error ||
    result.errors?.[0] ||
    'An unexpected error occurred while processing the response.'

  if (publisher.clientDisconnected) {
    logger.info(`[${requestId}] Stream failed after client disconnect`, { error: errorMessage })
  }
  logger.error(`[${requestId}] Orchestration returned failure`, { error: errorMessage })

  await publisher.publish({
    type: MothershipStreamV1EventType.error,
    payload: {
      message: errorMessage,
      error: errorMessage,
      data: { displayMessage: 'An unexpected error occurred while processing the response.' },
    },
  })
  if (!publisher.sawComplete) {
    await publisher.publish({
      type: MothershipStreamV1EventType.complete,
      payload: { status: MothershipStreamV1CompletionStatus.error },
    })
  }
  await publisher.flush()
  await loggedRunStatusUpdate(runId, MothershipStreamV1CompletionStatus.error, requestId, {
    completedAt: new Date(),
    error: errorMessage,
  })
}

async function handleSuccess(
  publisher: StreamWriter,
  runId: string,
  requestId: string
): Promise<void> {
  if (!publisher.sawComplete) {
    await publisher.publish({
      type: MothershipStreamV1EventType.complete,
      payload: { status: MothershipStreamV1CompletionStatus.complete },
    })
  }
  await publisher.flush()
  await loggedRunStatusUpdate(runId, MothershipStreamV1CompletionStatus.complete, requestId, {
    completedAt: new Date(),
  })
}

async function loggedRunStatusUpdate(
  runId: string,
  status: Parameters<typeof updateRunStatus>[1],
  requestId: string,
  updates: Parameters<typeof updateRunStatus>[2] = {}
): Promise<void> {
  try {
    await updateRunStatus(runId, status, updates)
  } catch (error) {
    logger.warn(`[${requestId}] Failed to update run status to ${status}`, {
      runId,
      error: toError(error).message,
    })
  }
}
