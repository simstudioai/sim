'use client'

import { useMemo, useState } from 'react'
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
  Settings,
  Store,
} from 'lucide-react'
import { AgentIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSidebarStore } from '@/stores/sidebar/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { HelpModal } from './components/help-modal/help-modal'
import { NavSection } from './components/nav-section/nav-section'
import { SettingsModal } from './components/settings-modal/settings-modal'
import { WorkflowList } from './components/workflow-list/workflow-list'
import { WorkspaceHeader } from './components/workspace-header/workspace-header'

export function Sidebar() {
  const { workflows, createWorkflow } = useWorkflowRegistry()
  const router = useRouter()
  const pathname = usePathname()
  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const { isCollapsed, toggleCollapsed } = useSidebarStore()

  // Separate regular workflows from temporary marketplace workflows
  const { regularWorkflows, tempWorkflows } = useMemo(() => {
    const regular: WorkflowMetadata[] = []
    const temp: WorkflowMetadata[] = []

    Object.values(workflows).forEach((workflow) => {
      if (workflow.marketplaceData?.status === 'temp') {
        temp.push(workflow)
      } else {
        regular.push(workflow)
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

    return { regularWorkflows: regular, tempWorkflows: temp }
  }, [workflows])

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

      const id = createWorkflow()
      router.push(`/w/${id}`)
    } catch (error) {
      console.error('Error creating workflow:', error)
    }
  }

  return (
    <aside
      className={clsx(
        'fixed inset-y-0 left-0 z-10 flex flex-col border-r bg-background sm:flex transition-width duration-200',
        isCollapsed ? 'w-14' : 'w-60'
      )}
    >
      {/* Workspace Header */}
      <WorkspaceHeader onCreateWorkflow={handleCreateWorkflow} isCollapsed={isCollapsed} />

      {/* Main navigation and content - This area scrolls */}
      <div className="flex-1 overflow-y-auto px-2 pt-0 pb-2 scrollbar-none">
        {/* Main Navigation */}
        <NavSection>
          <NavSection.Item
            icon={<Home className="h-[18px] w-[18px]" />}
            href="/w/1"
            label="Home"
            active={pathname === '/w/1'}
            isCollapsed={isCollapsed}
          />
          <NavSection.Item
            icon={<PanelRight className="h-[18px] w-[18px]" />}
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

        {/* Workflows Section */}
        <div className="mt-6">
          <h2
            className={`mb-1 px-2 text-xs font-medium text-muted-foreground ${isCollapsed ? 'text-center' : ''}`}
          >
            {isCollapsed ? '' : 'Workflows'}
          </h2>
          {isCollapsed ? (
            <div className="space-y-[1px]">
              {regularWorkflows.map((workflow) => {
                return (
                  <Link
                    key={workflow.id}
                    href={`/w/${workflow.id}`}
                    className={clsx(
                      'flex items-center justify-center rounded-md text-sm font-medium text-muted-foreground w-8 h-8 mx-auto',
                      pathname === `/w/${workflow.id}` ? 'bg-accent' : 'hover:bg-accent/50'
                    )}
                  >
                    <div
                      className="h-[14px] w-[14px] rounded flex-shrink-0"
                      style={{ backgroundColor: workflow.color }}
                    />
                  </Link>
                )
              })}
            </div>
          ) : (
            <WorkflowList
              regularWorkflows={regularWorkflows}
              marketplaceWorkflows={tempWorkflows}
            />
          )}
        </div>

        {/* Logs and Settings Navigation  */}
        <div className="mt-6">
          <NavSection>
            <NavSection.Item
              icon={<ScrollText className="h-[18px] w-[18px]" />}
              href="/w/logs"
              label="Logs"
              active={pathname === '/w/logs'}
              isCollapsed={isCollapsed}
            />
            <NavSection.Item
              icon={<Settings className="h-[18px] w-[18px]" />}
              onClick={() => setShowSettings(true)}
              label="Settings"
              isCollapsed={isCollapsed}
            />
          </NavSection>
        </div>
      </div>

      {/* Bottom buttons container */}
      <div className="flex-shrink-0 px-2 py-3">
        {isCollapsed ? (
          <div className="flex flex-col space-y-[1px]">
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

            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  onClick={toggleCollapsed}
                  className="flex items-center justify-center rounded-md text-sm font-medium text-muted-foreground hover:bg-accent/50 cursor-pointer w-8 h-8 mx-auto"
                >
                  <ChevronRight className="h-[18px] w-[18px]" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">Expand</TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <div className="flex justify-between">
            {/* Help button on left */}
            <div
              onClick={() => setShowHelp(true)}
              className="flex items-center justify-center rounded-md px-1 py-1 text-sm font-medium text-muted-foreground hover:bg-accent/50 cursor-pointer"
            >
              <HelpCircle className="h-[18px] w-[18px]" />
              <span className="sr-only">Help</span>
            </div>

            {/* Collapse/Expand button on right */}
            <div
              onClick={toggleCollapsed}
              className="flex items-center justify-center rounded-md px-1 py-1 text-sm font-medium text-muted-foreground hover:bg-accent/50 cursor-pointer"
            >
              <ChevronLeft className="h-[18px] w-[18px]" />
              <span className="sr-only">Collapse</span>
            </div>
          </div>
        )}
      </div>

      <SettingsModal open={showSettings} onOpenChange={setShowSettings} />
      <HelpModal open={showHelp} onOpenChange={setShowHelp} />
    </aside>
  )
}
