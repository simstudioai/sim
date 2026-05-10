import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ContractBodyInput,
  createNotificationContract,
  deleteNotificationContract,
  listNotificationsContract,
  type NotificationSubscription,
  testNotificationContract,
  updateNotificationContract,
} from '@/lib/api/contracts'

export type { NotificationSubscription }

const logger = createLogger('NotificationQueries')

/**
 * Query key factories for notification-related queries
 */
export const notificationKeys = {
  all: ['notifications'] as const,
  lists: () => [...notificationKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined) =>
    [...notificationKeys.lists(), workspaceId ?? ''] as const,
  details: () => [...notificationKeys.all, 'detail'] as const,
  detail: (workspaceId: string, notificationId: string) =>
    [...notificationKeys.details(), workspaceId, notificationId] as const,
}

/**
 * Fetch notifications for a workspace
 */
async function fetchNotifications(
  workspaceId: string,
  signal?: AbortSignal
): Promise<NotificationSubscription[]> {
  const data = await requestJson(listNotificationsContract, {
    params: { id: workspaceId },
    signal,
  })
  return data.data
}

/**
 * Hook to fetch notifications for a workspace
 */
export function useNotifications(workspaceId?: string) {
  return useQuery({
    queryKey: notificationKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchNotifications(workspaceId!, signal),
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

interface CreateNotificationParams {
  workspaceId: string
  data: ContractBodyInput<typeof createNotificationContract>
}

/**
 * Hook to create a notification
 */
export function useCreateNotification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, data }: CreateNotificationParams) => {
      return requestJson(createNotificationContract, {
        params: { id: workspaceId },
        body: data,
      })
    },
    onSuccess: (_, { workspaceId }) => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.list(workspaceId) })
    },
    onError: (error) => {
      logger.error('Failed to create notification', { error })
    },
  })
}

interface UpdateNotificationParams {
  workspaceId: string
  notificationId: string
  data: ContractBodyInput<typeof updateNotificationContract>
}

/**
 * Hook to update a notification
 */
export function useUpdateNotification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, notificationId, data }: UpdateNotificationParams) => {
      return requestJson(updateNotificationContract, {
        params: { id: workspaceId, notificationId },
        body: data,
      })
    },
    onSuccess: (_, { workspaceId }) => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.list(workspaceId) })
    },
    onError: (error) => {
      logger.error('Failed to update notification', { error })
    },
  })
}

interface DeleteNotificationParams {
  workspaceId: string
  notificationId: string
}

/**
 * Hook to delete a notification
 */
export function useDeleteNotification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, notificationId }: DeleteNotificationParams) => {
      return requestJson(deleteNotificationContract, {
        params: { id: workspaceId, notificationId },
      })
    },
    onSuccess: (_, { workspaceId }) => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.list(workspaceId) })
    },
    onError: (error) => {
      logger.error('Failed to delete notification', { error })
    },
  })
}

interface TestNotificationParams {
  workspaceId: string
  notificationId: string
}

/**
 * Hook to test a notification
 */
export function useTestNotification() {
  return useMutation({
    mutationFn: async ({ workspaceId, notificationId }: TestNotificationParams) => {
      return requestJson(testNotificationContract, {
        params: { id: workspaceId, notificationId },
      })
    },
    onError: (error) => {
      logger.error('Failed to test notification', { error })
    },
  })
}
