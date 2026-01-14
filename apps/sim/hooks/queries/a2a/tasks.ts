/**
 * A2A Tasks React Query Hooks (v0.3)
 *
 * Hooks for interacting with A2A tasks in the UI.
 */

import type { Artifact, Message, TaskState } from '@a2a-js/sdk'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isTerminalState } from '@/lib/a2a/utils'

/** A2A v0.3 JSON-RPC method names */
const A2A_METHODS = {
  MESSAGE_SEND: 'message/send',
  TASKS_GET: 'tasks/get',
  TASKS_CANCEL: 'tasks/cancel',
} as const

/**
 * A2A Task as returned from queries
 */
export interface A2ATask {
  kind: 'task'
  id: string
  contextId?: string
  status: {
    state: TaskState
    timestamp?: string
    message?: string
  }
  history?: Message[]
  artifacts?: Artifact[]
  metadata?: Record<string, unknown>
}

/**
 * Query keys for A2A tasks
 */
export const a2aTaskKeys = {
  all: ['a2a-tasks'] as const,
  detail: (agentUrl: string, taskId: string) =>
    [...a2aTaskKeys.all, 'detail', agentUrl, taskId] as const,
}

/**
 * Send task params
 */
export interface SendA2ATaskParams {
  agentUrl: string
  message: string
  taskId?: string
  contextId?: string
  apiKey?: string
}

/**
 * Send task response
 */
export interface SendA2ATaskResponse {
  content: string
  taskId: string
  contextId?: string
  state: TaskState
  artifacts?: Artifact[]
  history?: Message[]
}

/**
 * Send a message to an A2A agent (v0.3)
 */
async function sendA2ATask(params: SendA2ATaskParams): Promise<SendA2ATaskResponse> {
  const userMessage: Message = {
    kind: 'message',
    messageId: crypto.randomUUID(),
    role: 'user',
    parts: [{ kind: 'text', text: params.message }],
    ...(params.taskId && { taskId: params.taskId }),
    ...(params.contextId && { contextId: params.contextId }),
  }

  const response = await fetch(params.agentUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: A2A_METHODS.MESSAGE_SEND,
      params: {
        message: userMessage,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`A2A request failed: ${response.status} ${response.statusText}`)
  }

  const result = await response.json()

  if (result.error) {
    throw new Error(result.error.message || 'A2A request failed')
  }

  const task = result.result as A2ATask

  const lastAgentMessage = task.history?.filter((m) => m.role === 'agent').pop()
  const content = lastAgentMessage
    ? lastAgentMessage.parts
        .filter((p): p is import('@a2a-js/sdk').TextPart => p.kind === 'text')
        .map((p) => p.text)
        .join('')
    : ''

  return {
    content,
    taskId: task.id,
    contextId: task.contextId,
    state: task.status.state,
    artifacts: task.artifacts,
    history: task.history,
  }
}

/**
 * Hook to send a message to an A2A agent
 */
export function useSendA2ATask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: sendA2ATask,
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: a2aTaskKeys.detail(variables.agentUrl, data.taskId),
      })
    },
  })
}

/**
 * Get task params
 */
export interface GetA2ATaskParams {
  agentUrl: string
  taskId: string
  apiKey?: string
  historyLength?: number
}

/**
 * Fetch a task from an A2A agent
 */
async function fetchA2ATask(params: GetA2ATaskParams): Promise<A2ATask> {
  const response = await fetch(params.agentUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: A2A_METHODS.TASKS_GET,
      params: {
        id: params.taskId,
        historyLength: params.historyLength,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`A2A request failed: ${response.status} ${response.statusText}`)
  }

  const result = await response.json()

  if (result.error) {
    throw new Error(result.error.message || 'A2A request failed')
  }

  return result.result as A2ATask
}

/**
 * Hook to get an A2A task
 */
export function useA2ATask(params: GetA2ATaskParams | null) {
  return useQuery({
    queryKey: params ? a2aTaskKeys.detail(params.agentUrl, params.taskId) : ['disabled'],
    queryFn: () => fetchA2ATask(params!),
    enabled: Boolean(params?.agentUrl && params?.taskId),
    staleTime: 5 * 1000, // 5 seconds - tasks can change quickly
    refetchInterval: (query) => {
      // Auto-refresh if task is still running
      const data = query.state.data as A2ATask | undefined
      if (data && !isTerminalState(data.status.state)) {
        return 2000 // 2 seconds
      }
      return false
    },
  })
}

/**
 * Cancel task params
 */
export interface CancelA2ATaskParams {
  agentUrl: string
  taskId: string
  apiKey?: string
}

/**
 * Cancel a task
 */
async function cancelA2ATask(params: CancelA2ATaskParams): Promise<A2ATask> {
  const response = await fetch(params.agentUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: A2A_METHODS.TASKS_CANCEL,
      params: {
        id: params.taskId,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`A2A request failed: ${response.status} ${response.statusText}`)
  }

  const result = await response.json()

  if (result.error) {
    throw new Error(result.error.message || 'A2A request failed')
  }

  return result.result as A2ATask
}

/**
 * Hook to cancel an A2A task
 */
export function useCancelA2ATask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: cancelA2ATask,
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: a2aTaskKeys.detail(variables.agentUrl, variables.taskId),
      })
    },
  })
}
