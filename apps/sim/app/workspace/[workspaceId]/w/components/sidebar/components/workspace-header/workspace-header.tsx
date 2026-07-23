'use client'

import { memo, type ReactElement, useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  Chip,
  ChipConfirmModal,
  ChipInput,
  chipGeometryClass,
  chipVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Plus,
  Send,
  Skeleton,
  Tooltip,
} from '@sim/emcn'
import { ManageWorkspace, PanelLeft } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { MoreHorizontal, Search } from 'lucide-react'
import { useActiveOrganization } from '@/lib/auth/auth-client'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'
import { DeleteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/delete-modal/delete-modal'
import {
  CreateWorkspaceModal,
  type CreateWorkspaceTarget,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/create-workspace-modal/create-workspace-modal'
import { InviteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/invite-modal'
import type { Workspace, WorkspaceCreationPolicy } from '@/hooks/queries/workspace'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

const logger = createLogger('WorkspaceHeader')

/** Show the search input once the workspace list exceeds this count. */
const WORKSPACE_SEARCH_THRESHOLD = 3

/**
 * Derives the single-letter avatar initial for a workspace, ignoring the word
 * "workspace" in the name (e.g. "Acme Workspace" → "A").
 */
function getWorkspaceInitial(name: string | undefined): string {
  const stripped = (name ?? '').replace(/workspace/gi, '').trim()
  return (stripped[0] || name?.[0] || 'W').toUpperCase()
}

interface DisabledReasonTooltipProps {
  reason: string | null
  children: ReactElement
}

/**
 * Wraps a menu item in a tooltip explaining why the action is unavailable.
 * Renders the child as-is when there is no reason to show.
 */
function DisabledReasonTooltip({ reason, children }: DisabledReasonTooltipProps) {
  if (!reason) return children
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Content>
        <p>{reason}</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

interface WorkspaceHeaderProps {
  /** The active workspace object */
  activeWorkspace?: { name: string } | null
  /** Current workspace ID */
  workspaceId: string
  /** List of available workspaces */
  workspaces: Workspace[]
  /** Server-derived workspace creation policy for the current user context */
  workspaceCreationPolicy?: WorkspaceCreationPolicy | null
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
  /** Callback to upload a workspace logo */
  onUploadLogo: (workspaceId: string) => void
  /** Callback to leave the workspace */
  onLeaveWorkspace: (workspaceId: string) => Promise<void>
  /** Whether workspace leave is in progress */
  isLeavingWorkspace: boolean
  /** Current user's session ID for owner check */
  sessionUserId?: string
  /** Whether the sidebar is collapsed */
  isCollapsed?: boolean
  /** Callback to expand the sidebar from collapsed state */
  onExpandSidebar?: () => void
}

/**
 * Workspace header component that displays workspace name and switcher.
 */
function WorkspaceHeaderImpl({
  activeWorkspace,
  workspaceId,
  workspaces,
  workspaceCreationPolicy,
  isWorkspacesLoading,
  isCreatingWorkspace,
  isWorkspaceMenuOpen,
  setIsWorkspaceMenuOpen,
  onWorkspaceSwitch,
  onCreateWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  isDeletingWorkspace,
  onUploadLogo,
  onLeaveWorkspace,
  isLeavingWorkspace,
  sessionUserId,
  isCollapsed = false,
  onExpandSidebar,
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

  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
  const [menuOpenWorkspaceId, setMenuOpenWorkspaceId] = useState<string | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const capturedWorkspaceRef = useRef<Workspace | null>(null)
  const isRenamingRef = useRef(false)
  const isContextMenuOpeningRef = useRef(false)
  const contextMenuClosedRef = useRef(true)
  const hasInputFocusedRef = useRef(false)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const workspaceListRef = useRef<HTMLDivElement>(null)

  const [workspaceSearch, setWorkspaceSearch] = useState('')
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  const showSearch = workspaces.length > WORKSPACE_SEARCH_THRESHOLD
  const searchQuery = workspaceSearch.trim().toLowerCase()
  const filteredWorkspaces =
    showSearch && searchQuery
      ? workspaces.filter((w) => w.name.toLowerCase().includes(searchQuery))
      : workspaces

  /**
   * The highlighted row resolved from the highlighted workspace's identity, not
   * a stored position. Tracking the id (rather than a numeric index) keeps the
   * highlight on the same workspace when the list shrinks, grows, or reorders
   * while the menu is open (a live membership change or background refetch);
   * a missing id (filtered out) or no selection falls back to the first row.
   * `activeIndex` is the single source of truth for Enter, the visual highlight,
   * and the scroll target, so those three can never diverge.
   */
  const activeIndex = highlightedId
    ? Math.max(
        0,
        filteredWorkspaces.findIndex((w) => w.id === highlightedId)
      )
    : 0

  useEffect(() => {
    if (!showSearch || !isWorkspaceMenuOpen) return
    const el = workspaceListRef.current?.querySelector<HTMLElement>(
      `[data-workspace-row-idx="${activeIndex}"]`
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, showSearch, isWorkspaceMenuOpen])

  /**
   * Seed the highlight to the first result whenever the current one is absent —
   * on open, or after typing filters the highlighted workspace out. This keeps
   * `highlightedId` pinned to a real workspace identity rather than falling back
   * to a bare positional default, so a reorder or query change carries the
   * highlight along with its workspace instead of stranding it on whatever now
   * occupies the first row.
   */
  useEffect(() => {
    if (!showSearch || !isWorkspaceMenuOpen || filteredWorkspaces.length === 0) return
    const present = highlightedId !== null && filteredWorkspaces.some((w) => w.id === highlightedId)
    if (!present) setHighlightedId(filteredWorkspaces[0].id)
  }, [highlightedId, filteredWorkspaces, showSearch, isWorkspaceMenuOpen])

  /**
   * Clear the query and highlight whenever the menu closes, by any path —
   * selecting a workspace closes it via `setIsWorkspaceMenuOpen(false)` without
   * routing through `onOpenChange`, so resetting here (not in the open handler)
   * keeps a stale search from persisting into the next open. Not gated on
   * `showSearch`: if the list drops to the threshold while a query is active the
   * search input unmounts, and this still clears the now-invisible filter. For
   * users who never search, both setters no-op (same value) so there is no cost.
   */
  useEffect(() => {
    if (isWorkspaceMenuOpen) return
    setWorkspaceSearch('')
    setHighlightedId(null)
  }, [isWorkspaceMenuOpen])

  const [isMounted, setIsMounted] = useState(false)
  useEffect(() => {
    setIsMounted(true)
  }, [])

  const { data: viewerActiveOrganization } = useActiveOrganization()
  const { navigateToSettings } = useSettingsNavigation()

  const activeWorkspaceFull = workspaces.find((w) => w.id === workspaceId) || null
  const isWorkspaceReady = !isWorkspacesLoading && activeWorkspaceFull !== null
  const canCreateWorkspace = workspaceCreationPolicy?.canCreate ?? true
  const createWorkspaceDisabledReason =
    workspaceCreationPolicy?.canCreate === false ? workspaceCreationPolicy.reason : null
  const { isInvitationsDisabled: isInvitationsDisabledByConfig } = usePermissionConfig()
  const inviteDisabledReason = activeWorkspaceFull?.inviteDisabledReason ?? null
  const isInvitationsDisabled = isInvitationsDisabledByConfig || inviteDisabledReason !== null
  const createWorkspaceTarget: CreateWorkspaceTarget =
    workspaceCreationPolicy?.workspaceMode === 'organization' &&
    workspaceCreationPolicy.organizationId
      ? {
          type: 'organization',
          organizationName:
            viewerActiveOrganization?.id === workspaceCreationPolicy.organizationId
              ? viewerActiveOrganization.name
              : 'your organization',
        }
      : { type: 'personal' }

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

  const workspaceInitial = getWorkspaceInitial(activeWorkspace?.name)

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

  const handleUploadLogoAction = () => {
    if (!capturedWorkspaceRef.current) return
    onUploadLogo(capturedWorkspaceRef.current.id)
  }

  /**
   * Handle leave workspace after confirmation
   */
  const handleLeaveWorkspace = async () => {
    if (!leaveTarget) return

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
    <div className='min-w-0 flex-1'>
      {isMounted && isCollapsed ? (
        <button
          type='button'
          aria-label='Expand sidebar'
          onClick={onExpandSidebar}
          className={chipVariants({ fullWidth: true })}
        >
          <div className='relative flex size-[16px] flex-shrink-0 items-center justify-center'>
            {!activeWorkspaceFull ? (
              <Skeleton className='size-[16px] rounded-sm' />
            ) : (
              <>
                {activeWorkspaceFull.logoUrl ? (
                  <img
                    src={activeWorkspaceFull.logoUrl}
                    alt={activeWorkspaceFull.name || 'Workspace logo'}
                    className='size-[16px] rounded-sm object-cover group-hover:invisible'
                  />
                ) : (
                  <div
                    className='flex size-[16px] items-center justify-center rounded-sm font-medium text-[9px] text-white leading-none group-hover:invisible'
                    style={{
                      backgroundColor: activeWorkspaceFull.color ?? 'var(--brand-accent)',
                    }}
                  >
                    {workspaceInitial}
                  </div>
                )}
                <PanelLeft
                  aria-hidden
                  className='pointer-events-none invisible absolute inset-0 m-auto size-[16px] rotate-180 text-[var(--text-icon)] group-hover:visible'
                />
              </>
            )}
          </div>
        </button>
      ) : isMounted && isWorkspaceReady ? (
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
            if (open && showSearch) {
              requestAnimationFrame(() => searchInputRef.current?.focus())
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              aria-label='Switch workspace'
              className={cn(chipVariants(), 'min-w-0 max-w-full')}
              title={activeWorkspace?.name}
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
                    className='size-[16px] flex-shrink-0 rounded-sm object-cover'
                  />
                ) : (
                  <div
                    className='flex size-[16px] flex-shrink-0 items-center justify-center rounded-sm font-medium text-[9px] text-white leading-none'
                    style={{
                      backgroundColor: activeWorkspaceFull.color ?? 'var(--brand-accent)',
                    }}
                  >
                    {workspaceInitial}
                  </div>
                )
              ) : (
                <Skeleton className='size-[16px] flex-shrink-0 rounded-sm' />
              )}
              {!isCollapsed && activeWorkspace?.name && (
                <>
                  <span className='min-w-0 truncate text-[var(--text-body)] text-sm'>
                    {activeWorkspace.name}
                  </span>
                  <ChevronDown className='h-[6px] w-[10px] flex-shrink-0 text-[var(--text-icon)]' />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align='start'
            side={isCollapsed ? 'right' : 'bottom'}
            sideOffset={isCollapsed ? 16 : 8}
            className='flex max-h-none flex-col overflow-hidden'
            style={{
              width: '248px',
              maxWidth: 'calc(100vw - 24px)',
            }}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            {isWorkspacesLoading ? (
              <div className='px-2 py-[5px] font-medium text-[var(--text-secondary)] text-caption'>
                Loading workspaces...
              </div>
            ) : (
              <>
                {showSearch && (
                  <ChipInput
                    ref={searchInputRef}
                    icon={Search}
                    placeholder='Search workspaces...'
                    value={workspaceSearch}
                    onChange={(e) => setWorkspaceSearch(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.nativeEvent.isComposing) return
                      if (filteredWorkspaces.length === 0) return
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        const next = (activeIndex + 1) % filteredWorkspaces.length
                        setHighlightedId(filteredWorkspaces[next].id)
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        const next =
                          (activeIndex - 1 + filteredWorkspaces.length) % filteredWorkspaces.length
                        setHighlightedId(filteredWorkspaces[next].id)
                      } else if (e.key === 'Enter') {
                        e.preventDefault()
                        const target = filteredWorkspaces[activeIndex]
                        if (target) onWorkspaceSwitch(target)
                      }
                    }}
                    className='mb-1.5'
                  />
                )}
                <div
                  ref={workspaceListRef}
                  className='-mx-1.5 flex max-h-[94px] flex-col gap-0.5 overflow-y-auto px-1.5'
                >
                  {filteredWorkspaces.length === 0 && workspaceSearch && (
                    <div className='px-2 py-[5px] text-[var(--text-muted)] text-caption'>
                      No results for "{workspaceSearch}"
                    </div>
                  )}
                  {filteredWorkspaces.map((workspace, idx) => {
                    const initial = getWorkspaceInitial(workspace.name)
                    const isActive = workspace.id === workspaceId
                    const isMenuOpen = menuOpenWorkspaceId === workspace.id
                    const isKeyboardHighlighted = showSearch && idx === activeIndex

                    /**
                     * Hover-highlight is wired to `onMouseMove`, not `onMouseEnter`: a
                     * keyboard-driven `scrollIntoView` slides rows under a stationary cursor
                     * and fires `mouseenter`, which would hijack the keyboard selection.
                     * `mousemove` only fires on real pointer motion, so hover follows the
                     * mouse without fighting the arrow keys.
                     */
                    return (
                      <div
                        key={workspace.id}
                        data-workspace-row-idx={showSearch ? idx : undefined}
                        onMouseMove={showSearch ? () => setHighlightedId(workspace.id) : undefined}
                      >
                        {editingWorkspaceId === workspace.id ? (
                          <div
                            className={chipVariants({ active: true, fullWidth: true, flush: true })}
                          >
                            {workspace.logoUrl ? (
                              <img
                                src={workspace.logoUrl}
                                alt={workspace.name || 'Workspace logo'}
                                className='size-[16px] flex-shrink-0 rounded-sm object-cover'
                              />
                            ) : (
                              <div
                                className='flex size-[16px] flex-shrink-0 items-center justify-center rounded-sm font-medium text-[9px] text-white leading-none'
                                style={{
                                  backgroundColor: workspace.color ?? 'var(--brand-accent)',
                                }}
                              >
                                {initial}
                              </div>
                            )}
                            <input
                              ref={(el) => {
                                renameInputRef.current = el
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
                              className='w-full min-w-0 border-0 bg-transparent p-0 text-[var(--text-body)] text-sm outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
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
                              chipVariants({
                                active: isActive || isMenuOpen || isKeyboardHighlighted,
                                fullWidth: true,
                                flush: true,
                              }),
                              'select-none'
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
                            {workspace.logoUrl ? (
                              <img
                                src={workspace.logoUrl}
                                alt={workspace.name || 'Workspace logo'}
                                className='size-[16px] flex-shrink-0 rounded-sm object-cover'
                              />
                            ) : (
                              <div
                                className='flex size-[16px] flex-shrink-0 items-center justify-center rounded-sm font-medium text-[9px] text-white leading-none'
                                style={{
                                  backgroundColor: workspace.color ?? 'var(--brand-accent)',
                                }}
                              >
                                {initial}
                              </div>
                            )}
                            <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-sm'>
                              {workspace.name}
                            </span>
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
                                'flex size-[18px] flex-shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100',
                                isMenuOpen && 'opacity-100'
                              )}
                            >
                              <MoreHorizontal className='size-[14px] text-[var(--text-tertiary)]' />
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                <DropdownMenuSeparator className='mx-0' />

                <div className='flex flex-col gap-0.5'>
                  <DisabledReasonTooltip reason={createWorkspaceDisabledReason}>
                    <Chip
                      leftIcon={Plus}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!canCreateWorkspace) return
                        setIsWorkspaceMenuOpen(false)
                        setIsCreateModalOpen(true)
                      }}
                      disabled={isCreatingWorkspace}
                      aria-disabled={!canCreateWorkspace || undefined}
                      fullWidth
                      flush
                      className={cn(
                        'select-none',
                        !canCreateWorkspace &&
                          'cursor-not-allowed opacity-60 hover-hover:bg-transparent'
                      )}
                    >
                      New workspace
                    </Chip>
                  </DisabledReasonTooltip>
                </div>

                <DropdownMenuSeparator className='mx-0' />
                <DisabledReasonTooltip reason={inviteDisabledReason}>
                  <Chip
                    leftIcon={Send}
                    onClick={() => {
                      setIsWorkspaceMenuOpen(false)
                      if (isInvitationsDisabled) {
                        if (isBillingEnabled) navigateToSettings({ section: 'billing' })
                        return
                      }
                      setIsInviteModalOpen(true)
                    }}
                    fullWidth
                    flush
                    className='select-none'
                  >
                    Invite teammates
                  </Chip>
                </DisabledReasonTooltip>
                <DisabledReasonTooltip reason={inviteDisabledReason}>
                  <Chip
                    leftIcon={ManageWorkspace}
                    onClick={() => {
                      setIsWorkspaceMenuOpen(false)
                      if (isInvitationsDisabled) {
                        if (isBillingEnabled) navigateToSettings({ section: 'billing' })
                        return
                      }
                      navigateToSettings({ section: 'teammates' })
                    }}
                    fullWidth
                    flush
                    className='select-none'
                  >
                    Manage workspace
                  </Chip>
                </DisabledReasonTooltip>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <button
          type='button'
          aria-label='Switch workspace'
          className={cn(
            chipGeometryClass,
            'mx-0.5',
            isCollapsed ? 'flex' : 'inline-flex min-w-0 max-w-full'
          )}
          title={activeWorkspace?.name}
          disabled
        >
          {activeWorkspaceFull ? (
            activeWorkspaceFull.logoUrl ? (
              <img
                src={activeWorkspaceFull.logoUrl}
                alt={activeWorkspaceFull.name || 'Workspace logo'}
                className='size-[16px] flex-shrink-0 rounded-sm object-cover'
              />
            ) : (
              <div
                className='flex size-[16px] flex-shrink-0 items-center justify-center rounded-sm font-medium text-[9px] text-white leading-none'
                style={{ backgroundColor: activeWorkspaceFull.color ?? 'var(--brand-accent)' }}
              >
                {workspaceInitial}
              </div>
            )
          ) : (
            <Skeleton className='size-[16px] flex-shrink-0 rounded-sm' />
          )}
          {!isCollapsed && activeWorkspace?.name && (
            <>
              <span className='min-w-0 truncate text-[var(--text-body)] text-sm'>
                {activeWorkspace.name}
              </span>
              <ChevronDown className='h-[6px] w-[10px] flex-shrink-0 text-[var(--text-icon)]' />
            </>
          )}
        </button>
      )}

      {(() => {
        const capturedPermissions = capturedWorkspaceRef.current?.permissions
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
            renameInputRef={renameInputRef}
            onDelete={handleDeleteAction}
            onLeave={handleLeaveAction}
            onUploadLogo={handleUploadLogoAction}
            showRename={true}
            showUploadLogo={!!onUploadLogo}
            showLeave={!isOwner && !!onLeaveWorkspace}
            disableRename={!contextCanAdmin}
            disableDelete={!contextCanAdmin || workspaces.length <= 1}
            disableUploadLogo={!contextCanAdmin}
          />
        )
      })()}

      <CreateWorkspaceModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onConfirm={async (name) => {
          await onCreateWorkspace(name)
          setIsCreateModalOpen(false)
        }}
        isCreating={isCreatingWorkspace}
        target={createWorkspaceTarget}
      />

      <InviteModal
        open={isInviteModalOpen}
        onOpenChange={setIsInviteModalOpen}
        workspaceName={activeWorkspace?.name || 'Workspace'}
        inviteDisabledReason={inviteDisabledReason}
        organizationId={activeWorkspaceFull?.organizationId ?? null}
      />
      <DeleteModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteWorkspace}
        isDeleting={isDeletingWorkspace}
        itemType='workspace'
        itemName={deleteTarget?.name}
      />
      <ChipConfirmModal
        open={isLeaveModalOpen}
        onOpenChange={() => setIsLeaveModalOpen(false)}
        srTitle='Leave workspace'
        title='Leave workspace'
        text={[
          'Are you sure you want to leave ',
          { text: leaveTarget?.name ?? 'this workspace', bold: true },
          '? You will lose access to all workflows and data in this workspace. This action cannot be undone.',
        ]}
        confirm={{
          label: 'Leave workspace',
          onClick: handleLeaveWorkspace,
          pending: isLeavingWorkspace,
          pendingLabel: 'Leaving...',
        }}
      />
    </div>
  )
}

export const WorkspaceHeader = memo(WorkspaceHeaderImpl)
