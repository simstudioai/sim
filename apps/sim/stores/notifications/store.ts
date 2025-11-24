import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('NotificationStore')

/**
 * Notification action configuration
 * Stores serializable data - handlers are reconstructed at runtime
 */
export interface NotificationAction {
  /**
   * Action type identifier for handler reconstruction
   */
  type: 'copilot' | 'refresh'

  /**
   * Message or data to pass to the action handler.
   *
   * For:
   * - {@link NotificationAction.type} = `copilot` - message sent to Copilot
   * - {@link NotificationAction.type} = `refresh` - optional context, not required for the action
   */
  message: string
}

/**
 * Core notification data structure
 */
export interface Notification {
  /**
   * Unique identifier for the notification
   */
  id: string

  /**
   * Notification severity level
   */
  level: 'info' | 'error'

  /**
   * Message to display to the user
   */
  message: string

  /**
   * Optional action to execute when user clicks the action button
   */
  action?: NotificationAction

  /**
   * Timestamp when notification was created
   */
  createdAt: number

  /**
   * Optional workflow ID - if provided, notification is workflow-specific
   * If omitted, notification is shown across all workflows
   */
  workflowId?: string
}

/**
 * Parameters for adding a new notification
 * Omits auto-generated fields (id, createdAt)
 */
export type AddNotificationParams = Omit<Notification, 'id' | 'createdAt'>

interface NotificationStore {
  /**
   * Array of active notifications (newest first)
   */
  notifications: Notification[]

  /**
   * Adds a new notification to the stack
   *
   * @param params - Notification parameters
   * @returns The created notification ID
   */
  addNotification: (params: AddNotificationParams) => string

  /**
   * Removes a notification by ID
   *
   * @param id - Notification ID to remove
   */
  removeNotification: (id: string) => void

  /**
   * Gets notifications for a specific workflow
   * Returns both global notifications (no workflowId) and workflow-specific notifications
   *
   * @param workflowId - The workflow ID to filter by
   * @returns Array of notifications for the workflow
   */
  getNotificationsForWorkflow: (workflowId: string) => Notification[]

  /**
   * Clears notifications.
   *
   * When a workflow ID is provided, this removes:
   * - All notifications scoped to that workflow.
   * - Global notifications (without a workflowId), since they are visible in all workflows.
   *
   * When omitted, all notifications are cleared.
   *
   * @param workflowId - Optional workflow ID to scope the clear operation.
   */
  clearNotifications: (workflowId?: string) => void
}

export const useNotificationStore = create<NotificationStore>()(
  persist(
    (set, get) => ({
      notifications: [],

      addNotification: (params: AddNotificationParams) => {
        const id = crypto.randomUUID()

        const notification: Notification = {
          id,
          level: params.level,
          message: params.message,
          action: params.action,
          createdAt: Date.now(),
          workflowId: params.workflowId,
        }

        set((state) => ({
          notifications: [notification, ...state.notifications],
        }))

        logger.info('Notification added', {
          id,
          level: params.level,
          message: params.message,
          workflowId: params.workflowId,
          actionType: params.action?.type,
        })

        return id
      },

      removeNotification: (id: string) => {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }))

        logger.info('Notification removed', { id })
      },

      getNotificationsForWorkflow: (workflowId: string) => {
        return get().notifications.filter((n) => !n.workflowId || n.workflowId === workflowId)
      },

      clearNotifications: (workflowId?: string) => {
        set((state) => {
          if (!workflowId) {
            return { notifications: [] }
          }

          return {
            notifications: state.notifications.filter(
              (notification) =>
                // Keep notifications for other workflows only.
                notification.workflowId && notification.workflowId !== workflowId
            ),
          }
        })
      },
    }),
    {
      name: 'notification-storage',
      /**
       * Only persist workflow-level notifications.
       * Global notifications (without a workflowId) are kept in memory only.
       */
      partialize: (state): Pick<NotificationStore, 'notifications'> => ({
        notifications: state.notifications.filter((notification) => !!notification.workflowId),
      }),
    }
  )
)
