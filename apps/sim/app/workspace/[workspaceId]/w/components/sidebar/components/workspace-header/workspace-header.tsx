'use client'

import { memo, type ReactElement, useEffect, useRef, useState } from 'react'
import {
  Chip,
  ChipChevronDown,
  ChipConfirmModal,
  ChipInput,
  chipContentLabelClass,
  chipGeometryClass,
  chipVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  OverflowText,
  Plus,
  Send,
  Skeleton,
  scrollFadeAttributes,
  scrollFadeClass,
  Tooltip,
  toast,
  useScrollEdges,
} from '@sim/emcn'
import { MoreHorizontal, PanelLeft, Pin, Search } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { getWorkspaceInitial } from '@/lib/workspaces/initials'
import { InviteModal } from '@/app/workspace/[workspaceId]/components/invite-modal'
import { useWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'
import { DeleteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/delete-modal/delete-modal'
import { CreateWorkspaceModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/create-workspace-modal/create-workspace-modal'
import { ViewInvitationsMenuItem } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/pending-invitations/view-invitations-menu-item'
import { ViewInvitationsModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/pending-invitations/view-invitations-modal'
import { SIDEBAR_RAIL_CHIP_CLASS } from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { invitationKeys } from '@/hooks/queries/invitations'
import {
  type Workspace,
  type WorkspaceCreationPolicy,
  workspaceKeys,
} from '@/hooks/queries/workspace'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

const logger = createLogger('WorkspaceHeader')

/**
 * Show the search input once the workspace list reaches this count, and size the
 * list viewport to exactly this many rows — so the sixth workspace is the one that
 * both fills the viewport and brings in search.
 *
 * The viewport's `max-h-[200px]` is derived from it: 6 rows at `chipGeometryClass`'s
 * 30px plus the 2px `gap-0.5` between them (6 * 30 + 5 * 2), plus the list's own
 * `pt-1.5 pb-1` (6 + 4) — the gaps to the search field and the rule, carried as
 * the scroll box's padding so rows scroll through them under the edge fade.
 * Tailwind arbitrary values must be statically analyzable, so the arithmetic
 * cannot live in the class — change them together.
 */
const WORKSPACE_SEARCH_THRESHOLD = 6

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
  /** List of available workspaces, already ordered pinned-first */
  workspaces: Workspace[]
  /** Ids of workspaces the viewer pinned to the top of the switcher */
  pinnedWorkspaceIds: ReadonlySet<string>
  /** Callback to toggle a workspace's pinned state */
  onToggleWorkspacePin: (workspaceId: string) => void
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
  pinnedWorkspaceIds,
  onToggleWorkspacePin,
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
  const { billingEnabled } = useDeploymentShape()
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
  const [isViewInvitationsOpen, setIsViewInvitationsOpen] = useState(false)
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
  /**
   * The row a context-menu action targets. Set alongside `menuOpenWorkspaceId` in
   * {@link openContextMenuAt}, but only that state re-renders — so anything the menu
   * *renders* must read the state, and only handlers may read this ref.
   */
  const capturedWorkspaceRef = useRef<Workspace | null>(null)
  /**
   * Set by context-menu actions whose result is only visible in the still-open
   * switcher — renaming (the inline input lives there) and pinning (the row moves
   * to the pinned group).
   */
  const keepWorkspaceMenuOpenRef = useRef(false)
  const isContextMenuOpeningRef = useRef(false)
  const contextMenuClosedRef = useRef(true)
  const hasInputFocusedRef = useRef(false)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const workspaceListRef = useRef<HTMLDivElement>(null)
  /**
   * Held in state as well as the ref: the list lives in the menu's portal, which
   * Radix mounts a commit after the menu opens, so the edge hook has to be handed
   * the element itself to pick it up.
   */
  const [workspaceListElement, setWorkspaceListElement] = useState<HTMLDivElement | null>(null)
  const listEdges = useScrollEdges(workspaceListElement)

  const [workspaceSearch, setWorkspaceSearch] = useState('')
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  /**
   * Which input the user is currently driving the list with. The highlight is only
   * painted in keyboard mode, because it renders in `--surface-active` — the same
   * token hover uses — so a highlight left behind by the pointer is indistinguishable
   * from a stuck hover, and sits alongside the equally-`--surface-active` current
   * workspace as a second phantom-hovered row.
   *
   * `highlightedId` itself still tracks the pointer, so Enter always targets the row
   * the user last touched; only whether it is *drawn* depends on the mode. Mirrors
   * `isKeyboardNav` in emcn's popover ("prevent dual highlights") and the single
   * modality-driven focus marker Headless UI's Combobox exposes.
   */
  const [isKeyboardNav, setIsKeyboardNav] = useState(false)

  const showSearch = workspaces.length >= WORKSPACE_SEARCH_THRESHOLD
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
    setIsKeyboardNav(false)
  }, [isWorkspaceMenuOpen])

  const [isMounted, setIsMounted] = useState(false)
  useEffect(() => {
    setIsMounted(true)
  }, [])

  const { navigateToSettings } = useSettingsNavigation()
  const queryClient = useQueryClient()

  const activeWorkspaceFull = workspaces.find((w) => w.id === workspaceId) || null
  const isWorkspaceReady = !isWorkspacesLoading && activeWorkspaceFull !== null
  const canCreateWorkspace = workspaceCreationPolicy?.canCreate ?? true
  const createWorkspaceDisabledReason =
    workspaceCreationPolicy?.canCreate === false ? workspaceCreationPolicy.reason : null
  const { isInvitationsDisabled: isInvitationsDisabledByConfig } = usePermissionConfig()
  /**
   * Only workspace admins can invite. The modal takes this as a prop, so each
   * entry point supplies it — the pre-consolidation modal derived it internally,
   * and omitting it here left the form fully enabled for non-admins until the
   * server refused the send.
   */
  const { userPermissions } = useWorkspacePermissionsContext()
  /**
   * Derived from the `workspaces` prop rather than {@link useWorkspaceInvitePolicy}:
   * this component is already handed the list it would otherwise re-read, and the
   * same object supplies the logo, color, and organization below.
   */
  const inviteDisabledReason = activeWorkspaceFull?.inviteDisabledReason ?? null
  const isInvitationsDisabled = isInvitationsDisabledByConfig || inviteDisabledReason !== null

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
    if (!keepWorkspaceMenuOpenRef.current && !isOpeningAnother) {
      setIsWorkspaceMenuOpen(false)
    }
    keepWorkspaceMenuOpenRef.current = false
  }

  /**
   * Handles rename action from context menu
   */
  const handleRenameAction = () => {
    if (!capturedWorkspaceRef.current) return

    keepWorkspaceMenuOpenRef.current = true
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

  const handleTogglePinAction = () => {
    const target = capturedWorkspaceRef.current
    if (!target) return
    keepWorkspaceMenuOpenRef.current = true
    onToggleWorkspacePin(target.id)
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
      /**
       * The endpoint refuses several standings it can explain — the billing
       * account, the last admin, a derived organization admin. Logging alone
       * left the confirm modal sitting open with no indication of why, so the
       * server's reason is surfaced the way the teammates list surfaces it.
       */
      toast.error("Couldn't leave workspace", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
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
        <Chip
          aria-label='Expand sidebar'
          onClick={onExpandSidebar}
          fullWidth
          className={SIDEBAR_RAIL_CHIP_CLASS}
          leftAdornment={
            <div className='relative flex size-[16px] shrink-0 items-center justify-center'>
              {activeWorkspace ? (
                <>
                  <IdentityTile
                    initial={workspaceInitial}
                    logoUrl={activeWorkspaceFull?.logoUrl}
                    alt={activeWorkspaceFull?.name || 'Workspace logo'}
                    className='group-hover:invisible'
                  />
                  <PanelLeft
                    aria-hidden
                    className='pointer-events-none invisible absolute inset-0 m-auto size-[16px] rotate-180 text-[var(--text-icon)] group-hover:visible'
                  />
                </>
              ) : (
                <Skeleton className='size-[16px] rounded-sm' />
              )}
            </div>
          }
        />
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
            if (open) {
              // Opening the switcher is the "user is looking" moment: refetch
              // stale server state so a workspace the user was auto-added to,
              // or a fresh pending invitation, appears without a page refresh
              // (these are app-wide queries with no focus refetch on the web).
              void queryClient.refetchQueries({ queryKey: workspaceKeys.lists(), stale: true })
              void queryClient.refetchQueries({ queryKey: invitationKeys.mine(), stale: true })
            }
            setIsWorkspaceMenuOpen(open)
            if (open && showSearch) {
              requestAnimationFrame(() => searchInputRef.current?.focus())
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <Chip
              aria-label='Switch workspace'
              className='min-w-0 max-w-full'
              onContextMenu={(e) => {
                if (activeWorkspaceFull) {
                  handleContextMenu(e, activeWorkspaceFull)
                }
              }}
              leftAdornment={
                <IdentityTile
                  initial={workspaceInitial}
                  logoUrl={activeWorkspaceFull.logoUrl}
                  alt={activeWorkspaceFull.name || 'Workspace logo'}
                />
              }
              rightAdornment={activeWorkspace?.name ? <ChipChevronDown /> : undefined}
            >
              {activeWorkspace?.name}
            </Chip>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align='start'
            side={isCollapsed ? 'right' : 'bottom'}
            sideOffset={isCollapsed ? 16 : 8}
            /* Overrides the 240px default cap so the six-row list is not clipped, but
               still bounded by the space Radix measured — at six rows the menu is tall
               enough that a short viewport would otherwise push the footer actions off
               screen with nothing able to scroll to them. */
            className='flex max-h-[var(--radix-dropdown-menu-content-available-height,400px)] w-64 max-w-[calc(100vw-24px)] flex-col overflow-y-auto'
          >
            {isWorkspacesLoading ? (
              <div className='px-2 py-[5px] text-[var(--text-secondary)] text-caption'>
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
                    onChange={(e) => {
                      // Typing is keyboard intent, so the cursor appears on the top
                      // result and Enter has a visible target.
                      setIsKeyboardNav(true)
                      setWorkspaceSearch(e.target.value)
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.nativeEvent.isComposing) return
                      if (filteredWorkspaces.length === 0) return
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        setIsKeyboardNav(true)
                        const next = (activeIndex + 1) % filteredWorkspaces.length
                        setHighlightedId(filteredWorkspaces[next].id)
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        setIsKeyboardNav(true)
                        const next =
                          (activeIndex - 1 + filteredWorkspaces.length) % filteredWorkspaces.length
                        setHighlightedId(filteredWorkspaces[next].id)
                      } else if (e.key === 'Enter') {
                        // Only armed once a cursor is actually on screen. The search
                        // field is focused on open, so acting on the seeded row here
                        // would switch workspace with nothing marked — emcn's popover
                        // likewise holds its selection at -1 until keyboard nav starts.
                        if (!isKeyboardNav) return
                        e.preventDefault()
                        const target = filteredWorkspaces[activeIndex]
                        if (target) onWorkspaceSwitch(target)
                      }
                    }}
                  />
                )}
                {/** The list owns the gap below search, when shown, and above the separator. */}
                <div
                  ref={(node) => {
                    workspaceListRef.current = node
                    setWorkspaceListElement(node)
                  }}
                  className={cn(
                    scrollFadeClass,
                    '-mx-1.5 flex max-h-[200px] flex-col gap-0.5 overflow-y-auto px-1.5 pb-1',
                    showSearch && 'pt-1.5'
                  )}
                  {...scrollFadeAttributes(listEdges)}
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
                    const isKeyboardHighlighted = showSearch && isKeyboardNav && idx === activeIndex

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
                        onMouseMove={
                          showSearch
                            ? () => {
                                setIsKeyboardNav(false)
                                setHighlightedId(workspace.id)
                              }
                            : undefined
                        }
                      >
                        {editingWorkspaceId === workspace.id ? (
                          <div className={chipVariants({ active: true, fullWidth: true })}>
                            <IdentityTile
                              initial={initial}
                              logoUrl={workspace.logoUrl}
                              alt={workspace.name || 'Workspace logo'}
                            />
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
                              className='w-full min-w-0 border-0 bg-transparent p-0 text-[var(--text-body)] text-sm outline-hidden focus:outline-hidden focus:ring-0 focus-visible:outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0'
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
                              }),
                              'select-none'
                            )}
                            onClick={(e) => {
                              if (e.metaKey || e.ctrlKey) {
                                window.open(`/workspace/${workspace.id}`, '_blank')
                                return
                              }
                              onWorkspaceSwitch(workspace)
                            }}
                            onAuxClick={(e) => {
                              if (e.button === 1) {
                                e.preventDefault()
                                window.open(`/workspace/${workspace.id}`, '_blank')
                              }
                            }}
                            onContextMenu={(e) => handleContextMenu(e, workspace)}
                          >
                            <IdentityTile
                              initial={initial}
                              logoUrl={workspace.logoUrl}
                              alt={workspace.name || 'Workspace logo'}
                            />
                            <OverflowText
                              label={workspace.name}
                              className='flex-1 text-[var(--text-body)] text-sm'
                            />
                            {/* Pin and options share one fixed slot, as the chat rows do:
                                the trailing width never changes, so pinning cannot re-truncate
                                the name under the user's cursor. */}
                            <div className='relative flex size-[18px] shrink-0 items-center justify-center'>
                              {pinnedWorkspaceIds.has(workspace.id) && (
                                <Pin
                                  aria-hidden={false}
                                  role='img'
                                  aria-label='Pinned'
                                  className={cn(
                                    'absolute size-[12px] text-[var(--text-icon)] transition-opacity',
                                    isMenuOpen ? 'opacity-0' : 'group-hover:opacity-0'
                                  )}
                                />
                              )}
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
                                  'absolute inset-0 flex items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100',
                                  isMenuOpen && 'opacity-100'
                                )}
                              >
                                <MoreHorizontal className='size-[14px] text-[var(--text-icon)]' />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                <DropdownMenuSeparator className='mx-0 mt-0' />

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
                      className={cn(
                        'select-none',
                        !canCreateWorkspace &&
                          'cursor-not-allowed opacity-60 hover-hover:bg-transparent'
                      )}
                    >
                      New workspace
                    </Chip>
                  </DisabledReasonTooltip>
                  {userPermissions.canAdmin && (
                    <DisabledReasonTooltip reason={inviteDisabledReason}>
                      <Chip
                        leftIcon={Send}
                        onClick={() => {
                          setIsWorkspaceMenuOpen(false)
                          if (isInvitationsDisabled) {
                            if (billingEnabled) navigateToSettings({ section: 'billing' })
                            return
                          }
                          setIsInviteModalOpen(true)
                        }}
                        fullWidth
                        className='select-none'
                      >
                        Invite teammates
                      </Chip>
                    </DisabledReasonTooltip>
                  )}
                  <ViewInvitationsMenuItem
                    onOpen={() => {
                      setIsWorkspaceMenuOpen(false)
                      setIsViewInvitationsOpen(true)
                    }}
                  />
                </div>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <button
          type='button'
          aria-label='Switch workspace'
          /* Geometry must match the live trigger it stands in for, or the switcher
             shifts when the workspace resolves. Chips carry no margin, so neither
             does this. */
          className={cn(chipGeometryClass, isCollapsed ? 'flex' : 'inline-flex min-w-0 max-w-full')}
          disabled
        >
          {activeWorkspace ? (
            <IdentityTile
              initial={workspaceInitial}
              logoUrl={activeWorkspaceFull?.logoUrl}
              alt={activeWorkspaceFull?.name || 'Workspace logo'}
            />
          ) : (
            <Skeleton className='size-[16px] shrink-0 rounded-sm' />
          )}
          {!isCollapsed && activeWorkspace?.name && (
            <>
              <OverflowText
                label={activeWorkspace.name}
                className={cn('flex-1', chipContentLabelClass)}
                focusTarget='nearest-interactive'
              />
              <ChipChevronDown />
            </>
          )}
        </button>
      )}

      {(() => {
        const capturedPermissions = capturedWorkspaceRef.current?.permissions
        const contextCanAdmin = capturedPermissions === 'admin'
        const capturedWorkspace = workspaces.find((w) => w.id === capturedWorkspaceRef.current?.id)
        const isOwner = capturedWorkspace && sessionUserId === capturedWorkspace.ownerId
        /**
         * An organization admin holds this workspace through their org role, not
         * a permission row, so there is nothing to give up and the removal
         * endpoint refuses it. `permissions === 'admin'` cannot tell them apart
         * from an explicit workspace admin, who may leave. This menu has no
         * tooltip affordance to explain a greyed row, so the entry is withheld
         * rather than shown dead.
         */
        const canLeave = !isOwner && !capturedWorkspace?.isOrgAdmin && !!onLeaveWorkspace

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
            onTogglePin={handleTogglePinAction}
            onUploadLogo={handleUploadLogoAction}
            showPin={true}
            isPinned={Boolean(menuOpenWorkspaceId && pinnedWorkspaceIds.has(menuOpenWorkspaceId))}
            showRename={true}
            showUploadLogo={!!onUploadLogo}
            showLeave={canLeave}
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
      />

      <InviteModal
        open={isInviteModalOpen}
        onOpenChange={setIsInviteModalOpen}
        workspaceId={workspaceId}
        workspaceName={activeWorkspace?.name || 'Workspace'}
        inviteDisabledReason={inviteDisabledReason}
        organizationId={activeWorkspaceFull?.organizationId ?? null}
        canInvite={userPermissions.canAdmin}
      />
      <ViewInvitationsModal open={isViewInvitationsOpen} onOpenChange={setIsViewInvitationsOpen} />
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
