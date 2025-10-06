'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, Plus, Search } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Badge, ChevronDown, PanelLeft } from '@/components/emcn'
import { Button } from '@/components/emcn/components/button'
import { FolderPlus } from '@/components/emcn/icons'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { generateFolderName, generateWorkspaceName } from '@/lib/naming'
import { useFolderStore } from '@/stores/folders/store'
import { useSidebarStore } from '@/stores/sidebar/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { Blocks } from './components-new/blocks/blocks'
import { Triggers } from './components-new/triggers/triggers'
import { WorkflowList } from './components-new/workflow-list/workflow-list'

const logger = createLogger('SidebarNew')

interface Workspace {
  id: string
  name: string
  ownerId: string
  role?: string
  membershipId?: string
  permissions?: 'admin' | 'write' | 'read' | null
}

/**
 * Constants for sidebar sizing
 */
const MIN_WIDTH = 232
const MAX_WIDTH = 400

/**
 * Sidebar component with resizable width and panel heights that persist across page refreshes.
 *
 * Uses a CSS-based approach to prevent hydration mismatches:
 * 1. Dimensions are controlled by CSS variables (--sidebar-width, --triggers-height, --blocks-height)
 * 2. Blocking script in layout.tsx sets CSS variables before React hydrates
 * 3. Store updates CSS variables when dimensions change
 *
 * This ensures server and client render identical HTML, preventing hydration errors.
 */
export function SidebarNew() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const router = useRouter()

  const { setSidebarWidth } = useSidebarStore()
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)
  const isInitializedRef = useRef<boolean>(false)

  // Refs to avoid dependency issues
  const workspaceIdRef = useRef<string>(workspaceId)
  const routerRef = useRef<ReturnType<typeof useRouter>>(router)
  const activeWorkspaceRef = useRef<Workspace | null>(null)

  // Update refs when values change
  workspaceIdRef.current = workspaceId
  routerRef.current = router

  // Session data
  const { data: sessionData, isPending: sessionLoading } = useSession()

  // Workspace management state
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null)
  const [isWorkspacesLoading, setIsWorkspacesLoading] = useState(true)

  // Add state to prevent multiple simultaneous workflow creations
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false)
  // Add state to prevent multiple simultaneous folder creations
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  // Add state to prevent multiple simultaneous workspace creations (for future use)
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Get workflow data
  const {
    workflows,
    isLoading: workflowsLoading,
    loadWorkflows,
    switchToWorkspace,
    createWorkflow,
  } = useWorkflowRegistry()

  // Get folder store
  const { createFolder } = useFolderStore()

  // Filter and sort workflows
  const regularWorkflows = Object.values(workflows)
    .filter((workflow) => workflow.workspaceId === workspaceId)
    .sort((a, b) => {
      // Sort by creation date (newest first) for stable ordering
      return b.createdAt.getTime() - a.createdAt.getTime()
    })

  // Combined loading state
  const isLoading = workflowsLoading || sessionLoading

  // Update activeWorkspace ref when state changes
  activeWorkspaceRef.current = activeWorkspace

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
        // Use functional update to avoid dependency on activeWorkspace
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
  }, [])

  /**
   * Fetch workspaces for the current user with full validation and URL handling
   * Uses refs for workspaceId and router to avoid unnecessary recreations
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

            // Fallback to first workspace if current not found
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
  }, [])

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
   * Uses refs for activeWorkspace and router to avoid unnecessary recreations
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
    [switchToWorkspace]
  )

  /**
   * Handle create workspace (for future use when WorkspaceSelector is added)
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
   * Confirm delete workspace (for future use when WorkspaceSelector is added)
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
   * Handle leave workspace (for future use when WorkspaceSelector is added)
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
   * Initialize workspace data on mount (uses full validation with URL handling)
   * fetchWorkspaces is stable (empty deps array), so it's safe to call without including it
   */
  useEffect(() => {
    if (sessionData?.user?.id && !isInitializedRef.current) {
      isInitializedRef.current = true
      fetchWorkspaces()
    }
  }, [sessionData?.user?.id, fetchWorkspaces])

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
   * Load workflows for the current workspace when workspaceId changes
   */
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
  }, [workspaceId, loadWorkflows, isWorkspaceValid, fetchWorkspaces])

  /**
   * Handles mouse down on resize handle
   */
  const handleMouseDown = useCallback(() => {
    setIsResizing(true)
  }, [])

  /**
   * Setup resize event listeners and body styles when resizing
   * Cleanup is handled automatically by the effect's return function
   */
  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, setSidebarWidth])

  /**
   * Create workflow handler - creates workflow and navigates to it
   */
  const handleCreateWorkflow = useCallback(async () => {
    if (isCreatingWorkflow) {
      logger.info('Workflow creation already in progress, ignoring request')
      return
    }

    try {
      setIsCreatingWorkflow(true)

      // Clear workflow diff store when creating a new workflow
      const { clearDiff } = useWorkflowDiffStore.getState()
      clearDiff()

      const workflowId = await createWorkflow({
        workspaceId: workspaceId || undefined,
      })

      // Navigate to the newly created workflow
      if (workflowId) {
        router.push(`/workspace/${workspaceId}/w/${workflowId}`)
      }
    } catch (error) {
      logger.error('Error creating workflow:', error)
    } finally {
      setIsCreatingWorkflow(false)
    }
  }, [isCreatingWorkflow, createWorkflow, workspaceId, router])

  /**
   * Create folder handler - creates folder with auto-generated name
   */
  const handleCreateFolder = useCallback(async () => {
    if (isCreatingFolder || !workspaceId) {
      logger.info('Folder creation already in progress or no workspaceId available')
      return
    }

    try {
      setIsCreatingFolder(true)
      const folderName = await generateFolderName(workspaceId)
      await createFolder({ name: folderName, workspaceId })
      logger.info(`Created folder: ${folderName}`)
    } catch (error) {
      logger.error('Failed to create folder:', { error })
    } finally {
      setIsCreatingFolder(false)
    }
  }, [createFolder, workspaceId, isCreatingFolder])

  /**
   * Handle import workflow button click
   */
  const handleImportWorkflow = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  return (
    <>
      <aside
        ref={sidebarRef}
        className='sidebar-container fixed inset-y-0 left-0 z-10 overflow-hidden dark:bg-[#1E1E1E]'
        aria-label='Workspace sidebar'
      >
        <div className='flex h-full flex-col border-r pt-[14px] dark:border-[#2C2C2C]'>
          {/* Header */}
          <div className='flex flex-shrink-0 items-center justify-between gap-[8px] px-[14px]'>
            {/* Workspace Name */}
            <div className='flex min-w-0 items-center gap-[8px]'>
              <h2
                className='truncate font-medium text-base dark:text-white'
                title={activeWorkspace?.name || 'Loading...'}
              >
                {activeWorkspace?.name || 'Loading...'}
              </h2>
              {/* TODO: Solo/Team based on workspace members */}
              <Badge className='flex-shrink-0 translate-y-[1px] whitespace-nowrap'>Solo</Badge>
            </div>
            {/* Collapse/Expand */}
            <div className='flex items-center gap-[14px]'>
              <button type='button' aria-label='Collapse sidebar' className='group -m-1 p-1'>
                <ChevronDown className='h-[8px] w-[12px] text-[#787878] transition-colors dark:text-[#787878] dark:group-hover:text-[#E6E6E6]' />
              </button>
              <button type='button' aria-label='Collapse sidebar' className='group'>
                <PanelLeft className='h-[17.5px] w-[17.5px] text-[#787878] transition-colors dark:text-[#787878] dark:group-hover:text-[#E6E6E6]' />
              </button>
            </div>
          </div>

          {/* Add */}
          {/* <div className='mt-[14px] flex items-center'>
            <Button
              variant='3d'
              className='w-full gap-[12px] rounded-[8px] py-[5px] text-small'
              onClick={() => handleCreateWorkflow()}
              disabled={isCreatingWorkflow}
            >
              <Plus className='h-[14px] w-[14px]' />
              Add Workflow
            </Button>
          </div> */}

          {/* Search */}
          <div className='mx-[8px] mt-[14px] flex flex-shrink-0 cursor-pointer items-center justify-between rounded-[8px] bg-[#272727] px-[6px] py-[7px] dark:bg-[#272727]'>
            <div className='flex items-center gap-[6px]'>
              <Search className='h-[16px] w-[16px] text-[#7D7D7D] dark:text-[#7D7D7D]' />
              <p className='translate-y-[0.25px] font-medium text-[#B1B1B1] text-small dark:text-[#B1B1B1]'>
                Search
              </p>
            </div>
            <p className='font-medium text-[#7D7D7D] text-small dark:text-[#7D7D7D]'>⌘ + K</p>
          </div>

          {/* Workflows */}
          <div className='workflows-section relative mt-[14px] flex flex-1 flex-col overflow-hidden'>
            {/* Header - Always visible */}
            <div className='flex flex-shrink-0 flex-col space-y-[4px] px-[14px]'>
              <div className='flex items-center justify-between'>
                <div className='font-medium text-[#AEAEAE] text-small dark:text-[#AEAEAE]'>
                  Workflows
                </div>
                <div className='flex items-center justify-center gap-[10px]'>
                  <Button
                    variant='default'
                    className='translate-y-[-0.25px] p-[1px]'
                    onClick={handleImportWorkflow}
                    disabled={isImporting}
                    title={isImporting ? 'Importing workflow...' : 'Import workflow from JSON'}
                  >
                    <ArrowDown className='h-[14px] w-[14px]' />
                  </Button>
                  <Button
                    variant='default'
                    className='mr-[1px] translate-y-[-0.25px] p-[1px]'
                    onClick={handleCreateFolder}
                    disabled={isCreatingFolder}
                    title={isCreatingFolder ? 'Creating folder...' : 'Create new folder'}
                  >
                    <FolderPlus className='h-[14px] w-[14px]' />
                  </Button>
                  <Button
                    variant='outline'
                    className='translate-y-[-0.25px] p-[1px]'
                    onClick={handleCreateWorkflow}
                    disabled={isCreatingWorkflow}
                    title={isCreatingWorkflow ? 'Creating workflow...' : 'Create new workflow'}
                  >
                    <Plus className='h-[14px] w-[14px]' />
                  </Button>
                </div>
              </div>
            </div>

            {/* Scrollable workflow list */}
            <div className='mt-[4px] flex-1 overflow-y-auto overflow-x-hidden px-[8px]'>
              <WorkflowList
                regularWorkflows={regularWorkflows}
                isLoading={isLoading}
                isImporting={isImporting}
                setIsImporting={setIsImporting}
                fileInputRef={fileInputRef}
              />
            </div>

            {/* Triggers and Blocks sections - absolutely positioned overlays */}
            <Triggers disabled={isLoading} />
            <Blocks disabled={isLoading} />
          </div>
        </div>
      </aside>

      {/* Resize Handle */}
      <div
        className='fixed top-0 bottom-0 left-[calc(var(--sidebar-width)-4px)] z-20 w-[8px] cursor-ew-resize'
        onMouseDown={handleMouseDown}
        role='separator'
        aria-orientation='vertical'
        aria-label='Resize sidebar'
      />
    </>
  )
}
