'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  ChevronDown,
  FolderPlus,
  PanelLeft,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverSection,
  PopoverTrigger,
  Tooltip,
} from '@/components/emcn'
import { useSession } from '@/lib/auth-client'
import { useFolderStore } from '@/stores/folders/store'
import { FooterNavigation, WorkflowList } from './components-new'
import {
  useFolderOperations,
  useSidebarResize,
  useWorkflowOperations,
  useWorkspaceManagement,
} from './hooks'

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

  const sidebarRef = useRef<HTMLElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Session data
  const { data: sessionData, isPending: sessionLoading } = useSession()

  // Import state
  const [isImporting, setIsImporting] = useState(false)

  // Workspace popover state
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false)

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

      // Start the scroll attempt after a small delay to ensure rendering
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

  return (
    <>
      <aside
        ref={sidebarRef}
        className='sidebar-container fixed inset-y-0 left-0 z-10 overflow-hidden dark:bg-[#1E1E1E]'
        aria-label='Workspace sidebar'
        onClick={handleSidebarClick}
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
              {/* <Badge className='flex-shrink-0 translate-y-[1px] whitespace-nowrap'>Solo</Badge> */}
            </div>
            {/* Workspace Actions */}
            <div className='flex items-center gap-[14px]'>
              {/* Workspace Switcher Popover */}
              <Popover open={isWorkspaceMenuOpen} onOpenChange={setIsWorkspaceMenuOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant='ghost-secondary'
                    type='button'
                    aria-label='Switch workspace'
                    className='group -m-1 p-0 p-1'
                  >
                    <ChevronDown
                      className={`h-[8px] w-[12px] transition-transform duration-100 ${
                        isWorkspaceMenuOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align='end' side='bottom' sideOffset={8}>
                  {isWorkspacesLoading ? (
                    <PopoverItem disabled>
                      <span>Loading workspaces...</span>
                    </PopoverItem>
                  ) : (
                    <>
                      {workspaces.length > 0 && (
                        <>
                          <PopoverSection>Workspaces</PopoverSection>
                          {workspaces.map((workspace, index) => (
                            <PopoverItem
                              key={workspace.id}
                              active={workspace.id === workspaceId}
                              onClick={() => handleWorkspaceSwitch(workspace)}
                              className={index > 0 ? 'mt-[2px]' : ''}
                            >
                              <span>{workspace.name}</span>
                            </PopoverItem>
                          ))}
                        </>
                      )}
                      <PopoverItem
                        onClick={async () => {
                          await handleCreateWorkspace()
                          setIsWorkspaceMenuOpen(false)
                        }}
                        disabled={isCreatingWorkspace}
                        className={workspaces.length > 0 ? 'mt-[2px]' : ''}
                      >
                        <Plus className='h-3 w-3' />
                        <span>Create a workspace</span>
                      </PopoverItem>
                    </>
                  )}
                </PopoverContent>
              </Popover>
              {/* TODO: Add panel toggle */}
              <Button
                variant='ghost-secondary'
                type='button'
                aria-label='Toggle panel'
                className='group p-0'
              >
                <PanelLeft className='h-[17.5px] w-[17.5px]' />
              </Button>
            </div>
          </div>

          {/* Search */}
          <div className='mx-[8px] mt-[14px] flex flex-shrink-0 cursor-pointer items-center justify-between rounded-[8px] bg-[#272727] px-[6px] py-[7px] dark:bg-[#272727]'>
            <div className='flex items-center gap-[6px]'>
              <Search className='h-[16px] w-[16px] text-[#7D7D7D] dark:text-[#7D7D7D]' />
              <p className='translate-y-[0.25px] font-medium text-[#B1B1B1] text-small dark:text-[#B1B1B1]'>
                Search
              </p>
            </div>
            <p className='font-medium text-[#7D7D7D] text-small dark:text-[#7D7D7D]'>⌘K</p>
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
                      <p>{isImporting ? 'Importing workflow...' : 'Import from JSON'}</p>
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

          {/* Footer Navigation */}
          <FooterNavigation />
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
