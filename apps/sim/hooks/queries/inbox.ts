import { generateId } from '@sim/utils/id'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  addInboxSenderContract,
  getInboxConfigContract,
  type InboxConfig,
  type InboxSendersResponseBody,
  type InboxTask,
  type InboxTaskStatus,
  type InboxTasksResponseBody,
  listInboxSendersContract,
  listInboxTasksContract,
  removeInboxSenderContract,
  updateInboxConfigContract,
} from '@/lib/api/contracts'

export type { InboxConfig, InboxSendersResponseBody }
export type InboxTaskItem = InboxTask
export type InboxTasksResponse = InboxTasksResponseBody

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

type InboxTaskStatusFilter = InboxTaskStatus

async function fetchInboxConfig(workspaceId: string, signal?: AbortSignal): Promise<InboxConfig> {
  return requestJson(getInboxConfigContract, {
    params: { id: workspaceId },
    signal,
  })
}

async function fetchInboxSenders(
  workspaceId: string,
  signal?: AbortSignal
): Promise<InboxSendersResponseBody> {
  return requestJson(listInboxSendersContract, {
    params: { id: workspaceId },
    signal,
  })
}

async function fetchInboxTasks(
  workspaceId: string,
  opts: { status?: InboxTaskStatusFilter; cursor?: string; limit?: number },
  signal?: AbortSignal
): Promise<InboxTasksResponseBody> {
  return requestJson(listInboxTasksContract, {
    params: { id: workspaceId },
    query: {
      status: opts.status && opts.status !== 'all' ? opts.status : undefined,
      cursor: opts.cursor,
      limit: opts.limit,
    },
    signal,
  })
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
  opts: { status?: InboxTaskStatusFilter; cursor?: string; limit?: number } = {}
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
      return requestJson(updateInboxConfigContract, {
        params: { id: workspaceId },
        body: { enabled, username },
      })
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
      return requestJson(updateInboxConfigContract, {
        params: { id: workspaceId },
        body: { username },
      })
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
      return requestJson(addInboxSenderContract, {
        params: { id: workspaceId },
        body: { email, label },
      })
    },
    onMutate: async ({ workspaceId, email, label }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.senderList(workspaceId) })
      const previous = queryClient.getQueryData<InboxSendersResponseBody>(
        inboxKeys.senderList(workspaceId)
      )
      if (previous) {
        queryClient.setQueryData<InboxSendersResponseBody>(inboxKeys.senderList(workspaceId), {
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
      return requestJson(removeInboxSenderContract, {
        params: { id: workspaceId },
        body: { senderId },
      })
    },
    onMutate: async ({ workspaceId, senderId }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.senderList(workspaceId) })
      const previous = queryClient.getQueryData<InboxSendersResponseBody>(
        inboxKeys.senderList(workspaceId)
      )
      if (previous) {
        queryClient.setQueryData<InboxSendersResponseBody>(inboxKeys.senderList(workspaceId), {
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
