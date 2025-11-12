'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, Plus, RefreshCw } from 'lucide-react'
import {
  Badge,
  Button,
  ChevronDown,
  PanelLeft,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverSection,
  PopoverTrigger,
  Tooltip,
} from '@/components/emcn'
import { createLogger } from '@/lib/logs/console/logger'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ContextMenu } from '../workflow-list/components/context-menu/context-menu'
import { DeleteModal } from '../workflow-list/components/delete-modal/delete-modal'
import { InviteModal } from './components'

const logger = createLogger('WorkspaceHeader')

interface Workspace {
  id: string
  name: string
  ownerId: string
  role?: string
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
}: WorkspaceHeaderProps) {
  const userPermissions = useUserPermissionsContext()
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null)
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [isListRenaming, setIsListRenaming] = useState(false)
  const listRenameInputRef = useRef<HTMLInputElement | null>(null)

  // Context menu state
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const capturedWorkspaceRef = useRef<{ id: string; name: string } | null>(null)

  /**
   * Focus the inline list rename input when it becomes active
   */
  useEffect(() => {
    if (editingWorkspaceId && listRenameInputRef.current) {
      try {
        listRenameInputRef.current.focus()
        listRenameInputRef.current.select()
      } catch {
        // no-op
      }
    }
  }, [editingWorkspaceId])

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
   * Handles page refresh when disconnected
   */
  const handleRefresh = () => {
    window.location.reload()
  }

  /**
   * Handle right-click context menu
   */
  const handleContextMenu = (e: React.MouseEvent, workspace: Workspace) => {
    e.preventDefault()
    e.stopPropagation()

    capturedWorkspaceRef.current = { id: workspace.id, name: workspace.name }
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
    setIsContextMenuOpen(true)
  }

  /**
   * Close context menu
   */
  const closeContextMenu = () => {
    setIsContextMenuOpen(false)
  }

  /**
   * Handles rename action from context menu
   */
  const handleRenameAction = () => {
    if (!capturedWorkspaceRef.current) return

    setEditingWorkspaceId(capturedWorkspaceRef.current.id)
    setEditingName(capturedWorkspaceRef.current.name)
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
    <div className='flex min-w-0 items-center justify-between gap-[8px]'>
      {/* Workspace Name */}
      <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
        <h2
          className='max-w-full truncate font-base text-[14px] dark:text-[var(--white)]'
          title={activeWorkspace?.name || 'Loading...'}
        >
          {activeWorkspace?.name || 'Loading...'}
        </h2>
      </div>
      {/* Workspace Actions */}
      <div className='flex items-center gap-[10px]'>
        {/* Disconnection Indicator */}
        {userPermissions.isOfflineMode && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                type='button'
                aria-label='Connection lost - click to refresh'
                className='group !p-[3px] -m-[3px]'
                onClick={handleRefresh}
              >
                <RefreshCw className='h-[14px] w-[14px] text-[var(--text-error)] dark:text-[var(--text-error)]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Connection lost - refresh</Tooltip.Content>
          </Tooltip.Root>
        )}
        {/* Invite */}
        <Badge className='cursor-pointer' onClick={() => setIsInviteModalOpen(true)}>
          Invite
        </Badge>
        {/* Workspace Switcher Popover */}
        <Popover
          open={isWorkspaceMenuOpen}
          onOpenChange={(open) => {
            // Don't close if context menu is opening
            if (!open && isContextMenuOpen) {
              return
            }
            setIsWorkspaceMenuOpen(open)
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant='ghost-secondary'
              type='button'
              aria-label='Switch workspace'
              className='group !p-[3px] -m-[3px]'
            >
              <ChevronDown
                className={`h-[8px] w-[12px] transition-transform duration-100 ${
                  isWorkspaceMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align='end'
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
                  <div className='flex items-center gap-[6px]'>
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
                      <Tooltip.Content className='py-[2.5px]'>
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
                      <Tooltip.Content className='py-[2.5px]'>
                        <p>{isCreatingWorkspace ? 'Creating workspace...' : 'Create workspace'}</p>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  </div>
                </div>
                <div className='max-h-[200px] overflow-y-auto'>
                  {workspaces.map((workspace, index) => (
                    <div key={workspace.id} className={index > 0 ? 'mt-[2px]' : ''}>
                      {editingWorkspaceId === workspace.id ? (
                        <div className='flex h-[25px] items-center gap-[8px] rounded-[6px] bg-[var(--surface-9)] px-[6px] dark:bg-[var(--surface-9)]'>
                          <input
                            ref={listRenameInputRef}
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={async (e) => {
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
                              setIsListRenaming(true)
                              try {
                                await onRenameWorkspace(workspace.id, editingName.trim())
                                setEditingWorkspaceId(null)
                              } finally {
                                setIsListRenaming(false)
                              }
                            }}
                            className='w-full border-0 bg-transparent p-0 font-base text-[12px] text-[var(--text-primary)] outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-[var(--text-primary)]'
                            maxLength={100}
                            autoComplete='off'
                            autoCorrect='off'
                            autoCapitalize='off'
                            spellCheck='false'
                            disabled={isListRenaming}
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                            }}
                          />
                        </div>
                      ) : (
                        <PopoverItem
                          active={workspace.id === workspaceId}
                          onClick={() => onWorkspaceSwitch(workspace)}
                          onContextMenu={(e) => handleContextMenu(e, workspace)}
                        >
                          <span className='min-w-0 flex-1 truncate'>{workspace.name}</span>
                        </PopoverItem>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </PopoverContent>
        </Popover>
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
      <ContextMenu
        isOpen={isContextMenuOpen}
        position={contextMenuPosition}
        menuRef={contextMenuRef}
        onClose={closeContextMenu}
        onRename={handleRenameAction}
        onDuplicate={handleDuplicateAction}
        onExport={handleExportAction}
        onDelete={handleDeleteAction}
        showRename={true}
        showDuplicate={true}
        showExport={true}
      />

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
    </div>
  )
}
