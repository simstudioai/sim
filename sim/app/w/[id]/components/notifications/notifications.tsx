import { useEffect, useState } from 'react'
import { Rocket, Terminal, X } from 'lucide-react'
import { ErrorIcon } from '@/components/icons'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/stores/notifications/store'
import { Notification } from '@/stores/notifications/types'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('Notifications')

// Constants
const NOTIFICATION_TIMEOUT = 4000
const FADE_DURATION = 300

// Icon mapping for notification types
const NotificationIcon = {
  error: ErrorIcon,
  console: Terminal,
  api: Rocket,
}

// Color schemes for different notification types
const NotificationColors = {
  error:
    'border-red-500 bg-red-50 text-destructive dark:border-border dark:text-foreground dark:bg-background',
  console:
    'border-border bg-background text-foreground dark:border-border dark:text-foreground dark:bg-background',
  api: 'border-border bg-background text-foreground dark:border-border dark:text-foreground dark:bg-background',
}

// API deployment status styling
const ApiStatusStyles = {
  active: 'text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400',
  inactive: 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400',
}

/**
 * AlertDialog component for API deletion confirmation
 */
function DeleteApiConfirmation({
  isOpen,
  onClose,
  onConfirm,
  workflowId,
}: {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  workflowId: string | null
}) {
  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete API Deployment</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this API deployment? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-red-600 hover:bg-red-700">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * NotificationList component displays all active notifications as alerts
 * with support for auto-dismissal, copying content, and different styling per type
 */
export function NotificationList() {
  // Store access
  const { notifications, hideNotification } = useNotificationStore()

  // Local state
  const [fadingNotifications, setFadingNotifications] = useState<Set<string>>(new Set())

  // Filter to only show visible notifications
  const visibleNotifications = notifications.filter((n) => n.isVisible)

  // Handle auto-dismissal of non-persistent notifications
  useEffect(() => {
    // Setup timers for each notification
    const timers: ReturnType<typeof setTimeout>[] = []

    notifications.forEach((notification) => {
      // Skip if already hidden or marked as persistent
      if (!notification.isVisible || notification.options?.isPersistent) return

      // Start fade out animation
      const fadeTimer = setTimeout(() => {
        setFadingNotifications((prev) => new Set([...prev, notification.id]))
      }, NOTIFICATION_TIMEOUT)

      // Hide notification after fade completes
      const hideTimer = setTimeout(() => {
        hideNotification(notification.id)
        setFadingNotifications((prev) => {
          const next = new Set(prev)
          next.delete(notification.id)
          return next
        })
      }, NOTIFICATION_TIMEOUT + FADE_DURATION)

      timers.push(fadeTimer, hideTimer)
    })

    // Cleanup timers on unmount or when notifications change
    return () => timers.forEach(clearTimeout)
  }, [notifications, hideNotification])

  // Early return if no notifications to show
  if (visibleNotifications.length === 0) return null

  return (
    <div
      className="absolute left-1/2 z-50 space-y-2 max-w-md w-full"
      style={{
        top: '30px',
        transform: 'translateX(-50%)',
      }}
    >
      {visibleNotifications.map((notification) => (
        <NotificationAlert
          key={notification.id}
          notification={notification}
          isFading={fadingNotifications.has(notification.id)}
          onHide={hideNotification}
        />
      ))}
    </div>
  )
}

/**
 * Individual notification alert component
 */
interface NotificationAlertProps {
  notification: Notification
  isFading: boolean
  onHide: (id: string) => void
}

function NotificationAlert({ notification, isFading, onHide }: NotificationAlertProps) {
  const { id, type, message, options, workflowId } = notification
  const Icon = NotificationIcon[type]
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const { setDeploymentStatus } = useWorkflowStore()
  const { isDeployed } = useWorkflowStore((state) => ({
    isDeployed: state.isDeployed,
  }))

  const handleDeleteApi = async () => {
    if (!workflowId) return

    try {
      const response = await fetch(`/api/workflow/${workflowId}/deploy`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete API deployment')

      // Update deployment status in the store
      setDeploymentStatus(false)

      // Close the notification
      onHide(id)

      // Close the dialog
      setIsDeleteDialogOpen(false)
    } catch (error) {
      logger.error('Error deleting API deployment:', { error })
    }
  }

  return (
    <>
      <Alert
        className={cn(
          'transition-all duration-300 ease-in-out opacity-0 translate-y-[-100%]',
          isFading ? 'animate-notification-fade-out' : 'animate-notification-slide',
          NotificationColors[type]
        )}
      >
        {type === 'api' ? (
          // Special layout for API notifications with equal spacing
          <div className="flex items-start py-1 relative">
            {/* Left icon */}
            <div className="flex-shrink-0 mt-0.5">
              <Icon className="!text-[#7F2FFF] h-4 w-4" />
            </div>

            {/* Content area with equal margins */}
            <div className="flex-1 space-y-2 pt-[3.5px] mx-4 pr-4">
              <AlertTitle className="-mt-0.5">
                <span>API</span>
              </AlertTitle>

              <AlertDescription className="space-y-4">
                <p>{!isDeployed ? 'Workflow currently not deployed' : message}</p>

                {/* Optional sections with copyable content */}
                {options?.sections?.map((section, index) => (
                  <div key={index} className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">{section.label}</div>

                    {/* Copyable code block */}
                    <div className="relative group rounded-md border bg-muted/50 hover:bg-muted/80 transition-colors">
                      <pre className="p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto">
                        {section.content}
                      </pre>
                      <CopyButton text={section.content} />
                    </div>
                  </div>
                ))}

                {/* Status and Delete button row - with pulsing green indicator */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Status:</span>
                    <div className="flex items-center gap-1.5">
                      <div className="relative flex items-center justify-center">
                        {isDeployed ? (
                          <>
                            <div className="absolute h-3 w-3 rounded-full bg-green-500/20 animate-ping"></div>
                            <div className="relative h-2 w-2 rounded-full bg-green-500"></div>
                          </>
                        ) : (
                          <>
                            <div className="absolute h-3 w-3 rounded-full bg-red-500/20 animate-ping"></div>
                            <div className="relative h-2 w-2 rounded-full bg-red-500"></div>
                          </>
                        )}
                      </div>
                      <span
                        className={cn(
                          'text-xs font-medium',
                          isDeployed ? ApiStatusStyles.active : ApiStatusStyles.inactive
                        )}
                      >
                        {isDeployed ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2.5 text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setIsDeleteDialogOpen(true)}
                    disabled={!isDeployed}
                  >
                    Delete
                  </Button>
                </div>
              </AlertDescription>
            </div>

            {/* Absolute positioned close button in the top right */}
            {options?.isPersistent && (
              <div className="absolute top-0.5 right-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
                  onClick={() => onHide(id)}
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close</span>
                </Button>
              </div>
            )}
          </div>
        ) : (
          // Original layout for error and console notifications
          <div className="flex items-start gap-4 py-1">
            {/* Icon with proper vertical alignment */}
            <div className="flex-shrink-0 mt-0.5">
              <Icon
                className={cn('h-4 w-4', {
                  '!text-red-500 mt-[-3px]': type === 'error',
                  'text-foreground mt-[-3px]': type === 'console',
                })}
              />
            </div>

            {/* Content area with right margin for balance */}
            <div className="flex-1 space-y-2 mr-4">
              <AlertTitle className="flex items-center justify-between -mt-0.5">
                <span>{type === 'error' ? 'Error' : 'Console'}</span>

                {/* Close button for persistent notifications */}
                {options?.isPersistent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
                    onClick={() => onHide(id)}
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Close</span>
                  </Button>
                )}
              </AlertTitle>

              <AlertDescription className="space-y-4">
                {/* Message with auto-expanding and max height */}
                <p className="max-h-[300px] overflow-hidden break-words break-all whitespace-normal">
                  {message}
                </p>

                {/* Optional sections with copyable content */}
                {options?.sections?.map((section, index) => (
                  <div key={index} className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">{section.label}</div>

                    {/* Copyable code block with max height */}
                    <div className="relative group rounded-md border bg-muted/50 hover:bg-muted/80 transition-colors">
                      <pre className="p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-[300px]">
                        {section.content}
                      </pre>
                      <CopyButton text={section.content} />
                    </div>
                  </div>
                ))}
              </AlertDescription>
            </div>
          </div>
        )}
      </Alert>

      {/* Delete API confirmation dialog */}
      <DeleteApiConfirmation
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteApi}
        workflowId={workflowId}
      />
    </>
  )
}
