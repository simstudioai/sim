import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { generateId } from '@/lib/core/utils/uuid'
import type { InboxTaskStatus } from '@/lib/mothership/inbox/types'

export const inboxKeys = {
  all: ['inbox'] as const,
  configs: () => [...inboxKeys.all, 'config'] as const,
  config: (workspaceId: string) => [...inboxKeys.configs(), workspaceId] as const,
  senders: () => [...inboxKeys.all, 'sender'] as const,
  senderList: (workspaceId: string) => [...inboxKeys.senders(), workspaceId] as const,
  tasks: () => [...inboxKeys.all, 'task'] as const,
  taskList: (workspaceId: string, status?: string) =>
    [...inboxKeys.tasks(), workspaceId, status ?? 'all'] as const,
}

export interface InboxConfigResponse {
  enabled: boolean
  address: string | null
  taskStats: {
    total: number
    completed: number
    processing: number
    failed: number
  }
}

export interface InboxSender {
  id: string
  email: string
  label: string | null
  createdAt: string
}

export interface InboxMember {
  email: string
  name: string
  isAutoAllowed: boolean
}

export interface InboxSendersResponse {
  senders: InboxSender[]
  workspaceMembers: InboxMember[]
}

export interface InboxTaskItem {
  id: string
  fromEmail: string
  fromName: string | null
  subject: string
  bodyPreview: string | null
  status: InboxTaskStatus
  hasAttachments: boolean
  resultSummary: string | null
  errorMessage: string | null
  rejectionReason: string | null
  chatId: string | null
  createdAt: string
  completedAt: string | null
}

export interface InboxTasksResponse {
  tasks: InboxTaskItem[]
  pagination: {
    limit: number
    hasMore: boolean
    nextCursor: string | null
  }
}

async function fetchInboxConfig(
  workspaceId: string,
  signal?: AbortSignal
): Promise<InboxConfigResponse> {
  const response = await fetch(`/api/workspaces/${workspaceId}/inbox`, { signal })
  if (!response.ok) throw new Error('Failed to fetch inbox config')
  return response.json()
}

async function fetchInboxSenders(
  workspaceId: string,
  signal?: AbortSignal
): Promise<InboxSendersResponse> {
  const response = await fetch(`/api/workspaces/${workspaceId}/inbox/senders`, { signal })
  if (!response.ok) throw new Error('Failed to fetch inbox senders')
  return response.json()
}

async function fetchInboxTasks(
  workspaceId: string,
  opts: { status?: string; cursor?: string; limit?: number },
  signal?: AbortSignal
): Promise<InboxTasksResponse> {
  const params = new URLSearchParams()
  if (opts.status && opts.status !== 'all') params.set('status', opts.status)
  if (opts.cursor) params.set('cursor', opts.cursor)
  if (opts.limit) params.set('limit', String(opts.limit))
  const qs = params.toString()
  const response = await fetch(`/api/workspaces/${workspaceId}/inbox/tasks${qs ? `?${qs}` : ''}`, {
    signal,
  })
  if (!response.ok) throw new Error('Failed to fetch inbox tasks')
  return response.json()
}

export function useInboxConfig(workspaceId: string) {
  return useQuery({
    queryKey: inboxKeys.config(workspaceId),
    queryFn: ({ signal }) => fetchInboxConfig(workspaceId, signal),
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
  })
}

export function useInboxSenders(workspaceId: string) {
  return useQuery({
    queryKey: inboxKeys.senderList(workspaceId),
    queryFn: ({ signal }) => fetchInboxSenders(workspaceId, signal),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

export function useInboxTasks(
  workspaceId: string,
  opts: { status?: string; cursor?: string; limit?: number } = {}
) {
  return useQuery({
    queryKey: inboxKeys.taskList(workspaceId, opts.status),
    queryFn: ({ signal }) => fetchInboxTasks(workspaceId, opts, signal),
    enabled: Boolean(workspaceId),
    staleTime: 15 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useToggleInbox() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      enabled,
      username,
    }: {
      workspaceId: string
      enabled: boolean
      username?: string
    }) => {
      const response = await fetch(`/api/workspaces/${workspaceId}/inbox`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, username }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to toggle inbox')
      }
      return response.json()
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.config(variables.workspaceId) })
    },
  })
}

export function useUpdateInboxAddress() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, username }: { workspaceId: string; username: string }) => {
      const response = await fetch(`/api/workspaces/${workspaceId}/inbox`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update inbox address')
      }
      return response.json()
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.config(variables.workspaceId) })
    },
  })
}

export function useAddInboxSender() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      email,
      label,
    }: {
      workspaceId: string
      email: string
      label?: string
    }) => {
      const response = await fetch(`/api/workspaces/${workspaceId}/inbox/senders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, label }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to add sender')
      }
      return response.json()
    },
    onMutate: async ({ workspaceId, email, label }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.senderList(workspaceId) })
      const previous = queryClient.getQueryData<InboxSendersResponse>(
        inboxKeys.senderList(workspaceId)
      )
      if (previous) {
        queryClient.setQueryData<InboxSendersResponse>(inboxKeys.senderList(workspaceId), {
          ...previous,
          senders: [
            ...previous.senders,
            {
              id: `optimistic-${generateId()}`,
              email,
              label: label || null,
              createdAt: new Date().toISOString(),
            },
          ],
        })
      }
      return { previous }
    },
    onError: (_err, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(inboxKeys.senderList(variables.workspaceId), context.previous)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.senderList(variables.workspaceId) })
    },
  })
}

export function useRemoveInboxSender() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, senderId }: { workspaceId: string; senderId: string }) => {
      const response = await fetch(`/api/workspaces/${workspaceId}/inbox/senders`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderId }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to remove sender')
      }
      return response.json()
    },
    onMutate: async ({ workspaceId, senderId }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.senderList(workspaceId) })
      const previous = queryClient.getQueryData<InboxSendersResponse>(
        inboxKeys.senderList(workspaceId)
      )
      if (previous) {
        queryClient.setQueryData<InboxSendersResponse>(inboxKeys.senderList(workspaceId), {
          ...previous,
          senders: previous.senders.filter((s) => s.id !== senderId),
        })
      }
      return { previous }
    },
    onError: (_err, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(inboxKeys.senderList(variables.workspaceId), context.previous)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.senderList(variables.workspaceId) })
    },
  })
}
