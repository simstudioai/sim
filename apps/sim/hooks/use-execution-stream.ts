import { useCallback, useRef } from 'react'
import { createLogger } from '@sim/logger'
import type { ExecutionEvent } from '@/lib/workflows/executor/execution-events'
import type { SubflowType } from '@/stores/workflows/workflow/types'

const logger = createLogger('useExecutionStream')

export interface ExecutionStreamCallbacks {
  onExecutionStarted?: (data: { startTime: string }) => void
  onExecutionCompleted?: (data: {
    success: boolean
    output: any
    duration: number
    startTime: string
    endTime: string
  }) => void
  onExecutionError?: (data: { error: string; duration: number }) => void
  onExecutionCancelled?: (data: { duration: number }) => void
  onBlockStarted?: (data: {
    blockId: string
    blockName: string
    blockType: string
    iterationCurrent?: number
    iterationTotal?: number
    iterationType?: SubflowType
  }) => void
  onBlockCompleted?: (data: {
    blockId: string
    blockName: string
    blockType: string
    input?: any
    output: any
    durationMs: number
    iterationCurrent?: number
    iterationTotal?: number
    iterationType?: SubflowType
  }) => void
  onBlockError?: (data: {
    blockId: string
    blockName: string
    blockType: string
    input?: any
    error: string
    durationMs: number
    iterationCurrent?: number
    iterationTotal?: number
    iterationType?: SubflowType
  }) => void
  onStreamChunk?: (data: { blockId: string; chunk: string }) => void
  onStreamDone?: (data: { blockId: string }) => void
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
        const error = await response.json()
        throw new Error(error.error || 'Failed to start execution')
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      const executionId = response.headers.get('X-Execution-Id')
      if (executionId) {
        currentExecutionRef.current = { workflowId, executionId }
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()

          if (done) {
            break
          }

          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n\n')

          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.trim() || !line.startsWith('data: ')) {
              continue
            }

            const data = line.substring(6).trim()

            if (data === '[DONE]') {
              logger.info('Stream completed')
              continue
            }

            try {
              const event = JSON.parse(data) as ExecutionEvent

              logger.info('📡 SSE Event received:', {
                type: event.type,
                executionId: event.executionId,
                data: event.data,
              })

              switch (event.type) {
                case 'execution:started':
                  logger.info('🚀 Execution started')
                  callbacks.onExecutionStarted?.(event.data)
                  break
                case 'execution:completed':
                  logger.info('✅ Execution completed')
                  callbacks.onExecutionCompleted?.(event.data)
                  break
                case 'execution:error':
                  logger.error('❌ Execution error')
                  callbacks.onExecutionError?.(event.data)
                  break
                case 'execution:cancelled':
                  logger.warn('🛑 Execution cancelled')
                  callbacks.onExecutionCancelled?.(event.data)
                  break
                case 'block:started':
                  logger.info('🔷 Block started:', event.data.blockId)
                  callbacks.onBlockStarted?.(event.data)
                  break
                case 'block:completed':
                  logger.info('✓ Block completed:', event.data.blockId)
                  callbacks.onBlockCompleted?.(event.data)
                  break
                case 'block:error':
                  logger.error('✗ Block error:', event.data.blockId)
                  callbacks.onBlockError?.(event.data)
                  break
                case 'stream:chunk':
                  callbacks.onStreamChunk?.(event.data)
                  break
                case 'stream:done':
                  logger.info('Stream done:', event.data.blockId)
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
    cancel,
  }
}
