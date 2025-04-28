'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, PenLine, Settings, UserPlus } from 'lucide-react'
import { AgentIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSession } from '@/lib/auth-client'

interface WorkspaceHeaderProps {
  onCreateWorkflow: () => void
  isCollapsed?: boolean
}

export function WorkspaceHeader({ onCreateWorkflow, isCollapsed }: WorkspaceHeaderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const { data: sessionData, isPending } = useSession()
  const [plan, setPlan] = useState('Free Plan')
  const isLoading = isPending

  useEffect(() => {
    // Fetch subscription status if user is logged in
    if (sessionData?.user?.id) {
      fetch('/api/user/subscription')
        .then((res) => res.json())
        .then((data) => {
          setPlan(data.isPro ? 'Pro Plan' : 'Free Plan')
        })
        .catch((err) => {
          console.error('Error fetching subscription status:', err)
        })
    }
  }, [sessionData?.user?.id])

  const userName = sessionData?.user?.name || sessionData?.user?.email || 'User'

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
          {isCollapsed ? (
            <Link
              href="/w/1"
              className="group flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#802FFF]"
            >
              <AgentIcon className="text-white transition-all group-hover:scale-105 -translate-y-[0.5px] w-[18px] h-[18px]" />
            </Link>
          ) : (
            <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
              <DropdownMenuTrigger asChild>
                <div className="flex items-center gap-2 overflow-hidden">
                  <Link
                    href="/w/1"
                    className="group flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#802FFF]"
                    onClick={(e) => {
                      if (isOpen) e.preventDefault()
                    }}
                  >
                    <AgentIcon className="text-white transition-all group-hover:scale-105 -translate-y-[0.5px] w-[18px] h-[18px]" />
                  </Link>
                  {isLoading ? (
                    <Skeleton className="h-4 w-[140px]" />
                  ) : (
                    <span className="truncate max-w-[140px] text-sm font-medium">
                      {userName}'s Workspace
                    </span>
                  )}
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-68 p-1">
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-1">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[#802FFF]">
                        <AgentIcon className="text-white w-5 h-5" />
                      </div>
                      <div className="flex flex-col max-w-full">
                        {isLoading ? (
                          <>
                            <Skeleton className="h-4 w-[140px] mb-1" />
                            <Skeleton className="h-3 w-16" />
                          </>
                        ) : (
                          <>
                            <span className="text-sm font-medium truncate">
                              {userName}'s Workspace
                            </span>
                            <span className="text-xs text-muted-foreground">{plan}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {!isCollapsed && (
            <Tooltip>
              <TooltipTrigger asChild>
                {isLoading ? (
                  <Skeleton className="h-6 w-6 shrink-0" />
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onCreateWorkflow}
                    className="h-6 w-6 shrink-0 p-0 flex items-center justify-center"
                  >
                    <PenLine className="h-[18px] w-[18px]" />
                    <span className="sr-only">New Workflow</span>
                  </Button>
                )}
              </TooltipTrigger>
              <TooltipContent>New Workflow</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}
