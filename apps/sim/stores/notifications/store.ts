import { create } from 'zustand'
import { createLogger } from '@/lib/logs/console/logger'
import type { AddNotificationParams, Notification, NotificationCallback } from './types'

const logger = createLogger('NotificationStore')

/**
 * Default duration for notifications in milliseconds
 */
const DEFAULT_NOTIFICATION_DURATION = 5000

/**
 * Maximum number of notifications to display at once
 */
const MAX_NOTIFICATIONS = 5

interface NotificationStore {
  /**
   * Array of active notifications (newest first)
   */
  notifications: Notification[]

  /**
   * Map of timeout IDs for auto-dismissal
   */
  timeouts: Map<string, NodeJS.Timeout>

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
   * Dismisses a notification with animation
   *
   * @param id - Notification ID to dismiss
   */
  dismissNotification: (id: string) => void

  /**
   * Clears all notifications
   */
  clearAll: () => void

  /**
   * Executes the callback for a notification
   *
   * @param id - Notification ID
   */
  executeCallback: (id: string) => void
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  timeouts: new Map(),

  addNotification: (params: AddNotificationParams) => {
    const id = crypto.randomUUID()

    const notification: Notification = {
      id,
      level: params.level,
      message: params.message,
      callback: params.callback,
      createdAt: Date.now(),
    }

    set((state) => {
      // Add notification to the beginning of the array (newest first)
      let newNotifications = [notification, ...state.notifications]

      // Limit to MAX_NOTIFICATIONS
      if (newNotifications.length > MAX_NOTIFICATIONS) {
        // Remove oldest notifications
        const removedNotifications = newNotifications.slice(MAX_NOTIFICATIONS)
        newNotifications = newNotifications.slice(0, MAX_NOTIFICATIONS)

        // Clear timeouts for removed notifications
        removedNotifications.forEach((n) => {
          const timeout = state.timeouts.get(n.id)
          if (timeout) {
            clearTimeout(timeout)
            state.timeouts.delete(n.id)
          }
        })
      }

      return { notifications: newNotifications }
    })

    // Set up auto-dismiss timeout
    const timeout = setTimeout(() => {
      get().removeNotification(id)
    }, DEFAULT_NOTIFICATION_DURATION)

    set((state) => {
      const newTimeouts = new Map(state.timeouts)
      newTimeouts.set(id, timeout)
      return { timeouts: newTimeouts }
    })

    logger.info('Notification added', {
      id,
      level: params.level,
      message: params.message,
    })

    return id
  },

  dismissNotification: (id: string) => {
    get().removeNotification(id)
  },

  removeNotification: (id: string) => {
    set((state) => {
      // Clear timeout
      const timeout = state.timeouts.get(id)
      if (timeout) {
        clearTimeout(timeout)
      }

      const newTimeouts = new Map(state.timeouts)
      newTimeouts.delete(id)

      return {
        notifications: state.notifications.filter((n) => n.id !== id),
        timeouts: newTimeouts,
      }
    })

    logger.info('Notification removed', { id })
  },

  clearAll: () => {
    const { timeouts } = get()

    // Clear all timeouts
    timeouts.forEach((timeout) => {
      clearTimeout(timeout)
    })

    set({
      notifications: [],
      timeouts: new Map(),
    })

    logger.info('All notifications cleared')
  },

  executeCallback: (id: string) => {
    const notification = get().notifications.find((n) => n.id === id)

    if (!notification) {
      logger.warn('Notification not found for callback execution', { id })
      return
    }

    if (!notification.callback) {
      logger.warn('Notification has no callback', { id })
      return
    }

    try {
      logger.info('Executing notification callback', { id })
      const result = notification.callback()

      // Handle async callbacks
      if (result instanceof Promise) {
        result.catch((error) => {
          logger.error('Notification callback failed', { id, error })
        })
      }

      // Dismiss notification after callback execution
      get().dismissNotification(id)
    } catch (error) {
      logger.error('Notification callback threw error', { id, error })
    }
  },
}))

/**
 * Helper function to add an info notification
 *
 * @param message - Notification message
 * @param callback - Optional callback function
 * @returns Notification ID
 */
export const addInfoNotification = (message: string, callback?: NotificationCallback): string => {
  return useNotificationStore.getState().addNotification({
    level: 'info',
    message,
    callback,
  })
}

/**
 * Helper function to add an error notification
 *
 * @param message - Notification message
 * @param callback - Optional callback function
 * @returns Notification ID
 */
export const addErrorNotification = (message: string, callback?: NotificationCallback): string => {
  return useNotificationStore.getState().addNotification({
    level: 'error',
    message,
    callback,
  })
}

/**
 * Helper function to add a workflow block error notification
 *
 * @param blockName - Name of the block that errored
 * @param errorMessage - Error message
 * @param openCopilotCallback - Callback to open copilot with error message
 * @returns Notification ID
 */
export const addBlockErrorNotification = (
  blockName: string,
  errorMessage: string,
  openCopilotCallback?: NotificationCallback
): string => {
  return useNotificationStore.getState().addNotification({
    level: 'error',
    message: `${blockName}: ${errorMessage}`,
    callback: openCopilotCallback,
  })
}
