'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LogOut, Pencil, Plus, Send, Trash2 } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { isDev } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { InviteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-selector/components/invite-modal/invite-modal'

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
  onDeleteWorkspace: (workspace: Workspace, templateAction?: 'keep' | 'delete') => Promise<void>
  onLeaveWorkspace: (workspace: Workspace) => Promise<void>
  updateWorkspaceName: (workspaceId: string, newName: string) => Promise<boolean>
  isDeleting: boolean
  isLeaving: boolean
  isCreating: boolean
}

export function WorkspaceSelector({
  workspaces,
  activeWorkspace,
  isWorkspacesLoading,
  onWorkspaceUpdate,
  onSwitchWorkspace,
  onCreateWorkspace,
  onDeleteWorkspace,
  onLeaveWorkspace,
  updateWorkspaceName,
  isDeleting,
  isLeaving,
  isCreating,
}: WorkspaceSelectorProps) {
  const userPermissions = useUserPermissionsContext()

  // State
  const [showInviteMembers, setShowInviteMembers] = useState(false)
  const [hoveredWorkspaceId, setHoveredWorkspaceId] = useState<string | null>(null)
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('')
  const [leaveConfirmationName, setLeaveConfirmationName] = useState('')
  const [isCheckingTemplates, setIsCheckingTemplates] = useState(false)
  const [showTemplateChoice, setShowTemplateChoice] = useState(false)
  const [templatesInfo, setTemplatesInfo] = useState<{
    count: number
    templates: Array<{ id: string; name: string }>
  } | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [workspaceToDelete, setWorkspaceToDelete] = useState<Workspace | null>(null)

  // Refs
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  // Focus input when editing starts
  useEffect(() => {
    if (editingWorkspaceId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingWorkspaceId])

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
   * Handle start editing workspace name
   */
  const handleStartEdit = useCallback((workspace: Workspace, e: React.MouseEvent) => {
    // Only allow admins to rename workspace
    if (workspace.permissions !== 'admin') {
      return
    }
    e.stopPropagation()
    setEditingWorkspaceId(workspace.id)
    setEditingName(workspace.name)
  }, [])

  /**
   * Handle save edit
   */
  const handleSaveEdit = useCallback(async () => {
    if (!editingWorkspaceId || !editingName.trim()) {
      setEditingWorkspaceId(null)
      setEditingName('')
      return
    }

    const workspace = workspaces.find((w) => w.id === editingWorkspaceId)
    if (!workspace || editingName.trim() === workspace.name) {
      setEditingWorkspaceId(null)
      setEditingName('')
      return
    }

    setIsRenaming(true)
    try {
      await updateWorkspaceName(editingWorkspaceId, editingName.trim())
      logger.info(
        `Successfully renamed workspace from "${workspace.name}" to "${editingName.trim()}"`
      )
      setEditingWorkspaceId(null)
      setEditingName('')
    } catch (error) {
      logger.error('Failed to rename workspace:', {
        error,
        workspaceId: editingWorkspaceId,
        oldName: workspace.name,
        newName: editingName.trim(),
      })
      // Reset to original name on error
      setEditingName(workspace.name)
    } finally {
      setIsRenaming(false)
    }
  }, [editingWorkspaceId, editingName, workspaces, updateWorkspaceName])

  /**
   * Handle cancel edit
   */
  const handleCancelEdit = useCallback(() => {
    setEditingWorkspaceId(null)
    setEditingName('')
  }, [])

  /**
   * Handle keyboard events
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSaveEdit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleCancelEdit()
      }
    },
    [handleSaveEdit, handleCancelEdit]
  )

  /**
   * Handle input blur
   */
  const handleInputBlur = useCallback(() => {
    handleSaveEdit()
  }, [handleSaveEdit])

  /**
   * Handle workspace click
   */
  const handleWorkspaceClick = useCallback(
    (workspace: Workspace, e: React.MouseEvent) => {
      if (editingWorkspaceId) {
        e.preventDefault()
        return
      }
      onSwitchWorkspace(workspace)
    },
    [editingWorkspaceId, onSwitchWorkspace]
  )

  /**
   * Reset delete dialog state
   */
  const resetDeleteState = useCallback(() => {
    setDeleteConfirmationName('')
    setShowTemplateChoice(false)
    setTemplatesInfo(null)
    setIsCheckingTemplates(false)
    setWorkspaceToDelete(null)
  }, [])

  /**
   * Handle dialog close
   */
  const handleDialogClose = useCallback(
    (open: boolean) => {
      if (!open) {
        resetDeleteState()
      }
      setIsDeleteDialogOpen(open)
    },
    [resetDeleteState]
  )

  /**
   * Handle template choice action
   */
  const handleTemplateAction = useCallback(
    async (action: 'keep' | 'delete') => {
      if (!workspaceToDelete) return

      setShowTemplateChoice(false)
      setTemplatesInfo(null)
      setDeleteConfirmationName('')
      await onDeleteWorkspace(workspaceToDelete, action)
      setWorkspaceToDelete(null)
      setIsDeleteDialogOpen(false)
    },
    [workspaceToDelete, onDeleteWorkspace]
  )

  /**
   * Check for templates and handle deletion
   */
  const handleDeleteClick = useCallback(async () => {
    if (!workspaceToDelete) return

    setIsCheckingTemplates(true)
    try {
      const checkResponse = await fetch(
        `/api/workspaces/${workspaceToDelete.id}?check-templates=true`
      )
      if (checkResponse.ok) {
        const templateCheck = await checkResponse.json()
        if (templateCheck.hasPublishedTemplates && templateCheck.count > 0) {
          // Templates exist - show template choice
          setTemplatesInfo({
            count: templateCheck.count,
            templates: templateCheck.publishedTemplates,
          })
          setShowTemplateChoice(true)
          setIsCheckingTemplates(false)
          return
        }
      }
    } catch (error) {
      logger.error('Error checking templates:', error)
    }

    // No templates or error - proceed with deletion
    setIsCheckingTemplates(false)
    setDeleteConfirmationName('')
    await onDeleteWorkspace(workspaceToDelete)
    setWorkspaceToDelete(null)
    setIsDeleteDialogOpen(false)
  }, [workspaceToDelete, onDeleteWorkspace])

  /**
   * Confirm leave workspace
   */
  const confirmLeaveWorkspace = useCallback(
    async (workspaceToLeave: Workspace) => {
      await onLeaveWorkspace(workspaceToLeave)
    },
    [onLeaveWorkspace]
  )

  // Render workspace list
  const renderWorkspaceList = () => {
    if (isWorkspacesLoading) {
      return (
        <div className='space-y-1'>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className='flex h-8 items-center rounded-[8px] p-2 text-left'
              style={{ maxWidth: '206px' }}
            >
              <div className='flex min-w-0 flex-1 items-center text-left'>
                <Skeleton className='h-4 w-32' />
              </div>
            </div>
          ))}
        </div>
      )
    }

    return (
      <div className='space-y-1'>
        {workspaces.map((workspace) => {
          const isEditing = editingWorkspaceId === workspace.id
          const isHovered = hoveredWorkspaceId === workspace.id

          return (
            <div
              key={workspace.id}
              data-workspace-id={workspace.id}
              onMouseEnter={() => setHoveredWorkspaceId(workspace.id)}
              onMouseLeave={() => setHoveredWorkspaceId(null)}
              onClick={(e) => handleWorkspaceClick(workspace, e)}
              className={cn(
                'group flex h-8 cursor-pointer items-center rounded-[8px] p-2 text-left transition-colors',
                activeWorkspace?.id === workspace.id ? 'bg-muted' : 'hover:bg-muted'
              )}
              style={{ maxWidth: '206px' }}
            >
              <div className='flex min-w-0 flex-1 items-center text-left'>
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleInputBlur}
                    className={cn(
                      'min-w-0 flex-1 border-0 bg-transparent p-0 font-medium text-sm outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                      activeWorkspace?.id === workspace.id
                        ? 'text-foreground'
                        : 'text-muted-foreground group-hover:text-foreground'
                    )}
                    maxLength={100}
                    disabled={isRenaming}
                    onClick={(e) => e.stopPropagation()}
                    autoComplete='off'
                    autoCorrect='off'
                    autoCapitalize='off'
                    spellCheck='false'
                  />
                ) : (
                  <span
                    className={cn(
                      'min-w-0 flex-1 select-none truncate pr-1 font-medium text-sm',
                      activeWorkspace?.id === workspace.id
                        ? 'text-foreground'
                        : 'text-muted-foreground group-hover:text-foreground'
                    )}
                  >
                    {workspace.name}
                  </span>
                )}
              </div>

              <div
                className='flex h-full flex-shrink-0 items-center justify-center gap-1'
                onClick={(e) => e.stopPropagation()}
              >
                {/* Edit button - show on hover for admin users */}
                {!isEditing && isHovered && workspace.permissions === 'admin' && (
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={(e) => handleStartEdit(workspace, e)}
                    className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
                  >
                    <Pencil className='!h-3.5 !w-3.5' />
                  </Button>
                )}

                {/* Leave Workspace - for non-admin users */}
                {workspace.permissions !== 'admin' && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          'h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground',
                          !isEditing && isHovered ? 'opacity-100' : 'pointer-events-none opacity-0'
                        )}
                      >
                        <LogOut className='!h-3.5 !w-3.5' />
                      </Button>
                    </AlertDialogTrigger>

                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Leave workspace?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Leaving this workspace will remove your access to all associated
                          workflows, logs, and knowledge bases.{' '}
                          <span className='text-red-500 dark:text-red-500'>
                            This action cannot be undone.
                          </span>
                        </AlertDialogDescription>
                      </AlertDialogHeader>

                      <div className='py-2'>
                        <p className='mb-2 font-[360] text-sm'>
                          Enter the workspace name <strong>{workspace.name}</strong> to confirm.
                        </p>
                        <Input
                          value={leaveConfirmationName}
                          onChange={(e) => setLeaveConfirmationName(e.target.value)}
                          placeholder={workspace.name}
                          className='h-9'
                        />
                      </div>

                      <AlertDialogFooter className='flex'>
                        <AlertDialogCancel
                          className='h-9 w-full rounded-[8px]'
                          onClick={() => setLeaveConfirmationName('')}
                        >
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            confirmLeaveWorkspace(workspace)
                            setLeaveConfirmationName('')
                          }}
                          className='h-9 w-full rounded-[8px] bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
                          disabled={isLeaving || leaveConfirmationName !== workspace.name}
                        >
                          {isLeaving ? 'Leaving...' : 'Leave'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {/* Delete Workspace - for admin users */}
                {workspace.permissions === 'admin' && (
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={(e) => {
                      e.stopPropagation()
                      setWorkspaceToDelete(workspace)
                      setIsDeleteDialogOpen(true)
                    }}
                    className={cn(
                      'h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground',
                      !isEditing && isHovered ? 'opacity-100' : 'pointer-events-none opacity-0'
                    )}
                  >
                    <Trash2 className='!h-3.5 !w-3.5' />
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <>
      <div className='rounded-[10px] border bg-background shadow-xs'>
        <div className='flex h-full flex-col p-2'>
          {/* Workspace List */}
          <div className='min-h-0 flex-1'>
            <ScrollArea ref={scrollAreaRef} className='h-[104px]' hideScrollbar={true}>
              {renderWorkspaceList()}
            </ScrollArea>
          </div>

          {/* Bottom Actions */}
          <div className='mt-2 flex items-center gap-2 border-t pt-2'>
            {/* Send Invite - Hide in development */}
            {!isDev && (
              <Button
                variant='secondary'
                onClick={userPermissions.canAdmin ? () => setShowInviteMembers(true) : undefined}
                disabled={!userPermissions.canAdmin}
                className={cn(
                  'h-8 flex-1 justify-center gap-2 rounded-[8px] font-medium text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground',
                  !userPermissions.canAdmin && 'cursor-not-allowed opacity-50'
                )}
              >
                <Send className='h-3 w-3' />
                <span>Invite</span>
              </Button>
            )}

            {/* Create Workspace */}
            <Button
              variant='secondary'
              onClick={onCreateWorkspace}
              disabled={isCreating}
              className={cn(
                'h-8 flex-1 justify-center gap-2 rounded-[8px] font-medium text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground',
                isCreating && 'cursor-not-allowed'
              )}
            >
              <Plus className='h-3 w-3' />
              <span>Create</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Centralized Delete Workspace Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={handleDialogClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {showTemplateChoice
                ? 'Delete workspace with published templates?'
                : 'Delete workspace?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {showTemplateChoice ? (
                <>
                  This workspace contains {templatesInfo?.count} published template
                  {templatesInfo?.count === 1 ? '' : 's'}:
                  <br />
                  <br />
                  {templatesInfo?.templates.map((template) => (
                    <span key={template.id} className='block'>
                      • {template.name}
                    </span>
                  ))}
                  <br />
                  What would you like to do with the published templates?
                </>
              ) : (
                <>
                  Deleting this workspace will permanently remove all associated workflows, logs,
                  and knowledge bases.{' '}
                  <span className='text-red-500 dark:text-red-500'>
                    This action cannot be undone.
                  </span>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {showTemplateChoice ? (
            <div className='flex gap-2 py-2'>
              <Button
                onClick={() => handleTemplateAction('keep')}
                className='h-9 flex-1 rounded-[8px]'
                variant='outline'
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Keep Templates'}
              </Button>
              <Button
                onClick={() => handleTemplateAction('delete')}
                className='h-9 flex-1 rounded-[8px] bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete Templates'}
              </Button>
            </div>
          ) : (
            <div className='py-2'>
              <p className='mb-2 font-[360] text-sm'>
                Enter the workspace name{' '}
                <span className='font-semibold'>{workspaceToDelete?.name}</span> to confirm.
              </p>
              <Input
                value={deleteConfirmationName}
                onChange={(e) => setDeleteConfirmationName(e.target.value)}
                placeholder={workspaceToDelete?.name}
                className='h-9 rounded-[8px]'
              />
            </div>
          )}

          {!showTemplateChoice && (
            <AlertDialogFooter className='flex'>
              <Button
                variant='outline'
                className='h-9 w-full rounded-[8px]'
                onClick={() => {
                  resetDeleteState()
                  setIsDeleteDialogOpen(false)
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={(e) => {
                  e.preventDefault()
                  handleDeleteClick()
                }}
                className='h-9 w-full rounded-[8px] bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
                disabled={
                  isDeleting ||
                  deleteConfirmationName !== workspaceToDelete?.name ||
                  isCheckingTemplates
                }
              >
                {isDeleting ? 'Deleting...' : isCheckingTemplates ? 'Deleting...' : 'Delete'}
              </Button>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* Invite Modal */}
      <InviteModal
        open={showInviteMembers}
        onOpenChange={setShowInviteMembers}
        workspaceName={activeWorkspace?.name}
      />
    </>
  )
}
