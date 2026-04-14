'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { MoreHorizontal, Search } from 'lucide-react'
import {
  Button,
  ChevronDown,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Plus,
  Skeleton,
  UserPlus,
} from '@/components/emcn'
import { getDisplayPlanName, isFree } from '@/lib/billing/plan-helpers'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { cn } from '@/lib/core/utils/cn'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'
import { DeleteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/delete-modal/delete-modal'
import { CreateWorkspaceModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/create-workspace-modal/create-workspace-modal'
import { InviteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/invite-modal'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import type { Workspace } from '@/hooks/queries/workspace'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

const logger = createLogger('WorkspaceHeader')

/** Minimum workspace count before the search input and keyboard navigation are shown. */
const WORKSPACE_SEARCH_THRESHOLD = 3

interface WorkspaceHeaderProps {
  /** The active workspace object */
  activeWorkspace?: { name: string } | null
  /** Current workspace ID */
  workspaceId: string
  /** List of available workspaces */
  workspaces: Workspace[]
  /** Whether workspaces are loading */
  isWorkspacesLoading: boolean
  /** Whether workspace creation is in progress */
  isCreatingWorkspace: boolean
  /** Whether the workspace menu popover is open */
  isWorkspaceMenuOpen: boolean
  /** Callback to set workspace menu open state */
  setIsWorkspaceMenuOpen: (isOpen: boolean) => void
  /** Callback when workspace is switched */
  onWorkspaceSwitch: (workspace: Workspace) => void
  /** Callback when create workspace is confirmed with a name */
  onCreateWorkspace: (name: string) => Promise<void>
  /** Callback to rename the workspace */
  onRenameWorkspace: (workspaceId: string, newName: string) => Promise<void>
  /** Callback to delete the workspace */
  onDeleteWorkspace: (workspaceId: string) => Promise<void>
  /** Whether workspace deletion is in progress */
  isDeletingWorkspace: boolean
  /** Callback to duplicate the workspace */
  onDuplicateWorkspace: (workspaceId: string, workspaceName: string) => Promise<void>
  /** Callback to export the workspace */
  onExportWorkspace: (workspaceId: string, workspaceName: string) => Promise<void>
  /** Callback to import workspace */
  onImportWorkspace: () => void
  /** Whether workspace import is in progress */
  isImportingWorkspace: boolean
  /** Callback to change the workspace color */
  onColorChange?: (workspaceId: string, color: string) => Promise<void>
  /** Callback to upload a workspace logo */
  onUploadLogo?: (workspaceId: string) => void
  /** Callback to remove the workspace logo */
  onRemoveLogo?: (workspaceId: string) => Promise<void>
  /** Callback to leave the workspace */
  onLeaveWorkspace?: (workspaceId: string) => Promise<void>
  /** Whether workspace leave is in progress */
  isLeavingWorkspace: boolean
  /** Current user's session ID for owner check */
  sessionUserId?: string
  /** Whether the sidebar is collapsed */
  isCollapsed?: boolean
}

/**
 * Workspace header component that displays workspace name and switcher.
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
  onRenameWorkspace,
  onDeleteWorkspace,
  isDeletingWorkspace,
  onDuplicateWorkspace,
  onExportWorkspace,
  onImportWorkspace,
  isImportingWorkspace,
  onColorChange,
  onUploadLogo,
  onRemoveLogo,
  onLeaveWorkspace,
  isLeavingWorkspace,
  sessionUserId,
  isCollapsed = false,
}: WorkspaceHeaderProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null)
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false)
  const [leaveTarget, setLeaveTarget] = useState<Workspace | null>(null)
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [isListRenaming, setIsListRenaming] = useState(false)
  const [workspaceSearch, setWorkspaceSearch] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const workspaceListRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const row = workspaceListRef.current?.querySelector<HTMLElement>(
      `[data-workspace-row-idx="${highlightedIndex}"]`
    )
    row?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  const searchQuery = workspaceSearch.trim().toLowerCase()
  const filteredWorkspaces = searchQuery
    ? workspaces.filter((w) => w.name.toLowerCase().includes(searchQuery))
    : workspaces

  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
  const [menuOpenWorkspaceId, setMenuOpenWorkspaceId] = useState<string | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const capturedWorkspaceRef = useRef<Workspace | null>(null)
  const isRenamingRef = useRef(false)
  const isContextMenuOpeningRef = useRef(false)
  const contextMenuClosedRef = useRef(true)
  const hasInputFocusedRef = useRef(false)

  const [isMounted, setIsMounted] = useState(false)
  useEffect(() => {
    setIsMounted(true)
  }, [])

  const { isInvitationsDisabled } = usePermissionConfig()
  const { data: subscriptionResponse } = useSubscriptionData({ enabled: isBillingEnabled })
  const { navigateToSettings } = useSettingsNavigation()
  const currentPlan = subscriptionResponse?.data?.plan
  const showPlanInfo = isBillingEnabled && typeof currentPlan !== 'undefined'
  const rawPlanName = showPlanInfo ? getDisplayPlanName(currentPlan) : ''
  const planDisplayName = showPlanInfo
    ? rawPlanName.includes('for Teams')
      ? rawPlanName
      : `${rawPlanName} Plan`
    : ''
  const isFreePlan = showPlanInfo && isFree(currentPlan)

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

  useEffect(() => {
    if (isWorkspaceMenuOpen) {
      setHighlightedIndex(0)
      const id = requestAnimationFrame(() => searchInputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
    setWorkspaceSearch('')
  }, [isWorkspaceMenuOpen])

  const activeWorkspaceFull = workspaces.find((w) => w.id === workspaceId) || null

  const workspaceInitial = (() => {
    const name = activeWorkspace?.name || ''
    const stripped = name.replace(/workspace/gi, '').trim()
    return (stripped[0] || name[0] || 'W').toUpperCase()
  })()

  /**
   * Opens the context menu for a workspace at the specified position
   */
  const openContextMenuAt = (workspace: Workspace, x: number, y: number) => {
    isContextMenuOpeningRef.current = true
    contextMenuClosedRef.current = false

    capturedWorkspaceRef.current = workspace
    setMenuOpenWorkspaceId(workspace.id)
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
    setMenuOpenWorkspaceId(null)
    const isOpeningAnother = isContextMenuOpeningRef.current
    isContextMenuOpeningRef.current = false
    if (!isRenamingRef.current && !isOpeningAnother) {
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
   * Handles color change action from context menu
   */
  const handleColorChangeAction = async (color: string) => {
    if (!capturedWorkspaceRef.current || !onColorChange) return
    await onColorChange(capturedWorkspaceRef.current.id, color)
  }

  const handleUploadLogoAction = () => {
    if (!capturedWorkspaceRef.current || !onUploadLogo) return
    onUploadLogo(capturedWorkspaceRef.current.id)
  }

  const handleRemoveLogoAction = async () => {
    if (!capturedWorkspaceRef.current || !onRemoveLogo) return
    await onRemoveLogo(capturedWorkspaceRef.current.id)
  }

  /**
   * Handle leave workspace after confirmation
   */
  const handleLeaveWorkspace = async () => {
    if (!leaveTarget || !onLeaveWorkspace) return

    try {
      await onLeaveWorkspace(leaveTarget.id)
      setIsLeaveModalOpen(false)
      setLeaveTarget(null)
    } catch (error) {
      logger.error('Error leaving workspace:', error)
    }
  }

  /**
   * Handle delete workspace after confirmation
   */
  const handleDeleteWorkspace = async () => {
    try {
      const targetId = deleteTarget?.id || workspaceId
      await onDeleteWorkspace(targetId)
      setIsDeleteModalOpen(false)
      setDeleteTarget(null)
    } catch (error) {
      logger.error('Error deleting workspace:', error)
    }
  }

  return (
    <div className='min-w-0'>
      {/* Workspace Name with Switcher */}
      <div className='min-w-0'>
        {isMounted ? (
          <DropdownMenu
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
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                aria-label='Switch workspace'
                className={cn(
                  'group flex h-[32px] min-w-0 items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] pl-[5px] transition-colors hover-hover:bg-[var(--surface-5)]',
                  isCollapsed ? 'w-[32px]' : 'w-full cursor-pointer gap-2 pr-2'
                )}
                title={activeWorkspace?.name || 'Loading...'}
                onContextMenu={(e) => {
                  if (activeWorkspaceFull) {
                    handleContextMenu(e, activeWorkspaceFull)
                  }
                }}
              >
                {activeWorkspaceFull ? (
                  activeWorkspaceFull.logoUrl ? (
                    <img
                      src={activeWorkspaceFull.logoUrl}
                      alt={activeWorkspaceFull.name || 'Workspace logo'}
                      className='h-[20px] w-[20px] flex-shrink-0 rounded-sm object-cover'
                    />
                  ) : (
                    <div
                      className='flex h-[20px] w-[20px] flex-shrink-0 items-center justify-center rounded-sm font-medium text-caption text-white leading-none'
                      style={{
                        backgroundColor: activeWorkspaceFull.color ?? 'var(--brand-accent)',
                      }}
                    >
                      {workspaceInitial}
                    </div>
                  )
                ) : (
                  <Skeleton className='h-[20px] w-[20px] flex-shrink-0 rounded-sm' />
                )}
                {!isCollapsed && (
                  <>
                    <span className='min-w-0 flex-1 truncate text-left font-base text-[var(--text-primary)] text-sm'>
                      {activeWorkspace?.name || 'Loading...'}
                    </span>
                    <ChevronDown className='sidebar-collapse-hide h-[8px] w-[10px] flex-shrink-0 text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]' />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='start'
              side={isCollapsed ? 'right' : 'bottom'}
              sideOffset={isCollapsed ? 16 : 8}
              className='flex max-h-none flex-col overflow-hidden'
              style={
                isCollapsed
                  ? {
                      width: '248px',
                      maxWidth: 'calc(100vw - 24px)',
                    }
                  : {
                      width: 'var(--radix-dropdown-menu-trigger-width)',
                      minWidth: 'var(--radix-dropdown-menu-trigger-width)',
                      maxWidth: 'var(--radix-dropdown-menu-trigger-width)',
                    }
              }
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              {isWorkspacesLoading ? (
                <div className='px-2 py-[5px] font-medium text-[var(--text-secondary)] text-caption'>
                  Loading workspaces...
                </div>
              ) : (
                <>
                  <div className='flex items-center gap-2 px-0.5 py-0.5'>
                    {activeWorkspaceFull ? (
                      activeWorkspaceFull.logoUrl ? (
                        <img
                          src={activeWorkspaceFull.logoUrl}
                          alt={activeWorkspaceFull.name || 'Workspace logo'}
                          className='h-[32px] w-[32px] flex-shrink-0 rounded-md object-cover'
                        />
                      ) : (
                        <div
                          className='flex h-[32px] w-[32px] flex-shrink-0 items-center justify-center rounded-md font-medium text-caption text-white'
                          style={{
                            backgroundColor: activeWorkspaceFull.color ?? 'var(--brand-accent)',
                          }}
                        >
                          {workspaceInitial}
                        </div>
                      )
                    ) : (
                      <Skeleton className='h-[32px] w-[32px] flex-shrink-0 rounded-md' />
                    )}
                    <div className='flex min-w-0 flex-1 flex-col'>
                      <span className='truncate font-medium text-[var(--text-primary)] text-small'>
                        {activeWorkspace?.name || 'Loading...'}
                      </span>
                      {showPlanInfo && (
                        <div className='flex items-center gap-2'>
                          <span className='truncate text-[var(--text-tertiary)] text-xs'>
                            {planDisplayName}
                          </span>
                          {isFreePlan && (
                            <button
                              type='button'
                              className='flex-shrink-0 rounded-full bg-[color-mix(in_srgb,var(--brand-accent)_16%,transparent)] px-2 py-0.5 font-medium text-[11px] text-[var(--brand-accent)] leading-none transition-opacity hover:opacity-85'
                              onClick={(e) => {
                                e.stopPropagation()
                                setIsWorkspaceMenuOpen(false)
                                navigateToSettings({ section: 'subscription' })
                              }}
                            >
                              Upgrade
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {workspaces.length > WORKSPACE_SEARCH_THRESHOLD && (
                    <div className='mt-1 flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-transparent px-2 py-1 transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--surface-5)]'>
                      <Search
                        className='h-[12px] w-[12px] flex-shrink-0 text-[var(--text-tertiary)]'
                        strokeWidth={2}
                      />
                      <Input
                        ref={searchInputRef}
                        placeholder='Search workspaces...'
                        value={workspaceSearch}
                        onChange={(e) => {
                          setWorkspaceSearch(e.target.value)
                          setHighlightedIndex(0)
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (filteredWorkspaces.length === 0) return
                          if (e.key === 'ArrowDown') {
                            e.preventDefault()
                            setHighlightedIndex((i) => (i + 1) % filteredWorkspaces.length)
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault()
                            setHighlightedIndex(
                              (i) => (i - 1 + filteredWorkspaces.length) % filteredWorkspaces.length
                            )
                          } else if (e.key === 'Enter') {
                            e.preventDefault()
                            const target = filteredWorkspaces[highlightedIndex]
                            if (target) onWorkspaceSwitch(target)
                          }
                        }}
                        className='h-auto flex-1 border-0 bg-transparent p-0 text-caption leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
                      />
                    </div>
                  )}
                  <DropdownMenuGroup className='mt-2 min-h-0 flex-1'>
                    <div
                      ref={workspaceListRef}
                      className='flex max-h-[130px] flex-col gap-0.5 overflow-y-auto'
                    >
                      {filteredWorkspaces.length === 0 && workspaceSearch && (
                        <div className='px-2 py-[5px] text-[var(--text-tertiary)] text-caption'>
                          No workspaces match "{workspaceSearch}"
                        </div>
                      )}
                      {filteredWorkspaces.map((workspace, idx) => (
                        <div
                          key={workspace.id}
                          data-workspace-row-idx={idx}
                          onMouseEnter={() => setHighlightedIndex(idx)}
                        >
                          {editingWorkspaceId === workspace.id ? (
                            <div className='flex items-center gap-2 rounded-[5px] bg-[var(--surface-active)] px-2 py-[5px]'>
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
                                className='w-full border-0 bg-transparent p-0 font-medium text-[var(--text-primary)] text-caption outline-none selection:bg-[var(--selection-bg)] selection:text-[var(--bg)] focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:selection:bg-[var(--selection-dark)] dark:selection:text-white'
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
                            <div
                              className={cn(
                                'group flex cursor-pointer select-none items-center gap-2 rounded-[5px] px-2 py-[5px] font-medium text-[var(--text-body)] text-caption outline-none transition-colors',
                                workspace.id !== workspaceId &&
                                  menuOpenWorkspaceId !== workspace.id &&
                                  'hover-hover:bg-[var(--surface-hover)]',
                                (workspace.id === workspaceId ||
                                  menuOpenWorkspaceId === workspace.id) &&
                                  'bg-[var(--surface-active)]',
                                idx === highlightedIndex &&
                                  workspaces.length > WORKSPACE_SEARCH_THRESHOLD &&
                                  workspace.id !== workspaceId &&
                                  menuOpenWorkspaceId !== workspace.id &&
                                  'bg-[var(--surface-hover)]'
                              )}
                              onClick={(e) => {
                                if (e.metaKey || e.ctrlKey) {
                                  window.open(`/workspace/${workspace.id}/home`, '_blank')
                                  return
                                }
                                onWorkspaceSwitch(workspace)
                              }}
                              onAuxClick={(e) => {
                                if (e.button === 1) {
                                  e.preventDefault()
                                  window.open(`/workspace/${workspace.id}/home`, '_blank')
                                }
                              }}
                              onContextMenu={(e) => handleContextMenu(e, workspace)}
                            >
                              <span className='min-w-0 flex-1 truncate'>{workspace.name}</span>
                              <button
                                type='button'
                                aria-label='Workspace options'
                                onMouseDown={() => {
                                  isContextMenuOpeningRef.current = true
                                }}
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  openContextMenuAt(workspace, rect.right, rect.top)
                                }}
                                className={cn(
                                  'flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100',
                                  menuOpenWorkspaceId === workspace.id && 'opacity-100'
                                )}
                              >
                                <MoreHorizontal className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </DropdownMenuGroup>

                  <div className='mt-1 flex flex-col gap-0.5'>
                    <button
                      type='button'
                      className='flex w-full cursor-pointer select-none items-center gap-2 rounded-[5px] px-2 py-[5px] font-medium text-[var(--text-body)] text-caption outline-none transition-colors hover-hover:bg-[var(--surface-hover)] disabled:pointer-events-none disabled:opacity-50'
                      onClick={(e) => {
                        e.stopPropagation()
                        setIsWorkspaceMenuOpen(false)
                        setIsCreateModalOpen(true)
                      }}
                      disabled={isCreatingWorkspace}
                    >
                      <Plus className='h-[14px] w-[14px] shrink-0 text-[var(--text-icon)]' />
                      Create new workspace
                    </button>
                  </div>

                  {!isInvitationsDisabled && (
                    <>
                      <DropdownMenuSeparator />
                      <button
                        type='button'
                        className='flex w-full cursor-pointer select-none items-center gap-2 rounded-[5px] px-2 py-[5px] font-medium text-[var(--text-body)] text-caption outline-none transition-colors hover-hover:bg-[var(--surface-hover)]'
                        onClick={() => {
                          setIsInviteModalOpen(true)
                          setIsWorkspaceMenuOpen(false)
                        }}
                      >
                        <UserPlus className='h-[14px] w-[14px] shrink-0 text-[var(--text-icon)]' />
                        Invite members
                      </button>
                    </>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            type='button'
            aria-label='Switch workspace'
            className={cn(
              'flex h-[32px] min-w-0 items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] pl-[5px]',
              isCollapsed ? 'w-[32px]' : 'w-full gap-2 pr-2'
            )}
            title={activeWorkspace?.name || 'Loading...'}
            disabled
          >
            {activeWorkspaceFull ? (
              activeWorkspaceFull.logoUrl ? (
                <img
                  src={activeWorkspaceFull.logoUrl}
                  alt={activeWorkspaceFull.name || 'Workspace logo'}
                  className='h-[20px] w-[20px] flex-shrink-0 rounded-sm object-cover'
                />
              ) : (
                <div
                  className='flex h-[20px] w-[20px] flex-shrink-0 items-center justify-center rounded-sm font-medium text-caption text-white leading-none'
                  style={{ backgroundColor: activeWorkspaceFull.color ?? 'var(--brand-accent)' }}
                >
                  {workspaceInitial}
                </div>
              )
            ) : (
              <Skeleton className='h-[20px] w-[20px] flex-shrink-0 rounded-sm' />
            )}
            {!isCollapsed && (
              <>
                <span className='min-w-0 flex-1 truncate text-left font-base text-[var(--text-primary)] text-sm'>
                  {activeWorkspace?.name || 'Loading...'}
                </span>
                <ChevronDown className='sidebar-collapse-hide h-[8px] w-[10px] flex-shrink-0 text-[var(--text-muted)]' />
              </>
            )}
          </button>
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
            onColorChange={onColorChange ? handleColorChangeAction : undefined}
            onUploadLogo={onUploadLogo ? handleUploadLogoAction : undefined}
            onRemoveLogo={onRemoveLogo ? handleRemoveLogoAction : undefined}
            currentColor={capturedWorkspace?.color}
            showRename={true}
            showDuplicate={true}
            showExport={true}
            showColorChange={!!onColorChange}
            showUploadLogo={!!onUploadLogo}
            showRemoveLogo={!!onRemoveLogo && !!capturedWorkspace?.logoUrl}
            showLeave={!isOwner && !!onLeaveWorkspace}
            disableRename={!contextCanAdmin}
            disableDuplicate={!contextCanEdit}
            disableExport={!contextCanAdmin}
            disableDelete={!contextCanAdmin || workspaces.length <= 1}
            disableColorChange={!contextCanAdmin}
            disableUploadLogo={!contextCanAdmin}
            disableRemoveLogo={!contextCanAdmin}
          />
        )
      })()}

      {/* Create Workspace Modal */}
      <CreateWorkspaceModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onConfirm={async (name) => {
          await onCreateWorkspace(name)
          setIsCreateModalOpen(false)
        }}
        isCreating={isCreatingWorkspace}
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
        isDeleting={isDeletingWorkspace}
        itemType='workspace'
        itemName={deleteTarget?.name || activeWorkspaceFull?.name || activeWorkspace?.name}
      />
      {/* Leave Confirmation Modal */}
      <Modal open={isLeaveModalOpen} onOpenChange={() => setIsLeaveModalOpen(false)}>
        <ModalContent size='sm'>
          <ModalHeader>Leave Workspace</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              Are you sure you want to leave{' '}
              <span className='font-base text-[var(--text-primary)]'>{leaveTarget?.name}</span>? You
              will lose access to all workflows and data in this workspace. This action cannot be
              undone.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => setIsLeaveModalOpen(false)}
              disabled={isLeavingWorkspace}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleLeaveWorkspace}
              disabled={isLeavingWorkspace}
            >
              {isLeavingWorkspace ? 'Leaving...' : 'Leave Workspace'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
