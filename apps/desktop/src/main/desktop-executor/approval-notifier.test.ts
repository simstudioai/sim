import { describe, expect, it, vi } from 'vitest'
import { createApprovalNotifier } from '@/main/desktop-executor/approval-notifier'
import type { DesktopApprovalItem } from '@/main/desktop-executor/executor'

function approval(toolCallId: string, chatId = 'chat-b'): DesktopApprovalItem {
  return {
    kind: 'approval_needed',
    toolCallId,
    toolName: 'terminal',
    chatId,
    chatTitle: 'Fix CI',
    workspaceId: 'ws-1',
    summary: 'rm -rf build && npm test',
  }
}

function harness(options: { enabled?: boolean; focusedChatId?: string | null } = {}) {
  const notifications: Array<{
    options: { title: string; body: string; silent: boolean }
    show: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    click: () => void
  }> = []
  const openRoute = vi.fn()
  let focusedChatId = options.focusedChatId ?? null
  const notifier = createApprovalNotifier({
    preferences: () => ({
      notificationsEnabled: options.enabled ?? true,
      notificationSounds: true,
    }),
    focusedChatId: () => focusedChatId,
    openRoute,
    createNotification: (notificationOptions) => {
      let click = () => {}
      const notification = {
        options: notificationOptions,
        show: vi.fn(),
        close: vi.fn(),
        get click() {
          return click
        },
      }
      notifications.push(notification)
      return {
        show: notification.show,
        close: notification.close,
        on: (_event, listener) => {
          click = listener
        },
      }
    },
  })
  return {
    notifier,
    notifications,
    openRoute,
    focus: (chatId: string | null) => {
      focusedChatId = chatId
    },
  }
}

describe('approval notifications', () => {
  it('notifies once per waiting call and opens its chat, naming neither chat nor command', () => {
    const { notifier, notifications, openRoute } = harness()

    notifier.update([approval('call-1')])
    notifier.update([approval('call-1')])

    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.show).toHaveBeenCalledOnce()
    expect(notifications[0]?.options.body).not.toContain('rm -rf')
    expect(notifications[0]?.options.body).not.toContain('Fix CI')
    notifications[0]?.click()
    expect(openRoute).toHaveBeenCalledWith('/workspace/ws-1/chat/chat-b')
  })

  it('closes the notification once the call is decided', () => {
    const { notifier, notifications } = harness()
    notifier.update([approval('call-1')])

    notifier.update([])

    expect(notifications[0]?.close).toHaveBeenCalledOnce()
  })

  it('stays quiet for the chat the user is looking at, even after they leave it', () => {
    const { notifier, notifications, focus } = harness({ focusedChatId: 'chat-b' })
    notifier.update([approval('call-1')])
    focus('chat-c')

    notifier.update([approval('call-1')])

    expect(notifications).toHaveLength(0)
  })

  it('stays quiet when notifications are switched off', () => {
    const { notifier, notifications } = harness({ enabled: false })

    notifier.update([approval('call-1')])

    expect(notifications).toHaveLength(0)
  })
})
