'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ChevronDown,
  GitPullRequestCreate,
  GitPullRequestCreateArrow,
  Pencil,
  PenLine,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { AgentIcon } from '@/components/icons'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSession } from '@/lib/auth-client'
import { cn } from '@/lib/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface Workspace {
  id: string
  name: string
  ownerId: string
  role?: string
}

interface WorkspaceHeaderProps {
  onCreateWorkflow: () => void
  isCollapsed?: boolean
}

// New WorkspaceModal component
interface WorkspaceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateWorkspace: (name: string) => void
}

function WorkspaceModal({ open, onOpenChange, onCreateWorkspace }: WorkspaceModalProps) {
  const [workspaceName, setWorkspaceName] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (workspaceName.trim()) {
      onCreateWorkspace(workspaceName.trim())
      setWorkspaceName('')
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[500px] flex flex-col p-0 gap-0 overflow-hidden"
        hideCloseButton
      >
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-medium">Create New Workspace</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 p-0"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className="px-6 pt-4 pb-6">
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="workspace-name" className="text-sm font-medium">
                  Workspace Name
                </label>
                <Input
                  id="workspace-name"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="Enter workspace name"
                  className="w-full"
                  autoFocus
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  disabled={!workspaceName.trim()}
                  className={cn(
                    'gap-2 font-medium',
                    'bg-[#802FFF] hover:bg-[#7028E6]',
                    'shadow-[0_0_0_0_#802FFF] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
                    'text-white transition-all duration-200',
                    'disabled:opacity-50 disabled:hover:bg-[#802FFF] disabled:hover:shadow-none'
                  )}
                >
                  Create
                </Button>
              </div>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// New WorkspaceEditModal component
interface WorkspaceEditModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdateWorkspace: (id: string, name: string) => void
  workspace: Workspace | null
}

function WorkspaceEditModal({
  open,
  onOpenChange,
  onUpdateWorkspace,
  workspace,
}: WorkspaceEditModalProps) {
  const [workspaceName, setWorkspaceName] = useState('')

  useEffect(() => {
    if (workspace && open) {
      setWorkspaceName(workspace.name)
    }
  }, [workspace, open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (workspace && workspaceName.trim()) {
      onUpdateWorkspace(workspace.id, workspaceName.trim())
      setWorkspaceName('')
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[500px] flex flex-col p-0 gap-0 overflow-hidden"
        hideCloseButton
      >
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-medium">Edit Workspace</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 p-0"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className="px-6 pt-4 pb-6">
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="workspace-name-edit" className="text-sm font-medium">
                  Workspace Name
                </label>
                <Input
                  id="workspace-name-edit"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="Enter workspace name"
                  className="w-full"
                  autoFocus
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  disabled={!workspaceName.trim()}
                  className={cn(
                    'gap-2 font-medium',
                    'bg-[#802FFF] hover:bg-[#7028E6]',
                    'shadow-[0_0_0_0_#802FFF] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
                    'text-white transition-all duration-200',
                    'disabled:opacity-50 disabled:hover:bg-[#802FFF] disabled:hover:shadow-none'
                  )}
                >
                  Update
                </Button>
              </div>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function WorkspaceHeader({ onCreateWorkflow, isCollapsed }: WorkspaceHeaderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const { data: sessionData, isPending } = useSession()
  const [plan, setPlan] = useState('Free Plan')
  // Use client-side loading instead of isPending to avoid hydration mismatch
  const [isClientLoading, setIsClientLoading] = useState(true)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null)
  const [isWorkspacesLoading, setIsWorkspacesLoading] = useState(true)
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false)
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const router = useRouter()

  // Get workflowRegistry state and actions
  const { activeWorkspaceId, setActiveWorkspace: setActiveWorkspaceId } = useWorkflowRegistry()

  const userName = sessionData?.user?.name || sessionData?.user?.email || 'User'

  // Set isClientLoading to false after hydration
  useEffect(() => {
    setIsClientLoading(false)
  }, [])

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
      fetch('/api/workspaces')
        .then((res) => res.json())
        .then((data) => {
          if (data.workspaces && Array.isArray(data.workspaces)) {
            const fetchedWorkspaces = data.workspaces as Workspace[]
            setWorkspaces(fetchedWorkspaces)

            // Find workspace that matches the active ID from registry or use first workspace
            const matchingWorkspace = fetchedWorkspaces.find(
              (workspace) => workspace.id === activeWorkspaceId
            )
            const workspaceToActivate = matchingWorkspace || fetchedWorkspaces[0]

            // If we found a workspace, set it as active and update registry if needed
            if (workspaceToActivate) {
              setActiveWorkspace(workspaceToActivate)

              // If active workspace in UI doesn't match registry, update registry
              if (workspaceToActivate.id !== activeWorkspaceId) {
                setActiveWorkspaceId(workspaceToActivate.id)
              }
            }
          }
          setIsWorkspacesLoading(false)
        })
        .catch((err) => {
          console.error('Error fetching workspaces:', err)
          setIsWorkspacesLoading(false)
        })
    }
  }, [sessionData?.user?.id, activeWorkspaceId, setActiveWorkspaceId])

  const switchWorkspace = (workspace: Workspace) => {
    // If already on this workspace, do nothing
    if (activeWorkspace?.id === workspace.id) {
      setIsOpen(false)
      return
    }

    setActiveWorkspace(workspace)
    setIsOpen(false)

    // Update the workflow registry store with the new active workspace
    setActiveWorkspaceId(workspace.id)

    // Update URL to include workspace ID
    router.push(`/w/${workspace.id}`)
  }

  const handleCreateWorkspace = (name: string) => {
    setIsWorkspacesLoading(true)

    fetch('/api/workspaces', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.workspace) {
          const newWorkspace = data.workspace as Workspace
          setWorkspaces((prev) => [...prev, newWorkspace])
          setActiveWorkspace(newWorkspace)

          // Update the workflow registry store with the new active workspace
          setActiveWorkspaceId(newWorkspace.id)

          // Update URL to include new workspace ID
          router.push(`/w/${newWorkspace.id}`)
        }
        setIsWorkspacesLoading(false)
      })
      .catch((err) => {
        console.error('Error creating workspace:', err)
        setIsWorkspacesLoading(false)
      })
  }

  const handleUpdateWorkspace = async (id: string, name: string) => {
    setIsWorkspacesLoading(true)

    try {
      const response = await fetch(`/api/workspaces/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      })

      if (!response.ok) {
        throw new Error('Failed to update workspace')
      }

      const { workspace } = await response.json()

      // Update workspaces list
      setWorkspaces((prevWorkspaces) =>
        prevWorkspaces.map((w) => (w.id === workspace.id ? { ...w, name: workspace.name } : w))
      )

      // If active workspace was updated, update it too
      if (activeWorkspace?.id === workspace.id) {
        setActiveWorkspace({ ...activeWorkspace, name: workspace.name } as Workspace)
      }
    } catch (err) {
      console.error('Error updating workspace:', err)
    } finally {
      setIsWorkspacesLoading(false)
    }
  }

  const handleDeleteWorkspace = async (id: string) => {
    setIsDeleting(true)

    try {
      const response = await fetch(`/api/workspaces/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete workspace')
      }

      // Remove from workspace list
      const updatedWorkspaces = workspaces.filter((w) => w.id !== id)
      setWorkspaces(updatedWorkspaces)

      // If deleted workspace was active, switch to another workspace
      if (activeWorkspace?.id === id && updatedWorkspaces.length > 0) {
        // Use the specialized method for handling workspace deletion
        const newWorkspaceId = updatedWorkspaces[0].id
        useWorkflowRegistry.getState().handleWorkspaceDeletion(newWorkspaceId)
        setActiveWorkspace(updatedWorkspaces[0])
      }

      setIsOpen(false)
    } catch (err) {
      console.error('Error deleting workspace:', err)
    } finally {
      setIsDeleting(false)
    }
  }

  const openEditModal = (workspace: Workspace, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingWorkspace(workspace)
    setIsEditModalOpen(true)
  }

  // Determine URL for workspace links
  const workspaceUrl = activeWorkspace ? `/w/${activeWorkspace.id}` : '/w'

  return (
    <div className="py-2 px-2">
      {/* Workspace Modal */}
      <WorkspaceModal
        open={isWorkspaceModalOpen}
        onOpenChange={setIsWorkspaceModalOpen}
        onCreateWorkspace={handleCreateWorkspace}
      />

      {/* Edit Workspace Modal */}
      <WorkspaceEditModal
        open={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
        onUpdateWorkspace={handleUpdateWorkspace}
        workspace={editingWorkspace}
      />

      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <div
          className={`group relative rounded-md cursor-pointer ${isCollapsed ? 'flex justify-center' : ''}`}
        >
          {/* Hover background with consistent padding - only when not collapsed */}
          {!isCollapsed && <div className="absolute inset-0 rounded-md group-hover:bg-accent/50" />}

          {/* Content with consistent padding */}
          {isCollapsed ? (
            <div className="flex items-center justify-center px-2 py-[6px] relative z-10">
              <Link
                href={workspaceUrl}
                className="group flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#802FFF]"
              >
                <AgentIcon className="text-white transition-all group-hover:scale-105 -translate-y-[0.5px] w-[18px] h-[18px]" />
              </Link>
            </div>
          ) : (
            <div className="relative">
              <DropdownMenuTrigger asChild>
                <div className="flex items-center px-2 py-[6px] relative z-10 w-full">
                  <div className="flex items-center gap-2 overflow-hidden cursor-pointer">
                    <Link
                      href={workspaceUrl}
                      className="group flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#802FFF]"
                      onClick={(e) => {
                        if (isOpen) e.preventDefault()
                      }}
                    >
                      <AgentIcon className="text-white transition-all group-hover:scale-105 -translate-y-[0.5px] w-[18px] h-[18px]" />
                    </Link>
                    {isClientLoading || isWorkspacesLoading ? (
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
                </div>
              </DropdownMenuTrigger>

              {/* Plus button positioned absolutely */}
              {!isCollapsed && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 z-30">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        {isClientLoading ? (
                          <Skeleton className="h-6 w-6 shrink-0" />
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              onCreateWorkflow()
                            }}
                            className="h-6 w-6 shrink-0 p-0 flex items-center justify-center"
                          >
                            <Plus className="h-[18px] w-[18px] stroke-[2px]" />
                            <span className="sr-only">New Workflow</span>
                          </Button>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>New Workflow</TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>
          )}
        </div>
        <DropdownMenuContent align="start" className="p-1 min-w-[224px]">
          <div className="space-y-3">
            <div className="flex items-center justify-between p-1">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[#802FFF]">
                  <AgentIcon className="text-white w-5 h-5" />
                </div>
                <div className="flex flex-col max-w-full">
                  {isClientLoading || isWorkspacesLoading ? (
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
            <div className="text-xs font-medium text-muted-foreground mb-1 pl-1">Workspaces</div>
            {isWorkspacesLoading ? (
              <div className="py-1 px-2">
                <Skeleton className="h-5 w-full" />
              </div>
            ) : (
              <div className="space-y-1">
                {workspaces.map((workspace) => (
                  <DropdownMenuItem
                    key={workspace.id}
                    className={`text-sm rounded-md px-2 py-1.5 cursor-pointer ${activeWorkspace?.id === workspace.id ? 'bg-accent' : ''} group relative`}
                    onClick={() => switchWorkspace(workspace)}
                  >
                    <span className="truncate pr-16">{workspace.name}</span>
                    <div className="absolute right-2 opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 p-0 text-muted-foreground"
                        onClick={(e) => openEditModal(workspace, e)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span className="sr-only">Edit</span>
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 p-0 text-muted-foreground"
                            onClick={(e) => e.stopPropagation()}
                            disabled={isDeleting || workspaces.length <= 1}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Workspace</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete "{workspace.name}"? This action cannot
                              be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel onClick={(e) => e.stopPropagation()}>
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteWorkspace(workspace.id)
                              }}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </DropdownMenuItem>
                ))}
              </div>
            )}

            {/* Create new workspace button */}
            <DropdownMenuItem
              className="text-sm rounded-md px-2 py-1.5 cursor-pointer mt-1 text-muted-foreground"
              onClick={() => setIsWorkspaceModalOpen(true)}
            >
              <span className="truncate">+ New workspace</span>
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
