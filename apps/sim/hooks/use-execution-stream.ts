import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import type {
  BlockChildWorkflowStartedData,
  BlockCompletedData,
  BlockErrorData,
  BlockStartedData,
  ExecutionCancelledData,
  ExecutionCompletedData,
  ExecutionErrorData,
  ExecutionEvent,
  ExecutionPausedData,
  ExecutionStartedData,
  StreamChunkData,
  StreamDoneData,
} from '@/lib/workflows/executor/execution-events'
import type { SerializableExecutionState } from '@/executor/execution/types'

const logger = createLogger('useExecutionStream')

export class ExecutionStreamHttpError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number
  ) {
    super(message)
    this.name = 'ExecutionStreamHttpError'
  }
}

export function isExecutionStreamHttpError(error: unknown): error is ExecutionStreamHttpError {
  return error instanceof ExecutionStreamHttpError
}

export class SSEEventHandlerError extends Error {
  constructor(
    message: string,
    public readonly eventType: string,
    public readonly eventId: number | undefined,
    public readonly executionId: string | undefined,
    public readonly originalError: unknown
  ) {
    super(message)
    this.name = 'SSEEventHandlerError'
  }
}

export class SSEStreamInterruptedError extends Error {
  constructor(
    message: string,
    public readonly executionId: string | undefined,
    public readonly originalError: unknown
  ) {
    super(message)
    this.name = 'SSEStreamInterruptedError'
  }
}

/**
 * Detects errors caused by the browser killing a fetch (page refresh, navigation, tab close).
 * These should be treated as clean disconnects, not execution errors.
 */
function isClientDisconnectError(error: any): boolean {
  return error.name === 'AbortError'
}

function isRecoverableStreamError(error: any): boolean {
  if (isClientDisconnectError(error)) return false
  const msg = (error.message ?? '').toLowerCase()
  return (
    msg.includes('network error') || msg.includes('failed to fetch') || msg.includes('load failed')
  )
}

/**
 * Processes SSE events from a response body and invokes appropriate callbacks.
 * Exported for use by standalone (non-hook) execution paths like executeWorkflowWithFullLogging.
 */
export async function processSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: ExecutionStreamCallbacks,
  logPrefix: string
): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data: ')) continue

        const data = line.substring(6).trim()
        if (data === '[DONE]') {
          logger.info(`${logPrefix} stream completed`)
          continue
        }

        let event: ExecutionEvent
        try {
          event = JSON.parse(data) as ExecutionEvent
        } catch (error) {
          logger.error('Failed to parse SSE event:', error, { data })
          continue
        }

        try {
          switch (event.type) {
            case 'execution:started':
              await callbacks.onExecutionStarted?.(event.data)
              break
            case 'execution:completed':
              await callbacks.onExecutionCompleted?.(event.data)
              break
            case 'execution:paused':
              await callbacks.onExecutionPaused?.(event.data)
              break
            case 'execution:error':
              await callbacks.onExecutionError?.(event.data)
              break
            case 'execution:cancelled':
              await callbacks.onExecutionCancelled?.(event.data)
              break
            case 'block:started':
              await callbacks.onBlockStarted?.(event.data)
              break
            case 'block:completed':
              await callbacks.onBlockCompleted?.(event.data)
              break
            case 'block:error':
              await callbacks.onBlockError?.(event.data)
              break
            case 'block:childWorkflowStarted':
              await callbacks.onBlockChildWorkflowStarted?.(event.data)
              break
            case 'stream:chunk':
              await callbacks.onStreamChunk?.(event.data)
              break
            case 'stream:done':
              await callbacks.onStreamDone?.(event.data)
              break
            default:
              logger.warn('Unknown event type:', (event as any).type)
          }

          if (event.eventId != null) {
            await callbacks.onEventId?.(event.eventId)
          }
        } catch (error) {
          logger.error('SSE event handler failed:', error, {
            eventType: event.type,
            eventId: event.eventId,
          })
          const message = error instanceof Error ? error.message : String(error)
          throw new SSEEventHandlerError(
            message,
            event.type,
            event.eventId,
            event.executionId,
            error
          )
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export interface ExecutionStreamCallbacks {
  onExecutionStarted?: (data: ExecutionStartedData) => void | Promise<void>
  onExecutionCompleted?: (data: ExecutionCompletedData) => void | Promise<void>
  onExecutionPaused?: (data: ExecutionPausedData) => void | Promise<void>
  onExecutionError?: (data: ExecutionErrorData) => void | Promise<void>
  onExecutionCancelled?: (data: ExecutionCancelledData) => void | Promise<void>
  onBlockStarted?: (data: BlockStartedData) => void | Promise<void>
  onBlockCompleted?: (data: BlockCompletedData) => void | Promise<void>
  onBlockError?: (data: BlockErrorData) => void | Promise<void>
  onBlockChildWorkflowStarted?: (data: BlockChildWorkflowStartedData) => void | Promise<void>
  onStreamChunk?: (data: StreamChunkData) => void | Promise<void>
  onStreamDone?: (data: StreamDoneData) => void | Promise<void>
  onEventId?: (eventId: number) => void | Promise<void>
}

export interface ExecuteStreamOptions {
  workflowId: string
  input?: any
  workflowInput?: any
  currentBlockStates?: Record<string, any>
  envVarValues?: Record<string, string>
  workflowVariables?: Record<string, any>
  selectedOutputs?: string[]
  startBlockId?: string
  triggerType?: string
  useDraftState?: boolean
  isClientSession?: boolean
  workflowStateOverride?: {
    blocks: Record<string, any>
    edges: any[]
    loops?: Record<string, any>
    parallels?: Record<string, any>
  }
  stopAfterBlockId?: string
  onExecutionId?: (executionId: string) => void
  callbacks?: ExecutionStreamCallbacks
}

export interface ExecuteFromBlockOptions {
  workflowId: string
  startBlockId: string
  sourceSnapshot: SerializableExecutionState
  input?: any
  onExecutionId?: (executionId: string) => void
  callbacks?: ExecutionStreamCallbacks
}

export interface ReconnectStreamOptions {
  workflowId: string
  executionId: string
  fromEventId?: number
  callbacks?: ExecutionStreamCallbacks
}

/**
 * Module-level map shared across all hook instances.
 * Ensures ANY instance can cancel streams started by ANY other instance,
 * which is critical for SPA navigation where the original hook instance unmounts
 * but the SSE stream must be cancellable from the new instance.
 */
const sharedAbortControllers = new Map<string, AbortController>()

function executeStreamKey(workflowId: string): string {
  return `${workflowId}:execute`
}

function reconnectStreamKey(workflowId: string, executionId: string): string {
  return `${workflowId}:reconnect:${executionId}`
}

function abortStream(key: string): void {
  const controller = sharedAbortControllers.get(key)
  if (!controller) return
  controller.abort()
  sharedAbortControllers.delete(key)
}

function abortWorkflowStreams(workflowId: string): void {
  const prefix = `${workflowId}:`
  for (const [key, controller] of sharedAbortControllers) {
    if (!key.startsWith(prefix)) continue
    controller.abort()
    sharedAbortControllers.delete(key)
  }
}

/**
 * Hook for executing workflows via server-side SSE streaming.
 * Supports concurrent executions via per-workflow AbortController maps.
 */
export function useExecutionStream() {
  const execute = useCallback(async (options: ExecuteStreamOptions) => {
    const { workflowId, callbacks = {}, onExecutionId, ...payload } = options

    abortWorkflowStreams(workflowId)

    const abortController = new AbortController()
    const streamKey = executeStreamKey(workflowId)
    sharedAbortControllers.set(streamKey, abortController)
    let serverExecutionId: string | undefined

    try {
      // boundary-raw-fetch: workflow execute endpoint returns an SSE stream consumed via response.body.getReader() and processSSEStream; also reads the X-Execution-Id response header
      const response = await fetch(`/api/workflows/${workflowId}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...payload, stream: true }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        let errorResponse: any
        try {
          errorResponse = await response.json()
        } catch {
          throw new ExecutionStreamHttpError(
            `Server error (${response.status}): ${response.statusText}`,
            response.status
          )
        }
        const error = new ExecutionStreamHttpError(
          errorResponse.error || 'Failed to start execution',
          response.status
        )
        if (errorResponse && typeof errorResponse === 'object') {
          Object.assign(error, { executionResult: errorResponse })
        }
        throw error
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      serverExecutionId = response.headers.get('X-Execution-Id') ?? undefined
      if (serverExecutionId) {
        onExecutionId?.(serverExecutionId)
      }

      const reader = response.body.getReader()
      await processSSEStream(reader, callbacks, 'Execution')
    } catch (error: any) {
      if (isClientDisconnectError(error)) {
        logger.info('Execution stream disconnected (page unload or abort)')
        return
      }
      if (isRecoverableStreamError(error)) {
        logger.warn('Execution stream interrupted; preserving execution for reconnect', {
          executionId: serverExecutionId,
          error: error.message,
        })
        throw new SSEStreamInterruptedError(
          'Execution stream interrupted before a terminal event was received',
          serverExecutionId,
          error
        )
      }
      logger.error('Execution stream error:', error)
      if (!(error instanceof SSEEventHandlerError)) {
        await callbacks.onExecutionError?.({
          error: error.message || 'Unknown error',
          duration: 0,
        })
      }
      throw error
    } finally {
      if (sharedAbortControllers.get(streamKey) === abortController) {
        sharedAbortControllers.delete(streamKey)
      }
    }
  }, [])

  const executeFromBlock = useCallback(async (options: ExecuteFromBlockOptions) => {
    const {
      workflowId,
      startBlockId,
      sourceSnapshot,
      input,
      onExecutionId,
      callbacks = {},
    } = options

    abortWorkflowStreams(workflowId)

    const abortController = new AbortController()
    const streamKey = executeStreamKey(workflowId)
    sharedAbortControllers.set(streamKey, abortController)
    let serverExecutionId: string | undefined

    try {
      // boundary-raw-fetch: run-from-block endpoint returns an SSE stream consumed via response.body.getReader() and processSSEStream; also reads the X-Execution-Id response header
      const response = await fetch(`/api/workflows/${workflowId}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stream: true,
          input,
          runFromBlock: { startBlockId, sourceSnapshot },
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        let errorResponse: any
        try {
          errorResponse = await response.json()
        } catch {
          throw new ExecutionStreamHttpError(
            `Server error (${response.status}): ${response.statusText}`,
            response.status
          )
        }
        const error = new ExecutionStreamHttpError(
          errorResponse.error || 'Failed to start execution',
          response.status
        )
        if (errorResponse && typeof errorResponse === 'object') {
          Object.assign(error, { executionResult: errorResponse })
        }
        throw error
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      serverExecutionId = response.headers.get('X-Execution-Id') ?? undefined
      if (serverExecutionId) {
        onExecutionId?.(serverExecutionId)
      }

      const reader = response.body.getReader()
      await processSSEStream(reader, callbacks, 'Run-from-block')
    } catch (error: any) {
      if (isClientDisconnectError(error)) {
        logger.info('Run-from-block stream disconnected (page unload or abort)')
        return
      }
      if (isRecoverableStreamError(error)) {
        logger.warn('Run-from-block stream interrupted; preserving execution for reconnect', {
          executionId: serverExecutionId,
          error: error.message,
        })
        throw new SSEStreamInterruptedError(
          'Run-from-block stream interrupted before a terminal event was received',
          serverExecutionId,
          error
        )
      }
      logger.error('Run-from-block execution error:', error)
      if (!(error instanceof SSEEventHandlerError)) {
        await callbacks.onExecutionError?.({
          error: error.message || 'Unknown error',
          duration: 0,
        })
      }
      throw error
    } finally {
      if (sharedAbortControllers.get(streamKey) === abortController) {
        sharedAbortControllers.delete(streamKey)
      }
    }
  }, [])

  const reconnect = useCallback(async (options: ReconnectStreamOptions) => {
    const { workflowId, executionId, fromEventId = 0, callbacks = {} } = options

    const abortController = new AbortController()
    const streamKey = reconnectStreamKey(workflowId, executionId)
    abortStream(streamKey)
    sharedAbortControllers.set(streamKey, abortController)
    try {
      // boundary-raw-fetch: execution reconnect endpoint returns an SSE stream consumed via response.body.getReader() and processSSEStream
      const response = await fetch(
        `/api/workflows/${workflowId}/executions/${executionId}/stream?from=${fromEventId}`,
        { signal: abortController.signal }
      )
      if (!response.ok) {
        throw new ExecutionStreamHttpError(`Reconnect failed (${response.status})`, response.status)
      }
      if (!response.body) throw new Error('No response body')

      await processSSEStream(response.body.getReader(), callbacks, 'Reconnect')
    } catch (error: any) {
      if (isClientDisconnectError(error)) return
      logger.error('Reconnection stream error:', error)
      throw error
    } finally {
      if (sharedAbortControllers.get(streamKey) === abortController) {
        sharedAbortControllers.delete(streamKey)
      }
    }
  }, [])

  const cancel = useCallback((workflowId?: string) => {
    if (workflowId) {
      abortWorkflowStreams(workflowId)
    } else {
      for (const [, controller] of sharedAbortControllers) {
        controller.abort()
      }
      sharedAbortControllers.clear()
    }
  }, [])

  const cancelReconnect = useCallback((workflowId: string, executionId: string) => {
    abortStream(reconnectStreamKey(workflowId, executionId))
  }, [])

  const cancelExecute = useCallback((workflowId: string) => {
    abortStream(executeStreamKey(workflowId))
  }, [])

  return {
    execute,
    executeFromBlock,
    reconnect,
    cancel,
    cancelReconnect,
    cancelExecute,
  }
}
