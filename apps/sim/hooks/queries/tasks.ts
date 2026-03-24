import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'

export interface TaskMetadata {
  id: string
  name: string
  updatedAt: Date
  isActive: boolean
  isUnread: boolean
}

export interface StreamSnapshot {
  events: Array<{ eventId: number; streamId: string; event: Record<string, unknown> }>
  status: string
}

export interface TaskChatHistory {
  id: string
  title: string | null
  messages: TaskStoredMessage[]
  activeStreamId: string | null
  resources: MothershipResource[]
  streamSnapshot?: StreamSnapshot | null
}

export interface TaskStoredToolCall {
  id: string
  name: string
  status: string
  params?: Record<string, unknown>
  result?: unknown
  error?: string
  durationMs?: number
}

export interface TaskStoredFileAttachment {
  id: string
  key: string
  filename: string
  media_type: string
  size: number
}

export interface TaskStoredMessageContext {
  kind: string
  label: string
  workflowId?: string
  knowledgeId?: string
  tableId?: string
  fileId?: string
}

export interface TaskStoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  requestId?: string
  toolCalls?: TaskStoredToolCall[]
  contentBlocks?: TaskStoredContentBlock[]
  fileAttachments?: TaskStoredFileAttachment[]
  contexts?: TaskStoredMessageContext[]
}

export interface TaskStoredContentBlock {
  type: string
  content?: string
  toolCall?: {
    id?: string
    name?: string
    state?: string
    params?: Record<string, unknown>
    result?: { success: boolean; output?: unknown; error?: string }
    display?: { text?: string }
    calledBy?: string
  } | null
}

export const taskKeys = {
  all: ['tasks'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined) => [...taskKeys.lists(), workspaceId ?? ''] as const,
  detail: (chatId: string | undefined) => [...taskKeys.all, 'detail', chatId ?? ''] as const,
}

interface TaskResponse {
  id: string
  title: string | null
  updatedAt: string
  conversationId: string | null
  lastSeenAt: string | null
}

function mapTask(chat: TaskResponse): TaskMetadata {
  const updatedAt = new Date(chat.updatedAt)
  return {
    id: chat.id,
    name: chat.title ?? 'New task',
    updatedAt,
    isActive: chat.conversationId !== null,
    isUnread:
      chat.conversationId === null &&
      (chat.lastSeenAt === null || updatedAt > new Date(chat.lastSeenAt)),
  }
}

async function fetchTasks(workspaceId: string, signal?: AbortSignal): Promise<TaskMetadata[]> {
  const response = await fetch(`/api/mothership/chats?workspaceId=${workspaceId}`, { signal })

  if (!response.ok) {
    throw new Error('Failed to fetch tasks')
  }

  const { data }: { data: TaskResponse[] } = await response.json()
  return data.map(mapTask)
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

async function fetchChatHistory(chatId: string, signal?: AbortSignal): Promise<TaskChatHistory> {
  const response = await fetch(`/api/copilot/chat?chatId=${chatId}`, { signal })

  if (!response.ok) {
    throw new Error('Failed to load chat')
  }

  const { chat } = await response.json()
  return {
    id: chat.id,
    title: chat.title,
    messages: Array.isArray(chat.messages) ? chat.messages : [],
    activeStreamId: chat.conversationId || null,
    resources: Array.isArray(chat.resources) ? chat.resources : [],
    streamSnapshot: chat.streamSnapshot || null,
  }
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
  const response = await fetch('/api/copilot/chat/delete', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId }),
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.list(workspaceId) })
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.list(workspaceId) })
    },
  })
}

async function renameTask({ chatId, title }: { chatId: string; title: string }): Promise<void> {
  const response = await fetch('/api/copilot/chat/rename', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, title }),
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.list(workspaceId) })
    },
  })
}

async function addChatResource(params: {
  chatId: string
  resource: MothershipResource
}): Promise<{ resources: MothershipResource[] }> {
  const response = await fetch('/api/copilot/chat/resources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: params.chatId, resource: params.resource }),
  })
  if (!response.ok) throw new Error('Failed to add resource')
  return response.json()
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
  const response = await fetch('/api/copilot/chat/resources', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: params.chatId, resources: params.resources }),
  })
  if (!response.ok) throw new Error('Failed to reorder resources')
  return response.json()
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
  const response = await fetch('/api/copilot/chat/resources', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) throw new Error('Failed to remove resource')
  return response.json()
}

export function useRemoveChatResource(chatId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: removeChatResource,
    onMutate: async ({ resourceType, resourceId }) => {
      if (!chatId) return
      await queryClient.cancelQueries({ queryKey: taskKeys.detail(chatId) })
      const previous = queryClient.getQueryData<TaskChatHistory>(taskKeys.detail(chatId))
      if (previous) {
        queryClient.setQueryData<TaskChatHistory>(taskKeys.detail(chatId), {
          ...previous,
          resources: previous.resources.filter(
            (r) => !(r.type === resourceType && r.id === resourceId)
          ),
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

async function markTaskRead(chatId: string): Promise<void> {
  const response = await fetch('/api/mothership/chats/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId }),
  })
  if (!response.ok) {
    throw new Error('Failed to mark task as read')
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
