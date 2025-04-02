import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { AlertCircle, Copy, Rocket, Store, Terminal, X } from 'lucide-react'
import { ErrorIcon } from '@/components/icons'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/stores/notifications/store'
import { Notification, NotificationOptions, NotificationType } from '@/stores/notifications/types'

interface NotificationDropdownItemProps {
  id: string
  type: NotificationType
  message: string
  timestamp: number
  options?: NotificationOptions
  setDropdownOpen?: (open: boolean) => void
}

const NotificationIcon = {
  error: ErrorIcon,
  console: Terminal,
  api: Rocket,
  marketplace: Store,
  info: AlertCircle,
}

const NotificationColors = {
  error: 'text-destructive',
  console: 'text-foreground',
  api: 'text-[#802FFF]',
  marketplace: 'text-foreground',
  info: 'text-blue-500',
}

export function NotificationDropdownItem({
  id,
  type,
  message,
  timestamp,
  options,
  setDropdownOpen,
}: NotificationDropdownItemProps) {
  const { notifications, showNotification, hideNotification, removeNotification, addNotification } =
    useNotificationStore()
  const Icon = NotificationIcon[type]
  const [, forceUpdate] = useState({})

  // Update the time display every minute
  useEffect(() => {
    const interval = setInterval(() => forceUpdate({}), 60000)
    return () => clearInterval(interval)
  }, [])

  // Find the full notification object from the store
  const getFullNotification = (): Notification | undefined => {
    return notifications.find((n) => n.id === id)
  }

  // Handle click to show the notification
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const notification = getFullNotification()

    if (notification) {
      // For persistent notifications like API info, just re-show them
      if (notification.options?.isPersistent) {
        showNotification(id)
      } else {
        // For non-persistent notifications, we have different strategies:

        if (notification.isVisible) {
          if (notification.isFading) {
            // If it's currently fading, remove and re-add it to restart animation sequence
            removeNotification(id)

            // Re-add with same properties but new ID
            addNotification(
              notification.type,
              notification.message,
              notification.workflowId,
              notification.options
            )
          } else {
            // If visible but not fading, just make sure it's at the top of the stack
            showNotification(id)
          }
        } else {
          // If not visible, we re-add it instead of just showing it
          // This ensures a fresh animation sequence

          // Create a new notification with same properties
          addNotification(
            notification.type,
            notification.message,
            notification.workflowId,
            notification.options
          )
        }
      }
    } else {
      // Fallback for any case where the notification doesn't exist anymore
      addNotification(type, message, null, options)
    }

    // Close the dropdown after clicking
    if (setDropdownOpen) {
      setDropdownOpen(false)
    }
  }

  // Format time and replace "less than a minute ago" with "<1 minute ago"
  const rawTimeAgo = formatDistanceToNow(timestamp, { addSuffix: true })
  const timeAgo = rawTimeAgo.replace('less than a minute ago', '<1 minute ago')

  return (
    <DropdownMenuItem className="flex items-start gap-2 p-3 cursor-pointer" onClick={handleClick}>
      <Icon className={cn('h-4 w-4', NotificationColors[type])} />
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">
            {type === 'error'
              ? 'Error'
              : type === 'api'
                ? 'API'
                : type === 'marketplace'
                  ? 'Marketplace'
                  : type === 'info'
                    ? 'Info'
                    : 'Console'}
          </span>
          <span className="text-xs text-muted-foreground">{timeAgo}</span>
        </div>
        <p className="text-sm text-foreground break-normal whitespace-normal hyphens-auto overflow-wrap-anywhere">
          {message.length > 100 ? `${message.slice(0, 60)}...` : message}
        </p>
      </div>
    </DropdownMenuItem>
  )
}
