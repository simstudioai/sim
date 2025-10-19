'use client'

import { useCallback, useRef, useState } from 'react'
import { ArrowDown, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  ChevronDown,
  FolderPlus,
  PanelLeft,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/emcn'
import { useSession } from '@/lib/auth-client'
import { useFolderStore } from '@/stores/folders/store'
import { Blocks } from './components-new/blocks/blocks'
import { Triggers } from './components-new/triggers/triggers'
import { WorkflowList } from './components-new/workflow-list/workflow-list'
import { useFolderOperations } from './hooks/use-folder-operations'
import { useSidebarResize } from './hooks/use-sidebar-resize'
import { useWorkflowOperations } from './hooks/use-workflow-operations'
import { useWorkspaceManagement } from './hooks/use-workspace-management'

/**
 * Sidebar component with resizable width and panel heights that persist across page refreshes.
 *
 * Uses a CSS-based approach to prevent hydration mismatches:
 * 1. Dimensions are controlled by CSS variables (--sidebar-width, --triggers-height, --blocks-height)
 * 2. Blocking script in layout.tsx sets CSS variables before React hydrates
 * 3. Store updates CSS variables when dimensions change
 *
 * This ensures server and client render identical HTML, preventing hydration errors.
 *
 * @returns Sidebar with workflows, triggers, and blocks panels
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

  // Workspace management hook
  const { activeWorkspace, isWorkspacesLoading, fetchWorkspaces, isWorkspaceValid } =
    useWorkspaceManagement({
      workspaceId,
      sessionUserId: sessionData?.user?.id,
    })

  // Sidebar resize hook
  const { handleMouseDown } = useSidebarResize()

  // Workflow operations hook
  const { regularWorkflows, workflowsLoading, isCreatingWorkflow, handleCreateWorkflow } =
    useWorkflowOperations({
      workspaceId,
      isWorkspaceValid,
      onWorkspaceInvalid: fetchWorkspaces,
    })

  // Folder operations hook
  const { isCreatingFolder, handleCreateFolder } = useFolderOperations({ workspaceId })

  // Combined loading state
  const isLoading = workflowsLoading || sessionLoading

  /**
   * Handle import workflow button click - triggers file input
   */
  const handleImportWorkflow = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click()
    }
  }, [])

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
              <Badge className='flex-shrink-0 translate-y-[1px] whitespace-nowrap'>Solo</Badge>
            </div>
            {/* Collapse/Expand */}
            <div className='flex items-center gap-[14px]'>
              {/* TODO: Add sidebar collapse */}
              <Button
                variant='ghost-secondary'
                type='button'
                aria-label='Collapse sidebar'
                className='group -m-1 p-0 p-1'
              >
                <ChevronDown className='h-[8px] w-[12px]' />
              </Button>
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
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='ghost'
                        className='translate-y-[-0.25px] p-[1px]'
                        onClick={handleImportWorkflow}
                        disabled={isImporting}
                      >
                        <ArrowDown className='h-[14px] w-[14px]' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{isImporting ? 'Importing workflow...' : 'Import from JSON'}</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='ghost'
                        className='mr-[1px] translate-y-[-0.25px] p-[1px]'
                        onClick={handleCreateFolder}
                        disabled={isCreatingFolder}
                      >
                        <FolderPlus className='h-[14px] w-[14px]' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{isCreatingFolder ? 'Creating folder...' : 'Create folder'}</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='outline'
                        className='translate-y-[-0.25px] p-[1px]'
                        onClick={handleCreateWorkflow}
                        disabled={isCreatingWorkflow}
                      >
                        <Plus className='h-[14px] w-[14px]' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{isCreatingWorkflow ? 'Creating workflow...' : 'Create workflow'}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>

            {/* Scrollable workflow list */}
            <div
              ref={scrollContainerRef}
              className='mt-[4px] flex-1 overflow-y-auto overflow-x-hidden px-[8px]'
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
