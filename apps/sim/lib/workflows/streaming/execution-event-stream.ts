import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { createTimeoutAbortController, getTimeoutErrorMessage } from '@/lib/core/execution-limits'
import { traverseObjectPath } from '@/lib/core/utils/response-format'
import { compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import { cleanupExecutionBase64Cache } from '@/lib/uploads/utils/user-file-base64.server'
import { createSSECallbacks } from '@/lib/workflows/executor/execution-events'
import { completeLoggingSession } from '@/lib/workflows/streaming/logging-session-completion'
import type { ExecutionResult, StreamingExecution } from '@/executor/types'

const logger = createLogger('ExecutionEventStream')

/**
 * The block-completion payload the executor hands to `onBlockComplete`. Declared
 * structurally because `executeWorkflow` widens it to `unknown` on its way out.
 */
interface BlockCompletion {
  output?: unknown
  executionTime?: number
  startedAt?: string
  endedAt?: string
  executionOrder?: number
  childWorkflowInstanceId?: string
}

/** The executor callbacks a run must accept to be streamed as execution events. */
export interface ExecutionEventStreamCallbacks {
  onStream: (streamingExec: StreamingExecution) => Promise<void>
  onBlockStart: (
    blockId: string,
    blockName: string,
    blockType: string,
    executionOrder: number
  ) => Promise<void>
  onBlockComplete: (blockId: string, output: unknown) => Promise<void>
  abortSignal: AbortSignal
}

export interface ExecutionEventStreamOptions {
  requestId: string
  executionId: string
  workflowId: string
  /**
   * What the module published, as `blockId -> the output paths it named`.
   *
   * A module publishes `{ blockId, path }` pairs, so authorising by block id
   * alone is too coarse: an agent block's output carries `toolCalls.list`, whose
   * entries hold the literal arguments sent to every tool and the literal
   * response that came back. Publishing `agent-1 / content` must expose
   * `content` and nothing else, so only the named paths are forwarded.
   *
   * A block the module did not name is *withheld*: it still reports that it ran,
   * but reports nothing about itself — not its output, not its streamed text,
   * and not its authored name or type. The viewer is anonymous, and a workflow's
   * intermediate outputs and internal composition are not what was published.
   *
   * An empty map means nothing was named, so the run's final output is the
   * answer. Streaming still flows (that text *is* the answer) and the final
   * output is sent, but no per-block output is exposed and every block reports a
   * positional label — an unnamed block's identity was never published either.
   */
  publishedOutputs: ReadonlyMap<string, ReadonlySet<string>>
  /** Durable-serialization scope for outputs that leave the process. */
  workspaceId: string
  userId: string
  timeoutMs?: number
  executeFn: (callbacks: ExecutionEventStreamCallbacks) => Promise<ExecutionResult>
}

function readBlockCompletion(value: unknown): BlockCompletion {
  return isRecordLike(value) ? (value as BlockCompletion) : {}
}

/**
 * Stands in for a withheld failure message. A block error string routinely
 * embeds the upstream response body, URL, or echoed credential that caused it,
 * so the message itself is output — only the fact of the failure is not.
 */
const REDACTED_BLOCK_ERROR = 'This step failed.'

/**
 * Withholds a block's output entirely, keeping a fixed `error` sentinel so the
 * block still reports as failed rather than silently succeeding — never the
 * authored or upstream failure message.
 */
function withheldBlockOutput(output: unknown): unknown {
  const failed = isRecordLike(output) && output.error !== undefined
  return failed ? { error: REDACTED_BLOCK_ERROR } : {}
}

/**
 * Rebuilds a block's output containing only the paths the module published,
 * nesting preserved so the client resolves them exactly as it would have from
 * the whole object.
 *
 * A published path that the run did not produce is simply absent, which is what
 * the client already renders as "no value" — inventing a key would be a lie
 * about what ran.
 */
/**
 * Object keys that would reach the prototype chain rather than the payload.
 *
 * Defence in depth, deliberately untested: no reachable input exercises it,
 * because `traverseObjectPath` resolves such a path to `undefined` and the loop
 * skips it before the guard is consulted. Kept so that a future change to path
 * resolution cannot turn a stored path into a prototype write.
 */
const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

function pickPublishedPaths(output: unknown, paths: ReadonlySet<string>): unknown {
  if (!isRecordLike(output)) return output ?? {}

  const picked: Record<string, unknown> = {}
  for (const path of paths) {
    const segments = path.split('.')
    if (segments.some((segment) => segment === '' || UNSAFE_PATH_SEGMENTS.has(segment))) continue

    const value = traverseObjectPath(output, path)
    if (value === undefined) continue

    let cursor = picked
    for (const segment of segments.slice(0, -1)) {
      const next = cursor[segment]
      cursor[segment] = isRecordLike(next) ? next : {}
      cursor = cursor[segment] as Record<string, unknown>
    }
    cursor[segments[segments.length - 1]] = value
  }

  /**
   * A failure survives redaction. `error` is never a publishable path — the
   * output picker does not offer it — so picking alone strips it, and the
   * downstream event builder decides `block:error` vs `block:completed` from
   * exactly that field. Without this a published block that failed reports
   * success with an empty output, which is the silent-success the withheld
   * branch already refuses.
   */
  if (output.error !== undefined) picked.error = REDACTED_BLOCK_ERROR
  return picked
}

/**
 * Drains a withheld block's stream without forwarding any of it. The executor
 * accumulates `execution.output` from the reader this callback consumes, so the
 * stream must still be read to completion even when nothing is emitted.
 */
async function drainStream(stream: ReadableStream): Promise<void> {
  const reader = stream.getReader()
  try {
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {}
  }
}

/**
 * Streams a workflow run as the typed {@link ExecutionEvent} dialect — the one
 * and only SSE dialect `processSSEStream` decodes, and therefore the one every
 * in-app run surface (the workflow editor, the interface chat module) already
 * speaks.
 *
 * `createStreamingResponse` in this same folder emits the *other* dialect —
 * bare `{ blockId, chunk }` frames plus a terminal `{ event: 'final' }` — which
 * is the deployed chat's and the public execute API's wire format. Both are
 * live; neither is a fallback for the other. Pick this one when the consumer is
 * an app surface, and that one when the consumer is a deployed chat or an
 * external API caller.
 */
export function createExecutionEventStream(
  options: ExecutionEventStreamOptions
): ReadableStream<Uint8Array> {
  const { requestId, executionId, workflowId, publishedOutputs, timeoutMs, executeFn } = options
  const timeoutController = createTimeoutAbortController(timeoutMs)
  const durableContext = {
    workspaceId: options.workspaceId,
    workflowId,
    executionId,
    userId: options.userId,
    requireDurable: true,
    preserveRoot: true,
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let streamClosed = false
      const callbacks = createSSECallbacks({
        executionId,
        workflowId,
        controller,
        isStreamClosed: () => streamClosed,
        setStreamClosed: () => {
          streamClosed = true
        },
      })

      /**
       * `executeWorkflow` reports a block's name and type once, at start; the
       * completion callback carries only the id. Carrying them forward keeps
       * `block:completed` and `block:started` describing the same block — and,
       * for a withheld block, describing it the same redacted way twice.
       */
      const blockNames = new Map<string, { blockName: string; blockType: string }>()
      const startTime = new Date()

      /**
       * A block is published only if the module named it. This is deliberately
       * NOT relaxed when the selection is empty: an unnamed block's authored
       * name, type and output were never published either way, and treating
       * "nothing selected" as "everything public" leaked the workflow's whole
       * internal composition to anonymous viewers.
       */
      const isPublished = (blockId: unknown): blockId is string =>
        typeof blockId === 'string' && publishedOutputs.has(blockId)

      /**
       * Streaming is gated separately from output. With no selection the
       * streamed text IS the answer the module published, so it must flow; with
       * a selection, only the named blocks stream.
       */
      const hasSelection = publishedOutputs.size > 0
      const isStreamWithheld = (blockId: unknown) => hasSelection && !isPublished(blockId)

      await callbacks.sendEvent({
        type: 'execution:started',
        timestamp: startTime.toISOString(),
        executionId,
        workflowId,
        data: { startTime: startTime.toISOString() },
      })

      try {
        const result = await executeFn({
          abortSignal: timeoutController.signal,
          onStream: async (streamingExec) => {
            const streamBlockId = isRecordLike(streamingExec.execution)
              ? streamingExec.execution.blockId
              : undefined
            if (isStreamWithheld(streamBlockId)) {
              await drainStream(streamingExec.stream)
              return
            }
            await callbacks.onStream(streamingExec)
          },
          onBlockStart: async (blockId, blockName, blockType, executionOrder) => {
            /**
             * A withheld block reports a positional label: its authored name and
             * type describe the workflow's internal composition, which the
             * module never published.
             */
            const identity = isPublished(blockId)
              ? { blockName, blockType }
              : { blockName: `Step ${executionOrder}`, blockType: '' }
            blockNames.set(blockId, identity)
            await callbacks.onBlockStart(
              blockId,
              identity.blockName,
              identity.blockType,
              executionOrder
            )
          },
          onBlockComplete: async (blockId, completion) => {
            const { output, executionTime, startedAt, endedAt, executionOrder } =
              readBlockCompletion(completion)
            const identity = blockNames.get(blockId)
            const publishedPaths = publishedOutputs.get(blockId)
            const visibleOutput = publishedPaths
              ? pickPublishedPaths(output, publishedPaths)
              : withheldBlockOutput(output)
            await callbacks.onBlockComplete(
              blockId,
              identity?.blockName ?? blockId,
              identity?.blockType ?? '',
              {
                output: await compactExecutionPayload(visibleOutput, durableContext),
                executionTime: executionTime ?? 0,
                startedAt: startedAt ?? startTime.toISOString(),
                endedAt: endedAt ?? new Date().toISOString(),
                executionOrder: executionOrder ?? 0,
              }
            )
          },
        })

        const duration = result.metadata?.duration ?? 0

        if (
          result.status === 'cancelled' &&
          timeoutController.isTimedOut() &&
          timeoutController.timeoutMs
        ) {
          const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
          logger.info(`[${requestId}] Execution event stream timed out`, {
            timeoutMs: timeoutController.timeoutMs,
          })
          await result._streamingMetadata?.loggingSession.markAsFailed(timeoutErrorMessage)
          result._streamingMetadata = undefined
          await callbacks.sendEvent({
            type: 'execution:error',
            timestamp: new Date().toISOString(),
            executionId,
            workflowId,
            data: { error: timeoutErrorMessage, duration },
          })
        } else {
          await completeLoggingSession(result)

          if (result.status === 'cancelled') {
            await callbacks.sendEvent({
              type: 'execution:cancelled',
              timestamp: new Date().toISOString(),
              executionId,
              workflowId,
              data: { duration },
            })
          } else {
            /**
             * With a selection configured the answer arrives block by block, so
             * the run's raw final output — which belongs to whichever block ran
             * last, selected or not — is withheld.
             */
            const finalOutput = hasSelection
              ? {}
              : await compactExecutionPayload(result.output ?? {}, durableContext)
            const endTime = result.metadata?.endTime ?? new Date().toISOString()

            await callbacks.sendEvent(
              result.status === 'paused'
                ? {
                    type: 'execution:paused',
                    timestamp: new Date().toISOString(),
                    executionId,
                    workflowId,
                    data: {
                      output: finalOutput,
                      duration,
                      startTime: result.metadata?.startTime ?? startTime.toISOString(),
                      endTime,
                    },
                  }
                : {
                    type: 'execution:completed',
                    timestamp: new Date().toISOString(),
                    executionId,
                    workflowId,
                    data: {
                      success: result.success,
                      output: finalOutput,
                      duration,
                      startTime: result.metadata?.startTime ?? startTime.toISOString(),
                      endTime,
                    },
                  }
            )
          }
        }
      } catch (error) {
        logger.error(`[${requestId}] Execution event stream failed`, { error })
        await callbacks.sendEvent({
          type: 'execution:error',
          timestamp: new Date().toISOString(),
          executionId,
          workflowId,
          data: { error: getErrorMessage(error, 'Stream processing error'), duration: 0 },
        })
      } finally {
        timeoutController.cleanup()
        try {
          await cleanupExecutionBase64Cache(executionId)
        } catch (error) {
          logger.error(`[${requestId}] Failed to cleanup base64 cache`, { error })
        }
        streamClosed = true
        controller.close()
      }
    },
    async cancel(reason) {
      logger.info(`[${requestId}] Execution event stream cancelled`, { reason })
      timeoutController.abort()
      timeoutController.cleanup()
      try {
        await cleanupExecutionBase64Cache(executionId)
      } catch (error) {
        logger.error(`[${requestId}] Failed to cleanup base64 cache`, { error })
      }
    },
  })
}
