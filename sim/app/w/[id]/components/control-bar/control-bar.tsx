'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import {
  Bell,
  Bug,
  ChevronDown,
  History,
  Loader2,
  Play,
  Rocket,
  SkipForward,
  StepForward,
  Store,
  Trash2,
  X,
} from 'lucide-react'
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
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useExecutionStore } from '@/stores/execution/store'
import { useNotificationStore } from '@/stores/notifications/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useWorkflowExecution } from '../../hooks/use-workflow-execution'
import { HistoryDropdownItem } from './components/history-dropdown-item/history-dropdown-item'
import { MarketplaceModal } from './components/marketplace-modal/marketplace-modal'
import { NotificationDropdownItem } from './components/notification-dropdown-item/notification-dropdown-item'

const logger = createLogger('ControlBar')

// Predefined run count options
const RUN_COUNT_OPTIONS = [1, 5, 10, 25, 50, 100]

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

  // Debug mode state
  const { isDebugModeEnabled, toggleDebugMode } = useGeneralStore()
  const { isDebugging, pendingBlocks, handleStepDebug, handleCancelDebug, handleResumeDebug } =
    useWorkflowExecution()

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

  // Multiple runs state
  const [runCount, setRunCount] = useState(1)
  const [completedRuns, setCompletedRuns] = useState(0)
  const [isMultiRunning, setIsMultiRunning] = useState(false)
  const [showRunProgress, setShowRunProgress] = useState(false)

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
        const response = await fetch(`/api/workflows/${activeWorkflowId}/status`)
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

    // If already deployed, show the API info
    if (isDeployed) {
      // Try to find an existing API notification
      const apiNotification = notifications.find(
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

        const response = await fetch(`/api/workflows/${activeWorkflowId}/deploy`)
        if (!response.ok) throw new Error('Failed to fetch deployment info')

        const { apiKey } = await response.json()
        const endpoint = `${process.env.NEXT_PUBLIC_APP_URL}/api/workflows/${activeWorkflowId}/execute`

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
              content: apiKey || 'No API key found. Visit your account settings to create one.',
            },
            {
              label: 'Example curl command',
              content: apiKey
                ? `curl -X POST -H "X-API-Key: ${apiKey}" -H "Content-Type: application/json" ${endpoint}`
                : `You need an API key to call this endpoint. Visit your account settings to create one.`,
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

      const response = await fetch(`/api/workflows/${activeWorkflowId}/deploy`, {
        method: 'POST',
      })

      if (!response.ok) throw new Error('Failed to deploy workflow')

      const { apiKey, isDeployed: newDeployStatus, deployedAt } = await response.json()
      const endpoint = `${process.env.NEXT_PUBLIC_APP_URL}/api/workflows/${activeWorkflowId}/execute`

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
            content: apiKey || 'No API key found. Visit your account settings to create one.',
          },
          {
            label: 'Example curl command',
            content: apiKey
              ? `curl -X POST -H "X-API-Key: ${apiKey}" -H "Content-Type: application/json" ${endpoint}`
              : `You need an API key to call this endpoint. Visit your account settings to create one.`,
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
   * Handle multiple workflow runs
   */
  const handleMultipleRuns = async () => {
    if (isExecuting || isMultiRunning || runCount <= 0) return

    // Reset state for a new batch of runs
    setCompletedRuns(0)
    setIsMultiRunning(true)
    setShowRunProgress(runCount > 1)

    let result = null
    let workflowError = null

    try {
      // Run the workflow multiple times sequentially
      for (let i = 0; i < runCount; i++) {
        await handleRunWorkflow()
        setCompletedRuns(i + 1)
      }

      // Update workflow stats after all runs are complete
      if (activeWorkflowId) {
        const response = await fetch(`/api/workflows/${activeWorkflowId}/stats?runs=${runCount}`, {
          method: 'POST',
        })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error(`Failed to update workflow stats: ${JSON.stringify(errorData)}`)
          throw new Error('Failed to update workflow stats')
        }
      }
    } catch (error) {
      workflowError = error
      logger.error('Error during multiple workflow runs:', { error })
    } finally {
      setIsMultiRunning(false)
      // Keep progress visible for a moment after completion
      if (runCount > 1) {
        setTimeout(() => setShowRunProgress(false), 2000)
      }

      // Show notification after state is updated
      if (workflowError) {
        addNotification('error', 'Failed to complete all workflow runs', activeWorkflowId)
      }
    }
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
  const renderNotificationsDropdown = () => {
    // Ensure we're only showing notifications for the current workflow
    const currentWorkflowNotifications = activeWorkflowId
      ? notifications.filter((n) => n.workflowId === activeWorkflowId)
      : []

    return (
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

        {currentWorkflowNotifications.length === 0 ? (
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem className="text-sm text-muted-foreground">
              No new notifications
            </DropdownMenuItem>
          </DropdownMenuContent>
        ) : (
          <DropdownMenuContent align="end" className="w-60 max-h-[300px] overflow-y-auto">
            {[...currentWorkflowNotifications]
              .sort((a, b) => b.timestamp - a.timestamp)
              .map((notification) => (
                <NotificationDropdownItem
                  key={notification.id}
                  id={notification.id}
                  type={notification.type}
                  message={notification.message}
                  timestamp={notification.timestamp}
                  options={notification.options}
                  setDropdownOpen={setNotificationsOpen}
                />
              ))}
          </DropdownMenuContent>
        )}
      </DropdownMenu>
    )
  }

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
   * Render debug mode controls
   */
  const renderDebugControls = () => {
    // Display debug controls only when in debug mode and actively debugging
    if (!isDebugModeEnabled || !isDebugging) return null

    const pendingCount = pendingBlocks.length

    return (
      <div className="flex items-center gap-2 ml-2 bg-muted rounded-md px-2 py-1">
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">Debug Mode</span>
          <span className="text-xs font-medium">
            {pendingCount} block{pendingCount !== 1 ? 's' : ''} pending
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={handleStepDebug}
              className="h-8 w-8 bg-background"
              disabled={pendingCount === 0}
            >
              <StepForward className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Step Forward</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={handleResumeDebug}
              className="h-8 w-8 bg-background"
              disabled={pendingCount === 0}
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Resume Until End</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={handleCancelDebug}
              className="h-8 w-8 bg-background"
            >
              <X className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Cancel Debugging</TooltipContent>
        </Tooltip>
      </div>
    )
  }

  /**
   * Render debug mode toggle button
   */
  const renderDebugModeToggle = () => {
    const handleToggleDebugMode = () => {
      // If turning off debug mode, make sure to clean up any debug state
      if (isDebugModeEnabled) {
        // Only clean up if we're not actively executing
        if (!isExecuting) {
          useExecutionStore.getState().setIsDebugging(false)
          useExecutionStore.getState().setPendingBlocks([])
        }
      }
      toggleDebugMode()
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleToggleDebugMode}
            disabled={isExecuting || isMultiRunning}
            className={cn(isDebugModeEnabled && 'text-amber-500')}
          >
            <Bug className="h-5 w-5" />
            <span className="sr-only">Toggle Debug Mode</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isDebugModeEnabled ? 'Disable Debug Mode' : 'Enable Debug Mode'}
        </TooltipContent>
      </Tooltip>
    )
  }

  /**
   * Render run workflow button with multi-run dropdown
   */
  const renderRunButton = () => (
    <div className="flex items-center">
      {showRunProgress && (
        <div className="mr-3 w-28">
          <Progress value={(completedRuns / runCount) * 100} className="h-2 bg-muted" />
          <p className="text-xs text-muted-foreground mt-1 text-center">
            {completedRuns}/{runCount} runs
          </p>
        </div>
      )}

      {/* Show how many blocks have been executed in debug mode if debugging */}
      {isDebugging && (
        <div className="mr-3 min-w-28 px-1 py-0.5 bg-muted rounded">
          <div className="text-xs text-muted-foreground text-center">
            <span className="font-medium">Debugging Mode</span>
          </div>
        </div>
      )}

      {renderDebugControls()}

      <div className="flex ml-1">
        {/* Main Run Button */}
        <Button
          className={cn(
            'gap-2 font-medium',
            'bg-[#7F2FFF] hover:bg-[#7028E6]',
            'shadow-[0_0_0_0_#7F2FFF] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
            'text-white transition-all duration-200',
            (isExecuting || isMultiRunning) &&
              'relative after:absolute after:inset-0 after:animate-pulse after:bg-white/20',
            'disabled:opacity-50 disabled:hover:bg-[#7F2FFF] disabled:hover:shadow-none',
            isDebugModeEnabled
              ? 'rounded py-2 px-4 h-10'
              : 'rounded-r-none border-r border-r-[#6420cc] py-2 px-4 h-10'
          )}
          onClick={isDebugModeEnabled ? handleRunWorkflow : handleMultipleRuns}
          disabled={isExecuting || isMultiRunning}
        >
          {isDebugModeEnabled ? (
            <Bug className={cn('h-3.5 w-3.5 mr-1.5', 'fill-current stroke-current')} />
          ) : (
            <Play className={cn('h-3.5 w-3.5', 'fill-current stroke-current')} />
          )}
          {isMultiRunning
            ? `Running ${completedRuns}/${runCount}`
            : isExecuting
              ? isDebugging
                ? 'Debugging'
                : 'Running'
              : isDebugModeEnabled
                ? 'Debug'
                : runCount === 1
                  ? 'Run'
                  : `Run (${runCount})`}
        </Button>

        {/* Dropdown Trigger - Only show when not in debug mode */}
        {!isDebugModeEnabled && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className={cn(
                  'px-2 font-medium',
                  'bg-[#7F2FFF] hover:bg-[#7028E6]',
                  'shadow-[0_0_0_0_#7F2FFF] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
                  'text-white transition-all duration-200',
                  (isExecuting || isMultiRunning) &&
                    'relative after:absolute after:inset-0 after:animate-pulse after:bg-white/20',
                  'disabled:opacity-50 disabled:hover:bg-[#7F2FFF] disabled:hover:shadow-none',
                  'rounded-l-none h-10'
                )}
                disabled={isExecuting || isMultiRunning}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-20">
              {RUN_COUNT_OPTIONS.map((count) => (
                <DropdownMenuItem
                  key={count}
                  onClick={() => setRunCount(count)}
                  className={cn('justify-center', runCount === count && 'bg-muted')}
                >
                  {count}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
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
        {renderDebugModeToggle()}
        {renderPublishButton()}
        {renderDeployButton()}
        {renderRunButton()}

        {/* Add the marketplace modal */}
        <MarketplaceModal open={isMarketplaceModalOpen} onOpenChange={setIsMarketplaceModalOpen} />
      </div>
    </div>
  )
}
