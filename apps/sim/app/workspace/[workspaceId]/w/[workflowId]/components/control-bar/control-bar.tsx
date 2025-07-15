'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Bug,
  ChevronLeft,
  Copy,
  Layers,
  Play,
  RefreshCw,
  SkipForward,
  StepForward,
  Store,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/w/components/providers/workspace-permissions-provider'
import { useFolderStore } from '@/stores/folders/store'
import { usePanelStore } from '@/stores/panel/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useSubscriptionStore } from '@/stores/subscription/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import {
  getKeyboardShortcutText,
  useKeyboardShortcuts,
} from '../../../hooks/use-keyboard-shortcuts'
import { useWorkflowExecution } from '../../hooks/use-workflow-execution'
import { DeploymentControls } from './components/deployment-controls/deployment-controls'
import { ExportControls } from './components/export-controls/export-controls'
import { TemplateModal } from './components/template-modal/template-modal'

const logger = createLogger('ControlBar')

// Cache for usage data to prevent excessive API calls
let usageDataCache: {
  data: any | null
  timestamp: number
  expirationMs: number
} = {
  data: null,
  timestamp: 0,
  // Cache expires after 1 minute
  expirationMs: 60 * 1000,
}

interface ControlBarProps {
  hasValidationErrors?: boolean
}

/**
 * Control bar for managing workflows - handles editing, deletion, deployment,
 * history, notifications and execution.
 */
export function ControlBar({ hasValidationErrors = false }: ControlBarProps) {
  const router = useRouter()
  const { data: session } = useSession()
  const params = useParams()
  const workspaceId = params.workspaceId as string

  // Store hooks
  const { history, revertToHistoryState, lastSaved, setNeedsRedeploymentFlag, blocks } =
    useWorkflowStore()
  const {
    workflows,
    updateWorkflow,
    activeWorkflowId,
    removeWorkflow,
    duplicateWorkflow,
    setDeploymentStatus,
    isLoading: isRegistryLoading,
  } = useWorkflowRegistry()
  const { isExecuting, handleRunWorkflow } = useWorkflowExecution()
  const { setActiveTab, togglePanel, isOpen } = usePanelStore()
  const { getFolderTree, expandedFolders } = useFolderStore()

  // User permissions - use stable activeWorkspaceId from registry instead of deriving from currentWorkflow
  const userPermissions = useUserPermissionsContext()

  // Debug mode state
  const { isDebugModeEnabled, toggleDebugMode } = useGeneralStore()
  const { isDebugging, pendingBlocks, handleStepDebug, handleCancelDebug, handleResumeDebug } =
    useWorkflowExecution()

  // Local state
  const [mounted, setMounted] = useState(false)
  const [, forceUpdate] = useState({})
  const [isExpanded, setIsExpanded] = useState(false)
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false)

  // Deployed state management
  const [deployedState, setDeployedState] = useState<WorkflowState | null>(null)
  const [isLoadingDeployedState, setIsLoadingDeployedState] = useState<boolean>(false)

  // Change detection state
  const [changeDetected, setChangeDetected] = useState(false)

  // Usage limit state
  const [usageExceeded, setUsageExceeded] = useState(false)
  const [usageData, setUsageData] = useState<{
    percentUsed: number
    isWarning: boolean
    isExceeded: boolean
    currentUsage: number
    limit: number
  } | null>(null)

  // Helper function to open console panel
  const openConsolePanel = useCallback(() => {
    setActiveTab('console')
    if (!isOpen) {
      togglePanel()
    }
  }, [setActiveTab, isOpen, togglePanel])

  // Shared condition for keyboard shortcut and button disabled state
  const isWorkflowBlocked = isExecuting || hasValidationErrors

  // Register keyboard shortcut for running workflow
  useKeyboardShortcuts(() => {
    if (!isWorkflowBlocked) {
      openConsolePanel()
      handleRunWorkflow()
    }
  }, isWorkflowBlocked)

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

  useEffect(() => {
    if (!activeWorkflowId || !deployedState) {
      setChangeDetected(false)
      return
    }

    if (isLoadingDeployedState) {
      return
    }

    // Use the workflow status API to get accurate change detection
    // This uses the same logic as the deployment API (reading from normalized tables)
    const checkForChanges = async () => {
      try {
        const response = await fetch(`/api/workflows/${activeWorkflowId}/status`)
        if (response.ok) {
          const data = await response.json()
          setChangeDetected(data.needsRedeployment || false)
        } else {
          logger.error('Failed to fetch workflow status:', response.status, response.statusText)
          setChangeDetected(false)
        }
      } catch (error) {
        logger.error('Error fetching workflow status:', error)
        setChangeDetected(false)
      }
    }

    checkForChanges()
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
  }, [session?.user?.id, isRegistryLoading])

  /**
   * Check user usage limits and cache results
   */
  async function checkUserUsage(userId: string, forceRefresh = false): Promise<any | null> {
    const now = Date.now()
    const cacheAge = now - usageDataCache.timestamp

    // Return cached data if still valid and not forcing refresh
    if (!forceRefresh && usageDataCache.data && cacheAge < usageDataCache.expirationMs) {
      logger.info('Using cached usage data', {
        cacheAge: `${Math.round(cacheAge / 1000)}s`,
      })
      return usageDataCache.data
    }

    try {
      // Use subscription store to get usage data
      const { getUsage, refresh } = useSubscriptionStore.getState()

      // Force refresh if requested
      if (forceRefresh) {
        await refresh()
      }

      const usage = getUsage()

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
   * Handle deleting the current workflow
   */
  const handleDeleteWorkflow = () => {
    if (!activeWorkflowId || !userPermissions.canEdit) return

    const sidebarWorkflows = getSidebarOrderedWorkflows()
    const currentIndex = sidebarWorkflows.findIndex((w) => w.id === activeWorkflowId)

    // Find next workflow: try next, then previous
    let nextWorkflowId: string | null = null
    if (sidebarWorkflows.length > 1) {
      if (currentIndex < sidebarWorkflows.length - 1) {
        nextWorkflowId = sidebarWorkflows[currentIndex + 1].id
      } else if (currentIndex > 0) {
        nextWorkflowId = sidebarWorkflows[currentIndex - 1].id
      }
    }

    // Navigate to next workflow or workspace home
    if (nextWorkflowId) {
      router.push(`/workspace/${workspaceId}/w/${nextWorkflowId}`)
    } else {
      router.push(`/workspace/${workspaceId}`)
    }

    // Remove the workflow from the registry
    useWorkflowRegistry.getState().removeWorkflow(activeWorkflowId)
  }

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
   * Handle duplicating the current workflow
   */
  const handleDuplicateWorkflow = async () => {
    if (!activeWorkflowId || !userPermissions.canEdit) return

    try {
      const newWorkflow = await duplicateWorkflow(activeWorkflowId)
      if (newWorkflow) {
        router.push(`/workspace/${workspaceId}/w/${newWorkflow}`)
      }
    } catch (error) {
      logger.error('Error duplicating workflow:', { error })
    }
  }

  /**
   * Render delete workflow button with confirmation dialog
   */
  const renderDeleteButton = () => {
    const canEdit = userPermissions.canEdit
    const hasMultipleWorkflows = Object.keys(workflows).length > 1
    const isDisabled = !canEdit || !hasMultipleWorkflows

    const getTooltipText = () => {
      if (!canEdit) return 'Admin permission required to delete workflows'
      if (!hasMultipleWorkflows) return 'Cannot delete the last workflow'
      return 'Delete workflow'
    }

    if (isDisabled) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='inline-flex h-12 w-12 cursor-not-allowed items-center justify-center gap-2 whitespace-nowrap rounded-[11px] border bg-card font-medium text-card-foreground text-sm opacity-50 ring-offset-background transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'>
              <Trash2 className='h-5 w-5' />
            </div>
          </TooltipTrigger>
          <TooltipContent>{getTooltipText()}</TooltipContent>
        </Tooltip>
      )
    }

    return (
      <AlertDialog>
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertDialogTrigger asChild>
              <Button
                variant='outline'
                className={cn(
                  'h-12 w-12 rounded-[11px] border bg-card text-card-foreground shadow-xs',
                  'hover:border-red-500 hover:bg-red-500 hover:text-white',
                  'transition-all duration-200'
                )}
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
   * Render workflow duplicate button
   */
  const renderDuplicateButton = () => {
    const canEdit = userPermissions.canEdit
    const isDisabled = !canEdit || isDebugging

    const getTooltipText = () => {
      if (!canEdit) return 'Admin permission required to duplicate workflows'
      if (isDebugging) return 'Cannot duplicate workflow while debugging'
      return 'Duplicate workflow'
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {isDisabled ? (
            <div className='inline-flex h-12 w-12 cursor-not-allowed items-center justify-center gap-2 whitespace-nowrap rounded-[11px] border bg-card font-medium text-card-foreground text-sm opacity-50 ring-offset-background transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'>
              <Copy className='h-5 w-5' />
            </div>
          ) : (
            <Button
              variant='outline'
              onClick={handleDuplicateWorkflow}
              className='h-12 w-12 rounded-[11px] border bg-card text-card-foreground shadow-xs hover:bg-secondary'
            >
              <Copy className='h-5 w-5' />
              <span className='sr-only'>Duplicate Workflow</span>
            </Button>
          )}
        </TooltipTrigger>
        <TooltipContent>{getTooltipText()}</TooltipContent>
      </Tooltip>
    )
  }

  /**
   * Render auto-layout button
   */
  const renderAutoLayoutButton = () => {
    const handleAutoLayoutClick = () => {
      if (isExecuting || isDebugging || !userPermissions.canEdit) {
        return
      }

      window.dispatchEvent(new CustomEvent('trigger-auto-layout'))
    }

    const canEdit = userPermissions.canEdit
    const isDisabled = isExecuting || isDebugging || !canEdit

    const getTooltipText = () => {
      if (!canEdit) return 'Admin permission required to use auto-layout'
      if (isDebugging) return 'Cannot auto-layout while debugging'
      if (isExecuting) return 'Cannot auto-layout while workflow is running'
      return 'Auto layout'
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {isDisabled ? (
            <div className='inline-flex h-12 w-12 cursor-not-allowed items-center justify-center gap-2 whitespace-nowrap rounded-[11px] border bg-card font-medium text-card-foreground text-sm opacity-50 ring-offset-background transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'>
              <Layers className='h-5 w-5' />
            </div>
          ) : (
            <Button
              variant='outline'
              onClick={handleAutoLayoutClick}
              className='h-12 w-12 rounded-[11px] border bg-card text-card-foreground shadow-xs hover:bg-secondary'
            >
              <Layers className='h-5 w-5' />
              <span className='sr-only'>Auto Layout</span>
            </Button>
          )}
        </TooltipTrigger>
        <TooltipContent command={`${isDebugging ? '' : 'Shift+L'}`}>
          {getTooltipText()}
        </TooltipContent>
      </Tooltip>
    )
  }

  /**
   * Handles debug mode toggle - starts or stops debugging
   */
  const handleDebugToggle = useCallback(() => {
    if (!userPermissions.canRead) return

    if (isDebugging) {
      // Stop debugging
      handleCancelDebug()
    } else {
      // Check if there are executable blocks before starting debug mode
      const hasExecutableBlocks = Object.values(blocks).some(
        (block) => block.type !== 'starter' && block.enabled !== false
      )

      if (!hasExecutableBlocks) {
        return // Do nothing if no executable blocks
      }

      // Start debugging
      if (!isDebugModeEnabled) {
        toggleDebugMode()
      }
      if (usageExceeded) {
        openSubscriptionSettings()
      } else {
        openConsolePanel()
        handleRunWorkflow(undefined, true) // Start in debug mode
      }
    }
  }, [
    userPermissions.canRead,
    isDebugging,
    isDebugModeEnabled,
    usageExceeded,
    blocks,
    handleCancelDebug,
    toggleDebugMode,
    handleRunWorkflow,
    openConsolePanel,
  ])

  /**
   * Render debug controls bar (replaces run button when debugging)
   */
  const renderDebugControlsBar = () => {
    const pendingCount = pendingBlocks.length
    const isControlDisabled = pendingCount === 0

    const debugButtonClass = cn(
      'h-12 w-12 rounded-[11px] font-medium',
      'bg-[#701FFC] hover:bg-[#6518E6]',
      'shadow-[0_0_0_0_#701FFC] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
      'text-white transition-all duration-200',
      'disabled:opacity-50 disabled:hover:bg-[#701FFC] disabled:hover:shadow-none'
    )

    return (
      <div className='flex items-center gap-1'>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={() => {
                openConsolePanel()
                handleStepDebug()
              }}
              className={debugButtonClass}
              disabled={isControlDisabled}
            >
              <StepForward className='h-5 w-5' />
              <span className='sr-only'>Step Forward</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Step Forward</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={() => {
                openConsolePanel()
                handleResumeDebug()
              }}
              className={debugButtonClass}
              disabled={isControlDisabled}
            >
              <SkipForward className='h-5 w-5' />
              <span className='sr-only'>Resume Until End</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Resume Until End</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={() => {
                handleCancelDebug()
              }}
              className={debugButtonClass}
            >
              <X className='h-5 w-5' />
              <span className='sr-only'>Cancel Debugging</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Cancel Debugging</TooltipContent>
        </Tooltip>
      </div>
    )
  }

  /**
   * Render publish template button
   */
  const renderPublishButton = () => {
    const canEdit = userPermissions.canEdit
    const isDisabled = isExecuting || isDebugging || !canEdit

    const getTooltipText = () => {
      if (!canEdit) return 'Admin permission required to publish templates'
      if (isDebugging) return 'Cannot publish template while debugging'
      if (isExecuting) return 'Cannot publish template while workflow is running'
      return 'Publish as template'
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {isDisabled ? (
            <div className='inline-flex h-12 w-12 cursor-not-allowed items-center justify-center gap-2 whitespace-nowrap rounded-[11px] border bg-card font-medium text-card-foreground text-sm opacity-50 ring-offset-background transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'>
              <Store className='h-5 w-5' />
            </div>
          ) : (
            <Button
              variant='outline'
              onClick={() => setIsTemplateModalOpen(true)}
              className='h-12 w-12 rounded-[11px] border bg-card text-card-foreground shadow-xs hover:bg-secondary'
            >
              <Store className='h-5 w-5' />
              <span className='sr-only'>Publish Template</span>
            </Button>
          )}
        </TooltipTrigger>
        <TooltipContent>{getTooltipText()}</TooltipContent>
      </Tooltip>
    )
  }

  /**
   * Render debug mode toggle button
   */
  const renderDebugModeToggle = () => {
    const canDebug = userPermissions.canRead

    // Check if there are any meaningful blocks in the workflow (excluding just the starter block)
    const hasExecutableBlocks = Object.values(blocks).some(
      (block) => block.type !== 'starter' && block.enabled !== false
    )

    const isDisabled = isExecuting || !canDebug || !hasExecutableBlocks

    const getTooltipText = () => {
      if (!canDebug) return 'Read permission required to use debug mode'
      if (!hasExecutableBlocks) return 'Add blocks to enable debug mode'
      return isDebugging ? 'Stop debugging' : 'Start debugging'
    }

    const buttonClass = cn(
      'h-12 w-12 rounded-[11px] border bg-card text-card-foreground shadow-xs hover:bg-secondary',
      isDebugging && 'text-amber-500'
    )

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {isDisabled ? (
            <div
              className={cn(
                'inline-flex h-12 w-12 cursor-not-allowed items-center justify-center',
                'rounded-[11px] border bg-card text-card-foreground opacity-50',
                'transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
                isDebugging && 'text-amber-500'
              )}
            >
              <Bug className='h-5 w-5' />
            </div>
          ) : (
            <Button variant='outline' onClick={handleDebugToggle} className={buttonClass}>
              <Bug className='h-5 w-5' />
              <span className='sr-only'>{getTooltipText()}</span>
            </Button>
          )}
        </TooltipTrigger>
        <TooltipContent>{getTooltipText()}</TooltipContent>
      </Tooltip>
    )
  }

  /**
   * Render run workflow button
   */
  const renderRunButton = () => {
    const canRun = userPermissions.canRead // Running only requires read permissions
    const isLoadingPermissions = userPermissions.isLoading
    const isButtonDisabled = isWorkflowBlocked || (!canRun && !isLoadingPermissions)

    const getTooltipContent = () => {
      if (hasValidationErrors) {
        return (
          <div className='text-center'>
            <p className='font-medium text-destructive'>Workflow Has Errors</p>
            <p className='text-xs'>
              Nested subflows are not supported. Remove subflow blocks from inside other subflow
              blocks.
            </p>
          </div>
        )
      }

      if (!canRun && !isLoadingPermissions) {
        return 'Read permission required to run workflows'
      }

      if (usageExceeded) {
        return (
          <div className='text-center'>
            <p className='font-medium text-destructive'>Usage Limit Exceeded</p>
            <p className='text-xs'>
              You've used {usageData?.currentUsage?.toFixed(2) || 0}$ of{' '}
              {usageData?.limit?.toFixed(2) || 0}$ Upgrade your plan to continue.
            </p>
          </div>
        )
      }

      return 'Run'
    }

    const handleRunClick = () => {
      openConsolePanel()

      if (usageExceeded) {
        openSubscriptionSettings()
      } else {
        handleRunWorkflow()
      }
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(
              'gap-2 font-medium',
              'bg-[#701FFC] hover:bg-[#6518E6]',
              'shadow-[0_0_0_0_#701FFC] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
              'text-white transition-all duration-200',
              isExecuting &&
                'relative after:absolute after:inset-0 after:animate-pulse after:bg-white/20',
              'disabled:opacity-50 disabled:hover:bg-[#701FFC] disabled:hover:shadow-none',
              'h-12 rounded-[11px] px-4 py-2'
            )}
            onClick={handleRunClick}
            disabled={isButtonDisabled}
          >
            <Play className={cn('h-3.5 w-3.5', 'fill-current stroke-current')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent command={getKeyboardShortcutText('Enter', true)}>
          {getTooltipContent()}
        </TooltipContent>
      </Tooltip>
    )
  }

  /**
   * Get workflows in the exact order they appear in the sidebar
   */
  const getSidebarOrderedWorkflows = () => {
    // Get and sort regular workflows by last modified (newest first)
    const regularWorkflows = Object.values(workflows)
      .filter((workflow) => workflow.workspaceId === workspaceId)
      .filter((workflow) => workflow.marketplaceData?.status !== 'temp')
      .sort((a, b) => {
        const dateA =
          a.lastModified instanceof Date
            ? a.lastModified.getTime()
            : new Date(a.lastModified).getTime()
        const dateB =
          b.lastModified instanceof Date
            ? b.lastModified.getTime()
            : new Date(b.lastModified).getTime()
        return dateB - dateA
      })

    // Group workflows by folder
    const workflowsByFolder = regularWorkflows.reduce(
      (acc, workflow) => {
        const folderId = workflow.folderId || 'root'
        if (!acc[folderId]) acc[folderId] = []
        acc[folderId].push(workflow)
        return acc
      },
      {} as Record<string, typeof regularWorkflows>
    )

    const orderedWorkflows: typeof regularWorkflows = []

    // Recursively collect workflows from expanded folders
    const collectFromFolders = (folders: ReturnType<typeof getFolderTree>) => {
      folders.forEach((folder) => {
        if (expandedFolders.has(folder.id)) {
          orderedWorkflows.push(...(workflowsByFolder[folder.id] || []))
          if (folder.children.length > 0) {
            collectFromFolders(folder.children)
          }
        }
      })
    }

    // Get workflows from expanded folders first, then root workflows
    if (workspaceId) collectFromFolders(getFolderTree(workspaceId))
    orderedWorkflows.push(...(workflowsByFolder.root || []))

    return orderedWorkflows
  }

  /**
   * Render disconnection notice
   */
  const renderDisconnectionNotice = () => {
    if (!userPermissions.isOfflineMode) return null

    const handleRefresh = () => {
      window.location.reload()
    }

    return (
      <div className='flex h-12 items-center gap-2 rounded-[11px] border border-red-500 bg-red-500 px-3 text-white shadow-xs'>
        <Tooltip>
          <TooltipTrigger asChild>
            <WifiOff className='h-[18px] w-[18px] cursor-help' />
          </TooltipTrigger>
          <TooltipContent className='mt-3'>Connection lost - refresh</TooltipContent>
        </Tooltip>
        <Button
          variant='ghost'
          size='sm'
          onClick={handleRefresh}
          className='h-8 bg-white px-2 text-red-500 hover:bg-red-50'
        >
          <RefreshCw className='h-3 w-3' />
        </Button>
      </div>
    )
  }

  /**
   * Render control bar toggle button
   */
  const renderToggleButton = () => {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='outline'
            onClick={() => setIsExpanded(!isExpanded)}
            className='h-12 w-12 rounded-[11px] border bg-card text-card-foreground shadow-xs hover:bg-secondary'
          >
            <ChevronLeft
              className={cn(
                'h-5 w-5 transition-transform duration-200',
                isExpanded && 'rotate-180'
              )}
            />
            <span className='sr-only'>{isExpanded ? 'Collapse' : 'Expand'} Control Bar</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isExpanded ? 'Collapse' : 'Expand'} Control Bar</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className='fixed top-4 right-4 z-20 flex items-center gap-1'>
      {renderDisconnectionNotice()}
      {renderToggleButton()}
      {isExpanded && <ExportControls />}
      {isExpanded && renderAutoLayoutButton()}
      {isExpanded && renderDuplicateButton()}
      {renderDeleteButton()}
      {!isDebugging && renderDebugModeToggle()}
      {renderPublishButton()}
      {renderDeployButton()}
      {isDebugging ? renderDebugControlsBar() : renderRunButton()}

      {/* Template Modal */}
      {activeWorkflowId && (
        <TemplateModal
          open={isTemplateModalOpen}
          onOpenChange={setIsTemplateModalOpen}
          workflowId={activeWorkflowId}
        />
      )}
    </div>
  )
}
