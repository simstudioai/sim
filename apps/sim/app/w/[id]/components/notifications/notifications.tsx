// NOTE: API NOTIFICATIONS NO LONGER EXIST, BUT IF YOU DELETE THEM FROM THIS FILE THE APPLICATION WILL BREAK
import { useEffect, useState } from 'react'
import { Info, Rocket, Store, Terminal, X } from 'lucide-react'
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
import { MAX_VISIBLE_NOTIFICATIONS, useNotificationStore } from '@/stores/notifications/store'
import type { Notification } from '@/stores/notifications/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('Notifications')

// Constants
const FADE_DURATION = 500 // Fade out over 500ms

// Define keyframes for the animations in a style tag
const AnimationStyles = () => (
  <style jsx global>{`
    @keyframes notification-slide {
      0% {
        opacity: 0;
        transform: translateY(-100%);
      }
      100% {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes notification-fade-out {
      0% {
        opacity: 1;
        transform: translateY(0);
      }
      100% {
        opacity: 0;
        transform: translateY(-10%);
      }
    }

    @keyframes notification-slide-up {
      0% {
        transform: translateY(0);
      }
      100% {
        transform: translateY(-100%);
      }
    }

    .animate-notification-slide {
      animation: notification-slide 300ms ease forwards;
    }

    .animate-notification-fade-out {
      animation: notification-fade-out ${FADE_DURATION}ms ease forwards;
    }

    .animate-notification-slide-up {
      animation: notification-slide-up 300ms ease forwards;
    }

    .notification-container {
      transition:
        height 300ms ease,
        opacity 300ms ease,
        transform 300ms ease;
    }
  `}</style>
)

// Icon mapping for notification types
const NotificationIcon = {
  error: ErrorIcon,
  console: Terminal,
  api: Rocket,
  marketplace: Store,
  info: Info,
}

// Color schemes for different notification types
const NotificationColors = {
  error:
    'border-red-500 bg-red-50 text-destructive dark:border-border dark:text-foreground dark:bg-background',
  console:
    'border-border bg-background text-foreground dark:border-border dark:text-foreground dark:bg-background',
  api: 'border-border bg-background text-foreground dark:border-border dark:text-foreground dark:bg-background',
  marketplace:
    'border-border bg-background text-foreground dark:border-border dark:text-foreground dark:bg-background',
  info: 'border-border bg-background text-foreground dark:border-border dark:text-foreground dark:bg-background',
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
      <AlertDialogContent className='z-[100]'>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete API Deployment</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this API deployment? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className='bg-red-600 hover:bg-red-700'>
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
  const {
    notifications,
    hideNotification,
    markAsRead,
    removeNotification,
    setNotificationFading,
    getVisibleNotificationCount,
  } = useNotificationStore()
  const { activeWorkflowId } = useWorkflowRegistry()

  // Local state
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set())

  // Filter to only show:
  // 1. Visible notifications for the current workflow
  // 2. That are either unread OR marked as persistent
  // 3. And have not been marked for removal
  const visibleNotifications = notifications.filter(
    (n) =>
      n.isVisible &&
      n.workflowId === activeWorkflowId &&
      (!n.read || n.options?.isPersistent) &&
      !removedIds.has(n.id)
  )

  // Check if we're over the limit of visible notifications
  const visibleCount = activeWorkflowId ? getVisibleNotificationCount(activeWorkflowId) : 0
  const _isOverLimit = visibleCount > MAX_VISIBLE_NOTIFICATIONS

  // Reset removedIds whenever a notification's visibility changes from false to true
  useEffect(() => {
    const newlyVisibleNotifications = notifications.filter(
      (n) => n.isVisible && removedIds.has(n.id)
    )

    if (newlyVisibleNotifications.length > 0) {
      setRemovedIds((prev) => {
        const next = new Set(prev)
        newlyVisibleNotifications.forEach((n) => next.delete(n.id))
        return next
      })
    }
  }, [notifications, removedIds])

  // Handle fading notifications created by the store
  useEffect(() => {
    // This effect watches for notifications that are fading
    // and handles the DOM removal after animation completes

    const timers: Record<string, ReturnType<typeof setTimeout>> = {}

    visibleNotifications.forEach((notification) => {
      // For notifications that have started fading, set up cleanup timers
      if (notification.isFading && !animatingIds.has(notification.id)) {
        // Start slide up animation after fade animation
        const slideTimer = setTimeout(() => {
          setAnimatingIds((prev) => new Set([...prev, notification.id]))

          // After slide animation, remove from DOM
          setTimeout(() => {
            hideNotification(notification.id)
            markAsRead(notification.id)
            setRemovedIds((prev) => new Set([...prev, notification.id]))

            // Remove from animating set
            setAnimatingIds((prev) => {
              const next = new Set(prev)
              next.delete(notification.id)
              return next
            })
          }, 300)
        }, FADE_DURATION)

        timers[notification.id] = slideTimer
      }
    })

    return () => {
      Object.values(timers).forEach(clearTimeout)
    }
  }, [visibleNotifications, animatingIds, hideNotification, markAsRead])

  // Early return if no notifications to show
  if (visibleNotifications.length === 0) return null

  return (
    <>
      <AnimationStyles />
      <div
        className='pointer-events-none absolute left-1/2 z-[60] w-full max-w-lg space-y-2'
        style={{
          top: '30px',
          transform: 'translateX(-50%)',
        }}
      >
        {visibleNotifications.map((notification) => (
          <div
            key={notification.id}
            className={cn(
              'notification-container',
              animatingIds.has(notification.id) && 'animate-notification-slide-up'
            )}
          >
            <NotificationAlert
              notification={notification}
              isFading={notification.isFading ?? false}
              onHide={(id) => {
                // For persistent notifications like API, just hide immediately without animations
                if (notification.options?.isPersistent) {
                  hideNotification(id)
                  markAsRead(id)
                  setRemovedIds((prev) => new Set([...prev, id]))
                  return
                }

                // For regular notifications, use the animation sequence
                // Start the fade out animation when manually closing
                setNotificationFading(id)

                // Start slide up animation after fade completes
                setTimeout(() => {
                  setAnimatingIds((prev) => new Set([...prev, id]))
                }, FADE_DURATION)

                // Remove from DOM after all animations complete
                setTimeout(() => {
                  hideNotification(id)
                  markAsRead(id)
                  setRemovedIds((prev) => new Set([...prev, id]))
                  setAnimatingIds((prev) => {
                    const next = new Set(prev)
                    next.delete(id)
                    return next
                  })
                }, FADE_DURATION + 300) // Fade + slide durations
              }}
            />
          </div>
        ))}
      </div>
    </>
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

export function NotificationAlert({ notification, isFading, onHide }: NotificationAlertProps) {
  const { id, type, message, options, workflowId } = notification
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const { setDeploymentStatus } = useWorkflowRegistry()

  // Get deployment status from registry using notification's workflowId, not activeWorkflowId
  const deploymentStatus = useWorkflowRegistry((state) =>
    state.getWorkflowDeploymentStatus(workflowId || null)
  )
  const isDeployed = deploymentStatus?.isDeployed || false

  // Create a function to clear the redeployment flag and update deployment status
  const updateDeploymentStatus = (isDeployed: boolean, deployedAt?: Date) => {
    // Update deployment status in workflow store
    setDeploymentStatus(workflowId || null, isDeployed, deployedAt)

    // Manually update the needsRedeployment flag in workflow store
    useWorkflowStore.getState().setNeedsRedeploymentFlag(false)
  }

  const Icon = NotificationIcon[type]

  const handleDeleteApi = async () => {
    if (!workflowId) return

    try {
      const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete API deployment')

      // Update deployment status in the store
      updateDeploymentStatus(false)

      // Close the notification
      onHide(id)

      // Close the dialog
      setIsDeleteDialogOpen(false)
    } catch (error) {
      logger.error('Error deleting API deployment:', { error })
    }
  }

  // Function to mask API key with asterisks but keep first and last 4 chars visible
  const maskApiKey = (key: string) => {
    if (!key || key.includes('No API key found')) return key
    if (key.length <= 8) return key
    return `${key.substring(0, 4)}${'*'.repeat(key.length - 8)}${key.substring(key.length - 4)}`
  }

  // Modify the curl command to use a placeholder for the API key
  const formatCurlCommand = (command: string, apiKey: string) => {
    if (!command.includes('curl')) return command

    // Replace the actual API key with a placeholder in the command
    const sanitizedCommand = command.replace(apiKey, 'SIM_API_KEY')

    // Format the command with line breaks for better readability
    return sanitizedCommand
      .replace(' -H ', '\n  -H ')
      .replace(' -d ', '\n  -d ')
      .replace(' http', '\n  http')
  }

  return (
    <>
      <Alert
        className={cn(
          'pointer-events-auto translate-y-[-100%] opacity-0 transition-all duration-300 ease-in-out',
          isFading
            ? 'pointer-events-none animate-notification-fade-out'
            : 'animate-notification-slide',
          NotificationColors[type]
        )}
      >
        {type === 'api' ? (
          // Special layout for API notifications with equal spacing
          <div className='relative flex items-start py-1'>
            {/* Left icon */}
            <div className='mt-0.5 flex-shrink-0'>
              <Icon className='!text-[#802FFF] h-4 w-4' />
            </div>

            {/* Content area with equal margins */}
            <div className='mx-4 flex-1 space-y-2 pt-[3.5px] pr-4'>
              <AlertTitle className='-mt-0.5'>
                <span>API</span>
              </AlertTitle>

              <AlertDescription className='space-y-4'>
                <p>{!isDeployed ? 'Workflow currently not deployed' : message}</p>

                {/* Optional sections with copyable content */}
                {options?.sections?.map((section, index) => {
                  // Get the API key from the sections to use in curl command formatting
                  const apiKey =
                    options.sections?.find((s) => s.label === 'x-api-key')?.content || ''

                  return (
                    <div key={index} className='space-y-1.5'>
                      <div className='font-medium text-muted-foreground text-xs'>
                        {section.label}
                      </div>

                      {/* Copyable code block */}
                      <div className='group relative rounded-md border bg-muted/50 transition-colors hover:bg-muted/80'>
                        {section.label === 'x-api-key' ? (
                          <>
                            <pre
                              className='cursor-pointer overflow-x-auto whitespace-pre-wrap p-3 font-mono text-xs'
                              onClick={() => setShowApiKey(!showApiKey)}
                              title={
                                showApiKey ? 'Click to hide API Key' : 'Click to reveal API Key'
                              }
                            >
                              {showApiKey ? section.content : maskApiKey(section.content)}
                            </pre>
                            <div className='overflow-x-auto whitespace-pre-wrap font-mono text-xs'>
                              <CopyButton text={section.content} showLabel={false} />
                            </div>
                          </>
                        ) : section.label === 'Example curl command' ? (
                          <>
                            <pre className='overflow-x-auto whitespace-pre-wrap p-3 font-mono text-xs'>
                              {formatCurlCommand(section.content, apiKey)}
                            </pre>
                            <CopyButton text={section.content} showLabel={false} />
                          </>
                        ) : (
                          <>
                            <pre className='overflow-x-auto whitespace-pre-wrap p-3 font-mono text-xs'>
                              {section.content}
                            </pre>
                            <CopyButton text={section.content} showLabel={false} />
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* Status and Delete button row - with pulsing green indicator */}
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <span className='font-medium text-muted-foreground text-xs'>Status:</span>
                    <div className='flex items-center gap-1.5'>
                      <div className='relative flex items-center justify-center'>
                        {isDeployed ? (
                          options?.needsRedeployment ? (
                            <>
                              <div className='absolute h-3 w-3 animate-ping rounded-full bg-amber-500/20' />
                              <div className='relative h-2 w-2 rounded-full bg-amber-500' />
                            </>
                          ) : (
                            <>
                              <div className='absolute h-3 w-3 animate-ping rounded-full bg-green-500/20' />
                              <div className='relative h-2 w-2 rounded-full bg-green-500' />
                            </>
                          )
                        ) : (
                          <>
                            <div className='absolute h-3 w-3 animate-ping rounded-full bg-red-500/20' />
                            <div className='relative h-2 w-2 rounded-full bg-red-500' />
                          </>
                        )}
                      </div>
                      <span
                        className={cn(
                          'font-medium text-xs',
                          isDeployed
                            ? options?.needsRedeployment
                              ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400'
                              : ApiStatusStyles.active
                            : ApiStatusStyles.inactive
                        )}
                      >
                        {isDeployed
                          ? options?.needsRedeployment
                            ? 'Changes Detected'
                            : 'Active'
                          : 'Inactive'}
                      </span>
                    </div>
                  </div>
                  <div className='flex gap-2'>
                    {options?.needsRedeployment && (
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-7 px-2.5 font-medium text-muted-foreground text-xs hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/20 dark:hover:text-amber-400'
                        onClick={async () => {
                          if (!workflowId) return

                          try {
                            // Call the deploy endpoint to redeploy the workflow
                            const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
                              method: 'POST',
                            })

                            if (!response.ok) throw new Error('Failed to redeploy workflow')

                            // Get the response data
                            const data = await response.json()

                            // Update deployment status in the store (resets needsRedeployment flag)
                            updateDeploymentStatus(
                              data.isDeployed,
                              data.deployedAt ? new Date(data.deployedAt) : undefined
                            )

                            // First close this notification
                            onHide(id)

                            // Show a temporary success notification without creating another API notification
                            useNotificationStore
                              .getState()
                              .addNotification(
                                'info',
                                'Workflow successfully redeployed',
                                workflowId,
                                { isPersistent: false }
                              )
                          } catch (error) {
                            logger.error('Error redeploying workflow:', { error })
                          }
                        }}
                      >
                        Redeploy
                      </Button>
                    )}
                    {isDeployed && (
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-7 px-2.5 font-medium text-muted-foreground text-xs hover:bg-destructive/10 hover:text-destructive'
                        onClick={() => setIsDeleteDialogOpen(true)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              </AlertDescription>
            </div>

            {/* Absolute positioned close button in the top right */}
            {options?.isPersistent && (
              <div className='absolute top-0.5 right-1'>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-6 w-6 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground'
                  onClick={() => onHide(id)}
                >
                  <X className='h-4 w-4' />
                  <span className='sr-only'>Close</span>
                </Button>
              </div>
            )}
          </div>
        ) : (
          // Original layout for error, console and marketplace notifications
          <div className='flex items-start gap-4 py-1'>
            {/* Icon with proper vertical alignment */}
            <div className='mt-0.5 flex-shrink-0'>
              <Icon
                className={cn('h-4 w-4', {
                  '!text-red-500 mt-[-3px]': type === 'error',
                  'mt-[-4px] text-foreground': type === 'console' || type === 'info',
                  'text-foreground': type === 'marketplace',
                })}
              />
            </div>

            {/* Content area with right margin for balance */}
            <div className='mr-4 flex-1 space-y-2'>
              <AlertTitle className='-mt-0.5 flex items-center justify-between'>
                <span>
                  {type === 'error'
                    ? 'Error'
                    : type === 'marketplace'
                      ? 'Marketplace'
                      : type === 'info'
                        ? 'Info'
                        : 'Console'}
                </span>

                {/* Close button for persistent notifications */}
                {options?.isPersistent && (
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 w-6 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground'
                    onClick={() => onHide(id)}
                  >
                    <X className='h-4 w-4' />
                    <span className='sr-only'>Close</span>
                  </Button>
                )}
              </AlertTitle>

              <AlertDescription className='space-y-4'>
                {/* Message with auto-expanding and max height */}
                <p className='max-h-[300px] overflow-hidden whitespace-normal break-words break-all'>
                  {message}
                </p>

                {/* Optional sections with copyable content */}
                {options?.sections?.map((section, index) => (
                  <div key={index} className='space-y-1.5'>
                    <div className='font-medium text-muted-foreground text-xs'>{section.label}</div>

                    {/* Copyable code block with max height */}
                    <div className='group relative rounded-md border bg-muted/50 transition-colors hover:bg-muted/80'>
                      <pre className='max-h-[300px] overflow-x-auto whitespace-pre-wrap p-3 font-mono text-xs'>
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
