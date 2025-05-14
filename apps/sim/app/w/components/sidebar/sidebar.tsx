'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Home,
  PanelRight,
  PenLine,
  ScrollText,
  Send,
  Settings,
  Shapes,
  Store,
  Users,
} from 'lucide-react'
import { AgentIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSession } from '@/lib/auth-client'
import { useSidebarStore } from '@/stores/sidebar/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { getKeyboardShortcutText, useGlobalShortcuts } from '@/app/w/hooks/use-keyboard-shortcuts'
import { useRegistryLoading } from '../../hooks/use-registry-loading'
import { HelpModal } from './components/help-modal/help-modal'
import { InviteModal } from './components/invite-modal/invite-modal'
import { NavSection } from './components/nav-section/nav-section'
import { SettingsModal } from './components/settings-modal/settings-modal'
import { SidebarControl } from './components/sidebar-control/sidebar-control'
import { WorkflowList } from './components/workflow-list/workflow-list'
import { WorkspaceHeader } from './components/workspace-header/workspace-header'

export function Sidebar() {
  useRegistryLoading()
  // Initialize global keyboard shortcuts
  useGlobalShortcuts()

  const {
    workflows,
    activeWorkspaceId,
    createWorkflow,
    isLoading: workflowsLoading,
  } = useWorkflowRegistry()
  const { isPending: sessionLoading } = useSession()
  const isLoading = workflowsLoading || sessionLoading
  const router = useRouter()
  const pathname = usePathname()
  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showInviteMembers, setShowInviteMembers] = useState(false)
  const {
    mode,
    isExpanded,
    toggleExpanded,
    setMode,
    workspaceDropdownOpen,
    setWorkspaceDropdownOpen,
    isAnyModalOpen,
    setAnyModalOpen,
  } = useSidebarStore()
  const [isHovered, setIsHovered] = useState(false)
  const [explicitMouseEnter, setExplicitMouseEnter] = useState(false)

  // Track when active workspace changes to ensure we refresh the UI
  useEffect(() => {
    if (activeWorkspaceId) {
      // We don't need to do anything here, just force a re-render
      // when activeWorkspaceId changes to ensure fresh data
    }
  }, [activeWorkspaceId])

  // Update modal state in the store when settings or help modals open/close
  useEffect(() => {
    setAnyModalOpen(showSettings || showHelp || showInviteMembers)
  }, [showSettings, showHelp, showInviteMembers, setAnyModalOpen])

  // Reset explicit mouse enter state when modal state changes
  useEffect(() => {
    if (isAnyModalOpen) {
      setExplicitMouseEnter(false)
    }
  }, [isAnyModalOpen])

  // Separate regular workflows from temporary marketplace workflows
  const { regularWorkflows, tempWorkflows } = useMemo(() => {
    const regular: WorkflowMetadata[] = []
    const temp: WorkflowMetadata[] = []

    // Only process workflows when not in loading state
    if (!isLoading) {
      Object.values(workflows).forEach((workflow) => {
        // Include workflows that either:
        // 1. Belong to the active workspace, OR
        // 2. Don't have a workspace ID (legacy workflows)
        if (workflow.workspaceId === activeWorkspaceId || !workflow.workspaceId) {
          if (workflow.marketplaceData?.status === 'temp') {
            temp.push(workflow)
          } else {
            regular.push(workflow)
          }
        }
      })

      // Sort regular workflows by last modified date (newest first)
      regular.sort((a, b) => {
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

      // Sort temp workflows by last modified date (newest first)
      temp.sort((a, b) => {
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
    }

    return { regularWorkflows: regular, tempWorkflows: temp }
  }, [workflows, isLoading, activeWorkspaceId])

  // Create workflow
  const handleCreateWorkflow = async () => {
    try {
      // Import the isActivelyLoadingFromDB function to check sync status
      const { isActivelyLoadingFromDB } = await import('@/stores/workflows/sync')

      // Prevent creating workflows during active DB operations
      if (isActivelyLoadingFromDB()) {
        console.log('Please wait, syncing in progress...')
        return
      }

      // Create the workflow and ensure it's associated with the active workspace
      const id = createWorkflow({
        workspaceId: activeWorkspaceId || undefined,
      })

      router.push(`/w/${id}`)
    } catch (error) {
      console.error('Error creating workflow:', error)
    }
  }

  // Calculate sidebar visibility states
  // When in hover mode, sidebar is collapsed until hovered or workspace dropdown is open
  // When in expanded/collapsed mode, sidebar follows isExpanded state
  const isCollapsed =
    mode === 'collapsed' ||
    (mode === 'hover' &&
      ((!isHovered && !workspaceDropdownOpen) || isAnyModalOpen || !explicitMouseEnter))
  // Only show overlay effect when in hover mode and actually being hovered or dropdown is open
  const showOverlay =
    mode === 'hover' &&
    ((isHovered && !isAnyModalOpen && explicitMouseEnter) || workspaceDropdownOpen)

  return (
    <aside
      className={clsx(
        'fixed inset-y-0 left-0 z-10 flex flex-col border-r bg-background sm:flex transition-all duration-200',
        isCollapsed ? 'w-14' : 'w-60',
        showOverlay ? 'shadow-lg' : '',
        mode === 'hover' ? 'main-content-overlay' : ''
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
      style={{
        // When in hover mode and expanded, position above content without pushing it
        position: showOverlay ? 'fixed' : 'fixed',
      }}
    >
      {/* Workspace Header - Fixed at top */}
      <div className="flex-shrink-0">
        <WorkspaceHeader
          onCreateWorkflow={handleCreateWorkflow}
          isCollapsed={isCollapsed}
          onDropdownOpenChange={setWorkspaceDropdownOpen}
        />
      </div>

      {/* Main navigation - Fixed at top below header */}
      {/* <div className="flex-shrink-0 px-2 pt-0">
        <NavSection isLoading={isLoading} itemCount={2} isCollapsed={isCollapsed}>
          <NavSection.Item
            icon={<Home className="h-[18px] w-[18px]" />}
            href="/w/1"
            label="Home"
            active={pathname === '/w/1'}
            isCollapsed={isCollapsed}
          />
          <NavSection.Item
            icon={<Shapes className="h-[18px] w-[18px]" />}
            href="/w/templates"
            label="Templates"
            active={pathname === '/w/templates'}
            isCollapsed={isCollapsed}
          />
          <NavSection.Item
            icon={<Store className="h-[18px] w-[18px]" />}
            href="/w/marketplace"
            label="Marketplace"
            active={pathname === '/w/marketplace'}
            isCollapsed={isCollapsed}
          />
        </NavSection>
      </div> */}

      {/* Scrollable Content Area - Contains Workflows and Logs/Settings */}
      <div className="flex-1 overflow-auto scrollbar-none flex flex-col px-2 py-0">
        {/* Workflows Section */}
        <div className="flex-shrink-0">
          <h2
            className={`mb-1 px-2 text-xs font-medium text-muted-foreground ${isCollapsed ? 'text-center' : ''}`}
          >
            {isLoading ? (
              isCollapsed ? (
                ''
              ) : (
                <Skeleton className="w-16 h-4" />
              )
            ) : isCollapsed ? (
              ''
            ) : (
              'Workflows'
            )}
          </h2>
          <WorkflowList
            regularWorkflows={regularWorkflows}
            marketplaceWorkflows={tempWorkflows}
            isCollapsed={isCollapsed}
            isLoading={isLoading}
          />
        </div>

        {/* Logs and Settings Navigation - Follows workflows */}
        <div className="mt-6 flex-shrink-0">
          <NavSection isLoading={isLoading} itemCount={2} isCollapsed={isCollapsed}>
            <NavSection.Item
              icon={<ScrollText className="h-[18px] w-[18px]" />}
              href="/w/logs"
              label="Logs"
              active={pathname === '/w/logs'}
              isCollapsed={isCollapsed}
              shortcutCommand={getKeyboardShortcutText('L', true, true)}
              shortcutCommandPosition="below"
            />
            <NavSection.Item
              icon={<Settings className="h-[18px] w-[18px]" />}
              onClick={() => setShowSettings(true)}
              label="Settings"
              isCollapsed={isCollapsed}
            />
          </NavSection>
        </div>

        {/* Push the bottom controls down when content is short */}
        <div className="flex-grow"></div>
      </div>

      {isCollapsed ? (
        <div className="flex-shrink-0 px-3 pb-3 pt-1">
          <div className="flex flex-col space-y-[1px]">
            {/* Invite members button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  onClick={() => setShowInviteMembers(true)}
                  className="flex items-center justify-center rounded-md text-sm font-medium text-muted-foreground hover:bg-accent/50 cursor-pointer w-8 h-8 mx-auto"
                >
                  <Send className="h-[18px] w-[18px]" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">Invite Members</TooltipContent>
            </Tooltip>

            {/* Help button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  onClick={() => setShowHelp(true)}
                  className="flex items-center justify-center rounded-md text-sm font-medium text-muted-foreground hover:bg-accent/50 cursor-pointer w-8 h-8 mx-auto"
                >
                  <HelpCircle className="h-[18px] w-[18px]" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">Help</TooltipContent>
            </Tooltip>

            {/* Sidebar control */}
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarControl />
              </TooltipTrigger>
              <TooltipContent side="right">Toggle sidebar</TooltipContent>
            </Tooltip>
          </div>
        </div>
      ) : (
        <>
          {/* Invite members bar */}
          <div className="flex-shrink-0 px-3 pt-1">
            <div
              onClick={() => setShowInviteMembers(true)}
              className="flex items-center rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent/50 cursor-pointer"
            >
              <Send className="h-[18px] w-[18px]" />
              <span className="ml-2">Invite members</span>
            </div>
          </div>

          {/* Bottom buttons container */}
          <div className="flex-shrink-0 px-3 pb-3 pt-1">
            <div className="flex justify-between">
              {/* Sidebar control on left with tooltip */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarControl />
                </TooltipTrigger>
                <TooltipContent side="top">Toggle sidebar</TooltipContent>
              </Tooltip>

              {/* Help button on right with tooltip */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    onClick={() => setShowHelp(true)}
                    className="flex items-center justify-center rounded-md w-8 h-8 text-sm font-medium text-muted-foreground hover:bg-accent/50 cursor-pointer"
                  >
                    <HelpCircle className="h-[18px] w-[18px]" />
                    <span className="sr-only">Help</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">Help, contact</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </>
      )}

      <SettingsModal open={showSettings} onOpenChange={setShowSettings} />
      <HelpModal open={showHelp} onOpenChange={setShowHelp} />
      <InviteModal open={showInviteMembers} onOpenChange={setShowInviteMembers} />
    </aside>
  )
}
