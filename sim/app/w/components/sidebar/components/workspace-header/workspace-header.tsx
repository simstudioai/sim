'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, PenLine, Settings, UserPlus } from 'lucide-react'
import { AgentIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSession } from '@/lib/auth-client'

interface Workspace {
  id: string
  name: string
  ownerId: string
}

interface WorkspaceHeaderProps {
  onCreateWorkflow: () => void
  isCollapsed?: boolean
}

export function WorkspaceHeader({ onCreateWorkflow, isCollapsed }: WorkspaceHeaderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const { data: sessionData, isPending } = useSession()
  const [plan, setPlan] = useState('Free Plan')
  const isLoading = isPending
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null)
  const [isWorkspacesLoading, setIsWorkspacesLoading] = useState(true)

  const userName = sessionData?.user?.name || sessionData?.user?.email || 'User'

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

      // Fetch user's workspaces
      setIsWorkspacesLoading(true)
      // This is a mock implementation - we'd actually call the API here
      // fetch('/api/workspaces')
      //   .then((res) => res.json())
      //   .then((data) => handleWorkspaces(data))

      // Mock implementation for now
      setTimeout(() => {
        const defaultWorkspace = {
          id: '1',
          name: `${userName}'s Workspace`,
          ownerId: sessionData.user.id,
        }
        setWorkspaces([defaultWorkspace])
        setActiveWorkspace(defaultWorkspace)
        setIsWorkspacesLoading(false)
      }, 500)
    }
  }, [sessionData?.user?.id, userName])

  // This would be used when we have the actual API
  // const handleWorkspaces = (data: { workspaces: Workspace[] }) => {
  //   if (data.workspaces.length === 0) {
  //     // Create a default workspace if none exists
  //     createDefaultWorkspace();
  //   } else {
  //     setWorkspaces(data.workspaces);
  //     setActiveWorkspace(data.workspaces[0]);
  //     setIsWorkspacesLoading(false);
  //   }
  // }

  // const createDefaultWorkspace = () => {
  //   // Create a default workspace for the user
  //   fetch('/api/workspaces', {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ name: `${userName}'s Workspace` })
  //   })
  //     .then(res => res.json())
  //     .then(data => {
  //       setWorkspaces([data.workspace]);
  //       setActiveWorkspace(data.workspace);
  //       setIsWorkspacesLoading(false);
  //     })
  //     .catch(err => {
  //       console.error('Error creating workspace:', err);
  //       setIsWorkspacesLoading(false);
  //     });
  // }

  const switchWorkspace = (workspace: Workspace) => {
    setActiveWorkspace(workspace)
    // In a real implementation, we would navigate or update the app state
    // router.push(`/w/${workspace.id}`);
  }

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
                  {isLoading || isWorkspacesLoading ? (
                    <Skeleton className="h-4 w-[140px]" />
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className="truncate max-w-[120px] text-sm font-medium">
                        {activeWorkspace?.name || `${userName}'s Workspace`}
                      </span>
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </div>
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
                        {isLoading || isWorkspacesLoading ? (
                          <>
                            <Skeleton className="h-4 w-[140px] mb-1" />
                            <Skeleton className="h-3 w-16" />
                          </>
                        ) : (
                          <>
                            <span className="text-sm font-medium truncate">
                              {activeWorkspace?.name || `${userName}'s Workspace`}
                            </span>
                            <span className="text-xs text-muted-foreground">{plan}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <DropdownMenuSeparator />

                {/* Workspaces list */}
                <div className="py-1 px-1">
                  <div className="text-xs font-medium text-muted-foreground mb-1 pl-1">
                    Workspaces
                  </div>
                  {isWorkspacesLoading ? (
                    <div className="py-1 px-2">
                      <Skeleton className="h-5 w-full" />
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {workspaces.map((workspace) => (
                        <DropdownMenuItem
                          key={workspace.id}
                          className={`text-sm rounded-md px-2 py-1.5 cursor-pointer ${activeWorkspace?.id === workspace.id ? 'bg-accent' : ''}`}
                          onClick={() => switchWorkspace(workspace)}
                        >
                          <span className="truncate">{workspace.name}</span>
                        </DropdownMenuItem>
                      ))}
                    </div>
                  )}
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
