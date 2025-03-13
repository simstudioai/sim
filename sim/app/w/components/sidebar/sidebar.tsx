'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import clsx from 'clsx'
import { HelpCircle, Plus, ScrollText, Settings } from 'lucide-react'
import { AgentIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { HelpModal } from './components/help-modal/help-modal'
import { NavItem } from './components/nav-item/nav-item'
import { SettingsModal } from './components/settings-modal/settings-modal'

export function Sidebar() {
  const { workflows, createWorkflow } = useWorkflowRegistry()
  const router = useRouter()
  const pathname = usePathname()
  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  // Sort workflows by lastModified date (which corresponds to createdAt for new workflows)
  // Newest workflows at the bottom (ascending order by date)
  const sortedWorkflows = useMemo(() => {
    return Object.values(workflows).sort((a, b) => {
      // Ensure we're comparing dates properly by converting to timestamps
      const dateA =
        a.lastModified instanceof Date
          ? a.lastModified.getTime()
          : new Date(a.lastModified).getTime()
      const dateB =
        b.lastModified instanceof Date
          ? b.lastModified.getTime()
          : new Date(b.lastModified).getTime()
      return dateA - dateB // Ascending order (oldest first, newest last)
    })
  }, [workflows])

  const handleCreateWorkflow = () => {
    const id = createWorkflow()
    router.push(`/w/${id}`)
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-10 hidden w-14 flex-col border-r bg-background sm:flex">
      <nav className="flex flex-col items-center gap-4 px-2 py-5">
        <Link
          href="/w/1"
          className="group flex h-8 w-8 items-center justify-center rounded-lg bg-[#7F2FFF]"
        >
          <AgentIcon className="text-white transition-all group-hover:scale-110 -translate-y-[0.5px] w-5 h-5" />
          <span className="sr-only">Sim Studio</span>
        </Link>
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

      {/* Scrollable workflows section */}
      <nav className="flex-1 overflow-y-auto px-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
        <div className="flex flex-col items-center gap-4">
          {sortedWorkflows.map((workflow) => (
            <NavItem key={workflow.id} href={`/w/${workflow.id}`} label={workflow.name}>
              <div
                className="h-4 w-4 rounded-full"
                style={{ backgroundColor: workflow.color || '#3972F6' }}
              />
            </NavItem>
          ))}
        </div>
      </nav>

      <nav className="flex flex-col items-center gap-4 px-2 py-[18px]">
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
