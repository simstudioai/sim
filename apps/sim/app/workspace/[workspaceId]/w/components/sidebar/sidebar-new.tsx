'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, Plus, Search } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Button, FolderPlus, Tooltip } from '@/components/emcn'
import { useSession } from '@/lib/auth-client'
import { getEnv, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import {
  FooterNavigation,
  SearchModal,
  UsageIndicator,
  WorkflowList,
  WorkspaceHeader,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components-new'
import {
  useFolderOperations,
  useSidebarResize,
  useWorkflowOperations,
  useWorkspaceManagement,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import {
  useDuplicateWorkspace,
  useExportWorkspace,
  useImportWorkspace,
} from '@/app/workspace/[workspaceId]/w/hooks'
import { useFolderStore } from '@/stores/folders/store'
import { MIN_SIDEBAR_WIDTH, useSidebarStore } from '@/stores/sidebar/store'

const logger = createLogger('SidebarNew')

// Feature flag: Billing usage indicator visibility (matches legacy sidebar behavior)
const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))

/**
 * Sidebar component with resizable width that persists across page refreshes.
 *
 * Uses a CSS-based approach to prevent hydration mismatches:
 * 1. Dimensions are controlled by CSS variables (--sidebar-width)
 * 2. Blocking script in layout.tsx sets CSS variables before React hydrates
 * 3. Store updates CSS variables when dimensions change
 *
 * This ensures server and client render identical HTML, preventing hydration errors.
 *
 * @returns Sidebar with workflows panel
 */
export function SidebarNew() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const workflowId = params.workflowId as string | undefined
  const router = useRouter()

  const sidebarRef = useRef<HTMLElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Session data
  const { data: sessionData, isPending: sessionLoading } = useSession()

  // Sidebar state
  const isCollapsed = useSidebarStore((state) => state.isCollapsed)
  const setIsCollapsed = useSidebarStore((state) => state.setIsCollapsed)
  const setSidebarWidth = useSidebarStore((state) => state.setSidebarWidth)

  // Determine if we're on a workflow page (only workflow pages allow collapse and resize)
  const isOnWorkflowPage = !!workflowId

  // Import state
  const [isImporting, setIsImporting] = useState(false)

  // Workspace import input ref
  const workspaceFileInputRef = useRef<HTMLInputElement>(null)

  // Workspace import hook
  const { isImporting: isImportingWorkspace, handleImportWorkspace: importWorkspace } =
    useImportWorkspace()

  // Workspace export hook
  const { isExporting: isExportingWorkspace, handleExportWorkspace: exportWorkspace } =
    useExportWorkspace()

  // Workspace popover state
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false)

  // Search modal state
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false)

  // Workspace management hook
  const {
    workspaces,
    activeWorkspace,
    isWorkspacesLoading,
    fetchWorkspaces,
    isWorkspaceValid,
    switchWorkspace,
    handleCreateWorkspace,
    isCreatingWorkspace,
    updateWorkspaceName,
    confirmDeleteWorkspace,
  } = useWorkspaceManagement({
    workspaceId,
    sessionUserId: sessionData?.user?.id,
  })

  // Sidebar resize hook
  const { handleMouseDown } = useSidebarResize()

  // Workflow operations hook
  const {
    regularWorkflows,
    workflowsLoading,
    isCreatingWorkflow,
    handleCreateWorkflow: createWorkflow,
  } = useWorkflowOperations({
    workspaceId,
    isWorkspaceValid,
    onWorkspaceInvalid: fetchWorkspaces,
  })

  // Folder operations hook
  const { isCreatingFolder, handleCreateFolder: createFolder } = useFolderOperations({
    workspaceId,
  })

  // Duplicate workspace hook
  const { handleDuplicateWorkspace: duplicateWorkspace } = useDuplicateWorkspace({
    getWorkspaceId: () => workspaceId,
  })

  // Prepare data for search modal
  const searchModalWorkflows = useMemo(
    () =>
      regularWorkflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        href: `/workspace/${workspaceId}/w/${workflow.id}`,
        color: workflow.color,
        isCurrent: workflow.id === workflowId,
      })),
    [regularWorkflows, workspaceId, workflowId]
  )

  const searchModalWorkspaces = useMemo(
    () =>
      workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        href: `/workspace/${workspace.id}/w`,
        isCurrent: workspace.id === workspaceId,
      })),
    [workspaces, workspaceId]
  )

  // Combined loading state
  const isLoading = workflowsLoading || sessionLoading

  // Ref to track active timeout IDs for cleanup
  const scrollTimeoutRef = useRef<number | null>(null)

  /**
   * Scrolls an element into view if it's not already visible in the scroll container.
   * Uses a retry mechanism with cleanup to wait for the element to be rendered in the DOM.
   *
   * @param elementId - The ID of the element to scroll to
   * @param maxRetries - Maximum number of retry attempts (default: 10)
   */
  const scrollToElement = useCallback(
    (elementId: string, maxRetries = 10) => {
      // Clear any existing timeout
      if (scrollTimeoutRef.current !== null) {
        clearTimeout(scrollTimeoutRef.current)
        scrollTimeoutRef.current = null
      }

      let attempts = 0

      const tryScroll = () => {
        attempts++
        const element = document.querySelector(`[data-item-id="${elementId}"]`)
        const container = scrollContainerRef.current

        if (element && container) {
          const elementRect = element.getBoundingClientRect()
          const containerRect = container.getBoundingClientRect()

          // Check if element is not fully visible in the container
          const isAboveView = elementRect.top < containerRect.top
          const isBelowView = elementRect.bottom > containerRect.bottom

          if (isAboveView || isBelowView) {
            element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          }
          scrollTimeoutRef.current = null
        } else if (attempts < maxRetries) {
          // Element not in DOM yet, retry after a short delay
          scrollTimeoutRef.current = window.setTimeout(tryScroll, 50)
        } else {
          scrollTimeoutRef.current = null
        }
      }

      // Start the scroll attempt after a small delay to ensure rendering.
      scrollTimeoutRef.current = window.setTimeout(tryScroll, 50)
    },
    [scrollContainerRef]
  )

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current !== null) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  /**
   * Force sidebar to minimum width and ensure it's expanded when not on a workflow page
   */
  useEffect(() => {
    if (!isOnWorkflowPage) {
      // Ensure sidebar is always expanded on non-workflow pages
      if (isCollapsed) {
        setIsCollapsed(false)
      }
      // Force sidebar to minimum width
      setSidebarWidth(MIN_SIDEBAR_WIDTH)
    }
  }, [isOnWorkflowPage, isCollapsed, setIsCollapsed, setSidebarWidth])

  /**
   * Handle create workflow - creates workflow and scrolls to it
   */
  const handleCreateWorkflow = useCallback(async () => {
    const workflowId = await createWorkflow()
    if (workflowId) {
      scrollToElement(workflowId)
    }
  }, [createWorkflow, scrollToElement])

  /**
   * Handle create folder - creates folder and scrolls to it
   */
  const handleCreateFolder = useCallback(async () => {
    const folderId = await createFolder()
    if (folderId) {
      scrollToElement(folderId)
    }
  }, [createFolder, scrollToElement])

  /**
   * Handle import workflow button click - triggers file input
   */
  const handleImportWorkflow = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click()
    }
  }, [])

  /**
   * Handle workspace switch from popover menu
   */
  const handleWorkspaceSwitch = useCallback(
    async (workspace: { id: string; name: string; ownerId: string; role?: string }) => {
      if (workspace.id === workspaceId) {
        setIsWorkspaceMenuOpen(false)
        return
      }

      await switchWorkspace(workspace)
      setIsWorkspaceMenuOpen(false)
    },
    [workspaceId, switchWorkspace]
  )

  /**
   * Handle sidebar collapse toggle
   */
  const handleToggleCollapse = useCallback(() => {
    setIsCollapsed(!isCollapsed)
  }, [isCollapsed, setIsCollapsed])

  /**
   * Handle click on sidebar elements to revert to active workflow selection
   */
  const handleSidebarClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const target = e.target as HTMLElement
      // Revert to active workflow selection if clicking on sidebar background, header, or search area
      // But not on interactive elements like buttons or links
      if (target.tagName === 'BUTTON' || target.closest('button, [role="button"], a')) {
        return
      }

      const { selectOnly, clearSelection } = useFolderStore.getState()
      workflowId ? selectOnly(workflowId) : clearSelection()
    },
    [workflowId]
  )

  /**
   * Handle workspace rename
   */
  const handleRenameWorkspace = useCallback(
    async (workspaceIdToRename: string, newName: string) => {
      await updateWorkspaceName(workspaceIdToRename, newName)
    },
    [updateWorkspaceName]
  )

  /**
   * Handle workspace delete
   */
  const handleDeleteWorkspace = useCallback(
    async (workspaceIdToDelete: string) => {
      const workspaceToDelete = workspaces.find((w) => w.id === workspaceIdToDelete)
      if (workspaceToDelete) {
        await confirmDeleteWorkspace(workspaceToDelete, 'keep')
      }
    },
    [workspaces, confirmDeleteWorkspace]
  )

  /**
   * Handle workspace duplicate
   */
  const handleDuplicateWorkspace = useCallback(
    async (_workspaceIdToDuplicate: string, workspaceName: string) => {
      await duplicateWorkspace(workspaceName)
    },
    [duplicateWorkspace]
  )

  /**
   * Handle workspace export
   */
  const handleExportWorkspace = useCallback(
    async (workspaceIdToExport: string, workspaceName: string) => {
      await exportWorkspace(workspaceIdToExport, workspaceName)
    },
    [exportWorkspace]
  )

  /**
   * Handle workspace import button click
   */
  const handleImportWorkspace = useCallback(() => {
    if (workspaceFileInputRef.current) {
      workspaceFileInputRef.current.click()
    }
  }, [])

  /**
   * Handle workspace import file change
   */
  const handleWorkspaceFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (!files || files.length === 0) return

      const zipFile = files[0]
      await importWorkspace(zipFile)

      // Reset file input
      if (event.target) {
        event.target.value = ''
      }
    },
    [importWorkspace]
  )

  /**
   * Register global commands:
   * - Mod+Shift+A: Add an Agent block to the canvas
   * - Mod+Y: Navigate to Templates (attempts to override browser history)
   * - Mod+L: Navigate to Logs (attempts to override browser location bar)
   * - Mod+K: Search (placeholder; no-op for now)
   */
  useRegisterGlobalCommands(() => [
    {
      id: 'add-agent',
      shortcut: 'Mod+Shift+A',
      allowInEditable: true,
      handler: () => {
        try {
          const event = new CustomEvent('add-block-from-toolbar', {
            detail: { type: 'agent', enableTriggerMode: false },
          })
          window.dispatchEvent(event)
          logger.info('Dispatched add-agent command')
        } catch (err) {
          logger.error('Failed to dispatch add-agent command', { err })
        }
      },
    },
    {
      id: 'goto-templates',
      shortcut: 'Mod+Y',
      allowInEditable: true,
      handler: () => {
        try {
          const pathWorkspaceId =
            workspaceId ||
            (typeof window !== 'undefined'
              ? (() => {
                  const parts = window.location.pathname.split('/')
                  const idx = parts.indexOf('workspace')
                  return idx !== -1 ? parts[idx + 1] : undefined
                })()
              : undefined)
          if (pathWorkspaceId) {
            router.push(`/workspace/${pathWorkspaceId}/templates`)
            logger.info('Navigated to templates', { workspaceId: pathWorkspaceId })
          } else {
            logger.warn('No workspace ID found, cannot navigate to templates')
          }
        } catch (err) {
          logger.error('Failed to navigate to templates', { err })
        }
      },
    },
    {
      id: 'goto-logs',
      shortcut: 'Mod+L',
      allowInEditable: true,
      handler: () => {
        try {
          const pathWorkspaceId =
            workspaceId ||
            (typeof window !== 'undefined'
              ? (() => {
                  const parts = window.location.pathname.split('/')
                  const idx = parts.indexOf('workspace')
                  return idx !== -1 ? parts[idx + 1] : undefined
                })()
              : undefined)
          if (pathWorkspaceId) {
            router.push(`/workspace/${pathWorkspaceId}/logs`)
            logger.info('Navigated to logs', { workspaceId: pathWorkspaceId })
          } else {
            logger.warn('No workspace ID found, cannot navigate to logs')
          }
        } catch (err) {
          logger.error('Failed to navigate to logs', { err })
        }
      },
    },
    {
      id: 'open-search',
      shortcut: 'Mod+K',
      allowInEditable: true,
      handler: () => {
        setIsSearchModalOpen(true)
        logger.info('Search modal opened')
      },
    },
  ])

  return (
    <>
      {isCollapsed ? (
        /* Floating collapsed header */
        <div className='fixed top-[14px] left-[10px] z-10 max-w-[232px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-[12px] py-[8px]'>
          <WorkspaceHeader
            activeWorkspace={activeWorkspace}
            workspaceId={workspaceId}
            workspaces={workspaces}
            isWorkspacesLoading={isWorkspacesLoading}
            isCreatingWorkspace={isCreatingWorkspace}
            isWorkspaceMenuOpen={isWorkspaceMenuOpen}
            setIsWorkspaceMenuOpen={setIsWorkspaceMenuOpen}
            onWorkspaceSwitch={handleWorkspaceSwitch}
            onCreateWorkspace={handleCreateWorkspace}
            onToggleCollapse={handleToggleCollapse}
            isCollapsed={isCollapsed}
            onRenameWorkspace={handleRenameWorkspace}
            onDeleteWorkspace={handleDeleteWorkspace}
            onDuplicateWorkspace={handleDuplicateWorkspace}
            onExportWorkspace={handleExportWorkspace}
            onImportWorkspace={handleImportWorkspace}
            isImportingWorkspace={isImportingWorkspace}
            showCollapseButton={isOnWorkflowPage}
          />
        </div>
      ) : (
        /* Full sidebar */
        <>
          <aside
            ref={sidebarRef}
            className='sidebar-container fixed inset-y-0 left-0 z-10 overflow-hidden bg-[var(--surface-1)]'
            aria-label='Workspace sidebar'
            onClick={handleSidebarClick}
          >
            <div className='flex h-full flex-col border-r pt-[14px] dark:border-[var(--border)]'>
              {/* Header */}
              <div className='flex-shrink-0 px-[14px]'>
                <WorkspaceHeader
                  activeWorkspace={activeWorkspace}
                  workspaceId={workspaceId}
                  workspaces={workspaces}
                  isWorkspacesLoading={isWorkspacesLoading}
                  isCreatingWorkspace={isCreatingWorkspace}
                  isWorkspaceMenuOpen={isWorkspaceMenuOpen}
                  setIsWorkspaceMenuOpen={setIsWorkspaceMenuOpen}
                  onWorkspaceSwitch={handleWorkspaceSwitch}
                  onCreateWorkspace={handleCreateWorkspace}
                  onToggleCollapse={handleToggleCollapse}
                  isCollapsed={isCollapsed}
                  onRenameWorkspace={handleRenameWorkspace}
                  onDeleteWorkspace={handleDeleteWorkspace}
                  onDuplicateWorkspace={handleDuplicateWorkspace}
                  onExportWorkspace={handleExportWorkspace}
                  onImportWorkspace={handleImportWorkspace}
                  isImportingWorkspace={isImportingWorkspace}
                  showCollapseButton={isOnWorkflowPage}
                />
              </div>

              {/* Search */}
              <div
                className='mx-[8px] mt-[12px] flex flex-shrink-0 cursor-pointer items-center justify-between rounded-[8px] bg-[var(--surface-5)] px-[8px] py-[7px]'
                onClick={() => setIsSearchModalOpen(true)}
              >
                <div className='flex items-center gap-[6px]'>
                  <Search className='h-[14px] w-[14px] text-[var(--text-subtle)] dark:text-[var(--text-subtle)]' />
                  <p className='translate-y-[0.25px] font-medium text-[var(--text-secondary)] text-small dark:text-[var(--text-secondary)]'>
                    Search
                  </p>
                </div>
                <p className='font-medium text-[var(--text-subtle)] text-small dark:text-[var(--text-subtle)]'>
                  ⌘K
                </p>
              </div>

              {/* Workflows */}
              <div className='workflows-section relative mt-[14px] flex flex-1 flex-col overflow-hidden'>
                {/* Header - Always visible */}
                <div className='flex flex-shrink-0 flex-col space-y-[4px] px-[14px]'>
                  <div className='flex items-center justify-between'>
                    <div className='font-medium text-[var(--text-tertiary)] text-small dark:text-[var(--text-tertiary)]'>
                      Workflows
                    </div>
                    <div className='flex items-center justify-center gap-[10px]'>
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <Button
                            variant='ghost'
                            className='translate-y-[-0.25px] p-[1px]'
                            onClick={handleImportWorkflow}
                            disabled={isImporting}
                          >
                            <ArrowDown className='h-[14px] w-[14px]' />
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content className='py-[2.5px]'>
                          <p>{isImporting ? 'Importing workflow...' : 'Import workflow'}</p>
                        </Tooltip.Content>
                      </Tooltip.Root>
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <Button
                            variant='ghost'
                            className='mr-[1px] translate-y-[-0.25px] p-[1px]'
                            onClick={handleCreateFolder}
                            disabled={isCreatingFolder}
                          >
                            <FolderPlus className='h-[14px] w-[14px]' />
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content className='py-[2.5px]'>
                          <p>{isCreatingFolder ? 'Creating folder...' : 'Create folder'}</p>
                        </Tooltip.Content>
                      </Tooltip.Root>
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <Button
                            variant='outline'
                            className='translate-y-[-0.25px] p-[1px]'
                            onClick={handleCreateWorkflow}
                            disabled={isCreatingWorkflow}
                          >
                            <Plus className='h-[14px] w-[14px]' />
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content className='py-[2.5px]'>
                          <p>{isCreatingWorkflow ? 'Creating workflow...' : 'Create workflow'}</p>
                        </Tooltip.Content>
                      </Tooltip.Root>
                    </div>
                  </div>
                </div>

                {/* Scrollable workflow list */}
                <div
                  ref={scrollContainerRef}
                  className='mt-[6px] flex-1 overflow-y-auto overflow-x-hidden px-[8px]'
                >
                  <WorkflowList
                    regularWorkflows={regularWorkflows}
                    isLoading={isLoading}
                    isImporting={isImporting}
                    setIsImporting={setIsImporting}
                    fileInputRef={fileInputRef}
                    scrollContainerRef={scrollContainerRef}
                  />
                </div>
              </div>

              {/* Usage Indicator */}
              {isBillingEnabled && <UsageIndicator />}

              {/* Footer Navigation */}
              <FooterNavigation />
            </div>
          </aside>

          {/* Resize Handle - Only visible on workflow pages */}
          {isOnWorkflowPage && (
            <div
              className='fixed top-0 bottom-0 left-[calc(var(--sidebar-width)-4px)] z-20 w-[8px] cursor-ew-resize'
              onMouseDown={handleMouseDown}
              role='separator'
              aria-orientation='vertical'
              aria-label='Resize sidebar'
            />
          )}
        </>
      )}

      {/* Universal Search Modal */}
      <SearchModal
        open={isSearchModalOpen}
        onOpenChange={setIsSearchModalOpen}
        workflows={searchModalWorkflows}
        workspaces={searchModalWorkspaces}
        isOnWorkflowPage={!!workflowId}
      />

      {/* Hidden file input for workspace import */}
      <input
        ref={workspaceFileInputRef}
        type='file'
        accept='.zip'
        style={{ display: 'none' }}
        onChange={handleWorkspaceFileChange}
      />
    </>
  )
}
