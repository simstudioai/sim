import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CoreTriggerType } from '@/stores/logs/filters/types'

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

type NotificationType = 'webhook' | 'email' | 'slack'
type LogLevel = 'info' | 'error'
type TriggerType = CoreTriggerType

type AlertRuleType =
  | 'consecutive_failures'
  | 'failure_rate'
  | 'latency_threshold'
  | 'latency_spike'
  | 'cost_threshold'
  | 'no_activity'
  | 'error_count'

interface AlertConfig {
  rule: AlertRuleType
  consecutiveFailures?: number
  failureRatePercent?: number
  windowHours?: number
  durationThresholdMs?: number
  latencySpikePercent?: number
  costThresholdDollars?: number
  inactivityHours?: number
  errorCountThreshold?: number
}

interface WebhookConfig {
  url: string
  secret?: string
}

interface SlackConfig {
  channelId: string
  channelName: string
  accountId: string
}

export interface NotificationSubscription {
  id: string
  notificationType: NotificationType
  workflowIds: string[]
  allWorkflows: boolean
  levelFilter: LogLevel[]
  triggerFilter: TriggerType[]
  includeFinalOutput: boolean
  includeTraceSpans: boolean
  includeRateLimits: boolean
  includeUsageData: boolean
  webhookConfig?: WebhookConfig | null
  emailRecipients?: string[] | null
  slackConfig?: SlackConfig | null
  alertConfig?: AlertConfig | null
  active: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Fetch notifications for a workspace
 */
async function fetchNotifications(workspaceId: string): Promise<NotificationSubscription[]> {
  const response = await fetch(`/api/workspaces/${workspaceId}/notifications`)
  if (!response.ok) {
    throw new Error('Failed to fetch notifications')
  }
  const data = await response.json()
  return data.data || []
}

/**
 * Hook to fetch notifications for a workspace
 */
export function useNotifications(workspaceId?: string) {
  return useQuery({
    queryKey: notificationKeys.list(workspaceId),
    queryFn: () => fetchNotifications(workspaceId!),
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
  })
}

interface CreateNotificationParams {
  workspaceId: string
  data: {
    notificationType: NotificationType
    workflowIds: string[]
    allWorkflows: boolean
    levelFilter: LogLevel[]
    triggerFilter: TriggerType[]
    includeFinalOutput: boolean
    includeTraceSpans: boolean
    includeRateLimits: boolean
    includeUsageData: boolean
    alertConfig?: AlertConfig | null
    webhookConfig?: WebhookConfig
    emailRecipients?: string[]
    slackConfig?: SlackConfig
  }
}

/**
 * Hook to create a notification
 */
export function useCreateNotification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, data }: CreateNotificationParams) => {
      const response = await fetch(`/api/workspaces/${workspaceId}/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to create notification')
      }
      return response.json()
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
  data: Partial<CreateNotificationParams['data']> & { active?: boolean }
}

/**
 * Hook to update a notification
 */
export function useUpdateNotification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, notificationId, data }: UpdateNotificationParams) => {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/notifications/${notificationId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      )
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to update notification')
      }
      return response.json()
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
      const response = await fetch(
        `/api/workspaces/${workspaceId}/notifications/${notificationId}`,
        {
          method: 'DELETE',
        }
      )
      if (!response.ok) {
        throw new Error('Failed to delete notification')
      }
      return response.json()
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
      const response = await fetch(
        `/api/workspaces/${workspaceId}/notifications/${notificationId}/test`,
        { method: 'POST' }
      )
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to send test notification')
      }
      return response.json()
    },
    onError: (error) => {
      logger.error('Failed to test notification', { error })
    },
  })
}
