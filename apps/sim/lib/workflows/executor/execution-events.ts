import type { SubflowType } from '@/stores/workflows/workflow/types'

export type ExecutionEventType =
  | 'execution:started'
  | 'execution:completed'
  | 'execution:error'
  | 'execution:cancelled'
  | 'block:started'
  | 'block:completed'
  | 'block:error'
  | 'stream:chunk'
  | 'stream:done'

/**
 * Base event structure for SSE
 */
export interface BaseExecutionEvent {
  type: ExecutionEventType
  timestamp: string
  executionId: string
}

/**
 * Execution started event
 */
export interface ExecutionStartedEvent extends BaseExecutionEvent {
  type: 'execution:started'
  workflowId: string
  data: {
    startTime: string
  }
}

/**
 * Execution completed event
 */
export interface ExecutionCompletedEvent extends BaseExecutionEvent {
  type: 'execution:completed'
  workflowId: string
  data: {
    success: boolean
    output: any
    duration: number
    startTime: string
    endTime: string
  }
}

/**
 * Execution error event
 */
export interface ExecutionErrorEvent extends BaseExecutionEvent {
  type: 'execution:error'
  workflowId: string
  data: {
    error: string
    duration: number
  }
}

export interface ExecutionCancelledEvent extends BaseExecutionEvent {
  type: 'execution:cancelled'
  workflowId: string
  data: {
    duration: number
  }
}

/**
 * Block started event
 */
export interface BlockStartedEvent extends BaseExecutionEvent {
  type: 'block:started'
  workflowId: string
  data: {
    blockId: string
    blockName: string
    blockType: string
    executionOrder: number
    iterationCurrent?: number
    iterationTotal?: number
    iterationType?: SubflowType
  }
}

/**
 * Block completed event
 */
export interface BlockCompletedEvent extends BaseExecutionEvent {
  type: 'block:completed'
  workflowId: string
  data: {
    blockId: string
    blockName: string
    blockType: string
    input?: any
    output: any
    durationMs: number
    startedAt: string
    executionOrder: number
    endedAt: string
    iterationCurrent?: number
    iterationTotal?: number
    iterationType?: SubflowType
  }
}

/**
 * Block error event
 */
export interface BlockErrorEvent extends BaseExecutionEvent {
  type: 'block:error'
  workflowId: string
  data: {
    blockId: string
    blockName: string
    blockType: string
    input?: any
    error: string
    durationMs: number
    startedAt: string
    executionOrder: number
    endedAt: string
    iterationCurrent?: number
    iterationTotal?: number
    iterationType?: SubflowType
  }
}

/**
 * Stream chunk event (for agent blocks)
 */
export interface StreamChunkEvent extends BaseExecutionEvent {
  type: 'stream:chunk'
  workflowId: string
  data: {
    blockId: string
    chunk: string
  }
}

/**
 * Stream done event
 */
export interface StreamDoneEvent extends BaseExecutionEvent {
  type: 'stream:done'
  workflowId: string
  data: {
    blockId: string
  }
}

/**
 * Union type of all execution events
 */
export type ExecutionEvent =
  | ExecutionStartedEvent
  | ExecutionCompletedEvent
  | ExecutionErrorEvent
  | ExecutionCancelledEvent
  | BlockStartedEvent
  | BlockCompletedEvent
  | BlockErrorEvent
  | StreamChunkEvent
  | StreamDoneEvent

export type ExecutionStartedData = ExecutionStartedEvent['data']
export type ExecutionCompletedData = ExecutionCompletedEvent['data']
export type ExecutionErrorData = ExecutionErrorEvent['data']
export type ExecutionCancelledData = ExecutionCancelledEvent['data']
export type BlockStartedData = BlockStartedEvent['data']
export type BlockCompletedData = BlockCompletedEvent['data']
export type BlockErrorData = BlockErrorEvent['data']
export type StreamChunkData = StreamChunkEvent['data']
export type StreamDoneData = StreamDoneEvent['data']

/**
 * Helper to create SSE formatted message
 */
export function formatSSEEvent(event: ExecutionEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/**
 * Helper to encode SSE event as Uint8Array
 */
export function encodeSSEEvent(event: ExecutionEvent): Uint8Array {
  return new TextEncoder().encode(formatSSEEvent(event))
}

/**
 * Options for creating SSE execution callbacks
 */
export interface SSECallbackOptions {
  executionId: string
  workflowId: string
  controller: ReadableStreamDefaultController<Uint8Array>
  isStreamClosed: () => boolean
  setStreamClosed: () => void
}

/**
 * Creates SSE callbacks for workflow execution streaming
 */
export function createSSECallbacks(options: SSECallbackOptions) {
  const { executionId, workflowId, controller, isStreamClosed, setStreamClosed } = options

  const sendEvent = (event: ExecutionEvent) => {
    if (isStreamClosed()) return
    try {
      controller.enqueue(encodeSSEEvent(event))
    } catch {
      setStreamClosed()
    }
  }

  const onBlockStart = async (
    blockId: string,
    blockName: string,
    blockType: string,
    executionOrder: number,
    iterationContext?: { iterationCurrent: number; iterationTotal: number; iterationType: string }
  ) => {
    sendEvent({
      type: 'block:started',
      timestamp: new Date().toISOString(),
      executionId,
      workflowId,
      data: {
        blockId,
        blockName,
        blockType,
        executionOrder,
        ...(iterationContext && {
          iterationCurrent: iterationContext.iterationCurrent,
          iterationTotal: iterationContext.iterationTotal,
          iterationType: iterationContext.iterationType as any,
        }),
      },
    })
  }

  const onBlockComplete = async (
    blockId: string,
    blockName: string,
    blockType: string,
    callbackData: {
      input?: unknown
      output: any
      executionTime: number
      startedAt: string
      executionOrder: number
      endedAt: string
    },
    iterationContext?: { iterationCurrent: number; iterationTotal: number; iterationType: string }
  ) => {
    const hasError = callbackData.output?.error
    const iterationData = iterationContext
      ? {
          iterationCurrent: iterationContext.iterationCurrent,
          iterationTotal: iterationContext.iterationTotal,
          iterationType: iterationContext.iterationType as any,
        }
      : {}

    if (hasError) {
      sendEvent({
        type: 'block:error',
        timestamp: new Date().toISOString(),
        executionId,
        workflowId,
        data: {
          blockId,
          blockName,
          blockType,
          input: callbackData.input,
          error: callbackData.output.error,
          durationMs: callbackData.executionTime || 0,
          startedAt: callbackData.startedAt,
          executionOrder: callbackData.executionOrder,
          endedAt: callbackData.endedAt,
          ...iterationData,
        },
      })
    } else {
      sendEvent({
        type: 'block:completed',
        timestamp: new Date().toISOString(),
        executionId,
        workflowId,
        data: {
          blockId,
          blockName,
          blockType,
          input: callbackData.input,
          output: callbackData.output,
          durationMs: callbackData.executionTime || 0,
          startedAt: callbackData.startedAt,
          executionOrder: callbackData.executionOrder,
          endedAt: callbackData.endedAt,
          ...iterationData,
        },
      })
    }
  }

  const onStream = async (streamingExecution: unknown) => {
    const streamingExec = streamingExecution as { stream: ReadableStream; execution: any }
    const blockId = streamingExec.execution?.blockId
    const reader = streamingExec.stream.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        sendEvent({
          type: 'stream:chunk',
          timestamp: new Date().toISOString(),
          executionId,
          workflowId,
          data: { blockId, chunk },
        })
      }
      sendEvent({
        type: 'stream:done',
        timestamp: new Date().toISOString(),
        executionId,
        workflowId,
        data: { blockId },
      })
    } finally {
      try {
        reader.releaseLock()
      } catch {}
    }
  }

  return { sendEvent, onBlockStart, onBlockComplete, onStream }
}
