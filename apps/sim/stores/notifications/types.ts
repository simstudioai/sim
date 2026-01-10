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
