'use client'

import Link from 'next/link'
import { ChevronDown, PenLine } from 'lucide-react'
import { AgentIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface WorkspaceHeaderProps {
  onCreateWorkflow: () => void
  isCollapsed?: boolean
}

export function WorkspaceHeader({ onCreateWorkflow, isCollapsed }: WorkspaceHeaderProps) {
  return (
    <div className="py-2 px-2">
      <div
        className={`group relative rounded-md cursor-pointer ${isCollapsed ? 'flex justify-center' : ''}`}
      >
        {/* Hover background with consistent padding - only when not collapsed */}
        {!isCollapsed && <div className="absolute inset-0 rounded-md group-hover:bg-accent/50" />}

        {/* Content with consistent padding */}
        <div
          className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} px-2 py-[6px] relative z-10`}
        >
          <div className={`flex items-center ${isCollapsed ? '' : 'gap-2'} overflow-hidden`}>
            <Link
              href="/w/1"
              className="group flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#802FFF]"
            >
              <AgentIcon className="text-white transition-all group-hover:scale-105 -translate-y-[0.5px] w-[18px] h-[18px]" />
            </Link>
            {!isCollapsed && (
              <div className="flex items-center">
                <span className="truncate max-w-[110px] text-sm font-medium">
                  Emir Karabeg's Workspace
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground ml-1 flex-shrink-0" />
              </div>
            )}
          </div>

          {!isCollapsed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onCreateWorkflow}
                  className="h-6 w-6 shrink-0 p-0 flex items-center justify-center"
                >
                  <PenLine className="h-[18px] w-[18px]" />
                  <span className="sr-only">New Workflow</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>New Workflow</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Removing the collapsed workflow button as requested */}
    </div>
  )
}
