'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HelpCircle, LibraryBig, ScrollText, Search, Settings, Shapes } from 'lucide-react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import {
  getKeyboardShortcutText,
  useGlobalShortcuts,
} from '@/app/workspace/[workspaceId]/w/hooks/use-keyboard-shortcuts'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { useUserPermissionsContext } from '../providers/workspace-permissions-provider'
import { SearchModal } from '../search-modal/search-modal'
import { CreateMenu } from './components/create-menu/create-menu'
import { FolderTree } from './components/folder-tree/folder-tree'
import { HelpModal } from './components/help-modal/help-modal'
import { SettingsModal } from './components/settings-modal/settings-modal'
import { Toolbar } from './components/toolbar/toolbar'
import { WorkspaceHeader } from './components/workspace-header/workspace-header'
import { InviteModal } from './components/workspace-selector/components/invite-modal/invite-modal'
import { WorkspaceSelector } from './components/workspace-selector/workspace-selector'

const logger = createLogger('Sidebar')

const SIDEBAR_GAP = 12 // 12px gap between components - easily editable

// Heights for dynamic calculation (in px)
const SIDEBAR_HEIGHTS = {
  CONTAINER_PADDING: 32, // p-4 = 16px top + 16px bottom (bottom provides control bar spacing match)
  WORKSPACE_HEADER: 48, // estimated height of workspace header
  SEARCH: 48, // h-12
  WORKFLOW_SELECTOR: 212, // h-[212px]
  NAVIGATION: 48, // h-12 buttons
  WORKSPACE_SELECTOR: 183, // accurate height: p-2(16) + h-[116px](116) + mt-2(8) + border-t(1) + pt-2(8) + h-8(32) = 181px
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

  // Refs
  const workflowScrollAreaRef = useRef<HTMLDivElement>(null)
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

  // Update activeWorkspace ref when state changes
  activeWorkspaceRef.current = activeWorkspace

  // Check if we're on a workflow page
  const isOnWorkflowPage = useMemo(() => {
    // Pattern: /workspace/[workspaceId]/w/[workflowId]
    const workflowPageRegex = /^\/workspace\/[^/]+\/w\/[^/]+$/
    return workflowPageRegex.test(pathname)
  }, [pathname])

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
    try {
      logger.info('Creating new workspace')

      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Untitled workspace',
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
    }
  }, [refreshWorkspaceList, switchWorkspace])

  /**
   * Confirm delete workspace
   */
  const confirmDeleteWorkspace = useCallback(
    async (workspaceToDelete: Workspace) => {
      setIsDeleting(true)
      try {
        logger.info('Deleting workspace:', workspaceToDelete.id)

        const response = await fetch(`/api/workspaces/${workspaceToDelete.id}`, {
          method: 'DELETE',
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
          activeWorkflow.scrollIntoView({
            block: 'nearest',
          })
        }
      }
    }
  }, [workflowId, isLoading])

  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showInviteMembers, setShowInviteMembers] = useState(false)
  const [showSearchModal, setShowSearchModal] = useState(false)

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

      // Sort by last modified date (newest first)
      const sortByLastModified = (a: WorkflowMetadata, b: WorkflowMetadata) => {
        const dateA =
          a.lastModified instanceof Date
            ? a.lastModified.getTime()
            : new Date(a.lastModified).getTime()
        const dateB =
          b.lastModified instanceof Date
            ? b.lastModified.getTime()
            : new Date(b.lastModified).getTime()
        return dateB - dateA
      }

      regular.sort(sortByLastModified)
      temp.sort(sortByLastModified)
    }

    return { regularWorkflows: regular, tempWorkflows: temp }
  }, [workflows, isLoading, workspaceId])

  // Create workflow handler
  const handleCreateWorkflow = async (folderId?: string): Promise<string> => {
    if (isCreatingWorkflow) {
      logger.info('Workflow creation already in progress, ignoring request')
      throw new Error('Workflow creation already in progress')
    }

    try {
      setIsCreatingWorkflow(true)
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

  // Navigation items with their respective actions
  const navigationItems = [
    {
      id: 'settings',
      icon: Settings,
      onClick: () => setShowSettings(true),
      tooltip: 'Settings',
    },
    {
      id: 'help',
      icon: HelpCircle,
      onClick: () => setShowHelp(true),
      tooltip: 'Help',
    },
    {
      id: 'logs',
      icon: ScrollText,
      href: `/workspace/${workspaceId}/logs`,
      tooltip: 'Logs',
      shortcut: getKeyboardShortcutText('L', true, true),
      active: pathname === `/workspace/${workspaceId}/logs`,
    },
    {
      id: 'knowledge',
      icon: LibraryBig,
      href: `/workspace/${workspaceId}/knowledge`,
      tooltip: 'Knowledge',
      shortcut: getKeyboardShortcutText('K', true, true),
      active: pathname === `/workspace/${workspaceId}/knowledge`,
    },
    {
      id: 'templates',
      icon: Shapes,
      href: `/workspace/${workspaceId}/templates`,
      tooltip: 'Templates',
      active: pathname === `/workspace/${workspaceId}/templates`,
    },
  ]

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
              updateWorkspaceName={updateWorkspaceName}
            />
          </div>

          {/* 2. Workspace Selector - Conditionally rendered */}
          <div
            className={`pointer-events-auto flex-shrink-0 ${
              !isWorkspaceSelectorVisible || isSidebarCollapsed ? 'hidden' : ''
            }`}
          >
            <WorkspaceSelector
              workspaces={workspaces}
              activeWorkspace={activeWorkspace}
              isWorkspacesLoading={isWorkspacesLoading}
              onWorkspaceUpdate={refreshWorkspaceList}
              onSwitchWorkspace={switchWorkspace}
              onCreateWorkspace={handleCreateWorkspace}
              onDeleteWorkspace={confirmDeleteWorkspace}
              isDeleting={isDeleting}
            />
          </div>

          {/* 3. Search */}
          <div
            className={`pointer-events-auto flex-shrink-0 ${isSidebarCollapsed ? 'hidden' : ''}`}
          >
            <button
              onClick={() => setShowSearchModal(true)}
              className='flex h-12 w-full cursor-pointer items-center gap-2 rounded-[14px] border bg-card pr-[10px] pl-3 shadow-xs transition-colors hover:bg-muted/50'
            >
              <Search className='h-4 w-4 text-muted-foreground' strokeWidth={2} />
              <span className='flex h-8 flex-1 items-center px-0 font-[350] text-muted-foreground text-sm leading-none'>
                Search anything
              </span>
              <kbd className='flex h-6 w-8 items-center justify-center rounded-[5px] border border-border bg-background font-mono text-[#CDCDCD] text-xs dark:text-[#454545]'>
                <span className='flex items-center justify-center gap-[1px] pt-[1px]'>
                  <span className='text-lg'>⌘</span>
                  <span className='text-xs'>K</span>
                </span>
              </kbd>
            </button>
          </div>

          {/* 4. Workflow Selector */}
          <div
            className={`pointer-events-auto relative h-[212px] flex-shrink-0 rounded-[14px] border bg-card shadow-xs ${
              isSidebarCollapsed ? 'hidden' : ''
            }`}
          >
            <div className='px-2'>
              <ScrollArea ref={workflowScrollAreaRef} className='h-[210px]' hideScrollbar={true}>
                <FolderTree
                  regularWorkflows={regularWorkflows}
                  marketplaceWorkflows={tempWorkflows}
                  isCollapsed={false}
                  isLoading={isLoading}
                  onCreateWorkflow={handleCreateWorkflow}
                />
              </ScrollArea>
            </div>
            {!isLoading && (
              <div className='absolute top-2 right-2'>
                <CreateMenu
                  onCreateWorkflow={handleCreateWorkflow}
                  isCollapsed={false}
                  isCreatingWorkflow={isCreatingWorkflow}
                />
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Floating Toolbar - Only on workflow pages */}
      <div
        className={`pointer-events-auto fixed left-4 z-50 w-56 rounded-[14px] border bg-card shadow-xs ${
          !isOnWorkflowPage || isSidebarCollapsed ? 'hidden' : ''
        }`}
        style={{
          top: `${toolbarTop}px`,
          bottom: `${navigationBottom + 42 + 12}px`, // Navigation height + gap
        }}
      >
        <Toolbar
          userPermissions={userPermissions}
          isWorkspaceSelectorVisible={isWorkspaceSelectorVisible}
        />
      </div>

      {/* Floating Navigation - Always visible */}
      <div
        className='pointer-events-auto fixed left-4 z-50 w-56'
        style={{ bottom: `${navigationBottom}px` }}
      >
        <div className='flex items-center gap-1'>
          {navigationItems.map((item) => (
            <NavigationItem key={item.id} item={item} />
          ))}
        </div>
      </div>

      {/* Modals */}
      <SettingsModal open={showSettings} onOpenChange={setShowSettings} />
      <HelpModal open={showHelp} onOpenChange={setShowHelp} />
      <InviteModal open={showInviteMembers} onOpenChange={setShowInviteMembers} />
      <SearchModal open={showSearchModal} onOpenChange={setShowSearchModal} templates={templates} />
    </>
  )
}

// Navigation Item Component
interface NavigationItemProps {
  item: {
    id: string
    icon: React.ElementType
    onClick?: () => void
    href?: string
    tooltip: string
    shortcut?: string
    active?: boolean
    disabled?: boolean
  }
}

const NavigationItem = ({ item }: NavigationItemProps) => {
  // Settings and help buttons get gray hover, others get purple hover
  const isGrayHover = item.id === 'settings' || item.id === 'help'

  const content = item.disabled ? (
    <div className='inline-flex h-[42px] w-[42px] cursor-not-allowed items-center justify-center gap-2 whitespace-nowrap rounded-[11px] border bg-card font-medium text-card-foreground text-sm opacity-50 ring-offset-background transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'>
      <item.icon className='h-4 w-4' />
    </div>
  ) : (
    <Button
      variant='outline'
      onClick={item.onClick}
      className={cn(
        'h-[42px] w-[42px] rounded-[11px] border bg-card text-card-foreground shadow-xs transition-all duration-200',
        isGrayHover && 'hover:bg-secondary',
        !isGrayHover && 'hover:border-[#701FFC] hover:bg-[#701FFC] hover:text-white',
        item.active && 'border-[#701FFC] bg-[#701FFC] text-white'
      )}
    >
      <item.icon className='h-4 w-4' />
    </Button>
  )

  if (item.href && !item.disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <a href={item.href} className='inline-block'>
            {content}
          </a>
        </TooltipTrigger>
        <TooltipContent side='top' className='flex flex-col items-center gap-1'>
          <span>{item.tooltip}</span>
          {item.shortcut && <span className='text-muted-foreground text-xs'>{item.shortcut}</span>}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side='top' className='flex flex-col items-center gap-1'>
        <span>{item.tooltip}</span>
        {item.shortcut && <span className='text-muted-foreground text-xs'>{item.shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}
