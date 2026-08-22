import type { SecretSafeBlockLog } from '@/lib/logs/execution/display-types'
import type {
  BlockCompletionCallbackData,
  ChildWorkflowContext,
  IterationContext,
  ParentIteration,
} from '@/executor/execution/types'
import type { SubflowType } from '@/stores/workflows/workflow/types'

export type ExecutionEventType =
  | 'execution:started'
  | 'execution:completed'
  | 'execution:paused'
  | 'execution:error'
  | 'execution:cancelled'
  | 'block:started'
  | 'block:completed'
  | 'block:error'
  | 'block:childWorkflowStarted'
  | 'stream:chunk'
  /** Live-only: clears a block's streamed answer text (intermediate turn). */
  | 'stream:chunk_reset'
  | 'stream:done'
  /** Live-only agent thinking delta (not buffered for reconnect replay). */
  | 'stream:thinking'
  /** Live-only tool lifecycle (not buffered for reconnect replay). */
  | 'stream:tool'

/**
 * Event types that are live-only: forwarded to connected clients but excluded
 * from reconnect replay buffers (same rule as answer chunks — guaranteed `seq`
 * replay for stream events is out of scope).
 */
export const LIVE_ONLY_EXECUTION_EVENT_TYPES: ReadonlySet<ExecutionEventType> = new Set([
  'stream:chunk',
  'stream:chunk_reset',
  'stream:done',
  'stream:thinking',
  'stream:tool',
])

/**
 * Base event structure for SSE
 */
interface BaseExecutionEvent {
  type: ExecutionEventType
  timestamp: string
  executionId: string
  eventId?: number
}

export interface ExecutionEventDisplayData {
  input?: unknown
  output?: unknown
  error?: string
  text?: string
  chunk?: string
  clearLiveDisplay?: true
}

/**
 * Execution started event
 */
interface ExecutionStartedEvent extends BaseExecutionEvent {
  type: 'execution:started'
  workflowId: string
  data: {
    startTime: string
  }
}

/**
 * Execution completed event
 */
interface ExecutionCompletedEvent extends BaseExecutionEvent {
  type: 'execution:completed'
  workflowId: string
  data: {
    success: boolean
    output: any
    duration: number
    startTime: string
    endTime: string
    /** Authoritative per-block terminal states from the server's blockLogs. */
    finalBlockLogs?: SecretSafeBlockLog[]
  }
}

/**
 * Execution paused event (HITL block waiting for human input)
 */
interface ExecutionPausedEvent extends BaseExecutionEvent {
  type: 'execution:paused'
  workflowId: string
  data: {
    output: any
    duration: number
    startTime: string
    endTime: string
    /** Authoritative per-block terminal states from the server's blockLogs. */
    finalBlockLogs?: SecretSafeBlockLog[]
  }
}

/**
 * Execution error event
 */
interface ExecutionErrorEvent extends BaseExecutionEvent {
  type: 'execution:error'
  workflowId: string
  data: {
    error: string
    display?: ExecutionEventDisplayData
    duration: number
    /** Authoritative per-block terminal states from the server's blockLogs. */
    finalBlockLogs?: SecretSafeBlockLog[]
  }
}

interface ExecutionCancelledEvent extends BaseExecutionEvent {
  type: 'execution:cancelled'
  workflowId: string
  data: {
    duration: number
    /** Authoritative per-block terminal states from the server's blockLogs. */
    finalBlockLogs?: SecretSafeBlockLog[]
  }
}

/**
 * Block started event
 */
interface BlockStartedEvent extends BaseExecutionEvent {
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
    iterationContainerId?: string
    parentIterations?: ParentIteration[]
    childWorkflowBlockId?: string
    childWorkflowName?: string
  }
}

/**
 * Block completed event
 */
interface BlockCompletedEvent extends BaseExecutionEvent {
  type: 'block:completed'
  workflowId: string
  data: {
    blockId: string
    blockName: string
    blockType: string
    input?: any
    output: any
    display?: ExecutionEventDisplayData
    durationMs: number
    startedAt: string
    executionOrder: number
    endedAt: string
    iterationCurrent?: number
    iterationTotal?: number
    iterationType?: SubflowType
    iterationContainerId?: string
    parentIterations?: ParentIteration[]
    childWorkflowBlockId?: string
    childWorkflowName?: string
    /** Per-invocation unique ID for correlating child block events with this workflow block. */
    childWorkflowInstanceId?: string
  }
}

/**
 * Block error event
 */
interface BlockErrorEvent extends BaseExecutionEvent {
  type: 'block:error'
  workflowId: string
  data: {
    blockId: string
    blockName: string
    blockType: string
    input?: any
    error: string
    display?: ExecutionEventDisplayData
    durationMs: number
    startedAt: string
    executionOrder: number
    endedAt: string
    iterationCurrent?: number
    iterationTotal?: number
    iterationType?: SubflowType
    iterationContainerId?: string
    parentIterations?: ParentIteration[]
    childWorkflowBlockId?: string
    childWorkflowName?: string
    /** Per-invocation unique ID for correlating child block events with this workflow block. */
    childWorkflowInstanceId?: string
  }
}

/**
 * Block child workflow started event — fires when a workflow block generates its instanceId,
 * before child execution begins. Allows clients to pre-associate the running entry with
 * the instanceId so child block events can be correlated in real-time.
 */
interface BlockChildWorkflowStartedEvent extends BaseExecutionEvent {
  type: 'block:childWorkflowStarted'
  workflowId: string
  data: {
    blockId: string
    childWorkflowInstanceId: string
    iterationCurrent?: number
    iterationTotal?: number
    iterationType?: SubflowType
    iterationContainerId?: string
    parentIterations?: ParentIteration[]
    childWorkflowBlockId?: string
    childWorkflowName?: string
    executionOrder?: number
  }
}

/**
 * Stream chunk event (for agent blocks)
 */
interface StreamChunkEvent extends BaseExecutionEvent {
  type: 'stream:chunk'
  workflowId: string
  data: {
    blockId: string
    chunk: string
    display?: ExecutionEventDisplayData
  }
}

/**
 * Live-only reconciliation for agent-events runs: the answer text streamed so
 * far for `blockId` belonged to an intermediate turn (tool calls follow).
 * Clients discard the block's accumulated streamed text; the final turn's
 * text re-streams as regular `stream:chunk` events after tools settle.
 */
interface StreamChunkResetEvent extends BaseExecutionEvent {
  type: 'stream:chunk_reset'
  workflowId: string
  data: {
    blockId: string
  }
}

/**
 * Stream done event
 */
interface StreamDoneEvent extends BaseExecutionEvent {
  type: 'stream:done'
  workflowId: string
  data: {
    blockId: string
  }
}

/**
 * Live thinking delta from an agent-events provider sink (canvas / draft runs).
 * Builder runs show provider-exposed signals when the sink is attached
 * (executor already disables the sink under PII redaction).
 */
interface StreamThinkingEvent extends BaseExecutionEvent {
  type: 'stream:thinking'
  workflowId: string
  data: {
    blockId: string
    text: string
    display?: ExecutionEventDisplayData
  }
}

/**
 * Live tool lifecycle from an agent-events provider sink.
 * Name + status only — never args or results.
 */
interface StreamToolEvent extends BaseExecutionEvent {
  type: 'stream:tool'
  workflowId: string
  data: {
    blockId: string
    phase: 'start' | 'end'
    id: string
    name: string
    status?: 'success' | 'error' | 'cancelled'
  }
}

/**
 * Union type of all execution events
 */
export type ExecutionEvent =
  | ExecutionStartedEvent
  | ExecutionCompletedEvent
  | ExecutionPausedEvent
  | ExecutionErrorEvent
  | ExecutionCancelledEvent
  | BlockStartedEvent
  | BlockCompletedEvent
  | BlockErrorEvent
  | BlockChildWorkflowStartedEvent
  | StreamChunkEvent
  | StreamChunkResetEvent
  | StreamDoneEvent
  | StreamThinkingEvent
  | StreamToolEvent

export type ExecutionStartedData = ExecutionStartedEvent['data']
export type ExecutionCompletedData = ExecutionCompletedEvent['data']
export type ExecutionPausedData = ExecutionPausedEvent['data']
export type ExecutionErrorData = ExecutionErrorEvent['data']
export type ExecutionCancelledData = ExecutionCancelledEvent['data']
export type BlockStartedData = BlockStartedEvent['data']
export type BlockCompletedData = BlockCompletedEvent['data']
export type BlockErrorData = BlockErrorEvent['data']
export type BlockChildWorkflowStartedData = BlockChildWorkflowStartedEvent['data']
export type StreamChunkData = StreamChunkEvent['data']
export type StreamChunkResetData = StreamChunkResetEvent['data']
export type StreamDoneData = StreamDoneEvent['data']
export type StreamThinkingData = StreamThinkingEvent['data']
export type StreamToolData = StreamToolEvent['data']

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
 * Creates execution callbacks using a provided event sink.
 */
export function createExecutionCallbacks(options: {
  executionId: string
  workflowId: string
  sendEvent: (event: ExecutionEvent) => void | Promise<void>
}) {
  const { executionId, workflowId, sendEvent } = options

  const sendBufferedEvent = async (event: ExecutionEvent) => {
    await sendEvent(event)
  }

  const onBlockStart = async (
    blockId: string,
    blockName: string,
    blockType: string,
    executionOrder: number,
    iterationContext?: IterationContext,
    childWorkflowContext?: ChildWorkflowContext
  ) => {
    await sendBufferedEvent({
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
          iterationType: iterationContext.iterationType,
          iterationContainerId: iterationContext.iterationContainerId,
          ...(iterationContext.parentIterations?.length && {
            parentIterations: iterationContext.parentIterations,
          }),
        }),
        ...(childWorkflowContext && {
          childWorkflowBlockId: childWorkflowContext.parentBlockId,
          childWorkflowName: childWorkflowContext.workflowName,
        }),
      },
    })
  }

  const onBlockComplete = async (
    blockId: string,
    blockName: string,
    blockType: string,
    callbackData: BlockCompletionCallbackData,
    iterationContext?: IterationContext,
    childWorkflowContext?: ChildWorkflowContext
  ) => {
    const callbackError = callbackData.output?.error
    const iterationData = iterationContext
      ? {
          iterationCurrent: iterationContext.iterationCurrent,
          iterationTotal: iterationContext.iterationTotal,
          iterationType: iterationContext.iterationType,
          iterationContainerId: iterationContext.iterationContainerId,
          ...(iterationContext.parentIterations?.length && {
            parentIterations: iterationContext.parentIterations,
          }),
        }
      : {}
    const childWorkflowData = childWorkflowContext
      ? {
          childWorkflowBlockId: childWorkflowContext.parentBlockId,
          childWorkflowName: childWorkflowContext.workflowName,
        }
      : {}

    const instanceData = callbackData.childWorkflowInstanceId
      ? { childWorkflowInstanceId: callbackData.childWorkflowInstanceId }
      : {}
    if (callbackError) {
      await sendBufferedEvent({
        type: 'block:error',
        timestamp: new Date().toISOString(),
        executionId,
        workflowId,
        data: {
          blockId,
          blockName,
          blockType,
          input: callbackData.input,
          error: callbackError,
          durationMs: callbackData.executionTime || 0,
          startedAt: callbackData.startedAt,
          executionOrder: callbackData.executionOrder,
          endedAt: callbackData.endedAt,
          ...iterationData,
          ...childWorkflowData,
          ...instanceData,
        },
      })
    } else {
      await sendBufferedEvent({
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
          ...childWorkflowData,
          ...instanceData,
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
        await sendBufferedEvent({
          type: 'stream:chunk',
          timestamp: new Date().toISOString(),
          executionId,
          workflowId,
          data: { blockId, chunk },
        })
      }
      await sendBufferedEvent({
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

  const onChildWorkflowInstanceReady = async (
    blockId: string,
    childWorkflowInstanceId: string,
    iterationContext?: IterationContext,
    executionOrder?: number,
    childWorkflowContext?: ChildWorkflowContext
  ) => {
    await sendBufferedEvent({
      type: 'block:childWorkflowStarted',
      timestamp: new Date().toISOString(),
      executionId,
      workflowId,
      data: {
        blockId,
        childWorkflowInstanceId,
        ...(iterationContext && {
          iterationCurrent: iterationContext.iterationCurrent,
          iterationTotal: iterationContext.iterationTotal,
          iterationType: iterationContext.iterationType,
          iterationContainerId: iterationContext.iterationContainerId,
          ...(iterationContext.parentIterations?.length && {
            parentIterations: iterationContext.parentIterations,
          }),
        }),
        ...(childWorkflowContext && {
          childWorkflowBlockId: childWorkflowContext.parentBlockId,
          childWorkflowName: childWorkflowContext.workflowName,
        }),
        ...(executionOrder !== undefined && { executionOrder }),
      },
    })
  }

  return {
    sendEvent: sendBufferedEvent,
    onBlockStart,
    onBlockComplete,
    onStream,
    onChildWorkflowInstanceReady,
  }
}
