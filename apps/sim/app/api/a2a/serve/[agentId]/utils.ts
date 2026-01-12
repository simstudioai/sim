/**
 * A2A Serve Endpoint Utilities
 *
 * Shared utilities for JSON-RPC request/response handling in A2A v0.3.
 */

import type { Message, PushNotificationConfig, Task, TaskState } from '@a2a-js/sdk'
import { v4 as uuidv4 } from 'uuid'

/** A2A v0.3 JSON-RPC method names */
export const A2A_METHODS = {
  MESSAGE_SEND: 'message/send',
  MESSAGE_STREAM: 'message/stream',
  TASKS_GET: 'tasks/get',
  TASKS_CANCEL: 'tasks/cancel',
  TASKS_RESUBSCRIBE: 'tasks/resubscribe',
  PUSH_NOTIFICATION_SET: 'tasks/pushNotificationConfig/set',
  PUSH_NOTIFICATION_GET: 'tasks/pushNotificationConfig/get',
  PUSH_NOTIFICATION_DELETE: 'tasks/pushNotificationConfig/delete',
} as const

/** A2A v0.3 error codes */
export const A2A_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TASK_NOT_FOUND: -32001,
  TASK_ALREADY_COMPLETE: -32002,
  AGENT_UNAVAILABLE: -32003,
  AUTHENTICATION_REQUIRED: -32004,
} as const

export interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: unknown
}

export interface JSONRPCResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export interface MessageSendParams {
  message: Message
  configuration?: {
    acceptedOutputModes?: string[]
    historyLength?: number
    pushNotificationConfig?: PushNotificationConfig
  }
}

export interface TaskIdParams {
  id: string
  historyLength?: number
}

export interface PushNotificationSetParams {
  id: string
  pushNotificationConfig: PushNotificationConfig
}

/**
 * Create a JSON-RPC success response
 */
export function createResponse(id: string | number | null, result: unknown): JSONRPCResponse {
  return { jsonrpc: '2.0', id, result }
}

/**
 * Create a JSON-RPC error response
 */
export function createError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JSONRPCResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } }
}

/**
 * Type guard for JSON-RPC request validation
 */
export function isJSONRPCRequest(obj: unknown): obj is JSONRPCRequest {
  if (!obj || typeof obj !== 'object') return false
  const r = obj as Record<string, unknown>
  return r.jsonrpc === '2.0' && typeof r.method === 'string' && r.id !== undefined
}

/**
 * Generate a unique task ID
 */
export function generateTaskId(): string {
  return uuidv4()
}

/**
 * Create a task status object with current timestamp
 */
export function createTaskStatus(state: TaskState): { state: TaskState; timestamp: string } {
  return { state, timestamp: new Date().toISOString() }
}

/**
 * Format task response with optional history truncation
 */
export function formatTaskResponse(task: Task, historyLength?: number): Task {
  if (historyLength !== undefined && task.history) {
    return {
      ...task,
      history: task.history.slice(-historyLength),
    }
  }
  return task
}
