import type { Artifact, Message, PushNotificationConfig, Task, TaskState } from '@a2a-js/sdk'
import { v4 as uuidv4 } from 'uuid'
import { generateInternalToken } from '@/lib/auth/internal'
import { getBaseUrl } from '@/lib/core/utils/urls'

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

export function createResponse(id: string | number | null, result: unknown): JSONRPCResponse {
  return { jsonrpc: '2.0', id, result }
}

export function createError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JSONRPCResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } }
}

export function isJSONRPCRequest(obj: unknown): obj is JSONRPCRequest {
  if (!obj || typeof obj !== 'object') return false
  const r = obj as Record<string, unknown>
  return r.jsonrpc === '2.0' && typeof r.method === 'string' && r.id !== undefined
}

export function generateTaskId(): string {
  return uuidv4()
}

export function createTaskStatus(state: TaskState): { state: TaskState; timestamp: string } {
  return { state, timestamp: new Date().toISOString() }
}

export function formatTaskResponse(task: Task, historyLength?: number): Task {
  if (historyLength !== undefined && task.history) {
    return {
      ...task,
      history: task.history.slice(-historyLength),
    }
  }
  return task
}

export interface ExecuteRequestConfig {
  workflowId: string
  apiKey?: string | null
  stream?: boolean
}

export interface ExecuteRequestResult {
  url: string
  headers: Record<string, string>
  useInternalAuth: boolean
}

export async function buildExecuteRequest(
  config: ExecuteRequestConfig
): Promise<ExecuteRequestResult> {
  const url = `${getBaseUrl()}/api/workflows/${config.workflowId}/execute`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let useInternalAuth = false

  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey
  } else {
    const internalToken = await generateInternalToken()
    headers.Authorization = `Bearer ${internalToken}`
    useInternalAuth = true
  }

  if (config.stream) {
    headers['X-Stream-Response'] = 'true'
  }

  return { url, headers, useInternalAuth }
}

export function extractAgentContent(executeResult: {
  output?: { content?: string; [key: string]: unknown }
  error?: string
}): string {
  // Prefer explicit content field
  if (executeResult.output?.content) {
    return executeResult.output.content
  }

  // If output is an object with meaningful data, stringify it
  if (typeof executeResult.output === 'object' && executeResult.output !== null) {
    const keys = Object.keys(executeResult.output)
    // Skip empty objects or objects with only undefined values
    if (keys.length > 0 && keys.some((k) => executeResult.output![k] !== undefined)) {
      return JSON.stringify(executeResult.output)
    }
  }

  // Fallback to error message or default
  return executeResult.error || 'Task completed'
}

export function buildTaskResponse(params: {
  taskId: string
  contextId: string
  state: TaskState
  history: Message[]
  artifacts?: Artifact[]
}): Task {
  return {
    kind: 'task',
    id: params.taskId,
    contextId: params.contextId,
    status: createTaskStatus(params.state),
    history: params.history,
    artifacts: params.artifacts || [],
  }
}
