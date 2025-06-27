'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Pencil, Trash2, X } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
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
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/w/components/providers/workspace-permissions-provider'
import { useSidebarStore } from '@/stores/sidebar/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkspaceHeader')

interface Workspace {
  id: string
  name: string
  ownerId: string
  role?: string
}

interface WorkspaceHeaderProps {
  onCreateWorkflow: () => void
  isCollapsed?: boolean
  onDropdownOpenChange?: (isOpen: boolean) => void
}

// New WorkspaceModal component
interface WorkspaceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateWorkspace: (name: string) => void
}

const WorkspaceModal = React.memo<WorkspaceModalProps>(
  ({ open, onOpenChange, onCreateWorkspace }) => {
    const [workspaceName, setWorkspaceName] = useState('')

    const handleSubmit = useCallback(
      (e: React.FormEvent) => {
        e.preventDefault()
        if (workspaceName.trim()) {
          onCreateWorkspace(workspaceName.trim())
          setWorkspaceName('')
          onOpenChange(false)
        }
      },
      [workspaceName, onCreateWorkspace, onOpenChange]
    )

    const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      setWorkspaceName(e.target.value)
    }, [])

    const handleClose = useCallback(() => {
      onOpenChange(false)
    }, [onOpenChange])

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className='flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[500px]'
          hideCloseButton
        >
          <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
            <div className='flex items-center justify-between'>
              <DialogTitle className='font-medium text-lg'>Create New Workspace</DialogTitle>
              <Button variant='ghost' size='icon' className='h-8 w-8 p-0' onClick={handleClose}>
                <X className='h-4 w-4' />
                <span className='sr-only'>Close</span>
              </Button>
            </div>
          </DialogHeader>

          <div className='px-6 pt-4 pb-6'>
            <form onSubmit={handleSubmit}>
              <div className='space-y-4'>
                <div className='space-y-2'>
                  <label htmlFor='workspace-name' className='font-medium text-sm'>
                    Workspace Name
                  </label>
                  <Input
                    id='workspace-name'
                    value={workspaceName}
                    onChange={handleNameChange}
                    placeholder='Enter workspace name'
                    className='w-full'
                    autoFocus
                  />
                </div>
                <div className='flex justify-end'>
                  <Button
                    type='submit'
                    size='sm'
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
)

WorkspaceModal.displayName = 'WorkspaceModal'

// New WorkspaceEditModal component
interface WorkspaceEditModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdateWorkspace: (id: string, name: string) => void
  workspace: Workspace | null
}

const WorkspaceEditModal = React.memo<WorkspaceEditModalProps>(
  ({ open, onOpenChange, onUpdateWorkspace, workspace }) => {
    const [workspaceName, setWorkspaceName] = useState('')

    useEffect(() => {
      if (workspace && open) {
        setWorkspaceName(workspace.name)
      }
    }, [workspace, open])

    const handleSubmit = useCallback(
      (e: React.FormEvent) => {
        e.preventDefault()
        if (workspace && workspaceName.trim()) {
          onUpdateWorkspace(workspace.id, workspaceName.trim())
          setWorkspaceName('')
          onOpenChange(false)
        }
      },
      [workspace, workspaceName, onUpdateWorkspace, onOpenChange]
    )

    const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      setWorkspaceName(e.target.value)
    }, [])

    const handleClose = useCallback(() => {
      onOpenChange(false)
    }, [onOpenChange])

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className='flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[500px]'
          hideCloseButton
        >
          <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
            <div className='flex items-center justify-between'>
              <DialogTitle className='font-medium text-lg'>Edit Workspace</DialogTitle>
              <Button variant='ghost' size='icon' className='h-8 w-8 p-0' onClick={handleClose}>
                <X className='h-4 w-4' />
                <span className='sr-only'>Close</span>
              </Button>
            </div>
          </DialogHeader>

          <div className='px-6 pt-4 pb-6'>
            <form onSubmit={handleSubmit}>
              <div className='space-y-4'>
                <div className='space-y-2'>
                  <label htmlFor='workspace-name-edit' className='font-medium text-sm'>
                    Workspace Name
                  </label>
                  <Input
                    id='workspace-name-edit'
                    value={workspaceName}
                    onChange={handleNameChange}
                    placeholder='Enter workspace name'
                    className='w-full'
                    autoFocus
                  />
                </div>
                <div className='flex justify-end'>
                  <Button
                    type='submit'
                    size='sm'
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
)

WorkspaceEditModal.displayName = 'WorkspaceEditModal'

export const WorkspaceHeader = React.memo<WorkspaceHeaderProps>(
  ({ onCreateWorkflow, isCollapsed, onDropdownOpenChange }) => {
    // Get sidebar store state to check current mode
    const { mode, workspaceDropdownOpen, setWorkspaceDropdownOpen, setAnyModalOpen } =
      useSidebarStore()

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
    const { switchToWorkspace } = useWorkflowRegistry()
    const params = useParams()
    const currentWorkspaceId = params.workspaceId as string

    // Get user permissions for the active workspace
    const userPermissions = useUserPermissionsContext()

    const userName = useMemo(
      () => sessionData?.user?.name || sessionData?.user?.email || 'User',
      [sessionData?.user?.name, sessionData?.user?.email]
    )

    // Set isClientLoading to false after hydration
    useEffect(() => {
      setIsClientLoading(false)
    }, [])

    const fetchSubscriptionStatus = useCallback(async (userId: string) => {
      try {
        const response = await fetch('/api/user/subscription')
        const data = await response.json()
        setPlan(data.isPro ? 'Pro Plan' : 'Free Plan')
      } catch (err) {
        logger.error('Error fetching subscription status:', err)
      }
    }, [])

    const fetchWorkspaces = useCallback(async () => {
      setIsWorkspacesLoading(true)
      try {
        const response = await fetch('/api/workspaces')
        const data = await response.json()

        if (data.workspaces && Array.isArray(data.workspaces)) {
          const fetchedWorkspaces = data.workspaces as Workspace[]
          setWorkspaces(fetchedWorkspaces)

          // Only update workspace if we have a valid currentWorkspaceId from URL
          if (currentWorkspaceId) {
            const matchingWorkspace = fetchedWorkspaces.find(
              (workspace) => workspace.id === currentWorkspaceId
            )
            if (matchingWorkspace) {
              setActiveWorkspace(matchingWorkspace)
            } else {
              // Log the mismatch for debugging
              logger.warn(`Workspace ${currentWorkspaceId} not found in user's workspaces`)

              // Current workspace not found, fallback to first workspace
              if (fetchedWorkspaces.length > 0) {
                const fallbackWorkspace = fetchedWorkspaces[0]
                setActiveWorkspace(fallbackWorkspace)
                // Navigate to the fallback workspace
                router.push(`/workspace/${fallbackWorkspace.id}/w`)
              } else {
                // No workspaces available - handle this edge case
                logger.error('No workspaces available for user')
              }
            }
          }
        }
      } catch (err) {
        logger.error('Error fetching workspaces:', err)
      } finally {
        setIsWorkspacesLoading(false)
      }
    }, [currentWorkspaceId, router])

    useEffect(() => {
      // Fetch subscription status if user is logged in
      if (sessionData?.user?.id) {
        fetchSubscriptionStatus(sessionData.user.id)
        fetchWorkspaces()
      }
    }, [sessionData?.user?.id, fetchSubscriptionStatus, fetchWorkspaces])

    const switchWorkspace = useCallback(
      (workspace: Workspace) => {
        // If already on this workspace, close dropdown and do nothing else
        if (activeWorkspace?.id === workspace.id) {
          setWorkspaceDropdownOpen(false)
          return
        }

        setActiveWorkspace(workspace)
        setWorkspaceDropdownOpen(false)

        // Update URL first so sidebar filters use the new workspace ID
        router.push(`/workspace/${workspace.id}/w`)

        // Then switch workspace which will clear workflows and fetch new ones
        switchToWorkspace(workspace.id)
      },
      [activeWorkspace?.id, switchToWorkspace, router, setWorkspaceDropdownOpen]
    )

    const handleCreateWorkspace = useCallback(
      async (name: string) => {
        setIsWorkspacesLoading(true)

        try {
          const response = await fetch('/api/workspaces', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name }),
          })

          const data = await response.json()

          if (data.workspace) {
            const newWorkspace = data.workspace as Workspace
            setWorkspaces((prev) => [...prev, newWorkspace])
            setActiveWorkspace(newWorkspace)

            // Update URL first so sidebar filters use the new workspace ID
            router.push(`/workspace/${newWorkspace.id}/w`)

            // Then switch workspace which will clear workflows and fetch new ones
            switchToWorkspace(newWorkspace.id)
          }
        } catch (err) {
          logger.error('Error creating workspace:', err)
        } finally {
          setIsWorkspacesLoading(false)
        }
      },
      [switchToWorkspace, router]
    )

    const handleUpdateWorkspace = useCallback(
      async (id: string, name: string) => {
        // For update operations, we need to check permissions for the specific workspace
        // Since we can only use hooks at the component level, we'll make the API call
        // and let the backend handle the permission check
        setIsWorkspacesLoading(true)

        try {
          const response = await fetch(`/api/workspaces/${id}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name }),
          })

          if (!response.ok) {
            if (response.status === 403) {
              logger.error(
                'Permission denied: Only users with admin permissions can update workspaces'
              )
            }
            throw new Error('Failed to update workspace')
          }

          const { workspace: updatedWorkspace } = await response.json()

          // Update workspaces list
          setWorkspaces((prevWorkspaces) =>
            prevWorkspaces.map((w) =>
              w.id === updatedWorkspace.id ? { ...w, name: updatedWorkspace.name } : w
            )
          )

          // If active workspace was updated, update it too
          if (activeWorkspace && activeWorkspace.id === updatedWorkspace.id) {
            setActiveWorkspace({
              ...activeWorkspace,
              name: updatedWorkspace.name,
            })
          }
        } catch (err) {
          logger.error('Error updating workspace:', err)
        } finally {
          setIsWorkspacesLoading(false)
        }
      },
      [activeWorkspace]
    )

    const handleDeleteWorkspace = useCallback(
      async (id: string) => {
        // For delete operations, we need to check permissions for the specific workspace
        // Since we can only use hooks at the component level, we'll make the API call
        // and let the backend handle the permission check
        setIsDeleting(true)

        try {
          const response = await fetch(`/api/workspaces/${id}`, {
            method: 'DELETE',
          })

          if (!response.ok) {
            if (response.status === 403) {
              logger.error(
                'Permission denied: Only users with admin permissions can delete workspaces'
              )
            }
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

          setWorkspaceDropdownOpen(false)
        } catch (err) {
          logger.error('Error deleting workspace:', err)
        } finally {
          setIsDeleting(false)
        }
      },
      [workspaces, activeWorkspace?.id]
    )

    const openEditModal = useCallback(
      (workspace: Workspace, e: React.MouseEvent) => {
        e.stopPropagation()
        // Only show edit/delete options for the active workspace if user has admin permissions
        if (activeWorkspace?.id !== workspace.id || !userPermissions.canAdmin) {
          return
        }
        setEditingWorkspace(workspace)
        setIsEditModalOpen(true)
      },
      [activeWorkspace?.id, userPermissions.canAdmin]
    )

    // Determine URL for workspace links
    const workspaceUrl = useMemo(
      () => (activeWorkspace ? `/workspace/${activeWorkspace.id}/w` : '/workspace'),
      [activeWorkspace]
    )

    // Notify parent component when dropdown opens/closes
    const handleDropdownOpenChange = useCallback(
      (open: boolean) => {
        setWorkspaceDropdownOpen(open)
        // Inform the parent component about the dropdown state change
        if (onDropdownOpenChange) {
          onDropdownOpenChange(open)
        }
      },
      [onDropdownOpenChange, setWorkspaceDropdownOpen]
    )

    // Special handling for click interactions in hover mode
    const handleTriggerClick = useCallback(
      (e: React.MouseEvent) => {
        // When in hover mode, explicitly prevent bubbling for the trigger
        if (mode === 'hover') {
          e.stopPropagation()
          e.preventDefault()
          // Toggle dropdown state
          handleDropdownOpenChange(!workspaceDropdownOpen)
        }
      },
      [mode, workspaceDropdownOpen, handleDropdownOpenChange]
    )

    const handleContainerClick = useCallback(
      (e: React.MouseEvent) => {
        // In hover mode, prevent clicks on the container from collapsing the sidebar
        if (mode === 'hover') {
          e.stopPropagation()
        }
      },
      [mode]
    )

    const handleWorkspaceModalOpenChange = useCallback((open: boolean) => {
      setIsWorkspaceModalOpen(open)
    }, [])

    const handleEditModalOpenChange = useCallback((open: boolean) => {
      setIsEditModalOpen(open)
    }, [])

    // Handle modal open/close state
    useEffect(() => {
      // Update the modal state in the store
      setAnyModalOpen(isWorkspaceModalOpen || isEditModalOpen || isDeleting)
    }, [isWorkspaceModalOpen, isEditModalOpen, isDeleting, setAnyModalOpen])

    return (
      <div className='px-2 py-2'>
        {/* Workspace Modal */}
        <WorkspaceModal
          open={isWorkspaceModalOpen}
          onOpenChange={handleWorkspaceModalOpenChange}
          onCreateWorkspace={handleCreateWorkspace}
        />

        {/* Edit Workspace Modal */}
        <WorkspaceEditModal
          open={isEditModalOpen}
          onOpenChange={handleEditModalOpenChange}
          onUpdateWorkspace={handleUpdateWorkspace}
          workspace={editingWorkspace}
        />

        <DropdownMenu open={workspaceDropdownOpen} onOpenChange={handleDropdownOpenChange}>
          <div
            className={`group relative cursor-pointer rounded-md ${isCollapsed ? 'flex justify-center' : ''}`}
            onClick={handleContainerClick}
          >
            {/* Hover background with consistent padding - only when not collapsed */}
            {!isCollapsed && (
              <div className='absolute inset-0 rounded-md group-hover:bg-accent/50' />
            )}

            {/* Content with consistent padding */}
            {isCollapsed ? (
              <div className='relative z-10 flex items-center justify-center px-2 py-[6px]'>
                <Link
                  href={workspaceUrl}
                  className='group flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#802FFF]'
                >
                  <AgentIcon className='-translate-y-[0.5px] h-[18px] w-[18px] text-white transition-all group-hover:scale-105' />
                </Link>
              </div>
            ) : (
              <div className='relative'>
                <DropdownMenuTrigger asChild>
                  <div
                    className='relative z-10 flex w-full items-center px-2 py-[6px]'
                    onClick={handleTriggerClick}
                  >
                    <div className='flex cursor-pointer items-center gap-2 overflow-hidden'>
                      <Link
                        href={workspaceUrl}
                        className='group flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#802FFF]'
                        onClick={(e) => {
                          if (workspaceDropdownOpen) e.preventDefault()
                        }}
                      >
                        <AgentIcon className='-translate-y-[0.5px] h-[18px] w-[18px] text-white transition-all group-hover:scale-105' />
                      </Link>
                      {isClientLoading || isWorkspacesLoading ? (
                        <Skeleton className='h-4 w-[140px]' />
                      ) : (
                        <div className='flex items-center gap-1'>
                          <span className='max-w-[120px] truncate font-medium text-sm'>
                            {activeWorkspace?.name || `${userName}'s Workspace`}
                          </span>
                          <ChevronDown className='h-3 w-3 opacity-60' />
                        </div>
                      )}
                    </div>
                  </div>
                </DropdownMenuTrigger>
              </div>
            )}
          </div>
          <DropdownMenuContent align='start' className='min-w-[224px] p-1'>
            <div className='space-y-3'>
              <div className='flex items-center justify-between p-1'>
                <div className='flex items-center gap-2'>
                  <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[#802FFF]'>
                    <AgentIcon className='h-5 w-5 text-white' />
                  </div>
                  <div className='flex max-w-full flex-col'>
                    {isClientLoading || isWorkspacesLoading ? (
                      <>
                        <Skeleton className='mb-1 h-4 w-[140px]' />
                        <Skeleton className='h-3 w-16' />
                      </>
                    ) : (
                      <>
                        <span className='truncate font-medium text-sm'>
                          {activeWorkspace?.name || `${userName}'s Workspace`}
                        </span>
                        <span className='text-muted-foreground text-xs'>{plan}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <DropdownMenuSeparator />

            {/* Workspaces list */}
            <div className='px-1 py-1'>
              <div className='mb-1 pl-1 font-medium text-muted-foreground text-xs'>Workspaces</div>
              {isWorkspacesLoading ? (
                <div className='px-2 py-1'>
                  <Skeleton className='h-5 w-full' />
                </div>
              ) : (
                <div className='space-y-1'>
                  {workspaces.map((workspace) => (
                    <DropdownMenuItem
                      key={workspace.id}
                      className={`cursor-pointer rounded-md px-2 py-1.5 text-sm ${activeWorkspace?.id === workspace.id ? 'bg-accent' : ''} group relative`}
                      onClick={() => switchWorkspace(workspace)}
                    >
                      <span className='truncate pr-16'>{workspace.name}</span>
                      {userPermissions.canAdmin && activeWorkspace?.id === workspace.id && (
                        <div className='absolute right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='h-6 w-6 p-0 text-muted-foreground'
                            onClick={(e) => openEditModal(workspace, e)}
                          >
                            <Pencil className='h-3.5 w-3.5' />
                            <span className='sr-only'>Edit</span>
                          </Button>

                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant='ghost'
                                size='icon'
                                className='h-6 w-6 p-0 text-muted-foreground'
                                onClick={(e) => e.stopPropagation()}
                                disabled={isDeleting || workspaces.length <= 1}
                              >
                                <Trash2 className='h-3.5 w-3.5' />
                                <span className='sr-only'>Delete</span>
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Workspace</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete "{workspace.name}"? This action
                                  cannot be undone.
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
                                  className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      )}
                    </DropdownMenuItem>
                  ))}
                </div>
              )}

              {/* Create new workspace button */}
              <DropdownMenuItem
                className='mt-1 cursor-pointer rounded-md px-2 py-1.5 text-muted-foreground text-sm'
                onClick={() => setIsWorkspaceModalOpen(true)}
              >
                <span className='truncate'>+ New workspace</span>
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }
)

WorkspaceHeader.displayName = 'WorkspaceHeader'
