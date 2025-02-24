import { useEffect, useState } from 'react'
import { AlertCircle, Copy, Key, Terminal, X } from 'lucide-react'
import { ErrorIcon } from '@/components/icons'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/stores/notifications/store'

const NOTIFICATION_TIMEOUT = 4000
const FADE_DURATION = 300

const NotificationIcon = {
  error: ErrorIcon,
  console: Terminal,
  api: Key,
}

const NotificationColors = {
  error:
    'border-red-500 bg-red-50 text-destructive dark:border-border dark:text-foreground dark:bg-background',
  console:
    'border-border bg-background text-foreground dark:border-border dark:text-foreground dark:bg-background',
  api: 'border-green-500 bg-green-50 text-green-700 dark:border-border dark:text-green-500 dark:bg-background',
}

export function NotificationList() {
  const { notifications, hideNotification } = useNotificationStore()
  const [fadingNotifications, setFadingNotifications] = useState<Set<string>>(new Set())
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({})

  const visibleNotifications = notifications.filter((n) => n.isVisible)

  useEffect(() => {
    notifications.forEach((notification) => {
      if (!notification.isVisible || notification.options?.isPersistent) return

      // Start fade out
      const fadeTimer = setTimeout(() => {
        setFadingNotifications((prev) => new Set([...prev, notification.id]))
      }, NOTIFICATION_TIMEOUT)

      // Hide notification after fade
      const hideTimer = setTimeout(() => {
        hideNotification(notification.id)
        setFadingNotifications((prev) => {
          const next = new Set(prev)
          next.delete(notification.id)
          return next
        })
      }, NOTIFICATION_TIMEOUT + FADE_DURATION)

      return () => {
        clearTimeout(fadeTimer)
        clearTimeout(hideTimer)
      }
    })
  }, [notifications, hideNotification])

  const handleCopy = async (id: string, sectionIndex: number, content: string) => {
    await navigator.clipboard.writeText(content)
    setCopiedMap((prev) => ({ ...prev, [`${id}-${sectionIndex}`]: true }))
    setTimeout(() => {
      setCopiedMap((prev) => ({ ...prev, [`${id}-${sectionIndex}`]: false }))
    }, 2000)
  }

  if (visibleNotifications.length === 0) return null

  return (
    <div
      className="absolute left-1/2 z-50 space-y-2 max-w-md w-full"
      style={{
        top: '30px',
        transform: 'translateX(-50%)',
      }}
    >
      {visibleNotifications.map((notification) => {
        const Icon = NotificationIcon[notification.type]
        const isFading = fadingNotifications.has(notification.id)

        return (
          <Alert
            key={notification.id}
            className={cn(
              'transition-all duration-300 ease-in-out opacity-0 translate-y-[-100%]',
              isFading ? 'animate-notification-fade-out' : 'animate-notification-slide',
              NotificationColors[notification.type]
            )}
          >
            <div className="flex items-start gap-4 py-1">
              <Icon
                className={cn('h-4 w-4', {
                  '!text-red-500': notification.type === 'error',
                  'text-foreground': notification.type === 'console',
                  '!text-green-500': notification.type === 'api',
                })}
              />
              <div className="flex-1 space-y-2">
                <AlertTitle className="flex items-center justify-between -mt-0.5">
                  <span>
                    {notification.type === 'error'
                      ? 'Error'
                      : notification.type === 'api'
                        ? 'API'
                        : 'Console'}
                  </span>
                  {notification.options?.isPersistent && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 hover:bg-transparent hover:text-destructive"
                      onClick={() => hideNotification(notification.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </AlertTitle>
                <AlertDescription className="space-y-4">
                  <p>{notification.message}</p>
                  {notification.options?.sections?.map((section, index) => (
                    <div key={index} className="space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground">
                        {section.label}
                      </div>
                      <div
                        className="relative group cursor-pointer"
                        onClick={() => handleCopy(notification.id, index, section.content)}
                      >
                        <pre className="bg-muted rounded-md p-3 text-xs font-mono whitespace-pre-wrap transition-colors hover:bg-muted/80">
                          {section.content}
                        </pre>
                        <div className="absolute top-3 right-3 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                          {copiedMap[`${notification.id}-${index}`] ? 'Copied!' : 'Click to copy'}
                        </div>
                      </div>
                    </div>
                  ))}
                </AlertDescription>
              </div>
            </div>
          </Alert>
        )
      })}
    </div>
  )
}
