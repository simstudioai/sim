import { useCallback, useRef } from 'react'
import { createLogger } from '@sim/logger'
import type {
  BlockCompletedData,
  BlockErrorData,
  BlockStartedData,
  ExecutionCancelledData,
  ExecutionCompletedData,
  ExecutionErrorData,
  ExecutionEvent,
  ExecutionStartedData,
  StreamChunkData,
  StreamDoneData,
} from '@/lib/workflows/executor/execution-events'
import type { SerializableExecutionState } from '@/executor/execution/types'

const logger = createLogger('useExecutionStream')

/**
 * Detects errors caused by the browser killing a fetch (page refresh, navigation, tab close).
 * These should be treated as clean disconnects, not execution errors.
 */
function isClientDisconnectError(error: any): boolean {
  if (error.name === 'AbortError') return true
  const msg = (error.message ?? '').toLowerCase()
  return (
    msg.includes('network error') || msg.includes('failed to fetch') || msg.includes('load failed')
  )
}

/**
 * Processes SSE events from a response body and invokes appropriate callbacks.
 */
async function processSSEStream(
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

        try {
          const event = JSON.parse(data) as ExecutionEvent

          switch (event.type) {
            case 'execution:started':
              callbacks.onExecutionStarted?.(event.data)
              break
            case 'execution:completed':
              callbacks.onExecutionCompleted?.(event.data)
              break
            case 'execution:error':
              callbacks.onExecutionError?.(event.data)
              break
            case 'execution:cancelled':
              callbacks.onExecutionCancelled?.(event.data)
              break
            case 'block:started':
              callbacks.onBlockStarted?.(event.data)
              break
            case 'block:completed':
              callbacks.onBlockCompleted?.(event.data)
              break
            case 'block:error':
              callbacks.onBlockError?.(event.data)
              break
            case 'stream:chunk':
              callbacks.onStreamChunk?.(event.data)
              break
            case 'stream:done':
              callbacks.onStreamDone?.(event.data)
              break
            default:
              logger.warn('Unknown event type:', (event as any).type)
          }
        } catch (error) {
          logger.error('Failed to parse SSE event:', error, { data })
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export interface ExecutionStreamCallbacks {
  onExecutionStarted?: (data: ExecutionStartedData) => void
  onExecutionCompleted?: (data: ExecutionCompletedData) => void
  onExecutionError?: (data: ExecutionErrorData) => void
  onExecutionCancelled?: (data: ExecutionCancelledData) => void
  onBlockStarted?: (data: BlockStartedData) => void
  onBlockCompleted?: (data: BlockCompletedData) => void
  onBlockError?: (data: BlockErrorData) => void
  onStreamChunk?: (data: StreamChunkData) => void
  onStreamDone?: (data: StreamDoneData) => void
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
 * Hook for executing workflows via server-side SSE streaming.
 * Supports concurrent executions via per-workflow AbortController maps.
 */
export function useExecutionStream() {
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map())
  const currentExecutionsRef = useRef<Map<string, { workflowId: string; executionId: string }>>(
    new Map()
  )

  const execute = useCallback(async (options: ExecuteStreamOptions) => {
    const { workflowId, callbacks = {}, onExecutionId, ...payload } = options

    const existing = abortControllersRef.current.get(workflowId)
    if (existing) {
      existing.abort()
    }

    const abortController = new AbortController()
    abortControllersRef.current.set(workflowId, abortController)
    currentExecutionsRef.current.delete(workflowId)

    try {
      const response = await fetch(`/api/workflows/${workflowId}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...payload, stream: true }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const errorResponse = await response.json()
        const error = new Error(errorResponse.error || 'Failed to start execution')
        if (errorResponse && typeof errorResponse === 'object') {
          Object.assign(error, { executionResult: errorResponse })
        }
        throw error
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      const serverExecutionId = response.headers.get('X-Execution-Id')
      if (serverExecutionId) {
        currentExecutionsRef.current.set(workflowId, { workflowId, executionId: serverExecutionId })
        onExecutionId?.(serverExecutionId)
      }

      const reader = response.body.getReader()
      await processSSEStream(reader, callbacks, 'Execution')
    } catch (error: any) {
      if (isClientDisconnectError(error)) {
        logger.info('Execution stream disconnected (page unload or abort)')
        return
      }
      logger.error('Execution stream error:', error)
      callbacks.onExecutionError?.({
        error: error.message || 'Unknown error',
        duration: 0,
      })
      throw error
    } finally {
      abortControllersRef.current.delete(workflowId)
      currentExecutionsRef.current.delete(workflowId)
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

    const existing = abortControllersRef.current.get(workflowId)
    if (existing) {
      existing.abort()
    }

    const abortController = new AbortController()
    abortControllersRef.current.set(workflowId, abortController)
    currentExecutionsRef.current.delete(workflowId)

    try {
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
          throw new Error(`Server error (${response.status}): ${response.statusText}`)
        }
        const error = new Error(errorResponse.error || 'Failed to start execution')
        if (errorResponse && typeof errorResponse === 'object') {
          Object.assign(error, { executionResult: errorResponse })
        }
        throw error
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      const serverExecutionId = response.headers.get('X-Execution-Id')
      if (serverExecutionId) {
        currentExecutionsRef.current.set(workflowId, { workflowId, executionId: serverExecutionId })
        onExecutionId?.(serverExecutionId)
      }

      const reader = response.body.getReader()
      await processSSEStream(reader, callbacks, 'Run-from-block')
    } catch (error: any) {
      if (isClientDisconnectError(error)) {
        logger.info('Run-from-block stream disconnected (page unload or abort)')
        return
      }
      logger.error('Run-from-block execution error:', error)
      callbacks.onExecutionError?.({
        error: error.message || 'Unknown error',
        duration: 0,
      })
      throw error
    } finally {
      abortControllersRef.current.delete(workflowId)
      currentExecutionsRef.current.delete(workflowId)
    }
  }, [])

  const reconnect = useCallback(async (options: ReconnectStreamOptions) => {
    const { workflowId, executionId, fromEventId = 0, callbacks = {} } = options

    const abortController = new AbortController()
    abortControllersRef.current.set(workflowId, abortController)
    currentExecutionsRef.current.set(workflowId, { workflowId, executionId })

    try {
      const response = await fetch(
        `/api/workflows/${workflowId}/executions/${executionId}/stream?from=${fromEventId}`,
        { signal: abortController.signal }
      )
      if (!response.ok) throw new Error(`Reconnect failed (${response.status})`)
      if (!response.body) throw new Error('No response body')

      await processSSEStream(response.body.getReader(), callbacks, 'Reconnect')
    } catch (error: any) {
      if (isClientDisconnectError(error)) return
      logger.error('Reconnection stream error:', error)
      throw error
    } finally {
      abortControllersRef.current.delete(workflowId)
      currentExecutionsRef.current.delete(workflowId)
    }
  }, [])

  const cancel = useCallback((workflowId?: string) => {
    if (workflowId) {
      const controller = abortControllersRef.current.get(workflowId)
      if (controller) {
        controller.abort()
        abortControllersRef.current.delete(workflowId)
      }
      currentExecutionsRef.current.delete(workflowId)
    } else {
      for (const [, controller] of abortControllersRef.current) {
        controller.abort()
      }
      abortControllersRef.current.clear()
      currentExecutionsRef.current.clear()
    }
  }, [])

  return {
    execute,
    executeFromBlock,
    reconnect,
    cancel,
  }
}
