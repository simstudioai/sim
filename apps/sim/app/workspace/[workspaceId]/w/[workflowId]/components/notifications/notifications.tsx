import { memo, useCallback, useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { toast, useToast } from '@/components/emcn'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import {
  type Notification,
  type NotificationAction,
  openCopilotWithMessage,
  useNotificationStore,
} from '@/stores/notifications'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('Notifications')

const ACTION_LABELS: Record<NotificationAction['type'], string> = {
  copilot: 'Fix in Copilot',
  refresh: 'Refresh',
  'unlock-workflow': 'Unlock Workflow',
} as const

function executeNotificationAction(action: NotificationAction) {
  switch (action.type) {
    case 'copilot':
      openCopilotWithMessage(action.message)
      break
    case 'refresh':
      window.location.reload()
      break
    case 'unlock-workflow':
      window.dispatchEvent(new CustomEvent('unlock-workflow'))
      break
    default:
      logger.warn('Unknown action type', { actionType: action.type })
  }
}

function notificationToToast(n: Notification, removeNotification: (id: string) => void) {
  const toastAction = n.action
    ? {
        label: ACTION_LABELS[n.action.type] ?? 'Take action',
        onClick: () => {
          executeNotificationAction(n.action!)
          removeNotification(n.id)
        },
      }
    : undefined

  return {
    message: n.message,
    variant: n.level === 'error' ? ('error' as const) : ('default' as const),
    action: toastAction,
    duration: n.level === 'error' && n.workflowId ? 10_000 : 0,
  }
}

/**
 * Headless bridge that syncs the notification Zustand store into the toast system.
 *
 * Watches for new notifications scoped to the active workflow and shows them as toasts.
 * When a toast is dismissed, the corresponding notification is removed from the store.
 */
export const Notifications = memo(function Notifications() {
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const allNotifications = useNotificationStore((state) => state.notifications)
  const removeNotification = useNotificationStore((state) => state.removeNotification)
  const clearNotifications = useNotificationStore((state) => state.clearNotifications)
  const { dismissAll } = useToast()

  const shownIdsRef = useRef(new Set<string>())

  const showNotification = useCallback(
    (n: Notification) => {
      if (shownIdsRef.current.has(n.id)) return
      shownIdsRef.current.add(n.id)

      const input = notificationToToast(n, removeNotification)
      toast(input)

      logger.info('Notification shown as toast', {
        id: n.id,
        level: n.level,
        workflowId: n.workflowId,
      })
    },
    [removeNotification]
  )

  useEffect(() => {
    if (!activeWorkflowId) return

    const visible = allNotifications.filter(
      (n) => !n.workflowId || n.workflowId === activeWorkflowId
    )

    for (const n of visible) {
      showNotification(n)
    }

    const currentIds = new Set(allNotifications.map((n) => n.id))
    for (const id of shownIdsRef.current) {
      if (!currentIds.has(id)) {
        shownIdsRef.current.delete(id)
      }
    }
  }, [allNotifications, activeWorkflowId, showNotification])

  useRegisterGlobalCommands(() =>
    createCommands([
      {
        id: 'clear-notifications',
        handler: () => {
          clearNotifications(activeWorkflowId ?? undefined)
          dismissAll()
        },
        overrides: {
          allowInEditable: false,
        },
      },
    ])
  )

  return null
})
