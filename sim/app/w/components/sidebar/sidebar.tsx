'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import clsx from 'clsx'
import { HelpCircle, Plus, ScrollText, Settings, Store } from 'lucide-react'
import { AgentIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { HelpModal } from './components/help-modal/help-modal'
import { NavItem } from './components/nav-item/nav-item'
import { SettingsModal } from './components/settings-modal/settings-modal'
import { WorkflowFolders } from './components/workflow-folders/workflow-folders'

export function Sidebar() {
  const { workflows, createWorkflow } = useWorkflowRegistry()
  const router = useRouter()
  const pathname = usePathname()
  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

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
    <aside className="fixed inset-y-0 left-0 z-10 hidden w-14 flex-col border-r bg-background sm:flex">
      {/* Top navigation - Logo and Add button */}
      <nav className="flex-shrink-0 flex flex-col items-center gap-4 px-2 py-5">
        {/* Sim Studio Logo */}
        <Link
          href="/w/1"
          className="group flex h-8 w-8 items-center justify-center rounded-lg bg-[#802FFF]"
        >
          <AgentIcon className="text-white transition-all group-hover:scale-110 -translate-y-[0.5px] w-5 h-5" />
          <span className="sr-only">Sim Studio</span>
        </Link>

        {/* Add Workflow */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCreateWorkflow}
              className="h-9 w-9 md:h-8 md:w-8"
            >
              <Plus className="h-5 w-5" />
              <span className="sr-only">Add Workflow</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Add Workflow</TooltipContent>
        </Tooltip>
      </nav>

      {/* Workflow sections - This area scrolls */}
      <div className="flex-1 overflow-y-auto px-2 scrollbar-none">
        <div className="pb-2">
          <WorkflowFolders
            regularWorkflows={regularWorkflows}
            marketplaceWorkflows={tempWorkflows}
          />
        </div>
      </div>

      {/* Bottom navigation - Always visible */}
      <nav className="flex-shrink-0 flex flex-col items-center gap-4 px-2 py-[18px]">
        {/* Marketplace */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              asChild
              className={clsx(
                'flex !h-9 !w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground md:h-8 md:w-8',
                {
                  'bg-accent': pathname === '/w/marketplace',
                }
              )}
            >
              <Link href="/w/marketplace">
                <Store className="!h-5 !w-5" />
                <span className="sr-only">Marketplace</span>
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Marketplace</TooltipContent>
        </Tooltip>

        {/* Logs */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              asChild
              className={clsx(
                'flex !h-9 !w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground md:h-8 md:w-8',
                {
                  'bg-accent': pathname === '/w/logs',
                }
              )}
            >
              <Link href="/w/logs">
                <ScrollText className="!h-5 !w-5" />
                <span className="sr-only">Logs</span>
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Logs</TooltipContent>
        </Tooltip>

        {/* Help & Support */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowHelp(true)}
              className={clsx(
                'flex !h-9 !w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground md:h-8 md:w-8'
              )}
            >
              <HelpCircle className="!h-5 !w-5" />
              <span className="sr-only">Help & Support</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Help & Support</TooltipContent>
        </Tooltip>

        {/* Settings */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettings(true)}
              className="flex !h-9 !w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground md:h-8 md:w-8"
            >
              <Settings className="!h-5 !w-5" />
              <span className="sr-only">Settings</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      </nav>

      <SettingsModal open={showSettings} onOpenChange={setShowSettings} />
      <HelpModal open={showHelp} onOpenChange={setShowHelp} />
    </aside>
  )
}
