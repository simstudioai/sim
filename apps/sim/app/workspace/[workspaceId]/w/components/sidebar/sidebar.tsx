'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { ScrollArea } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { getEnv, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { generateWorkspaceName } from '@/lib/naming'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { SearchModal } from '@/app/workspace/[workspaceId]/w/components/search-modal/search-modal'
import {
  CreateMenu,
  FloatingNavigation,
  FolderTree,
  HelpModal,
  KeyboardShortcut,
  KnowledgeBaseTags,
  KnowledgeTags,
  LogsFilters,
  SettingsModal,
  SubscriptionModal,
  Toolbar,
  UsageIndicator,
  WorkspaceHeader,
  WorkspaceSelector,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import { InviteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-selector/components/invite-modal/invite-modal'
import { useAutoScroll } from '@/app/workspace/[workspaceId]/w/hooks/use-auto-scroll'
import {
  getKeyboardShortcutText,
  useGlobalShortcuts,
} from '@/app/workspace/[workspaceId]/w/hooks/use-keyboard-shortcuts'
import { useKnowledgeBasesList } from '@/hooks/use-knowledge'
import { useSubscriptionStore } from '@/stores/subscription/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

const logger = createLogger('Sidebar')

const SIDEBAR_GAP = 12 // 12px gap between components - easily editable

const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))

// Heights for dynamic calculation (in px)
const SIDEBAR_HEIGHTS = {
  CONTAINER_PADDING: 32, // p-4 = 16px top + 16px bottom (bottom provides control bar spacing match)
  WORKSPACE_HEADER: 48, // estimated height of workspace header
  SEARCH: 48, // h-12
  WORKFLOW_SELECTOR: 212, // h-[212px]
  NAVIGATION: 42, // h-[42px] buttons
  WORKSPACE_SELECTOR: 171, // optimized height: p-2(16) + h-[104px](104) + mt-2(8) + border-t(1) + pt-2(8) + h-8(32) = 169px
  USAGE_INDICATOR: 58, // actual height: border(2) + py-2.5(20) + content(~36) = 58px
}

/**
 * Workspace entity interface
 */
interface Workspace {
  id: string
  name: string
  ownerId: string
  role?: string
  membershipId?: string
  permissions?: 'admin' | 'write' | 'read' | null
}

/**
 * Template data interface for search modal
 */
interface TemplateData {
  id: string
  title: string
  description: string
  author: string
  usageCount: string
  stars: number
  icon: string
  iconColor: string
  state?: {
    blocks?: Record<string, { type: string; name?: string }>
  }
  isStarred?: boolean
}

export function Sidebar() {
  useGlobalShortcuts()

  const {
    workflows,
    createWorkflow,
    isLoading: workflowsLoading,
    loadWorkflows,
    switchToWorkspace,
  } = useWorkflowRegistry()
  const { data: sessionData, isPending: sessionLoading } = useSession()
  const userPermissions = useUserPermissionsContext()
  const isLoading = workflowsLoading || sessionLoading

  // Add state to prevent multiple simultaneous workflow creations
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false)
  // Add state to prevent multiple simultaneous workspace creations
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false)
  // Add sidebar collapsed state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  const params = useParams()
  const workspaceId = params.workspaceId as string
  const workflowId = params.workflowId as string
  const pathname = usePathname()
  const router = useRouter()

  // Template data for search modal
  const [templates, setTemplates] = useState<TemplateData[]>([])
  const [isTemplatesLoading, setIsTemplatesLoading] = useState(false)

  // Knowledge bases for search modal
  const { knowledgeBases } = useKnowledgeBasesList(workspaceId)

  // Refs
  const workflowScrollAreaRef = useRef<HTMLDivElement | null>(null)
  const workspaceIdRef = useRef<string>(workspaceId)
  const routerRef = useRef<ReturnType<typeof useRouter>>(router)
  const isInitializedRef = useRef<boolean>(false)
  const activeWorkspaceRef = useRef<Workspace | null>(null)

  // Update refs when values change
  workspaceIdRef.current = workspaceId
  routerRef.current = router

  // Workspace selector visibility state
  const [isWorkspaceSelectorVisible, setIsWorkspaceSelectorVisible] = useState(false)

  // Workspace management state
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null)
  const [isWorkspacesLoading, setIsWorkspacesLoading] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)

  // Auto-scroll state for drag operations
  const [isDragging, setIsDragging] = useState(false)

  // Update activeWorkspace ref when state changes
  activeWorkspaceRef.current = activeWorkspace

  // Check if we're on a workflow page
  const isOnWorkflowPage = useMemo(() => {
    // Pattern: /workspace/[workspaceId]/w/[workflowId]
    const workflowPageRegex = /^\/workspace\/[^/]+\/w\/[^/]+$/
    return workflowPageRegex.test(pathname)
  }, [pathname])

  // Check if we're on the logs page
  const isOnLogsPage = useMemo(() => {
    // Pattern: /workspace/[workspaceId]/logs
    const logsPageRegex = /^\/workspace\/[^/]+\/logs$/
    return logsPageRegex.test(pathname)
  }, [pathname])

  // Check if we're on any knowledge base page (overview or document)
  const isOnKnowledgePage = useMemo(() => {
    // Pattern: /workspace/[workspaceId]/knowledge/[id] or /workspace/[workspaceId]/knowledge/[id]/[documentId]
    const knowledgePageRegex = /^\/workspace\/[^/]+\/knowledge\/[^/]+/
    return knowledgePageRegex.test(pathname)
  }, [pathname])

  // Extract knowledge base ID and document ID from the pathname
  const { knowledgeBaseId, documentId } = useMemo(() => {
    if (!isOnKnowledgePage) {
      return { knowledgeBaseId: null, documentId: null }
    }

    // Handle both KB overview (/knowledge/[kbId]) and document page (/knowledge/[kbId]/[docId])
    const kbOverviewMatch = pathname.match(/^\/workspace\/[^/]+\/knowledge\/([^/]+)$/)
    const docPageMatch = pathname.match(/^\/workspace\/[^/]+\/knowledge\/([^/]+)\/([^/]+)$/)

    if (docPageMatch) {
      // Document page - has both kbId and docId
      return {
        knowledgeBaseId: docPageMatch[1],
        documentId: docPageMatch[2],
      }
    }
    if (kbOverviewMatch) {
      // KB overview page - has only kbId
      return {
        knowledgeBaseId: kbOverviewMatch[1],
        documentId: null,
      }
    }

    return { knowledgeBaseId: null, documentId: null }
  }, [pathname, isOnKnowledgePage])

  // Use optimized auto-scroll hook
  const { handleDragOver, stopScroll } = useAutoScroll(workflowScrollAreaRef)

  // Consolidated drag event management with optimized cleanup
  useEffect(() => {
    if (!isDragging) return

    const handleDragEnd = () => {
      setIsDragging(false)
      stopScroll()
    }

    const options = { passive: true } as const
    document.addEventListener('dragover', handleDragOver, options)
    document.addEventListener('dragend', handleDragEnd, options)
    document.addEventListener('drop', handleDragEnd, options)

    return () => {
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('dragend', handleDragEnd)
      document.removeEventListener('drop', handleDragEnd)
      stopScroll()
    }
  }, [isDragging, handleDragOver, stopScroll])

  /**
   * Refresh workspace list without validation logic - used for non-current workspace operations
   */
  const refreshWorkspaceList = useCallback(async () => {
    setIsWorkspacesLoading(true)
    try {
      const response = await fetch('/api/workspaces')
      const data = await response.json()

      if (data.workspaces && Array.isArray(data.workspaces)) {
        const fetchedWorkspaces = data.workspaces as Workspace[]
        setWorkspaces(fetchedWorkspaces)

        // Only update activeWorkspace if it still exists in the fetched workspaces
        // Use current state to avoid dependency on activeWorkspace
        setActiveWorkspace((currentActive) => {
          if (!currentActive) {
            return currentActive
          }

          const matchingWorkspace = fetchedWorkspaces.find(
            (workspace) => workspace.id === currentActive.id
          )
          if (matchingWorkspace) {
            return matchingWorkspace
          }

          // Active workspace was deleted, clear it
          logger.warn(`Active workspace ${currentActive.id} no longer exists`)
          return null
        })
      }
    } catch (err) {
      logger.error('Error refreshing workspace list:', err)
    } finally {
      setIsWorkspacesLoading(false)
    }
  }, []) // Remove activeWorkspace dependency

  /**
   * Fetch workspaces for the current user with full validation and URL handling
   */
  const fetchWorkspaces = useCallback(async () => {
    setIsWorkspacesLoading(true)
    try {
      const response = await fetch('/api/workspaces')
      const data = await response.json()

      if (data.workspaces && Array.isArray(data.workspaces)) {
        const fetchedWorkspaces = data.workspaces as Workspace[]
        setWorkspaces(fetchedWorkspaces)

        // Handle active workspace selection with URL validation using refs
        const currentWorkspaceId = workspaceIdRef.current
        const currentRouter = routerRef.current

        if (currentWorkspaceId) {
          const matchingWorkspace = fetchedWorkspaces.find(
            (workspace) => workspace.id === currentWorkspaceId
          )
          if (matchingWorkspace) {
            setActiveWorkspace(matchingWorkspace)
          } else {
            logger.warn(`Workspace ${currentWorkspaceId} not found in user's workspaces`)

            // Fallback to first workspace if current not found - FIX: Update URL to match
            if (fetchedWorkspaces.length > 0) {
              const fallbackWorkspace = fetchedWorkspaces[0]
              setActiveWorkspace(fallbackWorkspace)

              // Update URL to match the fallback workspace
              logger.info(`Redirecting to fallback workspace: ${fallbackWorkspace.id}`)
              currentRouter?.push(`/workspace/${fallbackWorkspace.id}/w`)
            } else {
              logger.error('No workspaces available for user')
            }
          }
        }
      }
    } catch (err) {
      logger.error('Error fetching workspaces:', err)
    } finally {
      setIsWorkspacesLoading(false)
    }
  }, []) // Remove workspaceId and router dependencies

  /**
   * Update workspace name both in API and local state
   */
  const updateWorkspaceName = useCallback(
    async (workspaceId: string, newName: string): Promise<boolean> => {
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim() }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to update workspace name')
        }

        // Update local state immediately after successful API call
        setActiveWorkspace((prev) => (prev ? { ...prev, name: newName.trim() } : null))
        setWorkspaces((prev) =>
          prev.map((workspace) =>
            workspace.id === workspaceId ? { ...workspace, name: newName.trim() } : workspace
          )
        )

        logger.info('Successfully updated workspace name to:', newName.trim())
        return true
      } catch (error) {
        logger.error('Error updating workspace name:', error)
        return false
      }
    },
    []
  )

  /**
   * Switch to a different workspace
   */
  const switchWorkspace = useCallback(
    async (workspace: Workspace) => {
      // If already on this workspace, return
      if (activeWorkspaceRef.current?.id === workspace.id) {
        return
      }

      try {
        // Switch workspace and update URL
        await switchToWorkspace(workspace.id)
        routerRef.current?.push(`/workspace/${workspace.id}/w`)
        logger.info(`Switched to workspace: ${workspace.name} (${workspace.id})`)
      } catch (error) {
        logger.error('Error switching workspace:', error)
      }
    },
    [switchToWorkspace] // Removed activeWorkspace and router dependencies
  )

  /**
   * Handle create workspace
   */
  const handleCreateWorkspace = useCallback(async () => {
    if (isCreatingWorkspace) {
      logger.info('Workspace creation already in progress, ignoring request')
      return
    }

    try {
      setIsCreatingWorkspace(true)
      logger.info('Creating new workspace')

      // Generate workspace name using utility function
      const workspaceName = await generateWorkspaceName()

      logger.info(`Generated workspace name: ${workspaceName}`)

      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: workspaceName,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create workspace')
      }

      const data = await response.json()
      const newWorkspace = data.workspace

      logger.info('Created new workspace:', newWorkspace)

      // Refresh workspace list (no URL validation needed for creation)
      await refreshWorkspaceList()

      // Switch to the new workspace
      await switchWorkspace(newWorkspace)
    } catch (error) {
      logger.error('Error creating workspace:', error)
    } finally {
      setIsCreatingWorkspace(false)
    }
  }, [refreshWorkspaceList, switchWorkspace, isCreatingWorkspace])

  /**
   * Confirm delete workspace (called from regular deletion dialog)
   */
  const confirmDeleteWorkspace = useCallback(
    async (workspaceToDelete: Workspace, templateAction?: 'keep' | 'delete') => {
      setIsDeleting(true)
      try {
        logger.info('Deleting workspace:', workspaceToDelete.id)

        const deleteTemplates = templateAction === 'delete'

        const response = await fetch(`/api/workspaces/${workspaceToDelete.id}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ deleteTemplates }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to delete workspace')
        }

        logger.info('Workspace deleted successfully:', workspaceToDelete.id)

        // Check if we're deleting the current workspace (either active or in URL)
        const isDeletingCurrentWorkspace =
          workspaceIdRef.current === workspaceToDelete.id ||
          activeWorkspaceRef.current?.id === workspaceToDelete.id

        if (isDeletingCurrentWorkspace) {
          // For current workspace deletion, use full fetchWorkspaces with URL validation
          logger.info(
            'Deleting current workspace - using full workspace refresh with URL validation'
          )
          await fetchWorkspaces()

          // If we deleted the active workspace, switch to the first available workspace
          if (activeWorkspaceRef.current?.id === workspaceToDelete.id) {
            const remainingWorkspaces = workspaces.filter((w) => w.id !== workspaceToDelete.id)
            if (remainingWorkspaces.length > 0) {
              await switchWorkspace(remainingWorkspaces[0])
            }
          }
        } else {
          // For non-current workspace deletion, just refresh the list without URL validation
          logger.info('Deleting non-current workspace - using simple list refresh')
          await refreshWorkspaceList()
        }
      } catch (error) {
        logger.error('Error deleting workspace:', error)
      } finally {
        setIsDeleting(false)
      }
    },
    [fetchWorkspaces, refreshWorkspaceList, workspaces, switchWorkspace]
  )

  /**
   * Handle leave workspace
   */
  const handleLeaveWorkspace = useCallback(
    async (workspaceToLeave: Workspace) => {
      setIsLeaving(true)
      try {
        logger.info('Leaving workspace:', workspaceToLeave.id)

        // Use the existing member removal API with current user's ID
        const response = await fetch(`/api/workspaces/members/${sessionData?.user?.id}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            workspaceId: workspaceToLeave.id,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to leave workspace')
        }

        logger.info('Left workspace successfully:', workspaceToLeave.id)

        // Check if we're leaving the current workspace (either active or in URL)
        const isLeavingCurrentWorkspace =
          workspaceIdRef.current === workspaceToLeave.id ||
          activeWorkspaceRef.current?.id === workspaceToLeave.id

        if (isLeavingCurrentWorkspace) {
          // For current workspace leaving, use full fetchWorkspaces with URL validation
          logger.info(
            'Leaving current workspace - using full workspace refresh with URL validation'
          )
          await fetchWorkspaces()

          // If we left the active workspace, switch to the first available workspace
          if (activeWorkspaceRef.current?.id === workspaceToLeave.id) {
            const remainingWorkspaces = workspaces.filter((w) => w.id !== workspaceToLeave.id)
            if (remainingWorkspaces.length > 0) {
              await switchWorkspace(remainingWorkspaces[0])
            }
          }
        } else {
          // For non-current workspace leaving, just refresh the list without URL validation
          logger.info('Leaving non-current workspace - using simple list refresh')
          await refreshWorkspaceList()
        }
      } catch (error) {
        logger.error('Error leaving workspace:', error)
      } finally {
        setIsLeaving(false)
      }
    },
    [fetchWorkspaces, refreshWorkspaceList, workspaces, switchWorkspace, sessionData?.user?.id]
  )

  /**
   * Validate workspace exists before making API calls
   */
  const isWorkspaceValid = useCallback(async (workspaceId: string) => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}`)
      return response.ok
    } catch {
      return false
    }
  }, [])

  /**
   * Fetch popular templates for search modal
   */
  const fetchTemplates = useCallback(async () => {
    setIsTemplatesLoading(true)
    try {
      // Fetch templates from API, ordered by views (most popular first)
      const response = await fetch('/api/templates?limit=8&offset=0')

      if (!response.ok) {
        throw new Error(`Failed to fetch templates: ${response.status}`)
      }

      const apiResponse = await response.json()

      // Map API response to TemplateData format
      const fetchedTemplates: TemplateData[] =
        apiResponse.data?.map((template: any) => ({
          id: template.id,
          title: template.name,
          description: template.description || '',
          author: template.author,
          usageCount: formatUsageCount(template.views || 0),
          stars: template.stars || 0,
          icon: template.icon || 'FileText',
          iconColor: template.color || '#6B7280',
          state: template.state,
          isStarred: template.isStarred || false,
        })) || []

      setTemplates(fetchedTemplates)
      logger.info(`Templates loaded successfully: ${fetchedTemplates.length} templates`)
    } catch (error) {
      logger.error('Error fetching templates:', error)
      // Set empty array on error
      setTemplates([])
    } finally {
      setIsTemplatesLoading(false)
    }
  }, [])

  /**
   * Format usage count for display (e.g., 1500 -> "1.5k")
   */
  const formatUsageCount = (count: number): string => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}m`
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`
    }
    return count.toString()
  }

  // Load workflows for the current workspace when workspaceId changes
  useEffect(() => {
    if (workspaceId) {
      // Validate workspace exists before loading workflows
      isWorkspaceValid(workspaceId).then((valid) => {
        if (valid) {
          loadWorkflows(workspaceId)
        } else {
          logger.warn(`Workspace ${workspaceId} no longer exists, triggering workspace refresh`)
          fetchWorkspaces() // This will handle the redirect through the fallback logic
        }
      })
    }
  }, [workspaceId, loadWorkflows]) // Removed isWorkspaceValid and fetchWorkspaces dependencies

  // Initialize workspace data on mount (uses full validation with URL handling)
  useEffect(() => {
    if (sessionData?.user?.id && !isInitializedRef.current) {
      isInitializedRef.current = true
      fetchWorkspaces()
      fetchTemplates()
    }
  }, [sessionData?.user?.id]) // Removed fetchWorkspaces dependency

  // Scroll to active workflow when it changes
  useEffect(() => {
    if (workflowId && !isLoading) {
      const scrollContainer = workflowScrollAreaRef.current
      if (scrollContainer) {
        const activeWorkflow = scrollContainer.querySelector(
          `[data-workflow-id="${workflowId}"]`
        ) as HTMLElement
        if (activeWorkflow) {
          // Check if this is a newly created workflow (created within the last 5 seconds)
          const currentWorkflow = workflows[workflowId]
          const isNewlyCreated =
            currentWorkflow &&
            currentWorkflow.lastModified instanceof Date &&
            Date.now() - currentWorkflow.lastModified.getTime() < 5000 // 5 seconds

          if (isNewlyCreated) {
            // For newly created workflows, use the original behavior - scroll to top
            activeWorkflow.scrollIntoView({
              block: 'start',
            })

            // Adjust scroll position to eliminate the small gap at the top
            const scrollViewport = scrollContainer.querySelector(
              '[data-radix-scroll-area-viewport]'
            ) as HTMLElement
            if (scrollViewport && scrollViewport.scrollTop > 0) {
              scrollViewport.scrollTop = Math.max(0, scrollViewport.scrollTop - 8)
            }
          } else {
            // For existing workflows, check if already visible and scroll minimally
            const containerRect = scrollContainer.getBoundingClientRect()
            const workflowRect = activeWorkflow.getBoundingClientRect()

            // Only scroll if the workflow is not fully visible
            const isFullyVisible =
              workflowRect.top >= containerRect.top && workflowRect.bottom <= containerRect.bottom

            if (!isFullyVisible) {
              // Use 'nearest' to scroll minimally - only bring into view, don't force to top
              activeWorkflow.scrollIntoView({
                block: 'nearest',
                behavior: 'smooth',
              })
            }
          }
        }
      }
    }
  }, [workflowId, isLoading, workflows])

  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showInviteMembers, setShowInviteMembers] = useState(false)
  const [showSearchModal, setShowSearchModal] = useState(false)
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false)

  // Separate regular workflows from temporary marketplace workflows
  const { regularWorkflows, tempWorkflows } = useMemo(() => {
    const regular: WorkflowMetadata[] = []
    const temp: WorkflowMetadata[] = []

    if (!isLoading) {
      Object.values(workflows).forEach((workflow) => {
        if (workflow.workspaceId === workspaceId || !workflow.workspaceId) {
          if (workflow.marketplaceData?.status === 'temp') {
            temp.push(workflow)
          } else {
            regular.push(workflow)
          }
        }
      })

      // Sort by creation date (newest first) for stable ordering
      const sortByCreatedAt = (a: WorkflowMetadata, b: WorkflowMetadata) => {
        return b.createdAt.getTime() - a.createdAt.getTime()
      }

      regular.sort(sortByCreatedAt)
      temp.sort(sortByCreatedAt)
    }

    return { regularWorkflows: regular, tempWorkflows: temp }
  }, [workflows, isLoading, workspaceId])

  // Prepare workflows for search modal
  const searchWorkflows = useMemo(() => {
    if (isLoading) return []

    const allWorkflows = [...regularWorkflows, ...tempWorkflows]
    return allWorkflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      href: `/workspace/${workspaceId}/w/${workflow.id}`,
      isCurrent: workflow.id === workflowId,
    }))
  }, [regularWorkflows, tempWorkflows, workspaceId, workflowId, isLoading])

  // Prepare workspaces for search modal (include all workspaces)
  const searchWorkspaces = useMemo(() => {
    return workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      href: `/workspace/${workspace.id}/w`,
      isCurrent: workspace.id === workspaceId,
    }))
  }, [workspaces, workspaceId])

  // Prepare knowledge bases for search modal
  const searchKnowledgeBases = useMemo(() => {
    return knowledgeBases.map((kb) => ({
      id: kb.id,
      name: kb.name,
      description: kb.description,
      href: `/workspace/${workspaceId}/knowledge/${kb.id}`,
      isCurrent: knowledgeBaseId === kb.id,
    }))
  }, [knowledgeBases, workspaceId, knowledgeBaseId])

  // Create workflow handler
  const handleCreateWorkflow = async (folderId?: string): Promise<string> => {
    if (isCreatingWorkflow) {
      logger.info('Workflow creation already in progress, ignoring request')
      throw new Error('Workflow creation already in progress')
    }

    try {
      setIsCreatingWorkflow(true)

      // Clear workflow diff store when creating a new workflow
      const { clearDiff } = useWorkflowDiffStore.getState()
      clearDiff()

      const id = await createWorkflow({
        workspaceId: workspaceId || undefined,
        folderId: folderId || undefined,
      })
      return id
    } catch (error) {
      logger.error('Error creating workflow:', error)
      throw error
    } finally {
      setIsCreatingWorkflow(false)
    }
  }

  // Toggle workspace selector visibility
  const toggleWorkspaceSelector = () => {
    setIsWorkspaceSelectorVisible((prev) => !prev)
  }

  // Toggle sidebar collapsed state
  const toggleSidebarCollapsed = () => {
    setIsSidebarCollapsed((prev) => !prev)
    // Hide workspace selector when collapsing sidebar
    if (!isSidebarCollapsed) {
      setIsWorkspaceSelectorVisible(false)
    }
  }

  // Calculate dynamic positions for floating elements
  const calculateFloatingPositions = useCallback(() => {
    const { CONTAINER_PADDING, WORKSPACE_HEADER, SEARCH, WORKFLOW_SELECTOR, WORKSPACE_SELECTOR } =
      SIDEBAR_HEIGHTS

    // Start from top padding
    let currentTop = CONTAINER_PADDING

    // Add workspace header
    currentTop += WORKSPACE_HEADER + SIDEBAR_GAP

    // Add workspace selector if visible and not collapsed
    if (isWorkspaceSelectorVisible && !isSidebarCollapsed) {
      currentTop += WORKSPACE_SELECTOR + SIDEBAR_GAP
    }

    // Add search (if not collapsed)
    if (!isSidebarCollapsed) {
      currentTop += SEARCH + SIDEBAR_GAP
    }

    // Add workflow selector
    currentTop += WORKFLOW_SELECTOR - 4

    // Toolbar position (for workflow pages) - consistent with sidebar spacing
    const toolbarTop = currentTop

    // Navigation position (always at bottom) - 16px spacing (space-4)
    const navigationBottom = 16

    return {
      toolbarTop,
      navigationBottom,
    }
  }, [isWorkspaceSelectorVisible, isSidebarCollapsed])

  const { toolbarTop, navigationBottom } = calculateFloatingPositions()

  // Add keyboard shortcut for search modal (Cmd+K)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger if user is typing in an input, textarea, or contenteditable element
      const activeElement = document.activeElement
      const isEditableElement =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement?.hasAttribute('contenteditable')

      if (isEditableElement) return

      // Cmd/Ctrl + K - Open search modal
      if (
        event.key.toLowerCase() === 'k' &&
        ((event.metaKey &&
          typeof navigator !== 'undefined' &&
          navigator.platform.toUpperCase().indexOf('MAC') >= 0) ||
          (event.ctrlKey &&
            (typeof navigator === 'undefined' ||
              navigator.platform.toUpperCase().indexOf('MAC') < 0)))
      ) {
        event.preventDefault()
        setShowSearchModal(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Optimized drag detection with memoized selectors
  useEffect(() => {
    const handleDragStart = (e: DragEvent) => {
      const target = e.target as HTMLElement
      const sidebarElement = workflowScrollAreaRef.current

      // Early exit if not in sidebar
      if (!sidebarElement?.contains(target)) return

      // Efficient draggable check - check element first, then traverse up
      if (target.draggable || target.closest('[data-workflow-id], [draggable="true"]')) {
        setIsDragging(true)
      }
    }

    const options = { capture: true, passive: true } as const
    document.addEventListener('dragstart', handleDragStart, options)

    return () => {
      document.removeEventListener('dragstart', handleDragStart, options)
      stopScroll() // Cleanup on unmount
    }
  }, [stopScroll])

  return (
    <>
      {/* Main Sidebar - Overlay */}
      <aside className='pointer-events-none fixed inset-y-0 left-0 z-10 w-64'>
        <div
          className='pointer-events-none flex h-full flex-col p-4'
          style={{ gap: `${SIDEBAR_GAP}px` }}
        >
          {/* 1. Workspace Header */}
          <div className='pointer-events-auto flex-shrink-0'>
            <WorkspaceHeader
              onCreateWorkflow={handleCreateWorkflow}
              isWorkspaceSelectorVisible={isWorkspaceSelectorVisible}
              onToggleWorkspaceSelector={toggleWorkspaceSelector}
              onToggleSidebar={toggleSidebarCollapsed}
              activeWorkspace={activeWorkspace}
              isWorkspacesLoading={isWorkspacesLoading}
            />
          </div>

          {/* 2. Workspace Selector */}
          <div
            className={`pointer-events-auto flex-shrink-0 ${!isWorkspaceSelectorVisible ? 'hidden' : ''}`}
          >
            <WorkspaceSelector
              workspaces={workspaces}
              activeWorkspace={activeWorkspace}
              isWorkspacesLoading={isWorkspacesLoading}
              onWorkspaceUpdate={refreshWorkspaceList}
              onSwitchWorkspace={switchWorkspace}
              onCreateWorkspace={handleCreateWorkspace}
              onDeleteWorkspace={confirmDeleteWorkspace}
              onLeaveWorkspace={handleLeaveWorkspace}
              updateWorkspaceName={updateWorkspaceName}
              isDeleting={isDeleting}
              isLeaving={isLeaving}
              isCreating={isCreatingWorkspace}
            />
          </div>

          {/* 3. Search */}
          <div
            className={`pointer-events-auto flex-shrink-0 ${isSidebarCollapsed ? 'hidden' : ''}`}
          >
            <button
              onClick={() => setShowSearchModal(true)}
              className='flex h-12 w-full cursor-pointer items-center gap-2 rounded-[10px] border bg-background pr-[10px] pl-3 shadow-xs transition-colors hover:bg-muted/50'
            >
              <Search className='h-4 w-4 text-muted-foreground' strokeWidth={2} />
              <span className='flex h-8 flex-1 items-center px-0 text-muted-foreground text-sm leading-none'>
                Search anything
              </span>
              <KeyboardShortcut shortcut={getKeyboardShortcutText('K', true)} />
            </button>
          </div>

          {/* 4. Workflow Selector */}
          <div
            className={`pointer-events-auto relative h-[212px] flex-shrink-0 rounded-[10px] border bg-background shadow-xs ${
              isSidebarCollapsed ? 'hidden' : ''
            }`}
          >
            <div className='px-2'>
              <ScrollArea className='h-[210px]' hideScrollbar={true}>
                <div ref={workflowScrollAreaRef}>
                  <FolderTree
                    regularWorkflows={regularWorkflows}
                    marketplaceWorkflows={tempWorkflows}
                    isLoading={isLoading}
                    onCreateWorkflow={handleCreateWorkflow}
                  />
                </div>
              </ScrollArea>
            </div>
            {!isLoading && (
              <div className='absolute top-2 right-2'>
                <CreateMenu
                  onCreateWorkflow={handleCreateWorkflow}
                  isCreatingWorkflow={isCreatingWorkflow}
                />
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Floating Toolbar - Only on workflow pages */}
      <div
        className={`pointer-events-auto fixed left-4 z-50 w-56 rounded-[10px] border bg-background shadow-xs ${
          !isOnWorkflowPage || isSidebarCollapsed ? 'hidden' : ''
        }`}
        style={{
          top: `${toolbarTop}px`,
          bottom: `${navigationBottom + SIDEBAR_HEIGHTS.NAVIGATION + SIDEBAR_GAP + (isBillingEnabled ? SIDEBAR_HEIGHTS.USAGE_INDICATOR + SIDEBAR_GAP : 0)}px`, // Navigation height + gap + UsageIndicator height + gap (if billing enabled)
        }}
      >
        <Toolbar
          userPermissions={userPermissions}
          isWorkspaceSelectorVisible={isWorkspaceSelectorVisible}
        />
      </div>

      {/* Floating Logs Filters - Only on logs page */}
      <div
        className={`pointer-events-auto fixed left-4 z-50 w-56 rounded-[10px] border bg-background shadow-xs ${
          !isOnLogsPage || isSidebarCollapsed ? 'hidden' : ''
        }`}
        style={{
          top: `${toolbarTop}px`,
          bottom: `${navigationBottom + SIDEBAR_HEIGHTS.NAVIGATION + SIDEBAR_GAP + (isBillingEnabled ? SIDEBAR_HEIGHTS.USAGE_INDICATOR + SIDEBAR_GAP : 0)}px`, // Navigation height + gap + UsageIndicator height + gap (if billing enabled)
        }}
      >
        <LogsFilters />
      </div>

      {/* Floating Knowledge Tags - Only on knowledge pages */}
      <div
        className={`pointer-events-auto fixed left-4 z-50 w-56 rounded-[10px] border bg-background shadow-xs ${
          !isOnKnowledgePage || isSidebarCollapsed || !knowledgeBaseId ? 'hidden' : ''
        }`}
        style={{
          top: `${toolbarTop}px`,
          bottom: `${navigationBottom + SIDEBAR_HEIGHTS.NAVIGATION + SIDEBAR_GAP + (isBillingEnabled ? SIDEBAR_HEIGHTS.USAGE_INDICATOR + SIDEBAR_GAP : 0)}px`, // Navigation height + gap + UsageIndicator height + gap (if billing enabled)
        }}
      >
        {knowledgeBaseId && documentId && (
          <KnowledgeTags knowledgeBaseId={knowledgeBaseId} documentId={documentId} />
        )}
        {knowledgeBaseId && !documentId && <KnowledgeBaseTags knowledgeBaseId={knowledgeBaseId} />}
      </div>

      {/* Floating Usage Indicator - Only shown when billing enabled */}
      {isBillingEnabled && (
        <div
          className='pointer-events-auto fixed left-4 z-50 w-56'
          style={{ bottom: `${navigationBottom + SIDEBAR_HEIGHTS.NAVIGATION + SIDEBAR_GAP}px` }} // Navigation height + gap
        >
          <UsageIndicator
            onClick={() => {
              const subscriptionStore = useSubscriptionStore.getState()
              const isBlocked = subscriptionStore.getBillingStatus() === 'blocked'
              const canUpgrade = subscriptionStore.canUpgrade()

              if (isBlocked || !canUpgrade) {
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(
                    new CustomEvent('open-settings', { detail: { tab: 'subscription' } })
                  )
                }
              } else {
                setShowSubscriptionModal(true)
              }
            }}
          />
        </div>
      )}

      {/* Floating Navigation - Always visible */}
      <FloatingNavigation
        workspaceId={workspaceId}
        pathname={pathname}
        onShowSettings={() => setShowSettings(true)}
        onShowHelp={() => setShowHelp(true)}
        bottom={navigationBottom}
      />

      {/* Modals */}
      <SettingsModal open={showSettings} onOpenChange={setShowSettings} />
      <HelpModal open={showHelp} onOpenChange={setShowHelp} />
      <InviteModal open={showInviteMembers} onOpenChange={setShowInviteMembers} />
      <SubscriptionModal open={showSubscriptionModal} onOpenChange={setShowSubscriptionModal} />

      <SearchModal
        open={showSearchModal}
        onOpenChange={setShowSearchModal}
        workflows={searchWorkflows}
        workspaces={searchWorkspaces}
        knowledgeBases={searchKnowledgeBases}
        isOnWorkflowPage={isOnWorkflowPage}
      />
    </>
  )
}
