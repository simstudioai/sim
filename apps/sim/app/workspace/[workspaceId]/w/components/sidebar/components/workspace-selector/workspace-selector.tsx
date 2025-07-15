'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Send, Trash2 } from 'lucide-react'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '../../../providers/workspace-permissions-provider'
import { InviteModal } from './components/invite-modal/invite-modal'

const logger = createLogger('WorkspaceSelector')

/**
 * Workspace entity interface
 */
interface Workspace {
  id: string
  name: string
  ownerId: string
  role?: string
  membershipId?: string
  permissions?: 'admin' | 'write' | 'read' | null
}

interface WorkspaceSelectorProps {
  workspaces: Workspace[]
  activeWorkspace: Workspace | null
  isWorkspacesLoading: boolean
  onWorkspaceUpdate: () => Promise<void>
  onSwitchWorkspace: (workspace: Workspace) => Promise<void>
  onCreateWorkspace: () => Promise<void>
  onDeleteWorkspace: (workspace: Workspace) => Promise<void>
  isDeleting: boolean
}

export function WorkspaceSelector({
  workspaces,
  activeWorkspace,
  isWorkspacesLoading,
  onWorkspaceUpdate,
  onSwitchWorkspace,
  onCreateWorkspace,
  onDeleteWorkspace,
  isDeleting,
}: WorkspaceSelectorProps) {
  const userPermissions = useUserPermissionsContext()

  // State
  const [showInviteMembers, setShowInviteMembers] = useState(false)
  const [hoveredWorkspaceId, setHoveredWorkspaceId] = useState<string | null>(null)

  // Refs
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  /**
   * Scroll to active workspace on load or when it changes
   */
  useEffect(() => {
    if (activeWorkspace && !isWorkspacesLoading) {
      const scrollContainer = scrollAreaRef.current
      if (scrollContainer) {
        const activeButton = scrollContainer.querySelector(
          `[data-workspace-id="${activeWorkspace.id}"]`
        ) as HTMLElement
        if (activeButton) {
          activeButton.scrollIntoView({
            block: 'nearest',
          })
        }
      }
    }
  }, [activeWorkspace, isWorkspacesLoading])

  /**
   * Confirm delete workspace
   */
  const confirmDeleteWorkspace = useCallback(
    async (workspaceToDelete: Workspace) => {
      await onDeleteWorkspace(workspaceToDelete)
    },
    [onDeleteWorkspace]
  )

  // Render workspace list
  const renderWorkspaceList = () => {
    if (isWorkspacesLoading) {
      return (
        <div className='space-y-1'>
          {[1, 2, 3].map((i) => (
            <div key={i} className='flex w-full items-center justify-between rounded-lg p-2'>
              <Skeleton className='h-[20px] w-32' />
            </div>
          ))}
        </div>
      )
    }

    return (
      <div className='space-y-1'>
        {workspaces.map((workspace) => (
          <div
            key={workspace.id}
            data-workspace-id={workspace.id}
            onMouseEnter={() => setHoveredWorkspaceId(workspace.id)}
            onMouseLeave={() => setHoveredWorkspaceId(null)}
            onClick={() => onSwitchWorkspace(workspace)}
            className={cn(
              'group flex h-9 w-full cursor-pointer items-center rounded-lg p-2 text-left transition-colors',
              activeWorkspace?.id === workspace.id ? 'bg-accent' : 'hover:bg-accent/50'
            )}
          >
            <div className='flex h-full min-w-0 flex-1 items-center text-left'>
              <span
                className={cn(
                  'truncate font-medium text-sm',
                  activeWorkspace?.id === workspace.id ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {workspace.name}
              </span>
            </div>
            <div className='flex h-full w-6 flex-shrink-0 items-center justify-center'>
              {hoveredWorkspaceId === workspace.id && workspace.permissions === 'admin' && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant='ghost'
                      onClick={(e) => {
                        e.stopPropagation()
                      }}
                      className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:text-muted-foreground'
                    >
                      <Trash2 className='h-2 w-2' />
                    </Button>
                  </AlertDialogTrigger>

                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Workspace</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete "{workspace.name}"? This action cannot be
                        undone and will permanently delete all workflows and data in this workspace.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => confirmDeleteWorkspace(workspace)}
                        className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
                        disabled={isDeleting}
                      >
                        {isDeleting ? 'Deleting...' : 'Delete'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
      <div className='rounded-[14px] border bg-card shadow-xs'>
        <div className='flex h-full flex-col p-2'>
          {/* Workspace List */}
          <div className='min-h-0 flex-1'>
            <ScrollArea ref={scrollAreaRef} className='h-[116px]' hideScrollbar={true}>
              {renderWorkspaceList()}
            </ScrollArea>
          </div>

          {/* Bottom Actions */}
          <div className='mt-2 flex items-center gap-2 border-t pt-2'>
            {/* Send Invite */}
            <Button
              variant='secondary'
              size='sm'
              onClick={userPermissions.canAdmin ? () => setShowInviteMembers(true) : undefined}
              disabled={!userPermissions.canAdmin}
              className={cn(
                'h-8 flex-1 justify-center gap-2 rounded-[8px] font-medium text-muted-foreground text-xs hover:bg-secondary hover:text-muted-foreground',
                !userPermissions.canAdmin && 'cursor-not-allowed opacity-50'
              )}
            >
              <Send className='h-3 w-3' />
              <span>Invite</span>
            </Button>

            {/* Create Workspace */}
            <Button
              variant='secondary'
              size='sm'
              onClick={onCreateWorkspace}
              className='h-8 flex-1 justify-center gap-2 rounded-[8px] font-medium text-muted-foreground text-xs hover:bg-secondary hover:text-muted-foreground'
            >
              <Plus className='h-3 w-3' />
              <span>Create</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Invite Modal */}
      <InviteModal open={showInviteMembers} onOpenChange={setShowInviteMembers} />
    </>
  )
}
