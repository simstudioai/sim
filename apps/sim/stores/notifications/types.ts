/**
 * Notification level types
 */
export type NotificationLevel = 'info' | 'error'

/**
 * Notification callback function type
 * Can be used to trigger actions when notification is clicked
 */
export type NotificationCallback = () => void | Promise<void>

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
  level: NotificationLevel

  /**
   * Message to display to the user
   */
  message: string

  /**
   * Optional callback to execute when user interacts with notification
   * Example: Open copilot and send a message
   */
  callback?: NotificationCallback

  /**
   * Timestamp when notification was created
   */
  createdAt: number
}

/**
 * Parameters for adding a new notification
 */
export interface AddNotificationParams {
  /**
   * Notification severity level
   */
  level: NotificationLevel

  /**
   * Message to display to the user
   */
  message: string

  /**
   * Optional callback to execute when user interacts with notification
   */
  callback?: NotificationCallback
}
