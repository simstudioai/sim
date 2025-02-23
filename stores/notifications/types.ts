export type NotificationType = 'error' | 'console' | 'api'

export interface Notification {
  id: string
  type: NotificationType
  message: string
  timestamp: number
  isVisible: boolean
  workflowId: string | null
  options?: NotificationOptions
}

export interface NotificationSection {
  label: string
  content: string
}

export interface NotificationOptions {
  copyableContent?: string
  isPersistent?: boolean
  sections?: NotificationSection[]
}

export interface NotificationStore {
  notifications: Notification[]
  addNotification: (
    type: NotificationType,
    message: string,
    workflowId: string | null,
    options?: NotificationOptions
  ) => void
  hideNotification: (id: string) => void
  showNotification: (id: string) => void
  removeNotification: (id: string) => void
  clearNotifications: () => void
  getWorkflowNotifications: (workflowId: string) => Notification[]
}
