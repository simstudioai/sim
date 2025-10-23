'use client'

import { useCallback, useRef, useState } from 'react'
import { ArrowDown, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Badge, ChevronDown, PanelLeft } from '@/components/emcn'
import { Button } from '@/components/emcn/components/button'
import { FolderPlus } from '@/components/emcn/icons'
import { useSession } from '@/lib/auth-client'
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
 */
export function SidebarNew() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const sidebarRef = useRef<HTMLElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
