import { memo, useCallback } from 'react'
import { X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/emcn'
import { createLogger } from '@/lib/logs/console/logger'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import {
  type NotificationAction,
  openCopilotWithMessage,
  useNotificationStore,
} from '@/stores/notifications'

const logger = createLogger('Notifications')
const MAX_VISIBLE_NOTIFICATIONS = 4

/**
 * Notifications display component
 * Positioned in the bottom-right workspace area, aligned with terminal and panel spacing
 * Shows both global notifications and workflow-specific notifications
 */
export const Notifications = memo(function Notifications() {
  const params = useParams()
  const workflowId = params.workflowId as string

  const notifications = useNotificationStore((state) =>
    state.notifications.filter((n) => !n.workflowId || n.workflowId === workflowId)
  )
  const removeNotification = useNotificationStore((state) => state.removeNotification)
  const clearNotifications = useNotificationStore((state) => state.clearNotifications)
  const visibleNotifications = notifications.slice(0, MAX_VISIBLE_NOTIFICATIONS)

  /**
   * Executes a notification action and handles side effects.
   *
   * @param notificationId - The ID of the notification whose action is executed.
   * @param action - The action configuration to execute.
   */
  const executeAction = useCallback(
    (notificationId: string, action: NotificationAction) => {
      try {
        logger.info('Executing notification action', {
          notificationId,
          actionType: action.type,
          messageLength: action.message.length,
        })

        switch (action.type) {
          case 'copilot':
            openCopilotWithMessage(action.message)
            break
          case 'refresh':
            window.location.reload()
            break
          default:
            logger.warn('Unknown action type', { notificationId, actionType: action.type })
        }

        // Dismiss the notification after the action is triggered
        removeNotification(notificationId)
      } catch (error) {
        logger.error('Failed to execute notification action', {
          notificationId,
          actionType: action.type,
          error,
        })
      }
    },
    [removeNotification]
  )

  /**
   * Register global keyboard shortcut for clearing notifications.
   *
   * - Mod+E: Clear all notifications visible in the current workflow (including global ones).
   *
   * The command is disabled in editable contexts so it does not interfere with typing.
   */
  useRegisterGlobalCommands(() =>
    createCommands([
      {
        id: 'clear-notifications',
        handler: () => {
          clearNotifications(workflowId)
        },
        overrides: {
          allowInEditable: false,
        },
      },
    ])
  )

  if (visibleNotifications.length === 0) {
    return null
  }

  return (
    <div className='fixed right-[calc(var(--panel-width)+16px)] bottom-[calc(var(--terminal-height)+16px)] z-30 flex flex-col items-end'>
      {[...visibleNotifications].reverse().map((notification, index, stacked) => {
        const depth = stacked.length - index - 1
        const xOffset = depth * 3
        const hasAction = Boolean(notification.action)

        return (
          <div
            key={notification.id}
            style={{ transform: `translateX(${xOffset}px)` }}
            className={`relative h-[78px] w-[240px] overflow-hidden rounded-[4px] border bg-[#232323] transition-transform duration-200 ${
              index > 0 ? '-mt-[78px]' : ''
            }`}
          >
            <div className='flex h-full flex-col justify-between px-[8px] pt-[6px] pb-[8px]'>
              <div
                className={`font-medium text-[12px] leading-[16px] ${
                  hasAction ? 'line-clamp-2' : 'line-clamp-4'
                }`}
              >
                <Button
                  variant='ghost'
                  onClick={() => removeNotification(notification.id)}
                  aria-label='Dismiss notification'
                  className='!p-1.5 -m-1.5 float-right ml-[16px]'
                >
                  <X className='h-3 w-3' />
                </Button>
                {notification.level === 'error' && (
                  <span className='mr-[6px] mb-[2.75px] inline-block h-[6px] w-[6px] rounded-[2px] bg-[var(--text-error)] align-middle' />
                )}
                {notification.message}
              </div>
              {hasAction && (
                <div className='mt-[4px]'>
                  <Button
                    variant='active'
                    onClick={() => executeAction(notification.id, notification.action!)}
                    className='w-full px-[8px] py-[4px] font-medium text-[12px]'
                  >
                    {notification.action!.type === 'copilot'
                      ? 'Fix in Copilot'
                      : notification.action!.type === 'refresh'
                        ? 'Refresh'
                        : 'Take action'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
})
