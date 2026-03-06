import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface TaskMetadata {
  id: string
  name: string
  updatedAt: Date
}

export interface TaskChatHistory {
  id: string
  title: string | null
  messages: TaskStoredMessage[]
  activeStreamId: string | null
}

export interface TaskStoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  contentBlocks?: TaskStoredContentBlock[]
}

export interface TaskStoredContentBlock {
  type: string
  content?: string
  toolCall?: {
    id?: string
    name?: string
    state?: string
    display?: { text?: string }
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
}

function mapTask(chat: TaskResponse): TaskMetadata {
  return {
    id: chat.id,
    name: chat.title ?? 'New task',
    updatedAt: new Date(chat.updatedAt),
  }
}

async function fetchTasks(workspaceId: string): Promise<TaskMetadata[]> {
  const response = await fetch(`/api/mothership/chats?workspaceId=${workspaceId}`)

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
    queryFn: () => fetchTasks(workspaceId as string),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  })
}

async function fetchChatHistory(chatId: string): Promise<TaskChatHistory> {
  const response = await fetch(`/api/copilot/chat?chatId=${chatId}`)

  if (!response.ok) {
    throw new Error('Failed to load chat')
  }

  const { chat } = await response.json()
  return {
    id: chat.id,
    title: chat.title,
    messages: Array.isArray(chat.messages) ? chat.messages : [],
    activeStreamId: chat.conversationId || null,
  }
}

/**
 * Fetches chat history for a single task (mothership chat).
 * Used by the task page to load an existing conversation.
 */
export function useChatHistory(chatId: string | undefined) {
  return useQuery({
    queryKey: taskKeys.detail(chatId),
    queryFn: () => fetchChatHistory(chatId!),
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
    onSuccess: () => {
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
