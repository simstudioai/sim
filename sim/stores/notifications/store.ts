import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { Notification, NotificationOptions, NotificationStore, NotificationType } from './types'

const STORAGE_KEY = 'workflow-notifications'
// Maximum number of notifications to keep across all workflows
const MAX_NOTIFICATIONS = 50

// Helper to load persisted notifications
const loadPersistedNotifications = (): Notification[] => {
  if (typeof window === 'undefined') return []
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved ? JSON.parse(saved).slice(0, MAX_NOTIFICATIONS) : []
}

// Helper to save notifications to localStorage
const persistNotifications = (notifications: Notification[]) => {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)))
}

export const useNotificationStore = create<NotificationStore>()(
  devtools(
    (set, get) => ({
      notifications: loadPersistedNotifications(),

      addNotification: (type, message, workflowId, options: NotificationOptions = {}) => {
        // Only create notifications on the client side
        if (typeof window === 'undefined') return

        const notification: Notification = {
          id: crypto.randomUUID(),
          type,
          message,
          timestamp: Date.now(),
          isVisible: true,
          read: false,
          workflowId,
          options,
        }

        set((state) => {
          // Add new notification at the start and limit total count
          const newNotifications = [notification, ...state.notifications].slice(
            0,
            MAX_NOTIFICATIONS
          )
          persistNotifications(newNotifications)
          return { notifications: newNotifications }
        })
      },

      hideNotification: (id) =>
        set((state) => {
          const newNotifications = state.notifications.map((n) =>
            n.id === id ? { ...n, isVisible: false, read: true } : n
          )
          persistNotifications(newNotifications)
          return { notifications: newNotifications }
        }),

      showNotification: (id) =>
        set((state) => {
          // Find the notification first to ensure it exists
          const notification = state.notifications.find((n) => n.id === id)
          if (!notification) return { notifications: state.notifications }

          // Bring the notification to the top and make it visible
          const filteredNotifications = state.notifications.filter((n) => n.id !== id)
          const updatedNotification = { ...notification, isVisible: true, read: false }

          // Put the notification at the top so it's easily visible in dropdowns
          const newNotifications = [updatedNotification, ...filteredNotifications]
          persistNotifications(newNotifications)
          return { notifications: newNotifications }
        }),

      markAsRead: (id) =>
        set((state) => {
          const newNotifications = state.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n
          )
          persistNotifications(newNotifications)
          return { notifications: newNotifications }
        }),

      markAllAsRead: (workflowId) =>
        set((state) => {
          const newNotifications = state.notifications.map((n) =>
            n.workflowId === workflowId ? { ...n, read: true } : n
          )
          persistNotifications(newNotifications)
          return { notifications: newNotifications }
        }),

      removeNotification: (id) =>
        set((state) => {
          const newNotifications = state.notifications.filter((n) => n.id !== id)
          persistNotifications(newNotifications)
          return { notifications: newNotifications }
        }),

      clearNotifications: () => {
        persistNotifications([])
        set({ notifications: [] })
      },

      getWorkflowNotifications: (workflowId) => {
        return get().notifications.filter((n) => n.workflowId === workflowId)
      },
    }),
    { name: 'notification-store' }
  )
)
