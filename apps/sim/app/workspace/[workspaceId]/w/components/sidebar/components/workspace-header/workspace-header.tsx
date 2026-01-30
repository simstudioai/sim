'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ArrowDown, MoreHorizontal, Plus } from 'lucide-react'
import {
  Badge,
  Button,
  ChevronDown,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  PanelLeft,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverSection,
  PopoverTrigger,
  Tooltip,
} from '@/components/emcn'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'
import { DeleteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/delete-modal/delete-modal'
import { InviteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/invite-modal'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const logger = createLogger('WorkspaceHeader')

interface Workspace {
  id: string
  name: string
  ownerId: string
  role?: string
  permissions?: 'admin' | 'write' | 'read' | null
}

interface WorkspaceHeaderProps {
  /**
   * The active workspace object
   */
  activeWorkspace?: { name: string } | null
  /**
   * Current workspace ID
   */
  workspaceId: string
  /**
   * List of available workspaces
   */
  workspaces: Workspace[]
  /**
   * Whether workspaces are loading
   */
  isWorkspacesLoading: boolean
  /**
   * Whether workspace creation is in progress
   */
  isCreatingWorkspace: boolean
  /**
   * Whether the workspace menu popover is open
   */
  isWorkspaceMenuOpen: boolean
  /**
   * Callback to set workspace menu open state
   */
  setIsWorkspaceMenuOpen: (isOpen: boolean) => void
  /**
   * Callback when workspace is switched
   */
  onWorkspaceSwitch: (workspace: Workspace) => void
  /**
   * Callback when create workspace is clicked
   */
  onCreateWorkspace: () => Promise<void>
  /**
   * Callback when toggle collapse is clicked
   */
  onToggleCollapse: () => void
  /**
   * Whether the sidebar is collapsed
   */
  isCollapsed: boolean
  /**
   * Callback to rename the workspace
   */
  onRenameWorkspace: (workspaceId: string, newName: string) => Promise<void>
  /**
   * Callback to delete the workspace
   */
  onDeleteWorkspace: (workspaceId: string) => Promise<void>
  /**
   * Callback to duplicate the workspace
   */
  onDuplicateWorkspace: (workspaceId: string, workspaceName: string) => Promise<void>
  /**
   * Callback to export the workspace
   */
  onExportWorkspace: (workspaceId: string, workspaceName: string) => Promise<void>
  /**
   * Callback to import workspace
   */
  onImportWorkspace: () => void
  /**
   * Whether workspace import is in progress
   */
  isImportingWorkspace: boolean
  /**
   * Whether to show the collapse button
   */
  showCollapseButton?: boolean
  /**
   * Callback to leave the workspace
   */
  onLeaveWorkspace?: (workspaceId: string) => Promise<void>
  /**
   * Current user's session ID for owner check
   */
  sessionUserId?: string
}

/**
 * Workspace header component that displays workspace name, switcher, and collapse toggle.
 * Used in both the full sidebar and floating collapsed state.
 */
export function WorkspaceHeader({
  activeWorkspace,
  workspaceId,
  workspaces,
  isWorkspacesLoading,
  isCreatingWorkspace,
  isWorkspaceMenuOpen,
  setIsWorkspaceMenuOpen,
  onWorkspaceSwitch,
  onCreateWorkspace,
  onToggleCollapse,
  isCollapsed,
  onRenameWorkspace,
  onDeleteWorkspace,
  onDuplicateWorkspace,
  onExportWorkspace,
  onImportWorkspace,
  isImportingWorkspace,
  showCollapseButton = true,
  onLeaveWorkspace,
  sessionUserId,
}: WorkspaceHeaderProps) {
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null)
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)
  const [leaveTarget, setLeaveTarget] = useState<Workspace | null>(null)
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [isListRenaming, setIsListRenaming] = useState(false)

  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const capturedWorkspaceRef = useRef<{
    id: string
    name: string
    permissions?: 'admin' | 'write' | 'read' | null
  } | null>(null)
  const isRenamingRef = useRef(false)
  const isContextMenuOpeningRef = useRef(false)
  const contextMenuClosedRef = useRef(true)
  const hasInputFocusedRef = useRef(false)

  const [isMounted, setIsMounted] = useState(false)
  useEffect(() => {
    setIsMounted(true)
  }, [])

  const { isInvitationsDisabled } = usePermissionConfig()

  // Listen for open-invite-modal event from context menu
  useEffect(() => {
    const handleOpenInvite = () => {
      if (!isInvitationsDisabled) {
        setIsInviteModalOpen(true)
      }
    }
    window.addEventListener('open-invite-modal', handleOpenInvite)
    return () => window.removeEventListener('open-invite-modal', handleOpenInvite)
  }, [isInvitationsDisabled])

  /**
   * Save and exit edit mode when popover closes
   */
  useEffect(() => {
    if (!isWorkspaceMenuOpen && editingWorkspaceId) {
      const workspace = workspaces.find((w) => w.id === editingWorkspaceId)
      if (workspace && editingName.trim() && editingName.trim() !== workspace.name) {
        void onRenameWorkspace(editingWorkspaceId, editingName.trim())
      }
      setEditingWorkspaceId(null)
    }
  }, [isWorkspaceMenuOpen, editingWorkspaceId, editingName, workspaces, onRenameWorkspace])

  const activeWorkspaceFull = workspaces.find((w) => w.id === workspaceId) || null

  /**
   * Opens the context menu for a workspace at the specified position
   */
  const openContextMenuAt = (workspace: Workspace, x: number, y: number) => {
    isContextMenuOpeningRef.current = true
    contextMenuClosedRef.current = false

    capturedWorkspaceRef.current = {
      id: workspace.id,
      name: workspace.name,
      permissions: workspace.permissions,
    }
    setContextMenuPosition({ x, y })
    setIsContextMenuOpen(true)
  }

  /**
   * Handle right-click context menu
   */
  const handleContextMenu = (e: React.MouseEvent, workspace: Workspace) => {
    e.preventDefault()
    e.stopPropagation()
    openContextMenuAt(workspace, e.clientX, e.clientY)
  }

  /**
   * Close context menu and optionally the workspace dropdown
   * When renaming, we keep the workspace menu open so the input is visible
   * This function is idempotent - duplicate calls are ignored
   */
  const closeContextMenu = () => {
    if (contextMenuClosedRef.current) {
      return
    }
    contextMenuClosedRef.current = true

    setIsContextMenuOpen(false)
    isContextMenuOpeningRef.current = false
    if (!isRenamingRef.current) {
      setIsWorkspaceMenuOpen(false)
    }
    isRenamingRef.current = false
  }

  /**
   * Handles rename action from context menu
   */
  const handleRenameAction = () => {
    if (!capturedWorkspaceRef.current) return

    isRenamingRef.current = true
    hasInputFocusedRef.current = false
    setEditingWorkspaceId(capturedWorkspaceRef.current.id)
    setEditingName(capturedWorkspaceRef.current.name)
    setIsWorkspaceMenuOpen(true)
  }

  /**
   * Handles duplicate action from context menu
   */
  const handleDuplicateAction = async () => {
    if (!capturedWorkspaceRef.current) return

    await onDuplicateWorkspace(capturedWorkspaceRef.current.id, capturedWorkspaceRef.current.name)
    setIsWorkspaceMenuOpen(false)
  }

  /**
   * Handles export action from context menu
   */
  const handleExportAction = async () => {
    if (!capturedWorkspaceRef.current) return

    await onExportWorkspace(capturedWorkspaceRef.current.id, capturedWorkspaceRef.current.name)
  }

  /**
   * Handles delete action from context menu
   */
  const handleDeleteAction = () => {
    if (!capturedWorkspaceRef.current) return

    const workspace = workspaces.find((w) => w.id === capturedWorkspaceRef.current?.id)
    if (workspace) {
      setDeleteTarget(workspace)
      setIsDeleteModalOpen(true)
      setIsWorkspaceMenuOpen(false)
    }
  }

  /**
   * Handles leave action from context menu - shows confirmation modal
   */
  const handleLeaveAction = () => {
    if (!capturedWorkspaceRef.current) return

    const workspace = workspaces.find((w) => w.id === capturedWorkspaceRef.current?.id)
    if (workspace) {
      setLeaveTarget(workspace)
      setIsLeaveModalOpen(true)
      setIsWorkspaceMenuOpen(false)
    }
  }

  /**
   * Handle leave workspace after confirmation
   */
  const handleLeaveWorkspace = async () => {
    if (!leaveTarget || !onLeaveWorkspace) return

    setIsLeaving(true)
    try {
      await onLeaveWorkspace(leaveTarget.id)
      setIsLeaveModalOpen(false)
      setLeaveTarget(null)
    } catch (error) {
      logger.error('Error leaving workspace:', error)
    } finally {
      setIsLeaving(false)
    }
  }

  /**
   * Handle delete workspace
   */
  const handleDeleteWorkspace = async () => {
    setIsDeleting(true)
    try {
      const targetId = deleteTarget?.id || workspaceId
      await onDeleteWorkspace(targetId)
      setIsDeleteModalOpen(false)
      setDeleteTarget(null)
    } catch (error) {
      logger.error('Error deleting workspace:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className={`flex items-center gap-[8px] ${isCollapsed ? '' : 'min-w-0 justify-between'}`}>
      {/* Workspace Name with Switcher */}
      <div className={isCollapsed ? '' : 'min-w-0 flex-1'}>
        {/* Workspace Switcher Popover - only render after mount to avoid Radix ID hydration mismatch */}
        {isMounted ? (
          <Popover
            open={isWorkspaceMenuOpen}
            onOpenChange={(open) => {
              if (
                !open &&
                (isContextMenuOpen || isContextMenuOpeningRef.current || editingWorkspaceId)
              ) {
                return
              }
              setIsWorkspaceMenuOpen(open)
            }}
          >
            <PopoverTrigger asChild>
              <button
                type='button'
                aria-label='Switch workspace'
                className={`group flex cursor-pointer items-center gap-[8px] rounded-[6px] bg-transparent px-[6px] py-[4px] transition-colors hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)] ${
                  isCollapsed ? '' : '-mx-[6px] min-w-0 max-w-full'
                }`}
                title={activeWorkspace?.name || 'Loading...'}
                onContextMenu={(e) => {
                  if (activeWorkspaceFull) {
                    handleContextMenu(e, activeWorkspaceFull)
                  }
                }}
              >
                <span
                  className={`font-base text-[14px] text-[var(--text-primary)] ${
                    isCollapsed ? 'max-w-[120px] truncate' : 'truncate'
                  }`}
                >
                  {activeWorkspace?.name || 'Loading...'}
                </span>
                <ChevronDown
                  className={`h-[8px] w-[10px] flex-shrink-0 text-[var(--text-muted)] transition-transform duration-100 group-hover:text-[var(--text-secondary)] ${
                    isWorkspaceMenuOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align='start'
              side='bottom'
              sideOffset={8}
              style={{ maxWidth: '160px', minWidth: '160px' }}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              {isWorkspacesLoading ? (
                <PopoverItem disabled>
                  <span>Loading workspaces...</span>
                </PopoverItem>
              ) : (
                <>
                  <div className='relative flex items-center justify-between'>
                    <PopoverSection>Workspaces</PopoverSection>
                    <div className='flex translate-y-[-2px] items-center gap-[6px]'>
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <Button
                            variant='ghost'
                            type='button'
                            aria-label='Import workspace'
                            className='!p-[3px]'
                            onClick={(e) => {
                              e.stopPropagation()
                              onImportWorkspace()
                            }}
                            disabled={isImportingWorkspace}
                          >
                            <ArrowDown className='h-[14px] w-[14px]' />
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content>
                          <p>
                            {isImportingWorkspace ? 'Importing workspace...' : 'Import workspace'}
                          </p>
                        </Tooltip.Content>
                      </Tooltip.Root>
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <Button
                            variant='ghost'
                            type='button'
                            aria-label='Create workspace'
                            className='!p-[3px]'
                            onClick={async (e) => {
                              e.stopPropagation()
                              await onCreateWorkspace()
                              setIsWorkspaceMenuOpen(false)
                            }}
                            disabled={isCreatingWorkspace}
                          >
                            <Plus className='h-[14px] w-[14px]' />
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content>
                          <p>
                            {isCreatingWorkspace ? 'Creating workspace...' : 'Create workspace'}
                          </p>
                        </Tooltip.Content>
                      </Tooltip.Root>
                    </div>
                  </div>
                  <div className='max-h-[200px] overflow-y-auto'>
                    {workspaces.map((workspace, index) => (
                      <div key={workspace.id} className={index > 0 ? 'mt-[2px]' : ''}>
                        {editingWorkspaceId === workspace.id ? (
                          <div className='flex h-[26px] items-center gap-[8px] rounded-[8px] bg-[var(--surface-5)] px-[6px]'>
                            <input
                              ref={(el) => {
                                if (el && !hasInputFocusedRef.current) {
                                  hasInputFocusedRef.current = true
                                  el.focus()
                                  el.select()
                                }
                              }}
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={async (e) => {
                                e.stopPropagation()
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  setIsListRenaming(true)
                                  try {
                                    await onRenameWorkspace(workspace.id, editingName.trim())
                                    setEditingWorkspaceId(null)
                                  } finally {
                                    setIsListRenaming(false)
                                  }
                                } else if (e.key === 'Escape') {
                                  e.preventDefault()
                                  setEditingWorkspaceId(null)
                                }
                              }}
                              onBlur={async () => {
                                if (!editingWorkspaceId) return
                                const trimmedName = editingName.trim()
                                if (trimmedName && trimmedName !== workspace.name) {
                                  setIsListRenaming(true)
                                  try {
                                    await onRenameWorkspace(workspace.id, trimmedName)
                                  } finally {
                                    setIsListRenaming(false)
                                  }
                                }
                                setEditingWorkspaceId(null)
                              }}
                              className='w-full border-0 bg-transparent p-0 font-base text-[13px] text-[var(--text-primary)] outline-none selection:bg-[#add6ff] selection:text-[#1b1b1b] focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:selection:bg-[#264f78] dark:selection:text-white'
                              maxLength={100}
                              autoComplete='off'
                              autoCorrect='off'
                              autoCapitalize='off'
                              spellCheck='false'
                              disabled={isListRenaming}
                              onClick={(e) => {
                                e.stopPropagation()
                              }}
                            />
                          </div>
                        ) : (
                          <PopoverItem
                            className='group'
                            active={workspace.id === workspaceId}
                            onClick={() => onWorkspaceSwitch(workspace)}
                            onContextMenu={(e) => handleContextMenu(e, workspace)}
                          >
                            <span className='min-w-0 flex-1 truncate'>{workspace.name}</span>
                            <button
                              type='button'
                              aria-label='Workspace options'
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                const rect = e.currentTarget.getBoundingClientRect()
                                openContextMenuAt(workspace, rect.right, rect.top)
                              }}
                              className='flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[4px] opacity-0 transition-opacity hover:bg-[var(--surface-7)] group-hover:opacity-100'
                            >
                              <MoreHorizontal className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
                            </button>
                          </PopoverItem>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </PopoverContent>
          </Popover>
        ) : (
          <button
            type='button'
            aria-label='Switch workspace'
            className={`flex cursor-pointer items-center gap-[8px] rounded-[6px] bg-transparent px-[6px] py-[4px] transition-colors hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)] ${
              isCollapsed ? '' : '-mx-[6px] min-w-0 max-w-full'
            }`}
            title={activeWorkspace?.name || 'Loading...'}
            disabled
          >
            <span
              className={`font-base text-[14px] text-[var(--text-primary)] dark:text-[var(--white)] ${
                isCollapsed ? 'max-w-[120px] truncate' : 'truncate'
              }`}
            >
              {activeWorkspace?.name || 'Loading...'}
            </span>
            <ChevronDown className='h-[8px] w-[10px] flex-shrink-0 text-[var(--text-muted)]' />
          </button>
        )}
      </div>
      {/* Workspace Actions */}
      <div className='flex flex-shrink-0 items-center gap-[10px]'>
        {/* Invite - hidden in collapsed mode or when invitations are disabled */}
        {!isCollapsed && !isInvitationsDisabled && (
          <Badge className='cursor-pointer' onClick={() => setIsInviteModalOpen(true)}>
            Invite
          </Badge>
        )}
        {/* Sidebar Collapse Toggle */}
        {showCollapseButton && (
          <Button
            variant='ghost-secondary'
            type='button'
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className='group !p-[3px] -m-[3px]'
            onClick={onToggleCollapse}
          >
            <PanelLeft className='h-[17.5px] w-[17.5px]' />
          </Button>
        )}
      </div>

      {/* Context Menu */}
      {(() => {
        const capturedPermissions = capturedWorkspaceRef.current?.permissions
        const contextCanEdit = capturedPermissions === 'admin' || capturedPermissions === 'write'
        const contextCanAdmin = capturedPermissions === 'admin'
        const capturedWorkspace = workspaces.find((w) => w.id === capturedWorkspaceRef.current?.id)
        const isOwner = capturedWorkspace && sessionUserId === capturedWorkspace.ownerId

        return (
          <ContextMenu
            isOpen={isContextMenuOpen}
            position={contextMenuPosition}
            menuRef={contextMenuRef}
            onClose={closeContextMenu}
            onRename={handleRenameAction}
            onDuplicate={handleDuplicateAction}
            onExport={handleExportAction}
            onDelete={handleDeleteAction}
            onLeave={handleLeaveAction}
            showRename={true}
            showDuplicate={true}
            showExport={true}
            showLeave={!isOwner && !!onLeaveWorkspace}
            disableRename={!contextCanAdmin}
            disableDuplicate={!contextCanEdit}
            disableExport={!contextCanAdmin}
            disableDelete={!contextCanAdmin}
          />
        )
      })()}

      {/* Invite Modal */}
      <InviteModal
        open={isInviteModalOpen}
        onOpenChange={setIsInviteModalOpen}
        workspaceName={activeWorkspace?.name || 'Workspace'}
      />
      {/* Delete Confirmation Modal */}
      <DeleteModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteWorkspace}
        isDeleting={isDeleting}
        itemType='workspace'
        itemName={deleteTarget?.name || activeWorkspaceFull?.name || activeWorkspace?.name}
      />
      {/* Leave Confirmation Modal */}
      <Modal open={isLeaveModalOpen} onOpenChange={() => setIsLeaveModalOpen(false)}>
        <ModalContent size='sm'>
          <ModalHeader>Leave Workspace</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to leave{' '}
              <span className='font-medium text-[var(--text-primary)]'>{leaveTarget?.name}</span>?
              You will lose access to all workflows and data in this workspace.{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => setIsLeaveModalOpen(false)}
              disabled={isLeaving}
            >
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleLeaveWorkspace} disabled={isLeaving}>
              {isLeaving ? 'Leaving...' : 'Leave Workspace'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
