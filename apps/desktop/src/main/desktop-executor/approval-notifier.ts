/**
 * Tells the user when a chat they are not looking at waits for their approval. The notification
 * only opens the chat at its approval card; approving happens there, where the user sees what
 * they are approving. It closes itself once the call is decided, and names neither the chat nor
 * the command, since a notification can show on a locked screen.
 */
import type { DesktopApprovalItem } from '@/main/desktop-executor/executor'

interface ApprovalNotification {
  show(): void
  close(): void
  on(event: 'click', listener: () => void): void
}

export interface ApprovalNotifierDeps {
  /** Whether the user allows desktop notifications, and with sound. */
  preferences: () => { notificationsEnabled: boolean; notificationSounds: boolean }
  /** The chat the focused Sim window shows, if any; its own approvals need no notification. */
  focusedChatId: () => string | null
  openRoute: (route: string | undefined) => void
  createNotification: (options: {
    title: string
    body: string
    silent: boolean
  }) => ApprovalNotification | null
}

/**
 * Creates the notifier the executor feeds each inbox read's approval items to. `update` notifies
 * once per newly waiting call and closes notifications for calls decided since; `clear` closes
 * them all, for sign-out.
 */
export function createApprovalNotifier(deps: ApprovalNotifierDeps) {
  /** Calls already brought to the user's attention, by notification or by being on screen. */
  const shown = new Map<string, ApprovalNotification | null>()

  return {
    /** Shows a notification for each newly waiting call and closes those no longer waiting. */
    update(items: DesktopApprovalItem[]): void {
      const waiting = new Set(items.map((item) => item.toolCallId))
      for (const [toolCallId, notification] of shown) {
        if (waiting.has(toolCallId)) continue
        notification?.close()
        shown.delete(toolCallId)
      }
      const preferences = deps.preferences()
      if (!preferences.notificationsEnabled) return
      for (const item of items) {
        if (shown.has(item.toolCallId)) continue
        if (deps.focusedChatId() === item.chatId) {
          shown.set(item.toolCallId, null)
          continue
        }
        const notification = deps.createNotification({
          title: 'Approval needed',
          body: 'A chat is waiting for your approval.',
          silent: !preferences.notificationSounds,
        })
        if (!notification) return
        const route = item.workspaceId
          ? `/workspace/${encodeURIComponent(item.workspaceId)}/chat/${encodeURIComponent(item.chatId)}`
          : undefined
        notification.on('click', () => deps.openRoute(route))
        notification.show()
        shown.set(item.toolCallId, notification)
      }
    },
    clear(): void {
      for (const notification of shown.values()) notification?.close()
      shown.clear()
    },
  }
}
