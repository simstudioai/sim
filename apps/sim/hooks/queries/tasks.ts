import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import { normalizeMessage } from '@/lib/copilot/chat/persisted-message'
import {
  type FilePreviewSession,
  isFilePreviewSession,
} from '@/lib/copilot/request/session/file-preview-session-contract'
import { isStreamBatchEvent, type StreamBatchEvent } from '@/lib/copilot/request/session/types'
import { type MothershipResource, MothershipResourceType } from '@/lib/copilot/resources/types'

export interface TaskMetadata {
  id: string
  name: string
  updatedAt: Date
  isActive: boolean
  isUnread: boolean
}

export interface TaskChatHistory {
  id: string
  title: string | null
  messages: PersistedMessage[]
  activeStreamId: string | null
  resources: MothershipResource[]
  streamSnapshot?: {
    events: StreamBatchEvent[]
    previewSessions: FilePreviewSession[]
    status: string
  } | null
}

export const taskKeys = {
  all: ['tasks'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined) => [...taskKeys.lists(), workspaceId ?? ''] as const,
  details: () => [...taskKeys.all, 'detail'] as const,
  detail: (chatId: string | undefined) => [...taskKeys.details(), chatId ?? ''] as const,
}

interface TaskResponse {
  id: string
  title: string | null
  updatedAt: string
  activeStreamId: string | null
  lastSeenAt: string | null
}

type ChatHistorySource = 'copilot' | 'mothership'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertValid(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function isResourceType(value: unknown): value is MothershipResource['type'] {
  return (
    typeof value === 'string' &&
    Object.values(MothershipResourceType).some((type) => type === value)
  )
}

function parseStreamSnapshot(value: unknown): TaskChatHistory['streamSnapshot'] {
  if (!isRecord(value)) {
    return null
  }

  const rawEvents = Array.isArray(value.events) ? value.events : []
  const events: StreamBatchEvent[] = []
  for (const entry of rawEvents) {
    if (!isStreamBatchEvent(entry)) {
      return null
    }
    events.push(entry)
  }

  const rawPreviewSessions = Array.isArray(value.previewSessions) ? value.previewSessions : []
  const previewSessions: FilePreviewSession[] = []
  for (const session of rawPreviewSessions) {
    if (!isFilePreviewSession(session)) {
      return null
    }
    previewSessions.push(session)
  }

  return {
    events,
    previewSessions,
    status: typeof value.status === 'string' ? value.status : 'unknown',
  }
}

function normalizeMessages(value: unknown): PersistedMessage[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isRecord).map((message) => normalizeMessage(message))
}

function parseTaskResponse(value: unknown, index: number): TaskResponse {
  assertValid(isRecord(value), `Invalid tasks response: data[${index}] must be an object`)
  assertValid(
    typeof value.id === 'string',
    `Invalid tasks response: data[${index}].id must be a string`
  )
  assertValid(
    isNullableString(value.title),
    `Invalid tasks response: data[${index}].title must be a string or null`
  )
  assertValid(
    isValidDateString(value.updatedAt),
    `Invalid tasks response: data[${index}].updatedAt must be a valid date string`
  )
  assertValid(
    isNullableString(value.activeStreamId),
    `Invalid tasks response: data[${index}].activeStreamId must be a string or null`
  )
  assertValid(
    isNullableString(value.lastSeenAt) &&
      (value.lastSeenAt === null || isValidDateString(value.lastSeenAt)),
    `Invalid tasks response: data[${index}].lastSeenAt must be a valid date string or null`
  )

  return {
    id: value.id,
    title: value.title,
    updatedAt: value.updatedAt,
    activeStreamId: value.activeStreamId,
    lastSeenAt: value.lastSeenAt,
  }
}

function parseTaskListResponse(value: unknown): TaskResponse[] {
  assertValid(isRecord(value), 'Invalid tasks response: body must be an object')
  assertValid(Array.isArray(value.data), 'Invalid tasks response: data must be an array')

  return value.data.map((task, index) => parseTaskResponse(task, index))
}

function parseResource(value: unknown, context: string): MothershipResource {
  assertValid(isRecord(value), `${context} must be an object`)
  assertValid(isResourceType(value.type), `${context}.type is invalid`)
  assertValid(typeof value.id === 'string', `${context}.id must be a string`)
  assertValid(typeof value.title === 'string', `${context}.title must be a string`)

  return {
    type: value.type,
    id: value.id,
    title: value.title,
  }
}

function parseResources(value: unknown, context: string): MothershipResource[] {
  assertValid(Array.isArray(value), `${context} must be an array`)

  return value.map((resource, index) => parseResource(resource, `${context}[${index}]`))
}

function parseStrictStreamSnapshot(
  value: unknown,
  context: string
): TaskChatHistory['streamSnapshot'] {
  if (value === undefined || value === null) {
    return null
  }

  const snapshot = parseStreamSnapshot(value)
  assertValid(snapshot !== null, `${context} is invalid`)
  return snapshot
}

function parseChatHistory(value: unknown, source: ChatHistorySource): TaskChatHistory {
  const responseContext = `Invalid ${source} chat response`
  const chatContext = `${responseContext}: chat`

  assertValid(isRecord(value), `${responseContext}: body must be an object`)
  assertValid(isRecord(value.chat), `${chatContext} must be an object`)

  const chat = value.chat
  const activeStreamField = source === 'mothership' ? 'conversationId' : 'activeStreamId'
  const activeStreamId = chat[activeStreamField]

  assertValid(typeof chat.id === 'string', `${chatContext}.id must be a string`)
  assertValid(isNullableString(chat.title), `${chatContext}.title must be a string or null`)
  assertValid(Array.isArray(chat.messages), `${chatContext}.messages must be an array`)
  assertValid(
    isNullableString(activeStreamId),
    `${chatContext}.${activeStreamField} must be a string or null`
  )

  return {
    id: chat.id,
    title: chat.title,
    messages: normalizeMessages(chat.messages),
    activeStreamId,
    resources: parseResources(chat.resources, `${chatContext}.resources`),
    streamSnapshot: parseStrictStreamSnapshot(chat.streamSnapshot, `${chatContext}.streamSnapshot`),
  }
}

function parseChatResourcesResponse(value: unknown): { resources: MothershipResource[] } {
  assertValid(isRecord(value), 'Invalid chat resources response: body must be an object')

  return {
    resources: parseResources(value.resources, 'Invalid chat resources response: resources'),
  }
}

function mapTask(chat: TaskResponse): TaskMetadata {
  const updatedAt = new Date(chat.updatedAt)
  return {
    id: chat.id,
    name: chat.title ?? 'New task',
    updatedAt,
    isActive: chat.activeStreamId !== null,
    isUnread:
      chat.activeStreamId === null &&
      (chat.lastSeenAt === null || updatedAt > new Date(chat.lastSeenAt)),
  }
}

export async function fetchTasks(
  workspaceId: string,
  signal?: AbortSignal
): Promise<TaskMetadata[]> {
  const response = await fetch(`/api/mothership/chats?workspaceId=${workspaceId}`, { signal })

  if (!response.ok) {
    throw new Error('Failed to fetch tasks')
  }

  return parseTaskListResponse(await response.json()).map(mapTask)
}

/**
 * Fetches mothership chat tasks for a workspace.
 * These are workspace-scoped conversations from the Home page.
 */
export function useTasks(workspaceId?: string) {
  return useQuery({
    queryKey: taskKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchTasks(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  })
}

export async function fetchChatHistory(
  chatId: string,
  signal?: AbortSignal
): Promise<TaskChatHistory> {
  const mothershipRes = await fetch(`/api/mothership/chats/${chatId}`, { signal })

  if (mothershipRes.ok) {
    return parseChatHistory(await mothershipRes.json(), 'mothership')
  }

  const copilotRes = await fetch(`/api/mothership/chat?chatId=${encodeURIComponent(chatId)}`, {
    signal,
  })

  if (!copilotRes.ok) {
    throw new Error('Failed to load chat')
  }

  return parseChatHistory(await copilotRes.json(), 'copilot')
}

/**
 * Fetches chat history for a single task (mothership chat).
 * Used by the task page to load an existing conversation.
 */
export function useChatHistory(chatId: string | undefined) {
  return useQuery({
    queryKey: taskKeys.detail(chatId),
    queryFn: ({ signal }) => fetchChatHistory(chatId!, signal),
    enabled: Boolean(chatId),
    staleTime: 30 * 1000,
  })
}

async function deleteTask(chatId: string): Promise<void> {
  const response = await fetch(`/api/mothership/chats/${chatId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error('Failed to delete task')
  }
}

/**
 * Deletes a mothership chat task and invalidates the task list.
 */
export function useDeleteTask(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteTask,
    onSettled: (_data, _error, chatId) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.list(workspaceId) })
      queryClient.removeQueries({ queryKey: taskKeys.detail(chatId) })
    },
  })
}

/**
 * Deletes multiple mothership chat tasks and invalidates the task list.
 */
export function useDeleteTasks(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (chatIds: string[]) => {
      await Promise.all(chatIds.map(deleteTask))
    },
    onSettled: (_data, _error, chatIds) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.list(workspaceId) })
      for (const chatId of chatIds) {
        queryClient.removeQueries({ queryKey: taskKeys.detail(chatId) })
      }
    },
  })
}

async function renameTask({ chatId, title }: { chatId: string; title: string }): Promise<void> {
  const response = await fetch(`/api/mothership/chats/${chatId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!response.ok) {
    throw new Error('Failed to rename task')
  }
}

/**
 * Renames a mothership chat task with optimistic update.
 */
export function useRenameTask(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: renameTask,
    onMutate: async ({ chatId, title }) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.list(workspaceId) })

      const previousTasks = queryClient.getQueryData<TaskMetadata[]>(taskKeys.list(workspaceId))

      queryClient.setQueryData<TaskMetadata[]>(taskKeys.list(workspaceId), (old) =>
        old?.map((task) => (task.id === chatId ? { ...task, name: title } : task))
      )

      return { previousTasks }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(taskKeys.list(workspaceId), context.previousTasks)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.list(workspaceId) })
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(variables.chatId) })
    },
  })
}

async function addChatResource(params: {
  chatId: string
  resource: MothershipResource
}): Promise<{ resources: MothershipResource[] }> {
  const response = await fetch('/api/mothership/chat/resources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: params.chatId, resource: params.resource }),
  })
  if (!response.ok) throw new Error('Failed to add resource')
  return parseChatResourcesResponse(await response.json())
}

export function useAddChatResource(chatId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: addChatResource,
    onMutate: async ({ resource }) => {
      if (!chatId) return
      await queryClient.cancelQueries({ queryKey: taskKeys.detail(chatId) })
      const previous = queryClient.getQueryData<TaskChatHistory>(taskKeys.detail(chatId))
      if (previous) {
        const exists = previous.resources.some(
          (r) => r.type === resource.type && r.id === resource.id
        )
        if (!exists) {
          queryClient.setQueryData<TaskChatHistory>(taskKeys.detail(chatId), {
            ...previous,
            resources: [...previous.resources, resource],
          })
        }
      }
      return { previous }
    },
    onError: (_err, _variables, context) => {
      if (context?.previous && chatId) {
        queryClient.setQueryData(taskKeys.detail(chatId), context.previous)
      }
    },
    onSettled: () => {
      if (chatId) {
        queryClient.invalidateQueries({ queryKey: taskKeys.detail(chatId) })
      }
    },
  })
}

async function reorderChatResources(params: {
  chatId: string
  resources: MothershipResource[]
}): Promise<{ resources: MothershipResource[] }> {
  const response = await fetch('/api/mothership/chat/resources', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: params.chatId, resources: params.resources }),
  })
  if (!response.ok) throw new Error('Failed to reorder resources')
  return parseChatResourcesResponse(await response.json())
}

export function useReorderChatResources(chatId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: reorderChatResources,
    onMutate: async ({ resources }) => {
      if (!chatId) return
      await queryClient.cancelQueries({ queryKey: taskKeys.detail(chatId) })
      const previous = queryClient.getQueryData<TaskChatHistory>(taskKeys.detail(chatId))
      if (previous) {
        queryClient.setQueryData<TaskChatHistory>(taskKeys.detail(chatId), {
          ...previous,
          resources,
        })
      }
      return { previous }
    },
    onError: (_err, _variables, context) => {
      if (context?.previous && chatId) {
        queryClient.setQueryData(taskKeys.detail(chatId), context.previous)
      }
    },
    onSettled: () => {
      if (chatId) {
        queryClient.invalidateQueries({ queryKey: taskKeys.detail(chatId) })
      }
    },
  })
}

async function removeChatResource(params: {
  chatId: string
  resourceType: string
  resourceId: string
}): Promise<{ resources: MothershipResource[] }> {
  const response = await fetch('/api/mothership/chat/resources', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) throw new Error('Failed to remove resource')
  return parseChatResourcesResponse(await response.json())
}

export function useRemoveChatResource(chatId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: removeChatResource,
    onMutate: async ({ resourceType, resourceId }) => {
      if (!chatId) return
      await queryClient.cancelQueries({ queryKey: taskKeys.detail(chatId) })
      const removed: TaskChatHistory['resources'] = []
      queryClient.setQueryData<TaskChatHistory>(taskKeys.detail(chatId), (prev) => {
        if (!prev) return prev
        const next: TaskChatHistory['resources'] = []
        for (const r of prev.resources) {
          if (r.type === resourceType && r.id === resourceId) removed.push(r)
          else next.push(r)
        }
        return removed.length > 0 ? { ...prev, resources: next } : prev
      })
      return { removed }
    },
    onError: (_err, _variables, context) => {
      if (!chatId || !context?.removed.length) return
      queryClient.setQueryData<TaskChatHistory>(taskKeys.detail(chatId), (prev) =>
        prev ? { ...prev, resources: [...prev.resources, ...context.removed] } : prev
      )
    },
    onSettled: () => {
      if (chatId) {
        queryClient.invalidateQueries({ queryKey: taskKeys.detail(chatId) })
      }
    },
  })
}

async function markTaskRead(chatId: string): Promise<void> {
  const response = await fetch(`/api/mothership/chats/${chatId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isUnread: false }),
  })
  if (!response.ok) {
    throw new Error('Failed to mark task as read')
  }
}

async function markTaskUnread(chatId: string): Promise<void> {
  const response = await fetch(`/api/mothership/chats/${chatId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isUnread: true }),
  })
  if (!response.ok) {
    throw new Error('Failed to mark task as unread')
  }
}

/**
 * Marks a task as read with optimistic update.
 */
export function useMarkTaskRead(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: markTaskRead,
    onMutate: async (chatId) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.list(workspaceId) })

      const previousTasks = queryClient.getQueryData<TaskMetadata[]>(taskKeys.list(workspaceId))

      queryClient.setQueryData<TaskMetadata[]>(taskKeys.list(workspaceId), (old) =>
        old?.map((task) => (task.id === chatId ? { ...task, isUnread: false } : task))
      )

      return { previousTasks }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(taskKeys.list(workspaceId), context.previousTasks)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.list(workspaceId) })
    },
  })
}

/**
 * Marks a task as unread with optimistic update.
 */
export function useMarkTaskUnread(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: markTaskUnread,
    onMutate: async (chatId) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.list(workspaceId) })

      const previousTasks = queryClient.getQueryData<TaskMetadata[]>(taskKeys.list(workspaceId))

      queryClient.setQueryData<TaskMetadata[]>(taskKeys.list(workspaceId), (old) =>
        old?.map((task) => (task.id === chatId ? { ...task, isUnread: true } : task))
      )

      return { previousTasks }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(taskKeys.list(workspaceId), context.previousTasks)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.list(workspaceId) })
    },
  })
}
