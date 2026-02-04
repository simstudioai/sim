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
  callbacks?: ExecutionStreamCallbacks
}

export interface ExecuteFromBlockOptions {
  workflowId: string
  startBlockId: string
  sourceSnapshot: SerializableExecutionState
  input?: any
  callbacks?: ExecutionStreamCallbacks
}

/**
 * Hook for executing workflows via server-side SSE streaming
 */
export function useExecutionStream() {
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentExecutionRef = useRef<{ workflowId: string; executionId: string } | null>(null)

  const execute = useCallback(async (options: ExecuteStreamOptions) => {
    const { workflowId, callbacks = {}, ...payload } = options

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    const abortController = new AbortController()
    abortControllerRef.current = abortController
    currentExecutionRef.current = null

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
        // Attach the execution result from server response for error handling
        if (errorResponse && typeof errorResponse === 'object') {
          Object.assign(error, { executionResult: errorResponse })
        }
        throw error
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      const executionId = response.headers.get('X-Execution-Id')
      if (executionId) {
        currentExecutionRef.current = { workflowId, executionId }
      }

      const reader = response.body.getReader()
      await processSSEStream(reader, callbacks, 'Execution')
    } catch (error: any) {
      if (error.name === 'AbortError') {
        logger.info('Execution stream cancelled')
        callbacks.onExecutionCancelled?.({ duration: 0 })
      } else {
        logger.error('Execution stream error:', error)
        callbacks.onExecutionError?.({
          error: error.message || 'Unknown error',
          duration: 0,
        })
      }
      throw error
    } finally {
      abortControllerRef.current = null
      currentExecutionRef.current = null
    }
  }, [])

  const executeFromBlock = useCallback(async (options: ExecuteFromBlockOptions) => {
    const { workflowId, startBlockId, sourceSnapshot, input, callbacks = {} } = options

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    const abortController = new AbortController()
    abortControllerRef.current = abortController
    currentExecutionRef.current = null

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

      const executionId = response.headers.get('X-Execution-Id')
      if (executionId) {
        currentExecutionRef.current = { workflowId, executionId }
      }

      const reader = response.body.getReader()
      await processSSEStream(reader, callbacks, 'Run-from-block')
    } catch (error: any) {
      if (error.name === 'AbortError') {
        logger.info('Run-from-block execution cancelled')
        callbacks.onExecutionCancelled?.({ duration: 0 })
      } else {
        logger.error('Run-from-block execution error:', error)
        callbacks.onExecutionError?.({
          error: error.message || 'Unknown error',
          duration: 0,
        })
      }
      throw error
    } finally {
      abortControllerRef.current = null
      currentExecutionRef.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    const execution = currentExecutionRef.current
    if (execution) {
      fetch(`/api/workflows/${execution.workflowId}/executions/${execution.executionId}/cancel`, {
        method: 'POST',
      }).catch(() => {})
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    currentExecutionRef.current = null
  }, [])

  return {
    execute,
    executeFromBlock,
    cancel,
  }
}
