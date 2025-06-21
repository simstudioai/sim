'use client'

import { useEffect, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  Bell,
  Bug,
  ChevronDown,
  Copy,
  History,
  Layers,
  Loader2,
  Play,
  SkipForward,
  StepForward,
  Trash2,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useUserPermissions } from '@/hooks/use-user-permissions'
import { useExecutionStore } from '@/stores/execution/store'
import { useNotificationStore } from '@/stores/notifications/store'
import { usePanelStore } from '@/stores/panel/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import {
  getKeyboardShortcutText,
  useKeyboardShortcuts,
} from '../../../hooks/use-keyboard-shortcuts'
import { useWorkflowExecution } from '../../hooks/use-workflow-execution'
import { DeploymentControls } from './components/deployment-controls/deployment-controls'
import { HistoryDropdownItem } from './components/history-dropdown-item/history-dropdown-item'
import { MarketplaceModal } from './components/marketplace-modal/marketplace-modal'
import { NotificationDropdownItem } from './components/notification-dropdown-item/notification-dropdown-item'

const logger = createLogger('ControlBar')

// Cache for usage data to prevent excessive API calls
let usageDataCache = {
  data: null,
  timestamp: 0,
  // Cache expires after 1 minute
  expirationMs: 60 * 1000,
}

// Predefined run count options
const RUN_COUNT_OPTIONS = [1, 5, 10, 25, 50, 100]

/**
 * Control bar for managing workflows - handles editing, deletion, deployment,
 * history, notifications and execution.
 */
export function ControlBar() {
  const router = useRouter()
  const { data: session } = useSession()

  // Store hooks
  const {
    notifications,
    getWorkflowNotifications,
    addNotification,
    showNotification,
    removeNotification,
  } = useNotificationStore()
  const { history, revertToHistoryState, lastSaved, setNeedsRedeploymentFlag, blocks } =
    useWorkflowStore()
  const { workflowValues } = useSubBlockStore()
  const {
    workflows,
    updateWorkflow,
    activeWorkflowId,
    activeWorkspaceId,
    removeWorkflow,
    duplicateWorkflow,
    setDeploymentStatus,
    isLoading: isRegistryLoading,
  } = useWorkflowRegistry()
  const { isExecuting, handleRunWorkflow } = useWorkflowExecution()
  const { setActiveTab } = usePanelStore()

  // Get current workflow and workspace ID for permissions
  const currentWorkflow = activeWorkflowId ? workflows[activeWorkflowId] : null

  // User permissions - use stable activeWorkspaceId from registry instead of deriving from currentWorkflow
  const userPermissions = useUserPermissions(activeWorkspaceId)

  // Debug mode state
  const { isDebugModeEnabled, toggleDebugMode } = useGeneralStore()
  const { isDebugging, pendingBlocks, handleStepDebug, handleCancelDebug, handleResumeDebug } =
    useWorkflowExecution()

  // Local state
  const [mounted, setMounted] = useState(false)
  const [, forceUpdate] = useState({})

  // Deployed state management
  const [deployedState, setDeployedState] = useState<WorkflowState | null>(null)
  const [isLoadingDeployedState, setIsLoadingDeployedState] = useState<boolean>(false)

  // Change detection state
  const [changeDetected, setChangeDetected] = useState(false)

  // Workflow name editing state
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState('')

  // Dropdown states
  const [historyOpen, setHistoryOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)

  // Marketplace modal state
  const [isMarketplaceModalOpen, setIsMarketplaceModalOpen] = useState(false)

  // Multiple runs state
  const [runCount, setRunCount] = useState(1)
  const [completedRuns, setCompletedRuns] = useState(0)
  const [isMultiRunning, setIsMultiRunning] = useState(false)
  const [showRunProgress, setShowRunProgress] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const cancelFlagRef = useRef(false)

  // Usage limit state
  const [usageExceeded, setUsageExceeded] = useState(false)
  const [usageData, setUsageData] = useState<{
    percentUsed: number
    isWarning: boolean
    isExceeded: boolean
    currentUsage: number
    limit: number
  } | null>(null)

  // Register keyboard shortcut for running workflow
  useKeyboardShortcuts(
    () => {
      if (!isExecuting && !isMultiRunning && !isCancelling) {
        if (isDebugModeEnabled) {
          handleRunWorkflow()
        } else {
          handleMultipleRuns()
        }
      }
    },
    isExecuting || isMultiRunning || isCancelling
  )

  // Get the marketplace data from the workflow registry if available
  const getMarketplaceData = () => {
    if (!activeWorkflowId || !workflows[activeWorkflowId]) return null
    return workflows[activeWorkflowId].marketplaceData
  }

  // Check if the current workflow is published to marketplace
  const _isPublishedToMarketplace = () => {
    const marketplaceData = getMarketplaceData()
    return !!marketplaceData
  }

  // // Check if the current user is the owner of the published workflow
  // const isWorkflowOwner = () => {
  //   const marketplaceData = getMarketplaceData()
  //   return marketplaceData?.status === 'owner'
  // }

  // Get deployment status from registry
  const deploymentStatus = useWorkflowRegistry((state) =>
    state.getWorkflowDeploymentStatus(activeWorkflowId)
  )
  const isDeployed = deploymentStatus?.isDeployed || false

  // Client-side only rendering for the timestamp
  useEffect(() => {
    setMounted(true)
  }, [])

  // Update the time display every minute
  useEffect(() => {
    const interval = setInterval(() => forceUpdate({}), 60000)
    return () => clearInterval(interval)
  }, [])

  /**
   * Fetches the deployed state of the workflow from the server
   * This is the single source of truth for deployed workflow state
   */
  const fetchDeployedState = async () => {
    if (!activeWorkflowId || !isDeployed) {
      setDeployedState(null)
      return
    }

    // Store the workflow ID at the start of the request to prevent race conditions
    const requestWorkflowId = activeWorkflowId

    // Helper to get current active workflow ID for race condition checks
    const getCurrentActiveWorkflowId = () => useWorkflowRegistry.getState().activeWorkflowId

    try {
      setIsLoadingDeployedState(true)

      const response = await fetch(`/api/workflows/${requestWorkflowId}/deployed`)

      // Check if the workflow ID changed during the request (user navigated away)
      if (requestWorkflowId !== getCurrentActiveWorkflowId()) {
        logger.debug('Workflow changed during deployed state fetch, ignoring response')
        return
      }

      if (!response.ok) {
        if (response.status === 404) {
          setDeployedState(null)
          return
        }
        throw new Error(`Failed to fetch deployed state: ${response.statusText}`)
      }

      const data = await response.json()

      if (requestWorkflowId === getCurrentActiveWorkflowId()) {
        setDeployedState(data.deployedState || null)
      } else {
        logger.debug('Workflow changed after deployed state response, ignoring result')
      }
    } catch (error) {
      logger.error('Error fetching deployed state:', { error })
      if (requestWorkflowId === getCurrentActiveWorkflowId()) {
        setDeployedState(null)
      }
    } finally {
      if (requestWorkflowId === getCurrentActiveWorkflowId()) {
        setIsLoadingDeployedState(false)
      }
    }
  }

  useEffect(() => {
    if (!activeWorkflowId) {
      setDeployedState(null)
      setIsLoadingDeployedState(false)
      return
    }

    if (isRegistryLoading) {
      setDeployedState(null)
      setIsLoadingDeployedState(false)
      return
    }

    if (isDeployed) {
      setNeedsRedeploymentFlag(false)
      fetchDeployedState()
    } else {
      setDeployedState(null)
      setIsLoadingDeployedState(false)
    }
  }, [activeWorkflowId, isDeployed, setNeedsRedeploymentFlag, isRegistryLoading])

  // Get current store state for change detection
  const currentBlocks = useWorkflowStore((state) => state.blocks)
  const subBlockValues = useSubBlockStore((state) =>
    activeWorkflowId ? state.workflowValues[activeWorkflowId] : null
  )

  /**
   * Normalize blocks for semantic comparison - only compare what matters functionally
   * Ignores: IDs, positions, dimensions, metadata that don't affect workflow logic
   * Compares: type, name, subBlock values
   */
  const normalizeBlocksForComparison = (blocks: Record<string, any>) => {
    if (!blocks) return []

    return Object.values(blocks)
      .map((block: any) => ({
        type: block.type,
        name: block.name,
        subBlocks: block.subBlocks || {},
      }))
      .sort((a, b) => {
        const typeA = a.type || ''
        const typeB = b.type || ''
        if (typeA !== typeB) return typeA.localeCompare(typeB)
        return (a.name || '').localeCompare(b.name || '')
      })
  }

  useEffect(() => {
    if (!activeWorkflowId || !deployedState) {
      setChangeDetected(false)
      return
    }

    if (isLoadingDeployedState) {
      return
    }

    const currentMergedState = mergeSubblockState(currentBlocks, activeWorkflowId)

    const deployedBlocks = deployedState?.blocks
    if (!deployedBlocks) {
      setChangeDetected(false)
      return
    }

    const normalizedCurrentBlocks = normalizeBlocksForComparison(currentMergedState)
    const normalizedDeployedBlocks = normalizeBlocksForComparison(deployedBlocks)

    const hasChanges =
      JSON.stringify(normalizedCurrentBlocks) !== JSON.stringify(normalizedDeployedBlocks)
    setChangeDetected(hasChanges)
  }, [activeWorkflowId, deployedState, currentBlocks, subBlockValues, isLoadingDeployedState])

  useEffect(() => {
    if (session?.user?.id && !isRegistryLoading) {
      checkUserUsage(session.user.id).then((usage) => {
        if (usage) {
          setUsageExceeded(usage.isExceeded)
          setUsageData(usage)
        }
      })
    }
  }, [session?.user?.id, completedRuns, isRegistryLoading])

  /**
   * Check user usage data with caching to prevent excessive API calls
   * @param userId User ID to check usage for
   * @param forceRefresh Whether to force a fresh API call ignoring cache
   * @returns Usage data or null if error
   */
  async function checkUserUsage(userId: string, forceRefresh = false): Promise<any | null> {
    const now = Date.now()
    const cacheAge = now - usageDataCache.timestamp

    // Use cache if available and not expired
    if (!forceRefresh && usageDataCache.data && cacheAge < usageDataCache.expirationMs) {
      logger.info('Using cached usage data', {
        cacheAge: `${Math.round(cacheAge / 1000)}s`,
      })
      return usageDataCache.data
    }

    try {
      const response = await fetch('/api/user/usage')
      if (!response.ok) {
        throw new Error('Failed to fetch usage data')
      }

      const usage = await response.json()

      // Update cache
      usageDataCache = {
        data: usage,
        timestamp: now,
        expirationMs: usageDataCache.expirationMs,
      }

      return usage
    } catch (error) {
      logger.error('Error checking usage limits:', { error })
      return null
    }
  }

  /**
   * Workflow name handlers
   */
  const handleNameClick = () => {
    if (!userPermissions.canEdit) return
    setIsEditing(true)
    setEditedName(activeWorkflowId ? workflows[activeWorkflowId]?.name || '' : '')
  }

  const handleNameSubmit = () => {
    if (!userPermissions.canEdit) return

    if (editedName.trim() && activeWorkflowId) {
      updateWorkflow(activeWorkflowId, { name: editedName.trim() })
    }
    setIsEditing(false)
  }

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSubmit()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
    }
  }

  /**
   * Handle deleting the current workflow
   */
  const handleDeleteWorkflow = () => {
    if (!activeWorkflowId || !userPermissions.canEdit) return

    const workflowIds = Object.keys(workflows)
    const currentIndex = workflowIds.indexOf(activeWorkflowId)

    // Find the next workflow to navigate to
    let nextWorkflowId = null
    if (workflowIds.length > 1) {
      // Try next workflow, then previous, then any other
      if (currentIndex < workflowIds.length - 1) {
        nextWorkflowId = workflowIds[currentIndex + 1]
      } else if (currentIndex > 0) {
        nextWorkflowId = workflowIds[currentIndex - 1]
      } else {
        nextWorkflowId = workflowIds.find((id) => id !== activeWorkflowId) || null
      }
    }

    // Navigate to the next workflow or home
    if (nextWorkflowId) {
      router.push(`/w/${nextWorkflowId}`)
    } else {
      router.push('/')
    }

    // Remove the workflow from the registry
    useWorkflowRegistry.getState().removeWorkflow(activeWorkflowId)
  }

  // /**
  //  * Handle opening marketplace modal or showing published status
  //  */
  // const handlePublishWorkflow = async () => {
  //   if (!activeWorkflowId) return

  //   // If already published, show marketplace modal with info instead of notifications
  //   const isPublished = isPublishedToMarketplace()
  //   if (isPublished) {
  //     setIsMarketplaceModalOpen(true)
  //     return
  //   }

  //   // If not published, open the modal to start the publishing process
  //   setIsMarketplaceModalOpen(true)
  // }

  // Helper function to open subscription settings
  const openSubscriptionSettings = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('open-settings', {
          detail: { tab: 'subscription' },
        })
      )
    }
  }

  /**
   * Handle running workflow multiple times
   */
  const handleMultipleRuns = async () => {
    if (isExecuting || isMultiRunning || runCount <= 0) return

    // Check if usage is exceeded before allowing execution
    if (usageExceeded) {
      openSubscriptionSettings()
      return
    }

    // Switch panel tab to console
    setActiveTab('console')

    // Reset state and ref for a new batch of runs
    setCompletedRuns(0)
    setIsMultiRunning(true)
    setIsCancelling(false)
    cancelFlagRef.current = false
    setShowRunProgress(runCount > 1)

    let workflowError = null
    let wasCancelled = false
    let runCounter = 0
    let shouldCheckUsage = false

    try {
      // Run the workflow multiple times sequentially
      for (let i = 0; i < runCount; i++) {
        // Check for cancellation before starting the next run using the ref
        if (cancelFlagRef.current) {
          logger.info('Multi-run cancellation requested by user.')
          wasCancelled = true
          break
        }

        // Run the workflow and immediately increment counter for visual feedback
        await handleRunWorkflow()
        runCounter = i + 1
        setCompletedRuns(runCounter)

        // Only check usage periodically to avoid excessive API calls
        // Check on first run, every 5 runs, and on last run
        shouldCheckUsage = i === 0 || (i + 1) % 5 === 0 || i === runCount - 1

        // Check usage if needed
        if (shouldCheckUsage && session?.user?.id) {
          const usage = await checkUserUsage(session.user.id, i === 0)

          if (usage?.isExceeded) {
            setUsageExceeded(true)
            setUsageData(usage)
            // Stop execution if we've exceeded the limit during this batch
            if (i < runCount - 1) {
              addNotification(
                'info',
                `Usage limit reached after ${runCounter} runs. Execution stopped.`,
                activeWorkflowId
              )
              break
            }
          }
        }
      }

      // Update workflow stats only if the run wasn't cancelled and completed normally
      if (!wasCancelled && activeWorkflowId) {
        try {
          // Don't block UI on stats update
          fetch(`/api/workflows/${activeWorkflowId}/stats?runs=${runCounter}`, {
            method: 'POST',
          }).catch((error) => {
            logger.error(`Failed to update workflow stats: ${error.message}`)
          })
        } catch (error) {
          logger.error('Error updating workflow stats:', { error })
        }
      }
    } catch (error) {
      workflowError = error
      logger.error('Error during multiple workflow runs:', { error })
    } finally {
      // Always immediately update UI state
      setIsMultiRunning(false)

      // Handle progress bar visibility
      if (runCount > 1) {
        // Keep progress visible briefly after completion
        setTimeout(() => setShowRunProgress(false), 1000)
      } else {
        // Immediately hide progress for single runs
        setShowRunProgress(false)
      }

      setIsCancelling(false)
      cancelFlagRef.current = false

      // Show notification after state is updated
      if (wasCancelled) {
        addNotification('info', 'Workflow run cancelled', activeWorkflowId)
      } else if (workflowError) {
        addNotification('error', 'Failed to complete all workflow runs', activeWorkflowId)
      }
    }
  }

  /**
   * Handle duplicating the current workflow
   */
  const handleDuplicateWorkflow = () => {
    if (!activeWorkflowId || !userPermissions.canEdit) return

    // Duplicate the workflow and get the new ID
    const newWorkflowId = duplicateWorkflow(activeWorkflowId)

    if (newWorkflowId) {
      // Navigate to the new workflow
      router.push(`/w/${newWorkflowId}`)
    }
  }

  /**
   * Render workflow name section (editable/non-editable)
   */
  const renderWorkflowName = () => {
    const canEdit = userPermissions.canEdit

    return (
      <div className='flex flex-col gap-[2px]'>
        {isEditing ? (
          <input
            type='text'
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={handleNameKeyDown}
            className='w-[200px] border-none bg-transparent p-0 font-medium text-sm outline-none'
          />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <h2
                className={cn(
                  'w-fit font-medium text-sm',
                  canEdit ? 'cursor-pointer hover:text-muted-foreground' : 'cursor-default'
                )}
                onClick={canEdit ? handleNameClick : undefined}
              >
                {activeWorkflowId ? workflows[activeWorkflowId]?.name : 'Workflow'}
              </h2>
            </TooltipTrigger>
            {!canEdit && (
              <TooltipContent>Edit permissions required to rename workflows</TooltipContent>
            )}
          </Tooltip>
        )}
        {mounted && (
          <p className='text-muted-foreground text-xs'>
            Saved{' '}
            {formatDistanceToNow(lastSaved || Date.now(), {
              addSuffix: true,
            })}
          </p>
        )}
      </div>
    )
  }

  /**
   * Render delete workflow button with confirmation dialog
   */
  const renderDeleteButton = () => {
    const canEdit = userPermissions.canEdit
    const hasMultipleWorkflows = Object.keys(workflows).length > 1
    const isDisabled = !canEdit || !hasMultipleWorkflows

    const getTooltipText = () => {
      if (!canEdit) return 'Edit permissions required to delete workflows'
      if (!hasMultipleWorkflows) return 'Cannot delete the last workflow'
      return 'Delete Workflow'
    }

    return (
      <AlertDialog>
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertDialogTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                disabled={isDisabled}
                className={cn('hover:text-red-600', isDisabled && 'cursor-not-allowed opacity-50')}
              >
                <Trash2 className='h-5 w-5' />
                <span className='sr-only'>Delete Workflow</span>
              </Button>
            </AlertDialogTrigger>
          </TooltipTrigger>
          <TooltipContent>{getTooltipText()}</TooltipContent>
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
            <AlertDialogAction
              onClick={handleDeleteWorkflow}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  /**
   * Render deploy button with tooltip
   */
  const renderDeployButton = () => (
    <DeploymentControls
      activeWorkflowId={activeWorkflowId}
      needsRedeployment={changeDetected}
      setNeedsRedeployment={setChangeDetected}
      deployedState={deployedState}
      isLoadingDeployedState={isLoadingDeployedState}
      refetchDeployedState={fetchDeployedState}
      userPermissions={userPermissions}
    />
  )

  /**
   * Render history dropdown
   */
  const renderHistoryDropdown = () => (
    <DropdownMenu open={historyOpen} onOpenChange={setHistoryOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon'>
              <History />
              <span className='sr-only'>Version History</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {!historyOpen && <TooltipContent>History</TooltipContent>}
      </Tooltip>

      {history.past.length === 0 && history.future.length === 0 ? (
        <DropdownMenuContent align='end' className='w-40'>
          <DropdownMenuItem className='text-muted-foreground text-sm'>
            No history available
          </DropdownMenuItem>
        </DropdownMenuContent>
      ) : (
        <DropdownMenuContent align='end' className='max-h-[300px] w-60 overflow-y-auto'>
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
    const currentWorkflowNotifications = activeWorkflowId
      ? notifications.filter((n) => n.workflowId === activeWorkflowId)
      : []

    return (
      <DropdownMenu open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon'>
                <Bell />
                <span className='sr-only'>Notifications</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          {!notificationsOpen && <TooltipContent>Notifications</TooltipContent>}
        </Tooltip>

        {currentWorkflowNotifications.length === 0 ? (
          <DropdownMenuContent align='end' className='w-40'>
            <DropdownMenuItem className='text-muted-foreground text-sm'>
              No new notifications
            </DropdownMenuItem>
          </DropdownMenuContent>
        ) : (
          <DropdownMenuContent align='end' className='max-h-[300px] w-60 overflow-y-auto'>
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
  // const renderPublishButton = () => {
  //   const isPublished = isPublishedToMarketplace()

  //   return (
  //     <Tooltip>
  //       <TooltipTrigger asChild>
  //         <Button
  //           variant="ghost"
  //           size="icon"
  //           onClick={handlePublishWorkflow}
  //           disabled={isPublishing}
  //           className={cn('hover:text-[#701FFC]', isPublished && 'text-[#701FFC]')}
  //         >
  //           {isPublishing ? (
  //             <Loader2 className="h-5 w-5 animate-spin" />
  //           ) : (
  //             <Store className="h-5 w-5" />
  //           )}
  //           <span className="sr-only">Publish to Marketplace</span>
  //         </Button>
  //       </TooltipTrigger>
  //       <TooltipContent>
  //         {isPublishing
  //           ? 'Publishing...'
  //           : isPublished
  //             ? 'Published to Marketplace'
  //             : 'Publish to Marketplace'}
  //       </TooltipContent>
  //     </Tooltip>
  //   )
  // }

  /**
   * Render workflow duplicate button
   */
  const renderDuplicateButton = () => {
    const canEdit = userPermissions.canEdit

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            onClick={handleDuplicateWorkflow}
            disabled={!canEdit}
            className={cn('hover:text-primary', !canEdit && 'cursor-not-allowed opacity-50')}
          >
            <Copy className='h-5 w-5' />
            <span className='sr-only'>Duplicate Workflow</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {canEdit ? 'Duplicate Workflow' : 'Edit permissions required to duplicate workflows'}
        </TooltipContent>
      </Tooltip>
    )
  }

  /**
   * Render auto-layout button
   */
  const renderAutoLayoutButton = () => {
    const handleAutoLayoutClick = () => {
      if (isExecuting || isMultiRunning || isDebugging || !userPermissions.canEdit) {
        return
      }

      window.dispatchEvent(new CustomEvent('trigger-auto-layout'))
    }

    const isDisabled = isExecuting || isMultiRunning || isDebugging || !userPermissions.canEdit

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            onClick={handleAutoLayoutClick}
            className={cn('hover:text-primary', isDisabled && 'cursor-not-allowed opacity-50')}
            disabled={isDisabled}
          >
            <Layers className='h-5 w-5' />
            <span className='sr-only'>Auto Layout</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent command='Shift+L'>
          {!userPermissions.canEdit
            ? 'Edit permissions required to use auto-layout'
            : 'Auto Layout'}
        </TooltipContent>
      </Tooltip>
    )
  }

  /**
   * Render debug mode controls
   */
  const renderDebugControls = () => {
    if (!isDebugModeEnabled || !isDebugging) return null

    const pendingCount = pendingBlocks.length

    return (
      <div className='ml-2 flex items-center gap-2 rounded-md bg-muted px-2 py-1'>
        <div className='flex flex-col'>
          <span className='text-muted-foreground text-xs'>Debug Mode</span>
          <span className='font-medium text-xs'>
            {pendingCount} block{pendingCount !== 1 ? 's' : ''} pending
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='outline'
              size='icon'
              onClick={handleStepDebug}
              className='h-8 w-8 bg-background'
              disabled={pendingCount === 0}
            >
              <StepForward className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Step Forward</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='outline'
              size='icon'
              onClick={handleResumeDebug}
              className='h-8 w-8 bg-background'
              disabled={pendingCount === 0}
            >
              <SkipForward className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Resume Until End</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='outline'
              size='icon'
              onClick={handleCancelDebug}
              className='h-8 w-8 bg-background'
            >
              <X className='h-4 w-4' />
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
    const canDebug = userPermissions.canRead // Debug mode now requires only read permissions

    const handleToggleDebugMode = () => {
      if (!canDebug) return

      if (isDebugModeEnabled) {
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
            variant='ghost'
            size='icon'
            onClick={handleToggleDebugMode}
            disabled={isExecuting || isMultiRunning || !canDebug}
            className={cn(
              isDebugModeEnabled && 'text-amber-500',
              !canDebug && 'cursor-not-allowed opacity-50'
            )}
          >
            <Bug className='h-5 w-5' />
            <span className='sr-only'>Toggle Debug Mode</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {!canDebug
            ? 'Read permissions required to use debug mode'
            : isDebugModeEnabled
              ? 'Disable Debug Mode'
              : 'Enable Debug Mode'}
        </TooltipContent>
      </Tooltip>
    )
  }

  /**
   * Render run workflow button with multi-run dropdown and cancel button
   */
  const renderRunButton = () => {
    const canRun = userPermissions.canRead // Running only requires read permissions
    const isLoadingPermissions = userPermissions.isLoading
    const isButtonDisabled =
      isExecuting || isMultiRunning || isCancelling || (!canRun && !isLoadingPermissions)

    return (
      <div className='flex items-center'>
        {showRunProgress && isMultiRunning && (
          <div className='mr-3 w-28'>
            <Progress value={(completedRuns / runCount) * 100} className='h-2 bg-muted' />
            <p className='mt-1 text-center text-muted-foreground text-xs'>
              {completedRuns}/{runCount} runs
            </p>
          </div>
        )}

        {/* Show how many blocks have been executed in debug mode if debugging */}
        {isDebugging && (
          <div className='mr-3 min-w-28 rounded bg-muted px-1 py-0.5'>
            <div className='text-center text-muted-foreground text-xs'>
              <span className='font-medium'>Debugging Mode</span>
            </div>
          </div>
        )}

        {renderDebugControls()}

        <div className='ml-1 flex'>
          {/* Main Run/Debug Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className={cn(
                  'gap-2 font-medium',
                  'bg-[#701FFC] hover:bg-[#6518E6]',
                  'shadow-[0_0_0_0_#701FFC] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
                  'text-white transition-all duration-200',
                  (isExecuting || isMultiRunning) &&
                    !isCancelling &&
                    'relative after:absolute after:inset-0 after:animate-pulse after:bg-white/20',
                  'disabled:opacity-50 disabled:hover:bg-[#701FFC] disabled:hover:shadow-none',
                  isDebugModeEnabled || isMultiRunning
                    ? 'h-10 rounded px-4 py-2'
                    : 'h-10 rounded-r-none border-r border-r-[#6420cc] px-4 py-2'
                )}
                onClick={
                  usageExceeded
                    ? openSubscriptionSettings
                    : isDebugModeEnabled
                      ? handleRunWorkflow
                      : handleMultipleRuns
                }
                disabled={isButtonDisabled}
              >
                {isCancelling ? (
                  <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                ) : isDebugModeEnabled ? (
                  <Bug className={cn('mr-1.5 h-3.5 w-3.5', 'fill-current stroke-current')} />
                ) : (
                  <Play className={cn('h-3.5 w-3.5', 'fill-current stroke-current')} />
                )}
                {isCancelling
                  ? 'Cancelling...'
                  : isMultiRunning
                    ? `Running (${completedRuns}/${runCount})`
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
            </TooltipTrigger>
            <TooltipContent command={getKeyboardShortcutText('Enter', true)}>
              {!canRun && !isLoadingPermissions ? (
                'Read permissions required to run workflows'
              ) : usageExceeded ? (
                <div className='text-center'>
                  <p className='font-medium text-destructive'>Usage Limit Exceeded</p>
                  <p className='text-xs'>
                    You've used {usageData?.currentUsage.toFixed(2)}$ of {usageData?.limit}$.
                    Upgrade your plan to continue.
                  </p>
                </div>
              ) : (
                <>
                  {isDebugModeEnabled
                    ? 'Debug Workflow'
                    : runCount === 1
                      ? 'Run Workflow'
                      : `Run Workflow ${runCount} times`}
                </>
              )}
            </TooltipContent>
          </Tooltip>

          {/* Dropdown Trigger - Only show when not in debug mode and not multi-running */}
          {!isDebugModeEnabled && !isMultiRunning && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className={cn(
                    'px-2 font-medium',
                    'bg-[#701FFC] hover:bg-[#6518E6]',
                    'shadow-[0_0_0_0_#701FFC] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
                    'text-white transition-all duration-200',
                    (isExecuting || isMultiRunning) &&
                      !isCancelling &&
                      'relative after:absolute after:inset-0 after:animate-pulse after:bg-white/20',
                    'disabled:opacity-50 disabled:hover:bg-[#701FFC] disabled:hover:shadow-none',
                    'h-10 rounded-l-none'
                  )}
                  disabled={isButtonDisabled}
                >
                  <ChevronDown className='h-4 w-4' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-20'>
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

          {/* Cancel Button - Only show when multi-running */}
          {isMultiRunning && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='outline'
                  size='icon'
                  onClick={() => {
                    logger.info('Cancel button clicked - setting ref and state')
                    cancelFlagRef.current = true
                    setIsCancelling(true)
                  }}
                  disabled={isCancelling}
                  className='ml-2 h-10 w-10'
                >
                  <X className='h-4 w-4' />
                  <span className='sr-only'>Cancel Runs</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cancel Runs</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-16 w-full items-center justify-between border-b bg-background'>
      {/* Left Section - Workflow Info */}
      <div className='pl-4'>{renderWorkflowName()}</div>

      {/* Middle Section - Reserved for future use */}
      <div className='flex-1' />

      {/* Right Section - Actions */}
      <div className='flex items-center gap-1 pr-4'>
        {renderDeleteButton()}
        {renderHistoryDropdown()}
        {renderNotificationsDropdown()}
        {renderDuplicateButton()}
        {renderAutoLayoutButton()}
        {renderDebugModeToggle()}
        {/* {renderPublishButton()} */}
        {renderDeployButton()}
        {renderRunButton()}

        {/* Add the marketplace modal */}
        <MarketplaceModal open={isMarketplaceModalOpen} onOpenChange={setIsMarketplaceModalOpen} />
      </div>
    </div>
  )
}
