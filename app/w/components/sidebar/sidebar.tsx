'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Settings } from 'lucide-react'
import { AgentIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWorkflowRegistry } from '@/stores/workflow/registry/store'
import { NavItem } from './components/nav-item/nav-item'
import { SettingsModal } from './components/settings-modal/settings-modal'

export function Sidebar() {
  const WORKFLOW_COLORS = ['#3972F6', '#F639DD', '#F6B539', '#8139F6', '#F64439']
  const { workflows, addWorkflow } = useWorkflowRegistry()
  const router = useRouter()
  const [showSettings, setShowSettings] = useState(false)

  const handleCreateWorkflow = () => {
    const id = crypto.randomUUID()
    const workflowArray = Object.values(workflows)
    const lastWorkflow = workflowArray[workflowArray.length - 1]

    // Find the index of the last used color, defaulting to first color if undefined
    const lastColorIndex = lastWorkflow?.color ? WORKFLOW_COLORS.indexOf(lastWorkflow.color) : -1

    // Get next color index, wrapping around to 0 if we reach the end
    const nextColorIndex = (lastColorIndex + 1) % WORKFLOW_COLORS.length

    const newWorkflow = {
      id,
      name: `Workflow ${workflowArray.length + 1}`,
      lastModified: new Date(),
      description: 'New workflow',
      color: WORKFLOW_COLORS[nextColorIndex],
    }

    addWorkflow(newWorkflow)
    router.push(`/w/${id}`)
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-10 hidden w-14 flex-col border-r bg-background sm:flex">
      <nav className="flex flex-col items-center gap-4 px-2 py-5">
        <Link
          href="/"
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
          {Object.values(workflows || {}).map((workflow) => (
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
    </aside>
  )
}
