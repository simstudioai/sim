/**
 * SSE Event types for workflow execution
 */

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

/**
 * Execution cancelled event
 */
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
    // Iteration context for loops and parallels
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
    output: any
    durationMs: number
    // Iteration context for loops and parallels
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
    error: string
    durationMs: number
    // Iteration context for loops and parallels
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
