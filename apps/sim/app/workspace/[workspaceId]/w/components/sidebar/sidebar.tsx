'use client'

import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { HelpCircle, LibraryBig, ScrollText, Send, Settings } from 'lucide-react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSession } from '@/lib/auth-client'
import { isDev } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import {
  getKeyboardShortcutText,
  useGlobalShortcuts,
} from '@/app/workspace/[workspaceId]/w/hooks/use-keyboard-shortcuts'
import { useSidebarStore } from '@/stores/sidebar/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { useUserPermissionsContext } from '../providers/workspace-permissions-provider'
import { CreateMenu } from './components/create-menu/create-menu'
import { FolderTree } from './components/folder-tree/folder-tree'
import { HelpModal } from './components/help-modal/help-modal'
import { InviteModal } from './components/invite-modal/invite-modal'
import { NavSection } from './components/nav-section/nav-section'
import { SettingsModal } from './components/settings-modal/settings-modal'
import { SidebarControl } from './components/sidebar-control/sidebar-control'
import { WorkspaceHeader } from './components/workspace-header/workspace-header'

const logger = createLogger('Sidebar')

export function Sidebar() {
  useGlobalShortcuts()

  const {
    workflows,
    createWorkflow,
    isLoading: workflowsLoading,
    loadWorkflows,
  } = useWorkflowRegistry()
  const { isPending: sessionLoading } = useSession()
  const userPermissions = useUserPermissionsContext()
  const isLoading = workflowsLoading || sessionLoading

  // Add state to prevent multiple simultaneous workflow creations
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false)
  const router = useRouter()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const pathname = usePathname()

  // Load workflows for the current workspace when workspaceId changes
  // This is the single source of truth for workflow loading
  useEffect(() => {
    if (workspaceId) {
      loadWorkflows(workspaceId)
    }
  }, [workspaceId, loadWorkflows])

  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showInviteMembers, setShowInviteMembers] = useState(false)
  const { mode, workspaceDropdownOpen, setWorkspaceDropdownOpen, isAnyModalOpen, setAnyModalOpen } =
    useSidebarStore()
  const [isHovered, setIsHovered] = useState(false)
  const [explicitMouseEnter, setExplicitMouseEnter] = useState(false)

  useEffect(() => {
    const anyModalIsOpen = showSettings || showHelp || showInviteMembers
    setAnyModalOpen(anyModalIsOpen)
    if (anyModalIsOpen) {
      setExplicitMouseEnter(false)
    }
  }, [showSettings, showHelp, showInviteMembers, setAnyModalOpen])

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
  const handleCreateWorkflow = async (folderId?: string) => {
    // Prevent multiple simultaneous workflow creations
    if (isCreatingWorkflow) {
      logger.info('Workflow creation already in progress, ignoring request')
      return
    }

    try {
      setIsCreatingWorkflow(true)
      const id = await createWorkflow({
        workspaceId: workspaceId || undefined,
        folderId: folderId || undefined,
      })
      router.push(`/workspace/${workspaceId}/w/${id}`)
    } catch (error) {
      logger.error('Error creating workflow:', error)
    } finally {
      setIsCreatingWorkflow(false)
    }
  }

  // Calculate sidebar visibility states
  // When in hover mode, sidebar is collapsed until hovered or workspace dropdown is open
  // When in expanded/collapsed mode, sidebar follows isExpanded state
  const isCollapsed =
    mode === 'collapsed' ||
    (mode === 'hover' &&
      ((!isHovered && !workspaceDropdownOpen) || isAnyModalOpen || !explicitMouseEnter))

  const showOverlay =
    mode === 'hover' &&
    ((isHovered && !isAnyModalOpen && explicitMouseEnter) || workspaceDropdownOpen)

  return (
    <aside
      className={clsx(
        'fixed inset-y-0 left-0 z-10 flex flex-col border-r bg-background transition-all duration-200 sm:flex',
        isCollapsed ? 'w-14' : 'w-60',
        showOverlay && 'shadow-lg',
        mode === 'hover' && 'main-content-overlay'
      )}
      onMouseEnter={() => {
        if (mode === 'hover' && !isAnyModalOpen) {
          setIsHovered(true)
          setExplicitMouseEnter(true)
        }
      }}
      onMouseLeave={() => {
        if (mode === 'hover') {
          setIsHovered(false)
        }
      }}
    >
      {/* Workspace Header */}
      <div className='flex-shrink-0'>
        <WorkspaceHeader
          onCreateWorkflow={handleCreateWorkflow}
          isCollapsed={isCollapsed}
          onDropdownOpenChange={setWorkspaceDropdownOpen}
        />
      </div>

      {/* Scrollable Content Area */}
      <div className='scrollbar-none flex flex-1 flex-col overflow-auto px-2 py-0'>
        {/* Workflows Section */}
        <div className='flex-shrink-0'>
          <div
            className={`${isCollapsed ? 'justify-center' : ''} mb-1 flex items-center justify-between px-2`}
          >
            <h2
              className={`${isCollapsed ? 'hidden' : ''} font-medium text-muted-foreground text-xs`}
            >
              {isLoading ? <Skeleton className='h-4 w-16' /> : 'Workflows'}
            </h2>
            {!isCollapsed && !isLoading && (
              <CreateMenu
                onCreateWorkflow={handleCreateWorkflow}
                isCollapsed={false}
                isCreatingWorkflow={isCreatingWorkflow}
              />
            )}
          </div>
          <FolderTree
            regularWorkflows={regularWorkflows}
            marketplaceWorkflows={tempWorkflows}
            isCollapsed={isCollapsed}
            isLoading={isLoading}
            onCreateWorkflow={handleCreateWorkflow}
          />
        </div>

        {/* Navigation Section */}
        <div className='mt-6 flex-shrink-0'>
          <NavSection isLoading={isLoading} itemCount={3} isCollapsed={isCollapsed}>
            <NavSection.Item
              icon={<ScrollText className='h-[18px] w-[18px]' />}
              href={`/workspace/${workspaceId}/logs`}
              label='Logs'
              active={pathname === `/workspace/${workspaceId}/logs`}
              isCollapsed={isCollapsed}
              shortcutCommand={getKeyboardShortcutText('L', true, true)}
              shortcutCommandPosition='below'
            />
            <NavSection.Item
              icon={<LibraryBig className='h-[18px] w-[18px]' />}
              href={`/workspace/${workspaceId}/knowledge`}
              label='Knowledge'
              active={pathname === `/workspace/${workspaceId}/knowledge`}
              isCollapsed={isCollapsed}
              shortcutCommand={getKeyboardShortcutText('K', true, true)}
              shortcutCommandPosition='below'
            />
            <NavSection.Item
              icon={<Settings className='h-[18px] w-[18px]' />}
              onClick={() => setShowSettings(true)}
              label='Settings'
              isCollapsed={isCollapsed}
            />
          </NavSection>
        </div>

        <div className='flex-grow' />
      </div>

      {/* Bottom Controls */}
      {isCollapsed ? (
        <div className='flex-shrink-0 px-3 pt-1 pb-3'>
          <div className='flex flex-col space-y-[1px]'>
            {!isDev && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    onClick={
                      userPermissions.canAdmin ? () => setShowInviteMembers(true) : undefined
                    }
                    className={clsx(
                      'mx-auto flex h-8 w-8 items-center justify-center rounded-md font-medium text-sm',
                      userPermissions.canAdmin
                        ? 'cursor-pointer text-muted-foreground hover:bg-accent/50'
                        : 'cursor-not-allowed text-muted-foreground/50'
                    )}
                  >
                    <Send className='h-[18px] w-[18px]' />
                  </div>
                </TooltipTrigger>
                <TooltipContent side='right'>
                  {userPermissions.canAdmin
                    ? 'Invite Members'
                    : 'Admin permission required to invite members'}
                </TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  onClick={() => setShowHelp(true)}
                  className='mx-auto flex h-8 w-8 cursor-pointer items-center justify-center rounded-md font-medium text-muted-foreground text-sm hover:bg-accent/50'
                >
                  <HelpCircle className='h-[18px] w-[18px]' />
                </div>
              </TooltipTrigger>
              <TooltipContent side='right'>Help</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarControl />
              </TooltipTrigger>
              <TooltipContent side='right'>Toggle sidebar</TooltipContent>
            </Tooltip>
          </div>
        </div>
      ) : (
        <>
          {!isDev && (
            <div className='flex-shrink-0 px-3 pt-1'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    onClick={
                      userPermissions.canAdmin ? () => setShowInviteMembers(true) : undefined
                    }
                    className={clsx(
                      'flex items-center rounded-md px-2 py-1.5 font-medium text-sm',
                      userPermissions.canAdmin
                        ? 'cursor-pointer text-muted-foreground hover:bg-accent/50'
                        : 'cursor-not-allowed text-muted-foreground/50'
                    )}
                  >
                    <Send className='h-[18px] w-[18px]' />
                    <span className='ml-2'>Invite members</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side='top'>
                  {userPermissions.canAdmin
                    ? 'Invite new members to this workspace'
                    : 'Admin permission required to invite members'}
                </TooltipContent>
              </Tooltip>
            </div>
          )}

          <div className='flex-shrink-0 px-3 pt-1 pb-3'>
            <div className='flex justify-between'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarControl />
                </TooltipTrigger>
                <TooltipContent side='top'>Toggle sidebar</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    onClick={() => setShowHelp(true)}
                    className='flex h-8 w-8 cursor-pointer items-center justify-center rounded-md font-medium text-muted-foreground text-sm hover:bg-accent/50'
                  >
                    <HelpCircle className='h-[18px] w-[18px]' />
                    <span className='sr-only'>Help</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side='top'>Help, contact</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </>
      )}

      {/* Modals */}
      <SettingsModal open={showSettings} onOpenChange={setShowSettings} />
      <HelpModal open={showHelp} onOpenChange={setShowHelp} />
      {!isDev && <InviteModal open={showInviteMembers} onOpenChange={setShowInviteMembers} />}
    </aside>
  )
}
