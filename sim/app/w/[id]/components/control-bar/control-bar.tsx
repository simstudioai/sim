'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Bell, History, Loader2, Play, Rocket, Store, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/stores/notifications/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useWorkflowExecution } from '../../hooks/use-workflow-execution'
import { HistoryDropdownItem } from './components/history-dropdown-item/history-dropdown-item'
import { MarketplaceModal } from './components/marketplace-modal/marketplace-modal'
import { NotificationDropdownItem } from './components/notification-dropdown-item/notification-dropdown-item'

const logger = createLogger('ControlBar')

/**
 * Control bar for managing workflows - handles editing, deletion, deployment,
 * history, notifications and execution.
 */
export function ControlBar() {
  const router = useRouter()

  // Store hooks
  const { notifications, getWorkflowNotifications, addNotification, showNotification } =
    useNotificationStore()
  const {
    history,
    revertToHistoryState,
    lastSaved,
    isDeployed,
    isPublished,
    setDeploymentStatus,
    setPublishStatus,
  } = useWorkflowStore()
  const { workflows, updateWorkflow, activeWorkflowId, removeWorkflow } = useWorkflowRegistry()
  const { isExecuting, handleRunWorkflow } = useWorkflowExecution()

  // Local state
  const [mounted, setMounted] = useState(false)
  const [, forceUpdate] = useState({})

  // Workflow name editing state
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState('')

  // Dropdown states
  const [historyOpen, setHistoryOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)

  // Status states
  const [isDeploying, setIsDeploying] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)

  // Marketplace modal state
  const [isMarketplaceModalOpen, setIsMarketplaceModalOpen] = useState(false)

  // Get notifications for current workflow
  const workflowNotifications = activeWorkflowId
    ? getWorkflowNotifications(activeWorkflowId)
    : notifications // Show all if no workflow is active

  // Client-side only rendering for the timestamp
  useEffect(() => {
    setMounted(true)
  }, [])

  // Update the time display every minute
  useEffect(() => {
    const interval = setInterval(() => forceUpdate({}), 60000)
    return () => clearInterval(interval)
  }, [])

  // Check deployment and publication status on mount or when activeWorkflowId changes
  useEffect(() => {
    async function checkStatus() {
      if (!activeWorkflowId) return

      // Skip API call in localStorage mode
      if (
        typeof window !== 'undefined' &&
        (localStorage.getItem('USE_LOCAL_STORAGE') === 'true' ||
          process.env.NEXT_PUBLIC_USE_LOCAL_STORAGE === 'true' ||
          process.env.NEXT_PUBLIC_DISABLE_DB_SYNC === 'true')
      ) {
        // For localStorage mode, we already have the status in the workflow store
        // Nothing more to do as the useWorkflowStore already has this information
        return
      }

      try {
        const response = await fetch(`/api/workflow/${activeWorkflowId}/status`)
        if (response.ok) {
          const data = await response.json()
          // Update the store with the status from the API
          setDeploymentStatus(
            data.isDeployed,
            data.deployedAt ? new Date(data.deployedAt) : undefined
          )
          setPublishStatus(data.isPublished)
        }
      } catch (error) {
        logger.error('Failed to check workflow status:', { error })
      }
    }
    checkStatus()
  }, [activeWorkflowId, setDeploymentStatus, setPublishStatus])

  /**
   * Workflow name handlers
   */
  const handleNameClick = () => {
    if (activeWorkflowId) {
      setEditedName(workflows[activeWorkflowId].name)
      setIsEditing(true)
    }
  }

  const handleNameSubmit = () => {
    if (activeWorkflowId) {
      const trimmedName = editedName.trim()
      if (trimmedName && trimmedName !== workflows[activeWorkflowId].name) {
        updateWorkflow(activeWorkflowId, { name: trimmedName })
      }
      setIsEditing(false)
    }
  }

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSubmit()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
    }
  }

  /**
   * Workflow deletion handler
   */
  const handleDeleteWorkflow = () => {
    if (!activeWorkflowId) return

    // Get remaining workflow IDs
    const remainingIds = Object.keys(workflows).filter((id) => id !== activeWorkflowId)

    // Navigate before removing the workflow to avoid any state inconsistencies
    if (remainingIds.length > 0) {
      router.push(`/w/${remainingIds[0]}`)
    } else {
      router.push('/')
    }

    // Remove the workflow from the registry
    removeWorkflow(activeWorkflowId)
  }

  /**
   * Workflow deployment handler
   */
  const handleDeploy = async () => {
    if (!activeWorkflowId) return

    // If already deployed, show the existing deployment info instead of redeploying
    if (isDeployed) {
      // Find existing API notification for this workflow
      const apiNotification = workflowNotifications.find(
        (n) => n.type === 'api' && n.workflowId === activeWorkflowId
      )

      if (apiNotification) {
        // Show the existing notification
        showNotification(apiNotification.id)
        return
      }

      // If notification not found but workflow is deployed, fetch deployment info
      try {
        setIsDeploying(true)

        const response = await fetch(`/api/workflow/${activeWorkflowId}/deploy/info`)
        if (!response.ok) throw new Error('Failed to fetch deployment info')

        const { apiKey } = await response.json()
        const endpoint = `${process.env.NEXT_PUBLIC_APP_URL}/api/workflow/${activeWorkflowId}/execute`

        // Create a new notification with the deployment info
        addNotification('api', 'Workflow deployment information', activeWorkflowId, {
          isPersistent: true,
          sections: [
            {
              label: 'API Endpoint',
              content: endpoint,
            },
            {
              label: 'API Key',
              content: apiKey,
            },
            {
              label: 'Example curl command',
              content: `curl -X POST -H "X-API-Key: ${apiKey}" -H "Content-Type: application/json" ${endpoint}`,
            },
          ],
        })
      } catch (error) {
        addNotification('error', 'Failed to fetch deployment information', activeWorkflowId)
      } finally {
        setIsDeploying(false)
      }
      return
    }

    // If not deployed, proceed with deployment
    try {
      setIsDeploying(true)

      const response = await fetch(`/api/workflow/${activeWorkflowId}/deploy`, {
        method: 'POST',
      })

      if (!response.ok) throw new Error('Failed to deploy workflow')

      const { apiKey, isDeployed: newDeployStatus, deployedAt } = await response.json()
      const endpoint = `${process.env.NEXT_PUBLIC_APP_URL}/api/workflow/${activeWorkflowId}/execute`

      // Update the store with the deployment status
      setDeploymentStatus(newDeployStatus, deployedAt ? new Date(deployedAt) : undefined)

      addNotification('api', 'Workflow successfully deployed', activeWorkflowId, {
        isPersistent: true,
        sections: [
          {
            label: 'API Endpoint',
            content: endpoint,
          },
          {
            label: 'API Key',
            content: apiKey,
          },
          {
            label: 'Example curl command',
            content: `curl -X POST -H "X-API-Key: ${apiKey}" -H "Content-Type: application/json" ${endpoint}`,
          },
        ],
      })
    } catch (error) {
      addNotification('error', 'Failed to deploy workflow. Please try again.', activeWorkflowId)
    } finally {
      setIsDeploying(false)
    }
  }

  /**
   * Handle opening marketplace modal or showing published status
   */
  const handlePublishWorkflow = async () => {
    if (!activeWorkflowId) return

    // If already published, show marketplace modal with info instead of notifications
    if (isPublished) {
      setIsMarketplaceModalOpen(true)
      return
    }

    // If not published, open the modal to start the publishing process
    setIsMarketplaceModalOpen(true)
  }

  /**
   * Render workflow name section (editable/non-editable)
   */
  const renderWorkflowName = () => (
    <div className="flex flex-col gap-[2px]">
      {isEditing ? (
        <input
          type="text"
          value={editedName}
          onChange={(e) => setEditedName(e.target.value)}
          onBlur={handleNameSubmit}
          onKeyDown={handleNameKeyDown}
          autoFocus
          className="font-semibold text-sm bg-transparent border-none outline-none p-0 w-[200px]"
        />
      ) : (
        <h2
          className="font-semibold text-sm hover:text-muted-foreground w-fit"
          onClick={handleNameClick}
        >
          {activeWorkflowId ? workflows[activeWorkflowId]?.name : 'Workflow'}
        </h2>
      )}
      {mounted && (
        <p className="text-xs text-muted-foreground">
          Saved{' '}
          {formatDistanceToNow(lastSaved || Date.now(), {
            addSuffix: true,
          })}
        </p>
      )}
    </div>
  )

  /**
   * Render delete workflow button with confirmation dialog
   */
  const renderDeleteButton = () => (
    <AlertDialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={Object.keys(workflows).length <= 1}
              className="hover:text-red-600"
            >
              <Trash2 className="h-5 w-5" />
              <span className="sr-only">Delete Workflow</span>
            </Button>
          </AlertDialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Delete Workflow</TooltipContent>
      </Tooltip>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Workflow</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this workflow? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDeleteWorkflow} className="bg-red-600 hover:bg-red-700">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  /**
   * Render deploy button with tooltip
   */
  const renderDeployButton = () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDeploy}
          disabled={isDeploying}
          className={cn('hover:text-[#7F2FFF]', isDeployed && 'text-[#7F2FFF]')}
        >
          {isDeploying ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Rocket className="h-5 w-5" />
          )}
          <span className="sr-only">Deploy API</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isDeploying ? 'Deploying...' : isDeployed ? 'Deployed' : 'Deploy as API'}
      </TooltipContent>
    </Tooltip>
  )

  /**
   * Render history dropdown
   */
  const renderHistoryDropdown = () => (
    <DropdownMenu open={historyOpen} onOpenChange={setHistoryOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <History />
              <span className="sr-only">Version History</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {!historyOpen && <TooltipContent>History</TooltipContent>}
      </Tooltip>

      {history.past.length === 0 && history.future.length === 0 ? (
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem className="text-sm text-muted-foreground">
            No history available
          </DropdownMenuItem>
        </DropdownMenuContent>
      ) : (
        <DropdownMenuContent align="end" className="w-60 max-h-[300px] overflow-y-auto">
          <>
            {[...history.future].reverse().map((entry, index) => (
              <HistoryDropdownItem
                key={`future-${entry.timestamp}-${index}`}
                action={entry.action}
                timestamp={entry.timestamp}
                onClick={() =>
                  revertToHistoryState(
                    history.past.length + 1 + (history.future.length - 1 - index)
                  )
                }
                isFuture={true}
              />
            ))}
            <HistoryDropdownItem
              key={`current-${history.present.timestamp}`}
              action={history.present.action}
              timestamp={history.present.timestamp}
              isCurrent={true}
              onClick={() => {}}
            />
            {[...history.past].reverse().map((entry, index) => (
              <HistoryDropdownItem
                key={`past-${entry.timestamp}-${index}`}
                action={entry.action}
                timestamp={entry.timestamp}
                onClick={() => revertToHistoryState(history.past.length - 1 - index)}
              />
            ))}
          </>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )

  /**
   * Render notifications dropdown
   */
  const renderNotificationsDropdown = () => (
    <DropdownMenu open={notificationsOpen} onOpenChange={setNotificationsOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <Bell />
              <span className="sr-only">Notifications</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {!notificationsOpen && <TooltipContent>Notifications</TooltipContent>}
      </Tooltip>

      {workflowNotifications.length === 0 ? (
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem className="text-sm text-muted-foreground">
            No new notifications
          </DropdownMenuItem>
        </DropdownMenuContent>
      ) : (
        <DropdownMenuContent align="end" className="w-60 max-h-[300px] overflow-y-auto">
          {[...workflowNotifications]
            .sort((a, b) => b.timestamp - a.timestamp)
            .map((notification) => (
              <NotificationDropdownItem
                key={notification.id}
                id={notification.id}
                type={notification.type}
                message={notification.message}
                timestamp={notification.timestamp}
                options={notification.options}
              />
            ))}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )

  /**
   * Render publish button
   */
  const renderPublishButton = () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={handlePublishWorkflow}
          disabled={isPublishing}
          className={cn('hover:text-[#7F2FFF]', isPublished && 'text-[#7F2FFF]')}
        >
          {isPublishing ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Store className="h-5 w-5" />
          )}
          <span className="sr-only">Publish to Marketplace</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isPublishing
          ? 'Publishing...'
          : isPublished
            ? 'Published to Marketplace'
            : 'Publish to Marketplace'}
      </TooltipContent>
    </Tooltip>
  )

  /**
   * Render run workflow button
   */
  const renderRunButton = () => (
    <Button
      className={cn(
        // Base styles
        'gap-2 ml-1 font-medium',
        // Brand color with hover states
        'bg-[#7F2FFF] hover:bg-[#7028E6]',
        // Hover effect with brand color
        'shadow-[0_0_0_0_#7F2FFF] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
        // Text color and transitions
        'text-white transition-all duration-200',
        // Running state animation
        isExecuting &&
          'relative after:absolute after:inset-0 after:animate-pulse after:bg-white/20',
        // Disabled state
        'disabled:opacity-50 disabled:hover:bg-[#7F2FFF] disabled:hover:shadow-none'
      )}
      onClick={handleRunWorkflow}
      disabled={isExecuting}
    >
      <Play className={cn('h-3.5 w-3.5', 'fill-current stroke-current')} />
      {isExecuting ? 'Running' : 'Run'}
    </Button>
  )

  return (
    <div className="flex h-16 w-full items-center justify-between bg-background px-6 border-b transition-all duration-300">
      {/* Left Section - Workflow Info */}
      {renderWorkflowName()}

      {/* Middle Section - Reserved for future use */}
      <div className="flex-1" />

      {/* Right Section - Actions */}
      <div className="flex items-center gap-2">
        {renderDeleteButton()}
        {renderHistoryDropdown()}
        {renderNotificationsDropdown()}
        {renderPublishButton()}
        {renderDeployButton()}
        {renderRunButton()}

        {/* Add the marketplace modal */}
        <MarketplaceModal open={isMarketplaceModalOpen} onOpenChange={setIsMarketplaceModalOpen} />
      </div>
    </div>
  )
}
