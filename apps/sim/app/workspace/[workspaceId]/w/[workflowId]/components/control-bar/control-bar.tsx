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
  Webhook,
  WifiOff,
  X,
} from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { getEnv, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  DeploymentControls,
  ExportControls,
  TemplateModal,
  WebhookSettings,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import {
  getKeyboardShortcutText,
  useKeyboardShortcuts,
} from '@/app/workspace/[workspaceId]/w/hooks/use-keyboard-shortcuts'
import { useFolderStore } from '@/stores/folders/store'
import { useOperationQueueStore } from '@/stores/operation-queue/store'
import { usePanelStore } from '@/stores/panel/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useSubscriptionStore } from '@/stores/subscription/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

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
  const { isExecuting, handleRunWorkflow, handleCancelExecution } = useWorkflowExecution()
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
  const [isWebhookSettingsOpen, setIsWebhookSettingsOpen] = useState(false)
  const [isAutoLayouting, setIsAutoLayouting] = useState(false)

  // Delete workflow state - grouped for better organization
  const [deleteState, setDeleteState] = useState({
    showDialog: false,
    isDeleting: false,
    hasPublishedTemplates: false,
    publishedTemplates: [] as any[],
    showTemplateChoice: false,
  })

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
  const currentEdges = useWorkflowStore((state) => state.edges)
  const subBlockValues = useSubBlockStore((state) =>
    activeWorkflowId ? state.workflowValues[activeWorkflowId] : null
  )

  useEffect(() => {
    // Avoid off-by-one false positives: wait until operation queue is idle
    const { operations, isProcessing } = useOperationQueueStore.getState()
    const hasPendingOps =
      isProcessing || operations.some((op) => op.status === 'pending' || op.status === 'processing')

    if (!activeWorkflowId || !deployedState) {
      setChangeDetected(false)
      return
    }

    if (isLoadingDeployedState || hasPendingOps) {
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
  }, [
    activeWorkflowId,
    deployedState,
    currentBlocks,
    currentEdges,
    subBlockValues,
    isLoadingDeployedState,
    useOperationQueueStore.getState().isProcessing,
    useOperationQueueStore.getState().operations.length,
  ])

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
      // Primary: call server-side usage check to mirror backend enforcement
      const res = await fetch('/api/usage?context=user', { cache: 'no-store' })
      if (res.ok) {
        const payload = await res.json()
        const usage = payload?.data
        // Update cache
        usageDataCache = { data: usage, timestamp: now, expirationMs: usageDataCache.expirationMs }
        return usage
      }

      // Fallback: use store if API not available
      const { getUsage, refresh } = useSubscriptionStore.getState()
      if (forceRefresh) await refresh()
      const usage = getUsage()

      // Update cache
      usageDataCache = { data: usage, timestamp: now, expirationMs: usageDataCache.expirationMs }
      return usage
    } catch (error) {
      logger.error('Error checking usage limits:', { error })
      return null
    }
  }

  /**
   * Reset delete state
   */
  const resetDeleteState = useCallback(() => {
    setDeleteState({
      showDialog: false,
      isDeleting: false,
      hasPublishedTemplates: false,
      publishedTemplates: [],
      showTemplateChoice: false,
    })
  }, [])

  /**
   * Navigate to next workflow after deletion
   */
  const navigateAfterDeletion = useCallback(
    (currentWorkflowId: string) => {
      const sidebarWorkflows = getSidebarOrderedWorkflows()
      const currentIndex = sidebarWorkflows.findIndex((w) => w.id === currentWorkflowId)

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
    },
    [workspaceId, router]
  )

  /**
   * Check if workflow has published templates
   */
  const checkPublishedTemplates = useCallback(async (workflowId: string) => {
    const checkResponse = await fetch(`/api/workflows/${workflowId}?check-templates=true`, {
      method: 'DELETE',
    })

    if (!checkResponse.ok) {
      throw new Error(`Failed to check templates: ${checkResponse.statusText}`)
    }

    return await checkResponse.json()
  }, [])

  /**
   * Delete workflow with optional template handling
   */
  const deleteWorkflowWithTemplates = useCallback(
    async (workflowId: string, templateAction?: 'keep' | 'delete') => {
      const endpoint = templateAction
        ? `/api/workflows/${workflowId}?deleteTemplates=${templateAction}`
        : null

      if (endpoint) {
        // Use custom endpoint for template handling
        const response = await fetch(endpoint, { method: 'DELETE' })
        if (!response.ok) {
          throw new Error(`Failed to delete workflow: ${response.statusText}`)
        }

        // Manual registry cleanup since we used custom API
        useWorkflowRegistry.setState((state) => {
          const newWorkflows = { ...state.workflows }
          delete newWorkflows[workflowId]

          return {
            ...state,
            workflows: newWorkflows,
            activeWorkflowId: state.activeWorkflowId === workflowId ? null : state.activeWorkflowId,
          }
        })
      } else {
        // Use registry's built-in deletion (handles database + state)
        await useWorkflowRegistry.getState().removeWorkflow(workflowId)
      }
    },
    []
  )

  /**
   * Handle deleting the current workflow - called after user confirms
   */
  const handleDeleteWorkflow = useCallback(async () => {
    const currentWorkflowId = params.workflowId as string
    if (!currentWorkflowId || !userPermissions.canEdit) return

    setDeleteState((prev) => ({ ...prev, isDeleting: true }))

    try {
      // Check if workflow has published templates
      const checkData = await checkPublishedTemplates(currentWorkflowId)

      if (checkData.hasPublishedTemplates) {
        setDeleteState((prev) => ({
          ...prev,
          hasPublishedTemplates: true,
          publishedTemplates: checkData.publishedTemplates || [],
          showTemplateChoice: true,
          isDeleting: false, // Stop showing "Deleting..." and show template choice
        }))
        return
      }

      // No templates, proceed with standard deletion
      navigateAfterDeletion(currentWorkflowId)
      await deleteWorkflowWithTemplates(currentWorkflowId)
      resetDeleteState()
    } catch (error) {
      logger.error('Error deleting workflow:', error)
      setDeleteState((prev) => ({ ...prev, isDeleting: false }))
    }
  }, [
    params.workflowId,
    userPermissions.canEdit,
    checkPublishedTemplates,
    navigateAfterDeletion,
    deleteWorkflowWithTemplates,
    resetDeleteState,
  ])

  /**
   * Handle template action selection
   */
  const handleTemplateAction = useCallback(
    async (action: 'keep' | 'delete') => {
      const currentWorkflowId = params.workflowId as string
      if (!currentWorkflowId || !userPermissions.canEdit) return

      setDeleteState((prev) => ({ ...prev, isDeleting: true }))

      try {
        logger.info(`Deleting workflow ${currentWorkflowId} with template action: ${action}`)

        navigateAfterDeletion(currentWorkflowId)
        await deleteWorkflowWithTemplates(currentWorkflowId, action)

        logger.info(
          `Successfully deleted workflow ${currentWorkflowId} with template action: ${action}`
        )
        resetDeleteState()
      } catch (error) {
        logger.error('Error deleting workflow:', error)
        setDeleteState((prev) => ({ ...prev, isDeleting: false }))
      }
    },
    [
      params.workflowId,
      userPermissions.canEdit,
      navigateAfterDeletion,
      deleteWorkflowWithTemplates,
      resetDeleteState,
    ]
  )

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
            <div className='inline-flex h-12 w-12 cursor-not-allowed items-center justify-center rounded-[11px] border bg-card text-card-foreground opacity-50 shadow-xs transition-colors'>
              <Trash2 className='h-4 w-4' />
            </div>
          </TooltipTrigger>
          <TooltipContent>{getTooltipText()}</TooltipContent>
        </Tooltip>
      )
    }

    return (
      <AlertDialog
        open={deleteState.showDialog}
        onOpenChange={(open) => {
          if (open) {
            // Reset all state when opening dialog to ensure clean start
            setDeleteState({
              showDialog: true,
              isDeleting: false,
              hasPublishedTemplates: false,
              publishedTemplates: [],
              showTemplateChoice: false,
            })
          } else {
            resetDeleteState()
          }
        }}
      >
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
            <AlertDialogTitle>
              {deleteState.showTemplateChoice ? 'Published Templates Found' : 'Delete workflow?'}
            </AlertDialogTitle>
            {deleteState.showTemplateChoice ? (
              <div className='space-y-3'>
                <AlertDialogDescription>
                  This workflow has {deleteState.publishedTemplates.length} published template
                  {deleteState.publishedTemplates.length > 1 ? 's' : ''}:
                </AlertDialogDescription>
                {deleteState.publishedTemplates.length > 0 && (
                  <ul className='list-disc space-y-1 pl-6'>
                    {deleteState.publishedTemplates.map((template) => (
                      <li key={template.id}>{template.name}</li>
                    ))}
                  </ul>
                )}
                <AlertDialogDescription>
                  What would you like to do with the published template
                  {deleteState.publishedTemplates.length > 1 ? 's' : ''}?
                </AlertDialogDescription>
              </div>
            ) : (
              <AlertDialogDescription>
                Deleting this workflow will permanently remove all associated blocks, executions,
                and configuration.{' '}
                <span className='text-red-500 dark:text-red-500'>
                  This action cannot be undone.
                </span>
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter className='flex'>
            {deleteState.showTemplateChoice ? (
              <div className='flex w-full gap-2'>
                <Button
                  variant='outline'
                  onClick={() => handleTemplateAction('keep')}
                  disabled={deleteState.isDeleting}
                  className='h-9 flex-1 rounded-[8px]'
                >
                  Keep templates
                </Button>
                <Button
                  onClick={() => handleTemplateAction('delete')}
                  disabled={deleteState.isDeleting}
                  className='h-9 flex-1 rounded-[8px] bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
                >
                  {deleteState.isDeleting ? 'Deleting...' : 'Delete templates'}
                </Button>
              </div>
            ) : (
              <>
                <AlertDialogCancel className='h-9 w-full rounded-[8px]'>Cancel</AlertDialogCancel>
                <Button
                  onClick={(e) => {
                    e.preventDefault()
                    handleDeleteWorkflow()
                  }}
                  disabled={deleteState.isDeleting}
                  className='h-9 w-full rounded-[8px] bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
                >
                  {deleteState.isDeleting ? 'Deleting...' : 'Delete'}
                </Button>
              </>
            )}
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
   * Render webhook settings button
   */
  const renderWebhookButton = () => {
    // Only show webhook button if Trigger.dev is enabled
    const isTriggerEnabled = isTruthy(getEnv('NEXT_PUBLIC_TRIGGER_DEV_ENABLED'))
    if (!isTriggerEnabled) return null

    const canEdit = userPermissions.canEdit
    const isDisabled = !canEdit

    const getTooltipText = () => {
      if (!canEdit) return 'Admin permission required to configure webhooks'
      return 'Configure webhook notifications'
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='outline'
            size='icon'
            disabled={isDisabled}
            onClick={() => setIsWebhookSettingsOpen(true)}
            className='h-12 w-12 rounded-[11px] border bg-card text-card-foreground shadow-xs hover:bg-secondary'
          >
            <Webhook className='h-5 w-5' />
            <span className='sr-only'>Webhook Settings</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{getTooltipText()}</TooltipContent>
      </Tooltip>
    )
  }

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
            <div className='inline-flex h-12 w-12 cursor-not-allowed items-center justify-center rounded-[11px] border bg-card text-card-foreground opacity-50 shadow-xs transition-colors'>
              <Copy className='h-4 w-4' />
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
    const handleAutoLayoutClick = async () => {
      if (isExecuting || isDebugging || !userPermissions.canEdit || isAutoLayouting) {
        return
      }

      setIsAutoLayouting(true)
      try {
        // Use the shared auto layout utility for immediate frontend updates
        const { applyAutoLayoutAndUpdateStore } = await import('../../utils/auto-layout')

        const result = await applyAutoLayoutAndUpdateStore(activeWorkflowId!)

        if (result.success) {
          logger.info('Auto layout completed successfully')
        } else {
          logger.error('Auto layout failed:', result.error)
          // You could add a toast notification here if available
        }
      } catch (error) {
        logger.error('Auto layout error:', error)
        // You could add a toast notification here if available
      } finally {
        setIsAutoLayouting(false)
      }
    }

    const canEdit = userPermissions.canEdit
    const isDisabled = isExecuting || isDebugging || !canEdit || isAutoLayouting

    const getTooltipText = () => {
      if (!canEdit) return 'Admin permission required to use auto-layout'
      if (isDebugging) return 'Cannot auto-layout while debugging'
      if (isExecuting) return 'Cannot auto-layout while workflow is running'
      if (isAutoLayouting) return 'Applying auto-layout...'
      return 'Auto layout'
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {isDisabled ? (
            <div className='inline-flex h-12 w-12 cursor-not-allowed items-center justify-center rounded-[11px] border bg-card text-card-foreground opacity-50 shadow-xs transition-colors'>
              {isAutoLayouting ? (
                <RefreshCw className='h-4 w-4 animate-spin' />
              ) : (
                <Layers className='h-4 w-4' />
              )}
            </div>
          ) : (
            <Button
              variant='outline'
              onClick={handleAutoLayoutClick}
              className='h-12 w-12 rounded-[11px] border bg-card text-card-foreground shadow-xs hover:bg-secondary'
              disabled={isAutoLayouting}
            >
              {isAutoLayouting ? (
                <RefreshCw className='h-5 w-5 animate-spin' />
              ) : (
                <Layers className='h-5 w-5' />
              )}
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
      'bg-[var(--brand-primary-hex)] hover:bg-[var(--brand-primary-hover-hex)]',
      'shadow-[0_0_0_0_var(--brand-primary-hex)] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]]',
      'text-white transition-all duration-200',
      'disabled:opacity-50 disabled:hover:bg-[var(--brand-primary-hex)] disabled:hover:shadow-none'
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
            <div className='inline-flex h-12 w-12 cursor-not-allowed items-center justify-center rounded-[11px] border bg-card text-card-foreground opacity-50 shadow-xs transition-colors'>
              <Store className='h-4 w-4' />
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
                'shadow-xs transition-colors',
                isDebugging && 'text-amber-500'
              )}
            >
              <Bug className='h-4 w-4' />
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
   * Render run workflow button or cancel button when executing
   */
  const renderRunButton = () => {
    const canRun = userPermissions.canRead // Running only requires read permissions
    const isLoadingPermissions = userPermissions.isLoading
    const isButtonDisabled =
      !isExecuting && (isWorkflowBlocked || (!canRun && !isLoadingPermissions))

    // If currently executing, show cancel button
    if (isExecuting) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className={cn(
                'gap-2 font-medium',
                'bg-red-500 hover:bg-red-600',
                'shadow-[0_0_0_0_#ef4444] hover:shadow-[0_0_0_4px_rgba(239,68,68,0.15)]',
                'text-white transition-all duration-200',
                'h-12 rounded-[11px] px-4 py-2'
              )}
              onClick={handleCancelExecution}
            >
              <X className={cn('h-3.5 w-3.5')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Cancel execution</TooltipContent>
        </Tooltip>
      )
    }

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
              'bg-[var(--brand-primary-hex)] hover:bg-[var(--brand-primary-hover-hex)]',
              'shadow-[0_0_0_0_var(--brand-primary-hex)] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
              'text-white transition-all duration-200',
              'disabled:opacity-50 disabled:hover:bg-[var(--brand-primary-hex)] disabled:hover:shadow-none',
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
    // Get and sort regular workflows by creation date (newest first) for stable ordering
    const regularWorkflows = Object.values(workflows)
      .filter((workflow) => workflow.workspaceId === workspaceId)
      .filter((workflow) => workflow.marketplaceData?.status !== 'temp')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

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
      {isExpanded && renderWebhookButton()}
      {isExpanded && <ExportControls />}
      {isExpanded && renderAutoLayoutButton()}
      {isExpanded && renderPublishButton()}
      {renderDeleteButton()}
      {renderDuplicateButton()}
      {!isDebugging && renderDebugModeToggle()}
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

      {/* Webhook Settings */}
      {activeWorkflowId && (
        <WebhookSettings
          open={isWebhookSettingsOpen}
          onOpenChange={setIsWebhookSettingsOpen}
          workflowId={activeWorkflowId}
        />
      )}
    </div>
  )
}
