import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { Notification, NotificationOptions, NotificationStore, NotificationType } from './types'

const STORAGE_KEY = 'workflow-notifications'
// Maximum number of notifications to keep across all workflows
const MAX_NOTIFICATIONS = 50
// Default notification display time before fading
export const NOTIFICATION_TIMEOUT = 4000
// Maximum number of visible notifications at once
export const MAX_VISIBLE_NOTIFICATIONS = 5

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
        if (typeof window === 'undefined') return ''

        const notification: Notification = {
          id: crypto.randomUUID(),
          type,
          message,
          timestamp: Date.now(),
          isVisible: true,
          read: false,
          isFading: false,
          workflowId,
          options,
        }

        set((state) => {
          // Add new notification at the start and limit total count
          let newNotifications = [notification, ...state.notifications].slice(
            0,
            MAX_NOTIFICATIONS
          )
          
          // Check if we need to auto-fade older notifications if we exceed the limit
          const workflowVisibleCount = get().getVisibleNotificationCount(workflowId);
          
          if (workflowVisibleCount > MAX_VISIBLE_NOTIFICATIONS) {
            // Find the oldest non-persistent visible notification from this workflow to fade out
            newNotifications = newNotifications.map((n, index) => {
              // Don't touch the newly added notification
              if (index === 0) return n;
              
              // Only target notifications from the same workflow that are visible, not persistent, and not already fading
              if (
                n.workflowId === workflowId && 
                n.isVisible && 
                !n.options?.isPersistent && 
                !n.isFading
              ) {
                // Mark it as fading - the oldest one will be the first we encounter
                return { ...n, isFading: true };
              }
              
              return n;
            });
          }
          
          persistNotifications(newNotifications)
          return { notifications: newNotifications }
        })

        // If not persistent, start the fade timer immediately
        if (!options.isPersistent) {
          const timerId = setTimeout(() => {
            // Start fade out animation
            set((state) => {
              const newNotifications = state.notifications.map((n) =>
                n.id === notification.id ? { ...n, isFading: true } : n
              )
              persistNotifications(newNotifications)
              return { notifications: newNotifications }
            })
          }, NOTIFICATION_TIMEOUT)
        }

        return notification.id
      },

      hideNotification: (id) =>
        set((state) => {
          const newNotifications = state.notifications.map((n) =>
            n.id === id ? { ...n, isVisible: false, read: true, isFading: false } : n
          )
          persistNotifications(newNotifications)
          return { notifications: newNotifications }
        }),

      setNotificationFading: (id) =>
        set((state) => {
          const newNotifications = state.notifications.map((n) =>
            n.id === id ? { ...n, isFading: true } : n
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
          const updatedNotification = { ...notification, isVisible: true, read: false, isFading: false }
          
          // Put the notification at the top so it's easily visible in dropdowns
          let newNotifications = [updatedNotification, ...filteredNotifications]
          
          // Check if we need to auto-fade older notifications due to the limit
          const workflowId = notification.workflowId;
          const workflowVisibleCount = get().getVisibleNotificationCount(workflowId);
          
          if (workflowVisibleCount > MAX_VISIBLE_NOTIFICATIONS) {
            // Find the oldest non-persistent visible notification to fade out
            newNotifications = newNotifications.map((n, index) => {
              // Don't touch the newly shown notification
              if (index === 0) return n;
              
              // Only target notifications from the same workflow that are visible, not persistent, and not already fading
              if (
                n.workflowId === workflowId && 
                n.isVisible && 
                !n.options?.isPersistent && 
                !n.isFading
              ) {
                // Mark it as fading - the oldest one will be the first we encounter
                return { ...n, isFading: true };
              }
              
              return n;
            });
          }
          
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
      
      getVisibleNotificationCount: (workflowId) => {
        if (!workflowId) return 0;
        
        return get().notifications.filter(
          n => n.workflowId === workflowId && 
               n.isVisible && 
               !n.read
        ).length;
      },
    }),
    { name: 'notification-store' }
  )
)
