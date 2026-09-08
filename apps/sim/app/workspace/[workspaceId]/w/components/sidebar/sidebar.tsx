'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Chip,
  chipVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FolderPlus,
  Home,
  Library,
  Loader,
  OverflowText,
  Skeleton,
  scrollFadeAttributes,
  scrollFadeClass,
  Tooltip,
  Upload,
  useScrollEdges,
} from '@sim/emcn'
import {
  Database,
  Files,
  Integration,
  MoreHorizontal,
  PanelLeft,
  Pin,
  Plus,
  Search,
  Table,
  Task,
  Workflow,
} from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { useSession } from '@/lib/auth/auth-client'
import { focusVisibleBrowserOmnibox } from '@/lib/browser-agent/renderer-shortcuts'
import { SIM_RESOURCES_DRAG_TYPE } from '@/lib/copilot/resource-types'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { isStatusNoticePreviewEnabled } from '@/lib/core/config/env-flags'
import { isMacPlatform } from '@/lib/core/utils/platform'
import { buildFolderTree, getFolderPathNames } from '@/lib/folders/tree'
import { DOCS_URL, SLACK_COMMUNITY_URL } from '@/lib/help-links'
import { captureEvent } from '@/lib/posthog/client'
import { useSidebarChrome } from '@/app/workspace/[workspaceId]/components/workspace-chrome'
import { CONNECT_MODE } from '@/app/workspace/[workspaceId]/integrations/connect-route'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import {
  ChatNavigationLink,
  CollapsedChatFlyoutItem,
  CollapsedFolderItems,
  CollapsedSidebarMenu,
  CollapsedWorkflowFlyoutItem,
  FilesRailFlyout,
  HelpModal,
  isNavItemActive,
  NavItemContextMenu,
  SearchModal,
  SettingsSidebar,
  SidebarFooter,
  SidebarNavChip,
  type SidebarNavItemData,
  SidebarSection,
  SidebarTooltip,
  StatusNotice,
  TablesRailFlyout,
  WorkflowList,
  WorkspaceHeader,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import {
  buildConnectedAccountSearchItems,
  buildIntegrationSearchItems,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/integration-search-items'
import type {
  LogItem,
  PageActionContext,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'
import { DeleteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/delete-modal/delete-modal'
import {
  SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
  SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
  SIDEBAR_ITEM_GAP_CLASS,
  SIDEBAR_SECTION_GAP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import {
  useChatSelection,
  useFlyoutInlineRename,
  useFolderOperations,
  useHoverMenu,
  useSidebarResize,
  useWorkflowOperations,
  useWorkspaceLogoUpload,
  useWorkspaceManagement,
  useWorkspaceWorkflowsRoom,
  WORKSPACE_LOGO_ACCEPT_ATTRIBUTE,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import {
  compareByOrder,
  createSidebarDragGhost,
  groupWorkflowsByFolder,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/utils'
import { useImportWorkflow } from '@/app/workspace/[workspaceId]/w/hooks'
import { useCustomBlockOverlayVersion } from '@/blocks/custom/client-overlay'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useFolderMap, useFolders } from '@/hooks/queries/folders'
import { type LogFilters, useLogsList } from '@/hooks/queries/logs'
import type { MothershipChatMetadata } from '@/hooks/queries/mothership-chats'
import {
  useDeleteMothershipChat,
  useDeleteMothershipChats,
  useMarkMothershipChatRead,
  useMarkMothershipChatUnread,
  useMothershipChats,
  useRenameMothershipChat,
  useSetMothershipChatPinned,
} from '@/hooks/queries/mothership-chats'
import { useUpdateWorkflow } from '@/hooks/queries/workflows'
import type { Workspace } from '@/hooks/queries/workspace'
import { useContextMenu } from '@/hooks/use-context-menu'
import { useMothershipChatEvents } from '@/hooks/use-mothership-chat-events'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { useFolderStore } from '@/stores/folders/store'
import type { WorkflowFolder } from '@/stores/folders/types'
import { useFilterStore } from '@/stores/logs/filters/store'
import { useSearchModalStore } from '@/stores/modals/search/store'
import { useProvidersStore } from '@/stores/providers'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'
import { useSidebarStore } from '@/stores/sidebar/store'

const logger = createLogger('Sidebar')

/**
 * Stable identity for the chat list's "no data" case. With Chat disabled the
 * query never runs, so a `= []` default would mint a new array every render and
 * invalidate every memo downstream of it.
 */
const EMPTY_CHATS: MothershipChatMetadata[] = []
/** Stable identity while a folder list loads, so the search-row memos don't churn. */
const EMPTY_FOLDER_MAP: Record<string, WorkflowFolder> = {}

/** Recent runs shown in the palette's Logs section on the logs pages. */
const SEARCH_MODAL_LOG_FILTERS: LogFilters = {
  timeRange: 'All time',
  level: 'all',
  workflowIds: [],
  folderIds: [],
  triggers: [],
  searchQuery: '',
  limit: 50,
  sortBy: 'date',
  sortOrder: 'desc',
}

/** Short run/activity date for palette row receipts (logs, chats). */
const SEARCH_MODAL_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/** Stands in for a chip row while a list loads, so it carries no margin either. */
function SidebarItemSkeleton() {
  return (
    <div className='sidebar-collapse-hide flex h-[30px] items-center gap-2 rounded-lg px-2'>
      <Skeleton className='h-[16px] w-[16px] shrink-0 rounded-sm' />
    </div>
  )
}

const SidebarChatItem = memo(function SidebarChatItem({
  chat,
  isCurrentRoute,
  isSelected,
  isActive,
  isUnread,
  isPinned,
  isMenuOpen,
  showCollapsedTooltips,
  onMultiSelectClick,
  onContextMenu,
  onMorePointerDown,
  onMoreClick,
}: {
  chat: { id: string; href: string; name: string }
  isCurrentRoute: boolean
  isSelected: boolean
  isActive: boolean
  isUnread: boolean
  isPinned: boolean
  isMenuOpen: boolean
  showCollapsedTooltips: boolean
  onMultiSelectClick: (chatId: string, shiftKey: boolean) => void
  onContextMenu: (e: React.MouseEvent, chatId: string) => void
  onMorePointerDown: () => void
  onMoreClick: (e: React.MouseEvent<HTMLButtonElement>, chatId: string) => void
}) {
  const dragGhostRef = useRef<HTMLElement | null>(null)

  /**
   * The trailing slot fits one glyph, and the dot wins over the pin: it reports
   * transient state (a run in progress, or an unread reply elsewhere), while pinning
   * is persistent and already conveyed by the row sorting to the top of the list.
   */
  const showStatusDot = isActive || (!isCurrentRoute && isUnread)

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData(
      SIM_RESOURCES_DRAG_TYPE,
      JSON.stringify([{ type: 'task', id: chat.id, title: chat.name }])
    )
    const ghost = createSidebarDragGhost(chat.name, { kind: 'task' })
    void ghost.offsetHeight
    e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2)
    dragGhostRef.current = ghost
  }

  function handleDragEnd() {
    if (dragGhostRef.current) {
      dragGhostRef.current.remove()
      dragGhostRef.current = null
    }
  }

  return (
    <SidebarTooltip label={chat.name} enabled={showCollapsedTooltips}>
      <ChatNavigationLink
        chatId={chat.id}
        href={chat.href}
        isCurrentRoute={isCurrentRoute}
        className={chipVariants({
          active: isCurrentRoute || isSelected || isMenuOpen,
          fullWidth: true,
        })}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) return
          if (e.shiftKey) {
            e.preventDefault()
            onMultiSelectClick(chat.id, true)
          } else {
            useFolderStore.getState().selectChatOnly(chat.id)
          }
        }}
        onContextMenu={(e) => onContextMenu(e, chat.id)}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <OverflowText label={chat.name} className='flex-1 text-[var(--text-body)]' />
        {chat.id !== 'new' && (
          <div className='relative flex size-[18px] shrink-0 items-center justify-center'>
            {showStatusDot && (
              <span
                aria-hidden='true'
                className={cn(
                  'size-[6px] rounded-full transition-opacity',
                  isMenuOpen ? 'opacity-0' : 'group-hover:opacity-0'
                )}
                style={{
                  backgroundColor: isActive ? '#EAB308' : 'var(--brand-accent)',
                }}
              />
            )}
            {!showStatusDot && isPinned && (
              <Pin
                aria-hidden='true'
                className={cn(
                  'absolute size-[12px] text-[var(--text-icon)] transition-opacity',
                  isMenuOpen ? 'opacity-0' : 'group-hover:opacity-0'
                )}
              />
            )}
            <button
              type='button'
              aria-label='Chat options'
              onPointerDown={onMorePointerDown}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onMoreClick(e, chat.id)
              }}
              className={cn(
                'absolute inset-0 flex items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100',
                isMenuOpen && 'opacity-100'
              )}
            >
              <MoreHorizontal className='size-[14px] text-[var(--text-icon)]' />
            </button>
          </div>
        )}
      </ChatNavigationLink>
    </SidebarTooltip>
  )
})

const SidebarNavItem = memo(function SidebarNavItem({
  item,
  active,
  showCollapsedTooltips,
  onContextMenu,
}: {
  item: SidebarNavItemData
  active: boolean
  showCollapsedTooltips: boolean
  onContextMenu?: (e: React.MouseEvent, href: string) => void
}) {
  if (!item.href && !item.onClick) return null

  return (
    <SidebarTooltip label={item.label} enabled={showCollapsedTooltips}>
      <SidebarNavChip
        item={item}
        active={active}
        onContextMenu={
          onContextMenu && item.href ? (e) => onContextMenu(e, item.href as string) : undefined
        }
      />
    </SidebarTooltip>
  )
})

/** Event name for sidebar scroll operations - centralized for consistency */
export const SIDEBAR_SCROLL_EVENT = 'sidebar-scroll-to-item'

const HIDDEN_STYLE = { display: 'none' } as const

/**
 * Opts a control out of the desktop shell's window-drag region. The header row is
 * draggable chrome, so anything clickable inside it has to say so or the click is
 * swallowed by the drag handler.
 */
const DRAG_EXEMPT_CLASS = '[-webkit-app-region:no-drag]'

/**
 * Sidebar component with resizable width that persists across page refreshes.
 *
 * Uses a CSS-based approach to prevent hydration mismatches:
 * 1. Dimensions are controlled by CSS variables (--sidebar-width)
 * 2. Blocking script in layout.tsx sets CSS variables before React hydrates
 * 3. Store updates CSS variables when dimensions change
 *
 * This ensures server and client render identical HTML, preventing hydration errors.
 *
 * Collapse and peek state come from the hosting chrome through
 * {@link useSidebarChrome}; the peek card always renders the expanded layout,
 * whatever the rail's state.
 *
 * @returns Sidebar with workflows panel
 */
export const Sidebar = memo(function Sidebar() {
  const { isCollapsed: isCollapsedProp, isPeeking } = useSidebarChrome()
  const isCollapsed = isCollapsedProp && !isPeeking
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const workflowId = params.workflowId as string | undefined
  const router = useRouter()
  const pathname = usePathname()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)

  const posthog = usePostHog()
  const { data: sessionData, isPending: sessionLoading } = useSession()
  const { workspace: routeWorkspace } = useWorkspaceHostContext()
  const { hosted, chatEnabled } = useDeploymentShape()
  const { canAdmin, canEdit, isLoading: permissionsLoading } = useUserPermissionsContext()
  const {
    config: permissionConfig,
    filterBlocks,
    isBlockAllowed,
    isToolAllowed,
    integrationAvailability,
  } = usePermissionConfig()
  const { getSettingsHref, navigateToSettings } = useSettingsNavigation()
  const initializeSearchData = useSearchModalStore((state) => state.initializeData)
  const customBlockOverlayVersion = useCustomBlockOverlayVersion()
  const providers = useProvidersStore((state) => state.providers)
  const providerModelSignature = useMemo(
    () =>
      Object.values(providers)
        .map((provider) => provider.models.join('\x00'))
        .join('\x01'),
    [providers]
  )

  useEffect(() => {
    initializeSearchData(filterBlocks, isToolAllowed)
  }, [
    initializeSearchData,
    filterBlocks,
    isToolAllowed,
    providerModelSignature,
    customBlockOverlayVersion,
  ])

  const setSidebarWidth = useSidebarStore((state) => state.setSidebarWidth)
  const toggleCollapsed = useSidebarStore((state) => state.toggleCollapsed)
  const isOnWorkflowPage = !!workflowId

  const isCollapsedRef = useRef(isCollapsed)
  useLayoutEffect(() => {
    isCollapsedRef.current = isCollapsed
  }, [isCollapsed])

  const isMac = isMacPlatform()

  const [showCollapsedTooltips, setShowCollapsedTooltips] = useState(isCollapsed)

  useEffect(() => {
    if (isCollapsed) {
      const timer = setTimeout(() => setShowCollapsedTooltips(true), 200)
      return () => clearTimeout(timer)
    }
    setShowCollapsedTooltips(false)
  }, [isCollapsed])

  const { isImporting, handleFileChange: handleImportFileChange } = useImportWorkflow({
    workspaceId,
  })

  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false)
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false)

  /** Listens for external events to open help modal */
  useEffect(() => {
    const handleOpenHelpModal = () => setIsHelpModalOpen(true)
    window.addEventListener('open-help-modal', handleOpenHelpModal)
    return () => window.removeEventListener('open-help-modal', handleOpenHelpModal)
  }, [])

  /** Listens for scroll events and scrolls items into view if off-screen */
  useEffect(() => {
    const handleScrollToItem = (e: CustomEvent<{ itemId: string }>) => {
      const { itemId } = e.detail
      if (!itemId) return

      const tryScroll = (retriesLeft: number) => {
        requestAnimationFrame(() => {
          const element = document.querySelector(`[data-item-id="${itemId}"]`)
          const container = scrollContainerRef.current

          if (!element || !container) {
            if (retriesLeft > 0) tryScroll(retriesLeft - 1)
            return
          }

          const { top: elTop, bottom: elBottom } = element.getBoundingClientRect()
          const { top: ctTop, bottom: ctBottom } = container.getBoundingClientRect()

          if (elBottom <= ctTop || elTop >= ctBottom) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        })
      }

      tryScroll(10)
    }
    window.addEventListener(SIDEBAR_SCROLL_EVENT, handleScrollToItem as EventListener)
    return () =>
      window.removeEventListener(SIDEBAR_SCROLL_EVENT, handleScrollToItem as EventListener)
  }, [])

  const isSearchModalOpen = useSearchModalStore((state) => state.isOpen)
  const setIsSearchModalOpen = useSearchModalStore((state) => state.setOpen)
  const openSearchModal = useSearchModalStore((state) => state.open)

  const {
    workspaces,
    pinnedWorkspaceIds,
    toggleWorkspacePin,
    workspaceCreationPolicy,
    activeWorkspace,
    isWorkspacesLoading,
    switchWorkspace,
    handleCreateWorkspace,
    isCreatingWorkspace,
    isDeletingWorkspace,
    isLeavingWorkspace,
    updateWorkspace,
    confirmDeleteWorkspace,
    handleLeaveWorkspace,
  } = useWorkspaceManagement({
    workspaceId,
    sessionUserId: sessionData?.user?.id,
  })

  const activeWorkspaceFull = workspaces.find((w) => w.id === workspaceId)
  const logoTargetWorkspaceIdRef = useRef<string>(workspaceId)

  const {
    fileInputRef: logoFileInputRef,
    handleFileChange: handleLogoFileChange,
    setTargetWorkspaceId: setLogoTargetWorkspaceId,
  } = useWorkspaceLogoUpload({
    workspaceId,
    currentLogoUrl: activeWorkspaceFull?.logoUrl,
    onUpload: (url) => {
      updateWorkspace(logoTargetWorkspaceIdRef.current, { logoUrl: url })
    },
    onError: (error) => {
      logger.error('Workspace logo upload error:', error)
    },
  })

  const { handlePointerDown } = useSidebarResize()

  const {
    regularWorkflows,
    workflowsLoading,
    isCreatingWorkflow,
    handleCreateWorkflow: createWorkflow,
  } = useWorkflowOperations({ workspaceId })

  const { isCreatingFolder, handleCreateFolder: createFolder } = useFolderOperations({
    workspaceId,
  })

  useFolders(workspaceId)
  useWorkspaceWorkflowsRoom(workspaceId)
  const { data: folderMap = EMPTY_FOLDER_MAP } = useFolderMap(workspaceId)
  const updateWorkflowMutation = useUpdateWorkflow()

  const folderTree = useMemo(
    () => (isCollapsed && workspaceId ? buildFolderTree(folderMap, workspaceId) : []),
    [isCollapsed, workspaceId, folderMap]
  )

  const workflowsByFolder = useMemo(
    () => (isCollapsed ? groupWorkflowsByFolder(regularWorkflows) : {}),
    [isCollapsed, regularWorkflows]
  )

  const collapsedRootItems = useMemo(() => {
    type RootItem =
      | {
          kind: 'folder'
          sortOrder: number
          createdAt?: Date
          id: string
          node: (typeof folderTree)[number]
        }
      | {
          kind: 'workflow'
          sortOrder: number
          createdAt?: Date
          id: string
          workflow: (typeof regularWorkflows)[number]
        }
    const items: RootItem[] = [
      ...folderTree.map((node) => ({
        kind: 'folder' as const,
        sortOrder: node.sortOrder,
        createdAt: node.createdAt,
        id: node.id,
        node,
      })),
      ...(workflowsByFolder.root ?? []).map((w) => ({
        kind: 'workflow' as const,
        sortOrder: w.sortOrder,
        createdAt: w.createdAt,
        id: w.id,
        workflow: w,
      })),
    ]
    items.sort(compareByOrder)
    return items
  }, [folderTree, workflowsByFolder])

  const [activeNavItemHref, setActiveNavItemHref] = useState<string | null>(null)
  const {
    isOpen: isNavContextMenuOpen,
    position: navContextMenuPosition,
    menuRef: navMenuRef,
    handleContextMenu: handleNavContextMenuBase,
    closeMenu: closeNavContextMenu,
  } = useContextMenu()

  const handleNavItemContextMenu = useCallback(
    (e: React.MouseEvent, href: string) => {
      setActiveNavItemHref(href)
      handleNavContextMenuBase(e)
    },
    [handleNavContextMenuBase]
  )

  const handleNavContextMenuClose = useCallback(() => {
    closeNavContextMenu()
    setActiveNavItemHref(null)
  }, [closeNavContextMenu])

  const handleNavOpenInNewTab = useCallback(() => {
    if (activeNavItemHref) {
      window.open(activeNavItemHref, '_blank', 'noopener,noreferrer')
    }
  }, [activeNavItemHref])

  const handleNavCopyLink = useCallback(async () => {
    if (activeNavItemHref) {
      const fullUrl = `${window.location.origin}${activeNavItemHref}`
      try {
        await navigator.clipboard.writeText(fullUrl)
      } catch (error) {
        logger.error('Failed to copy link to clipboard', { error })
      }
    }
  }, [activeNavItemHref])

  const deleteChatMutation = useDeleteMothershipChat(workspaceId)
  const deleteChatsMutation = useDeleteMothershipChats(workspaceId)
  const markChatReadMutation = useMarkMothershipChatRead(workspaceId)
  const markChatUnreadMutation = useMarkMothershipChatUnread(workspaceId)
  const renameChatMutation = useRenameMothershipChat(workspaceId)
  const setChatPinnedMutation = useSetMothershipChatPinned(workspaceId)
  const chatsHover = useHoverMenu()
  const workflowsHover = useHoverMenu()
  const tablesHover = useHoverMenu()
  const filesHover = useHoverMenu()

  const {
    isOpen: isChatContextMenuOpen,
    position: chatContextMenuPosition,
    menuRef: chatMenuRef,
    handleContextMenu: handleChatContextMenuBase,
    closeMenu: closeChatContextMenu,
    preventDismiss: preventChatDismiss,
  } = useContextMenu()

  const contextMenuSelectionRef = useRef<{ chatIds: string[]; names: string[] }>({
    chatIds: [],
    names: [],
  })
  const [menuOpenChatId, setMenuOpenChatId] = useState<string | null>(null)

  useEffect(() => {
    if (!isChatContextMenuOpen) setMenuOpenChatId(null)
  }, [isChatContextMenuOpen])

  const captureChatSelection = useCallback((chatId: string) => {
    const { selectedChats, selectChatOnly } = useFolderStore.getState()
    if (selectedChats.size > 0 && selectedChats.has(chatId)) {
      contextMenuSelectionRef.current = {
        chatIds: Array.from(selectedChats),
        names: [],
      }
    } else {
      selectChatOnly(chatId)
      contextMenuSelectionRef.current = { chatIds: [chatId], names: [] }
    }
  }, [])

  const handleChatContextMenu = useCallback(
    (e: React.MouseEvent, chatId: string) => {
      captureChatSelection(chatId)
      setMenuOpenChatId(chatId)
      chatsHover.setLocked(true)
      preventChatDismiss()
      handleChatContextMenuBase(e)
    },
    [captureChatSelection, handleChatContextMenuBase, preventChatDismiss, chatsHover]
  )

  const handleChatMorePointerDown = useCallback(() => {
    if (isChatContextMenuOpen) {
      preventChatDismiss()
    }
  }, [isChatContextMenuOpen, preventChatDismiss])

  const handleChatMoreClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, chatId: string) => {
      if (isChatContextMenuOpen) {
        closeChatContextMenu()
        return
      }
      chatsHover.setLocked(true)
      captureChatSelection(chatId)
      setMenuOpenChatId(chatId)
      const rect = e.currentTarget.getBoundingClientRect()
      handleChatContextMenuBase({
        preventDefault: () => {},
        stopPropagation: () => {},
        clientX: rect.right,
        clientY: rect.top,
      } as React.MouseEvent)
    },
    [
      isChatContextMenuOpen,
      closeChatContextMenu,
      captureChatSelection,
      handleChatContextMenuBase,
      chatsHover,
    ]
  )

  const searchModalWorkflows = useMemo(
    () =>
      regularWorkflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        href: `/workspace/${workspaceId}/w/${workflow.id}`,
        folderPath: getFolderPathNames(folderMap, workflow.folderId),
        isCurrent: workflow.id === workflowId,
      })),
    [regularWorkflows, folderMap, workspaceId, workflowId]
  )

  const searchModalWorkspaces = useMemo(
    () =>
      workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        href: `/workspace/${workspace.id}/w`,
        isCurrent: workspace.id === workspaceId,
        logoUrl: workspace.logoUrl,
      })),
    [workspaces, workspaceId]
  )

  const topNavItems = useMemo(
    () =>
      [
        {
          id: 'home',
          label: chatEnabled ? 'New chat' : 'New workflow',
          icon: chatEnabled ? Home : Plus,
          href: chatEnabled ? `/workspace/${workspaceId}/home` : undefined,
          onClick: chatEnabled ? undefined : createWorkflow,
          // Creation navigates optimistically, so a read-only member would land
          // on a workflow the server declined to create.
          hidden: !chatEnabled && !permissionsLoading && !canEdit,
        },
        {
          id: 'integrations',
          label: 'Integrations',
          icon: Integration,
          href: `/workspace/${workspaceId}/integrations`,
          /* Skills and Search are tabs of this surface, not their own nav items —
             keep the entry lit while the user is on either. */
          additionalActivePaths: [
            `/workspace/${workspaceId}/skills`,
            `/workspace/${workspaceId}/search`,
          ],
          hidden: permissionConfig.hideIntegrationsTab,
        },
      ].filter((item) => !item.hidden),
    [
      workspaceId,
      createWorkflow,
      canEdit,
      permissionsLoading,
      permissionConfig.hideIntegrationsTab,
      chatEnabled,
    ]
  )

  const workspaceNavItems = useMemo(
    () =>
      [
        {
          id: 'tables',
          label: 'Tables',
          icon: Table,
          href: `/workspace/${workspaceId}/tables`,
          hidden: permissionConfig.hideTablesTab,
        },
        {
          id: 'files',
          label: 'Files',
          icon: Files,
          href: `/workspace/${workspaceId}/files`,
          hidden: permissionConfig.hideFilesTab,
        },
        {
          id: 'knowledge-base',
          label: 'Knowledge bases',
          icon: Database,
          href: `/workspace/${workspaceId}/knowledge`,
          hidden: permissionConfig.hideKnowledgeBaseTab,
        },
        {
          id: 'logs',
          label: 'Logs',
          icon: Library,
          href: `/workspace/${workspaceId}/logs`,
        },
      ].filter((item) => !item.hidden),
    [
      workspaceId,
      permissionConfig.hideFilesTab,
      permissionConfig.hideKnowledgeBaseTab,
      permissionConfig.hideTablesTab,
    ]
  )

  /**
   * Rail flyouts by nav id; a nav item without one stays a plain link. Each element is only
   * built here — Radix mounts menu content on open, so the flyout's queries do not run (and
   * do not subscribe) until the user actually hovers the chip.
   */
  const railFlyouts: Record<
    string,
    { hover: ReturnType<typeof useHoverMenu>; content: React.ReactNode } | undefined
  > = {
    tables: { hover: tablesHover, content: <TablesRailFlyout workspaceId={workspaceId} /> },
    files: { hover: filesHover, content: <FilesRailFlyout workspaceId={workspaceId} /> },
  }

  const handleOpenSettings = (section: SettingsSection) => {
    if (!isCollapsedRef.current) {
      setSidebarWidth(SIDEBAR_WIDTH.MIN)
    }
    navigateToSettings({ section })
  }

  const { data: fetchedChats = EMPTY_CHATS, isLoading: chatsLoading } = useMothershipChats(
    workspaceId,
    { enabled: chatEnabled }
  )

  useMothershipChatEvents(workspaceId)

  /**
   * Stays empty when Chat is disabled, which also drops the command palette's
   * Chats group — `SearchGroups` renders nothing for an empty list.
   */
  const chats = useMemo(
    () =>
      fetchedChats.map((t) => ({
        ...t,
        href: `/workspace/${workspaceId}/chat/${t.id}`,
        date: SEARCH_MODAL_DATE_FORMAT.format(t.updatedAt),
      })),
    [fetchedChats, workspaceId]
  )

  const chatIds = useMemo(() => chats.map((t) => t.id), [chats])

  const { selectedChats, handleChatClick } = useChatSelection({ chatIds })
  const hasChatMultiSelection = selectedChats.size > 1

  const isMultiChatContextMenu = contextMenuSelectionRef.current.chatIds.length > 1
  const activeChatContextMenuItem =
    !isMultiChatContextMenu && contextMenuSelectionRef.current.chatIds.length === 1
      ? chats.find((chat) => chat.id === contextMenuSelectionRef.current.chatIds[0])
      : null

  const [isChatDeleteModalOpen, setIsChatDeleteModalOpen] = useState(false)

  const handleDeleteChat = useCallback(() => {
    const { chatIds: ids } = contextMenuSelectionRef.current
    if (ids.length === 0) return
    const names = ids.map((id) => chats.find((t) => t.id === id)?.name).filter(Boolean) as string[]
    contextMenuSelectionRef.current = { chatIds: ids, names }
    setIsChatDeleteModalOpen(true)
  }, [chats])

  const navigateToPage = useCallback(
    (path: string) => {
      if (!isCollapsedRef.current) {
        setSidebarWidth(SIDEBAR_WIDTH.MIN)
      }
      router.push(path)
    },
    [setSidebarWidth, router]
  )

  const handleConfirmDeleteChats = () => {
    const { chatIds: chatIdsToDelete } = contextMenuSelectionRef.current
    if (chatIdsToDelete.length === 0) return

    const currentPath = pathname ?? ''
    const isViewingDeletedChat = chatIdsToDelete.some(
      (id) => currentPath === `/workspace/${workspaceId}/chat/${id}`
    )

    const onDeleteSuccess = () => {
      useFolderStore.getState().clearChatSelection()
      if (isViewingDeletedChat) {
        navigateToPage(`/workspace/${workspaceId}/home`)
      }
    }

    if (chatIdsToDelete.length === 1) {
      deleteChatMutation.mutate(chatIdsToDelete[0], { onSuccess: onDeleteSuccess })
    } else {
      deleteChatsMutation.mutate(chatIdsToDelete, { onSuccess: onDeleteSuccess })
    }
    setIsChatDeleteModalOpen(false)
  }

  const [visibleChatCount, setVisibleChatCount] = useState(5)
  const chatFlyoutRename = useFlyoutInlineRename({
    itemType: 'task',
    onSave: async (chatId, name) => {
      await renameChatMutation.mutateAsync({ chatId: chatId, title: name })
    },
  })

  const workflowFlyoutRename = useFlyoutInlineRename({
    itemType: 'workflow',
    onSave: async (workflowIdToRename, name) => {
      await updateWorkflowMutation.mutateAsync({
        workspaceId,
        workflowId: workflowIdToRename,
        metadata: { name },
      })
    },
  })

  useEffect(() => {
    chatsHover.setLocked(isChatContextMenuOpen || !!chatFlyoutRename.editingId)
  }, [isChatContextMenuOpen, chatFlyoutRename.editingId, chatsHover.setLocked])

  useEffect(() => {
    workflowsHover.setLocked(!!workflowFlyoutRename.editingId)
  }, [workflowFlyoutRename.editingId, workflowsHover.setLocked])

  const handleChatOpenInNewTab = useCallback(() => {
    const { chatIds: ids } = contextMenuSelectionRef.current
    if (ids.length !== 1) return
    window.open(`/workspace/${workspaceId}/chat/${ids[0]}`, '_blank', 'noopener,noreferrer')
  }, [workspaceId])

  const handleMarkChatAsRead = useCallback(() => {
    const { chatIds: ids } = contextMenuSelectionRef.current
    if (ids.length !== 1) return
    markChatReadMutation.mutate(ids[0])
  }, [])

  const handleMarkChatAsUnread = useCallback(() => {
    const { chatIds: ids } = contextMenuSelectionRef.current
    if (ids.length !== 1) return
    markChatUnreadMutation.mutate(ids[0])
  }, [])

  const handleStartChatRename = useCallback(() => {
    const { chatIds: ids } = contextMenuSelectionRef.current
    if (ids.length !== 1) return
    const chatId = ids[0]
    const chat = chats.find((t) => t.id === chatId)
    if (!chat) return
    chatsHover.setLocked(true)
    chatFlyoutRename.startRename({ id: chatId, name: chat.name })
  }, [chatFlyoutRename, chats, chatsHover])

  const handleToggleChatPin = useCallback(() => {
    const { chatIds: ids } = contextMenuSelectionRef.current
    if (ids.length !== 1) return
    const chatId = ids[0]
    const chat = chats.find((t) => t.id === chatId)
    if (!chat) return
    setChatPinnedMutation.mutate({ chatId: chatId, pinned: !chat.isPinned })
  }, [chats, setChatPinnedMutation])

  const handleCollapsedWorkflowOpenInNewTab = useCallback(
    (workflow: { id: string }) => {
      window.open(`/workspace/${workspaceId}/w/${workflow.id}`, '_blank', 'noopener,noreferrer')
    },
    [workspaceId]
  )

  const handleCollapsedWorkflowRename = useCallback(
    (workflow: { id: string; name: string }) => {
      workflowsHover.setLocked(true)
      workflowFlyoutRename.startRename({ id: workflow.id, name: workflow.name })
    },
    [workflowFlyoutRename, workflowsHover]
  )

  const scrollEdges = useScrollEdges(scrollContainerRef, {
    contentRef: scrollContentRef,
    enabled: !isCollapsed,
  })

  const isOnSettingsPage = pathname?.startsWith(`/workspace/${workspaceId}/settings`) ?? false

  const logsViewMode = useFilterStore((state) => state.viewMode)

  /**
   * Page whose registered palette commands are currently invocable. Matches
   * only routes that mount the registering component: list pages exactly, and
   * detail roots as a single path segment (deeper routes don't mount them).
   */
  const searchModalPageContext = useMemo((): PageActionContext | null => {
    if (!pathname) return null
    if (workflowId) return 'workflow'
    const base = `/workspace/${workspaceId}`
    const detailSegment = (prefix: string): string | null => {
      if (!pathname.startsWith(prefix)) return null
      const rest = pathname.slice(prefix.length)
      return rest && !rest.includes('/') ? rest : null
    }
    if (pathname === `${base}/tables`) return 'tables'
    if (detailSegment(`${base}/tables/`)) return 'tableDetail'
    if (pathname === `${base}/files`) return 'files'
    if (detailSegment(`${base}/files/`)) return 'fileDetail'
    if (pathname === `${base}/knowledge`) return 'knowledge'
    if (detailSegment(`${base}/knowledge/`)) return 'knowledgeBase'
    if (pathname === `${base}/logs`) return logsViewMode === 'dashboard' ? 'logsDashboard' : 'logs'
    return null
  }, [pathname, workspaceId, workflowId, logsViewMode])

  const { data: fetchedCredentials = [] } = useWorkspaceCredentials({
    workspaceId,
    enabled:
      isSearchModalOpen &&
      !permissionConfig.hideIntegrationsTab &&
      searchModalPageContext !== 'workflow',
  })

  const isOnLogsPage =
    searchModalPageContext === 'logs' || searchModalPageContext === 'logsDashboard'
  const logsPages = useLogsList(workspaceId, SEARCH_MODAL_LOG_FILTERS, {
    enabled: isSearchModalOpen && isOnLogsPage,
  })
  const searchModalLogs = useMemo((): LogItem[] => {
    const rows = logsPages.data?.pages[0]?.logs ?? []
    return rows.map((log) => ({
      id: log.id,
      name: log.workflow?.name || log.jobTitle || 'Unknown workflow',
      href: log.executionId
        ? `/workspace/${workspaceId}/logs?executionId=${log.executionId}`
        : `/workspace/${workspaceId}/logs`,
      date: SEARCH_MODAL_DATE_FORMAT.format(new Date(log.createdAt)),
    }))
  }, [logsPages.data, workspaceId])

  const searchModalIntegrations = useMemo(
    () =>
      permissionConfig.hideIntegrationsTab
        ? []
        : buildIntegrationSearchItems(workspaceId, isBlockAllowed, (blockType) => {
            const availability = integrationAvailability.get(blockType.toLowerCase())
            if (!availability) return CONNECT_MODE.oauth
            if (availability?.oauthAvailable) return CONNECT_MODE.oauth
            if (availability?.state === 'limited') return CONNECT_MODE.serviceAccount
            return null
          }),
    [workspaceId, permissionConfig.hideIntegrationsTab, isBlockAllowed, integrationAvailability]
  )

  const searchModalConnectedAccounts = useMemo(
    () =>
      permissionConfig.hideIntegrationsTab
        ? []
        : buildConnectedAccountSearchItems(fetchedCredentials, workspaceId),
    [fetchedCredentials, workspaceId, permissionConfig.hideIntegrationsTab]
  )

  const isLoading = workflowsLoading || sessionLoading
  const initialScrollDoneRef = useRef(false)

  useEffect(() => {
    if (!workflowId || workflowsLoading || initialScrollDoneRef.current) return
    initialScrollDoneRef.current = true
    requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent(SIDEBAR_SCROLL_EVENT, { detail: { itemId: workflowId } })
      )
    })
  }, [workflowId, workflowsLoading])

  const handleCreateWorkflow = useCallback(async () => {
    const workflowId = await createWorkflow()
    if (workflowId) {
      window.dispatchEvent(
        new CustomEvent(SIDEBAR_SCROLL_EVENT, { detail: { itemId: workflowId } })
      )
    }
  }, [createWorkflow])

  const handleCreateFolder = useCallback(async () => {
    const folderId = await createFolder()
    if (folderId) {
      window.dispatchEvent(new CustomEvent(SIDEBAR_SCROLL_EVENT, { detail: { itemId: folderId } }))
    }
  }, [createFolder])

  const handleImportWorkflow = () => {
    fileInputRef.current?.click()
  }

  const requestLeave = useSettingsDirtyStore((s) => s.requestLeave)

  const handleWorkspaceSwitch = useCallback(
    (workspace: Workspace) => {
      if (workspace.id === workspaceId) {
        setIsWorkspaceMenuOpen(false)
        return
      }
      // Close the switcher first so the settings discard dialog (if any) is visible.
      setIsWorkspaceMenuOpen(false)
      requestLeave(() => {
        void switchWorkspace(workspace)
      })
    },
    [workspaceId, switchWorkspace, requestLeave]
  )

  const handleSidebarClick = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'BUTTON' || target.closest('button, [role="button"], a')) {
      return
    }
    const { selectOnly, clearAllSelection } = useFolderStore.getState()
    workflowId ? selectOnly(workflowId) : clearAllSelection()
  }

  const handleRenameWorkspace = useCallback(
    async (workspaceIdToRename: string, newName: string) => {
      await updateWorkspace(workspaceIdToRename, { name: newName })
    },
    [updateWorkspace]
  )

  const handleUploadLogo = useCallback(
    (workspaceIdToUpdate: string) => {
      logoTargetWorkspaceIdRef.current = workspaceIdToUpdate
      setLogoTargetWorkspaceId(workspaceIdToUpdate)
      logoFileInputRef.current?.click()
    },
    [logoFileInputRef, setLogoTargetWorkspaceId]
  )

  const handleDeleteWorkspace = useCallback(
    async (workspaceIdToDelete: string) => {
      const workspaceToDelete = workspaces.find((w) => w.id === workspaceIdToDelete)
      if (workspaceToDelete) {
        await confirmDeleteWorkspace(workspaceToDelete)
      }
    },
    [workspaces, confirmDeleteWorkspace]
  )

  const handleLeaveWorkspaceWrapper = useCallback(
    async (workspaceIdToLeave: string) => {
      const workspaceToLeave = workspaces.find((w) => w.id === workspaceIdToLeave)
      if (workspaceToLeave) {
        await handleLeaveWorkspace(workspaceToLeave)
      }
    },
    [workspaces, handleLeaveWorkspace]
  )

  const chatsCollapsedIcon = <Task className='size-[16px] shrink-0 text-[var(--text-icon)]' />

  const workflowsCollapsedIcon = (
    <Workflow className='size-[16px] shrink-0 text-[var(--text-icon)]' />
  )

  const workflowsPrimaryAction = {
    label: 'New workflow',
    onSelect: handleCreateWorkflow,
  }

  const handleSeeMoreChats = useCallback(() => setVisibleChatCount((prev) => prev + 5), [])
  const handleSeeLessChats = useCallback(() => setVisibleChatCount(5), [])

  const handleCloseChatDeleteModal = useCallback(() => setIsChatDeleteModalOpen(false), [])

  const handleEdgeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isCollapsed && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        toggleCollapsed()
      }
    },
    [isCollapsed, toggleCollapsed]
  )

  const handleOpenHelpFromMenu = () => setIsHelpModalOpen(true)

  const handleOpenDocs = () => {
    window.open(DOCS_URL, '_blank', 'noopener,noreferrer')
    captureEvent(posthog, 'docs_opened', { source: 'help_menu' })
  }

  const handleOpenSlackCommunity = () => {
    window.open(SLACK_COMMUNITY_URL, '_blank', 'noopener,noreferrer')
    captureEvent(posthog, 'slack_community_opened', { source: 'help_menu' })
  }

  const handleChatRenameBlur = useCallback(
    () => void chatFlyoutRename.saveRename(),
    [chatFlyoutRename.saveRename]
  )

  const handleWorkflowRenameBlur = useCallback(
    () => void workflowFlyoutRename.saveRename(),
    [workflowFlyoutRename.saveRename]
  )

  const resolveWorkspaceIdFromPath = useCallback((): string | undefined => {
    if (workspaceId) return workspaceId
    if (typeof window === 'undefined') return undefined

    const parts = window.location.pathname.split('/')
    const idx = parts.indexOf('workspace')
    if (idx === -1) return undefined

    return parts[idx + 1]
  }, [workspaceId])

  useRegisterGlobalCommands(() =>
    createCommands([
      {
        id: 'add-agent',
        handler: () => {
          try {
            const event = new CustomEvent('add-block-from-toolbar', {
              detail: { type: 'agent', enableTriggerMode: false },
            })
            window.dispatchEvent(event)
            logger.info('Dispatched add-agent command')
          } catch (err) {
            logger.error('Failed to dispatch add-agent command', { err })
          }
        },
      },
      {
        id: 'goto-logs',
        handler: () => {
          if (focusVisibleBrowserOmnibox()) return
          try {
            const pathWorkspaceId = resolveWorkspaceIdFromPath()
            if (pathWorkspaceId) {
              navigateToPage(`/workspace/${pathWorkspaceId}/logs`)
              logger.info('Navigated to logs', { workspaceId: pathWorkspaceId })
            } else {
              logger.warn('No workspace ID found, cannot navigate to logs')
            }
          } catch (err) {
            logger.error('Failed to navigate to logs', { err })
          }
        },
      },
      {
        id: 'open-search',
        handler: () => {
          const searchModal = useSearchModalStore.getState()
          searchModal.setOpen(!searchModal.isOpen)
        },
      },
      {
        id: 'add-workflow',
        handler: () => {
          if (!canEdit || isCreatingWorkflow) return
          handleCreateWorkflow()
        },
      },
      {
        id: 'toggle-sidebar',
        handler: () => {
          toggleCollapsed()
        },
      },
    ])
  )

  return (
    <>
      <input
        ref={logoFileInputRef}
        type='file'
        accept={WORKSPACE_LOGO_ACCEPT_ATTRIBUTE}
        className='hidden'
        onChange={handleLogoFileChange}
      />
      <input
        ref={fileInputRef}
        type='file'
        accept='.json,.zip'
        multiple
        className='hidden'
        onChange={handleImportFileChange}
      />
      <div className='relative h-full'>
        <aside
          className='group/rail sidebar-container relative h-full overflow-hidden bg-[var(--surface-1)] [&_.group.cursor-pointer]:duration-0'
          data-collapsed={isCollapsed || undefined}
          aria-label='Workspace sidebar'
          onClick={handleSidebarClick}
        >
          <div className='flex h-full flex-col'>
            {/* The peek card already sits below the lane; reserving it again doubles the offset. */}
            {!isPeeking && (
              <div
                aria-hidden
                className='desktop-window-drag-region desktop-workspace-window-drag-region h-[var(--desktop-title-bar-height)]'
              />
            )}
            <div
              className={cn(
                'relative flex shrink-0 items-center px-2 pt-2',
                !isPeeking &&
                  '[[data-sim-desktop-title-bar=inset]_&]:pt-[var(--desktop-title-bar-height)]'
              )}
            >
              <WorkspaceHeader
                activeWorkspace={activeWorkspace ?? routeWorkspace}
                workspaceId={workspaceId}
                workspaces={workspaces}
                pinnedWorkspaceIds={pinnedWorkspaceIds}
                onToggleWorkspacePin={toggleWorkspacePin}
                workspaceCreationPolicy={workspaceCreationPolicy}
                isWorkspacesLoading={isWorkspacesLoading}
                isCreatingWorkspace={isCreatingWorkspace}
                isWorkspaceMenuOpen={isWorkspaceMenuOpen}
                setIsWorkspaceMenuOpen={setIsWorkspaceMenuOpen}
                onWorkspaceSwitch={handleWorkspaceSwitch}
                onCreateWorkspace={handleCreateWorkspace}
                onRenameWorkspace={handleRenameWorkspace}
                onDeleteWorkspace={handleDeleteWorkspace}
                isDeletingWorkspace={isDeletingWorkspace}
                onUploadLogo={handleUploadLogo}
                onLeaveWorkspace={handleLeaveWorkspaceWrapper}
                isLeavingWorkspace={isLeavingWorkspace}
                sessionUserId={sessionData?.user?.id}
                isCollapsed={isCollapsed}
                onExpandSidebar={toggleCollapsed}
              />
              {/*
               * The trailing chips collapse as one cluster rather than individually: a
               * chip's own `px-2` still renders under border-box, so `w-0` on the chip
               * would leave a 16px stub — the width has to sit on an unpadded wrapper.
               *
               * Chips carry no outer margin, so the gap here is the whole distance
               * between them. `gap-[1px]` rather than `gap-px`: the `px` spacing key
               * is remapped to `--border-width`, which thins to 0.5px on hidpi so
               * hairline rules stay hairlines.
               *
               * The expanded width is EXPLICIT (2 icon chips × 32px + the 1px gap;
               * 32px when the desktop inset title bar hides the collapse chip) so the
               * cluster never claims more than its chips: it refuses to flex-shrink
               * (min-width: auto) while the workspace chip's wrapper is `min-w-0
               * flex-1`, so an `auto` width would crush the workspace chip instead.
               */}
              <div
                inert={isCollapsed}
                className={cn(
                  'flex h-[30px] items-center gap-[1px] overflow-hidden',
                  isCollapsed
                    ? 'w-0 opacity-0'
                    : 'w-[65px] [[data-sim-desktop-title-bar=inset]_&]:w-[32px]'
                )}
              >
                <SidebarTooltip
                  label='Search'
                  enabled={!isCollapsed}
                  side='bottom'
                  shortcut={isMac ? '⌘K' : 'Ctrl+K'}
                >
                  <Chip
                    leftIcon={Search}
                    aria-label='Search'
                    /* Called with no args — the store setter's first parameter is an
                       options object, which a raw handler would fill with the event. */
                    onClick={() => openSearchModal()}
                    tabIndex={isCollapsed ? -1 : undefined}
                    className={DRAG_EXEMPT_CLASS}
                  />
                </SidebarTooltip>
                <SidebarTooltip
                  label='Collapse sidebar'
                  enabled={!isCollapsed}
                  side='bottom'
                  shortcut={isMac ? '⌘B' : 'Ctrl+B'}
                >
                  <Chip
                    leftIcon={PanelLeft}
                    aria-label='Collapse sidebar'
                    onClick={toggleCollapsed}
                    tabIndex={isCollapsed ? -1 : undefined}
                    className={cn(
                      DRAG_EXEMPT_CLASS,
                      '[[data-sim-desktop-title-bar=inset]_&]:hidden'
                    )}
                  />
                </SidebarTooltip>
              </div>
            </div>

            {isOnSettingsPage ? (
              <SettingsSidebar
                isCollapsed={isCollapsed}
                showCollapsedTooltips={showCollapsedTooltips}
              />
            ) : (
              <>
                {/* The divider is the pinned block's bottom rule, not the scroll region's top one:
                    the region's edge fade masks its own first pixels, which would erase a rule
                    drawn there exactly when it should show. Same construction as the footer. */}
                <div
                  className={cn(
                    SIDEBAR_SECTION_GAP_CLASS,
                    SIDEBAR_ITEM_GAP_CLASS,
                    SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
                    'flex shrink-0 flex-col border-b px-2 transition-colors duration-150',
                    !scrollEdges.top && 'border-transparent'
                  )}
                >
                  {topNavItems.map((item) => (
                    <SidebarNavItem
                      key={item.id}
                      item={item}
                      active={isNavItemActive(item, pathname)}
                      showCollapsedTooltips={showCollapsedTooltips}
                      onContextMenu={item.href ? handleNavItemContextMenu : undefined}
                    />
                  ))}
                </div>

                <div
                  ref={isCollapsed ? undefined : scrollContainerRef}
                  className={cn(
                    SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
                    SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
                    scrollFadeClass,
                    'flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden'
                  )}
                  {...scrollFadeAttributes(scrollEdges)}
                >
                  <div ref={scrollContentRef} className='flex flex-col'>
                    {chatEnabled && (
                      <SidebarSection
                        title='Chats'
                        railCollapsed={isCollapsed}
                        className='chats-section shrink-0'
                      >
                        {isCollapsed ? (
                          <div className='px-2'>
                            <CollapsedSidebarMenu
                              icon={chatsCollapsedIcon}
                              hover={chatsHover}
                              ariaLabel='Chats'
                              isEditing={!!chatFlyoutRename.editingId}
                            >
                              {chatsLoading ? (
                                <DropdownMenuItem disabled>
                                  <Loader className='size-[14px]' animate />
                                  Loading...
                                </DropdownMenuItem>
                              ) : chats.length === 0 ? (
                                <DropdownMenuItem disabled>No chats yet</DropdownMenuItem>
                              ) : (
                                chats.map((chat) => (
                                  <CollapsedChatFlyoutItem
                                    key={chat.id}
                                    chat={chat}
                                    isCurrentRoute={pathname === chat.href}
                                    isMenuOpen={menuOpenChatId === chat.id}
                                    isEditing={chat.id === chatFlyoutRename.editingId}
                                    editValue={chatFlyoutRename.value}
                                    inputRef={chatFlyoutRename.inputRef}
                                    isRenaming={chatFlyoutRename.isSaving}
                                    onEditValueChange={chatFlyoutRename.setValue}
                                    onEditKeyDown={chatFlyoutRename.handleKeyDown}
                                    onEditBlur={handleChatRenameBlur}
                                    onContextMenu={handleChatContextMenu}
                                    onMorePointerDown={handleChatMorePointerDown}
                                    onMoreClick={handleChatMoreClick}
                                  />
                                ))
                              )}
                            </CollapsedSidebarMenu>
                          </div>
                        ) : (
                          <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
                            {chatsLoading ? (
                              <SidebarItemSkeleton />
                            ) : (
                              <>
                                {chats.length === 0 ? (
                                  <div className='flex h-[30px] items-center px-2 text-[var(--text-muted)] text-small'>
                                    No chats yet
                                  </div>
                                ) : null}
                                {/* `selectChatOnly` populates `selectedChats` on every click, so
                                    a single entry just means "last clicked" — already conveyed by
                                    `isCurrentRoute`. Highlight from selection only for explicit
                                    multi-selection (size > 1), otherwise it lingers after navigating
                                    away from a chat. */}
                                {chats.slice(0, visibleChatCount).map((chat) => {
                                  const isCurrentRoute = pathname === chat.href
                                  const isRenaming = chatFlyoutRename.editingId === chat.id
                                  const isSelected =
                                    chat.id !== 'new' &&
                                    hasChatMultiSelection &&
                                    selectedChats.has(chat.id)

                                  if (isRenaming) {
                                    return (
                                      <div
                                        key={chat.id}
                                        className={chipVariants({ active: true, fullWidth: true })}
                                      >
                                        <input
                                          ref={chatFlyoutRename.inputRef}
                                          value={chatFlyoutRename.value}
                                          onChange={(e) =>
                                            chatFlyoutRename.setValue(e.target.value)
                                          }
                                          onKeyDown={chatFlyoutRename.handleKeyDown}
                                          onBlur={handleChatRenameBlur}
                                          className='min-w-0 flex-1 border-none bg-transparent text-[14px] text-[var(--text-body)] outline-hidden'
                                        />
                                      </div>
                                    )
                                  }

                                  return (
                                    <SidebarChatItem
                                      key={chat.id}
                                      chat={chat}
                                      isCurrentRoute={isCurrentRoute}
                                      isSelected={isSelected}
                                      isActive={!!chat.isActive}
                                      isUnread={!!chat.isUnread}
                                      isPinned={!!chat.isPinned}
                                      isMenuOpen={menuOpenChatId === chat.id}
                                      showCollapsedTooltips={showCollapsedTooltips}
                                      onMultiSelectClick={handleChatClick}
                                      onContextMenu={handleChatContextMenu}
                                      onMorePointerDown={handleChatMorePointerDown}
                                      onMoreClick={handleChatMoreClick}
                                    />
                                  )
                                })}
                                {chats.length > 5 && (
                                  <button
                                    type='button'
                                    onClick={
                                      chats.length > visibleChatCount
                                        ? handleSeeMoreChats
                                        : handleSeeLessChats
                                    }
                                    className={cn(
                                      chipVariants({ fullWidth: true }),
                                      'text-[var(--text-muted)] text-small'
                                    )}
                                  >
                                    {chats.length > visibleChatCount ? 'See more' : 'See less'}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </SidebarSection>
                    )}

                    <SidebarSection
                      title='Workspace'
                      railCollapsed={isCollapsed}
                      className={cn(SIDEBAR_SECTION_GAP_CLASS, 'shrink-0')}
                    >
                      <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
                        {workspaceNavItems.map((item) => {
                          const active = isNavItemActive(item, pathname)
                          const flyout = isCollapsed ? railFlyouts[item.id] : undefined
                          /* The flyout replaces the collapsed tooltip rather than
                             stacking on it: both open on the same hover. */
                          return flyout ? (
                            <CollapsedSidebarMenu
                              key={item.id}
                              hover={flyout.hover}
                              navLink={{
                                item,
                                active,
                                onContextMenu: handleNavItemContextMenu,
                              }}
                            >
                              {flyout.content}
                            </CollapsedSidebarMenu>
                          ) : (
                            <SidebarNavItem
                              key={item.id}
                              item={item}
                              active={active}
                              showCollapsedTooltips={showCollapsedTooltips}
                              onContextMenu={handleNavItemContextMenu}
                            />
                          )
                        })}
                      </div>
                    </SidebarSection>

                    <SidebarSection
                      title='Workflows'
                      railCollapsed={isCollapsed}
                      className={cn(SIDEBAR_SECTION_GAP_CLASS, 'workflows-section relative')}
                      action={
                        isCollapsed ? undefined : (
                          <div className='flex items-center justify-center gap-2'>
                            <DropdownMenu>
                              <Tooltip.Root>
                                <Tooltip.Trigger asChild>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant='quiet'
                                      size='icon'
                                      disabled={!permissionsLoading && !canEdit}
                                    >
                                      {isImporting || isCreatingFolder ? (
                                        <Loader className='h-[16px] w-[16px]' animate />
                                      ) : (
                                        <MoreHorizontal className='size-[14px]' />
                                      )}
                                    </Button>
                                  </DropdownMenuTrigger>
                                </Tooltip.Trigger>
                                <Tooltip.Content>
                                  <p>More actions</p>
                                </Tooltip.Content>
                              </Tooltip.Root>
                              <DropdownMenuContent
                                align='start'
                                sideOffset={8}
                                className='min-w-[160px]'
                              >
                                <DropdownMenuItem
                                  onSelect={handleImportWorkflow}
                                  disabled={!canEdit || isImporting}
                                >
                                  <Upload />
                                  {isImporting ? 'Importing...' : 'Import workflow'}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={handleCreateFolder}
                                  disabled={!canEdit || isCreatingFolder}
                                >
                                  <FolderPlus />
                                  {isCreatingFolder ? 'Creating folder...' : 'Create folder'}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <Tooltip.Root>
                              <Tooltip.Trigger asChild>
                                <Button
                                  variant='quiet'
                                  size='icon'
                                  onClick={handleCreateWorkflow}
                                  disabled={isCreatingWorkflow || (!permissionsLoading && !canEdit)}
                                >
                                  <Plus className='h-[16px] w-[16px]' />
                                </Button>
                              </Tooltip.Trigger>
                              <Tooltip.Content>
                                {isCreatingWorkflow ? (
                                  <p>Creating workflow...</p>
                                ) : (
                                  <Tooltip.Shortcut keys={isMac ? '⌘⇧P' : 'Ctrl+Shift+P'}>
                                    New workflow
                                  </Tooltip.Shortcut>
                                )}
                              </Tooltip.Content>
                            </Tooltip.Root>
                          </div>
                        )
                      }
                    >
                      {isCollapsed ? (
                        <div className='px-2'>
                          <CollapsedSidebarMenu
                            icon={workflowsCollapsedIcon}
                            hover={workflowsHover}
                            ariaLabel='Workflows'
                            isEditing={!!workflowFlyoutRename.editingId}
                            primaryAction={workflowsPrimaryAction}
                          >
                            {workflowsLoading && regularWorkflows.length === 0 ? (
                              <DropdownMenuItem disabled>
                                <Loader className='size-[14px]' animate />
                                Loading...
                              </DropdownMenuItem>
                            ) : regularWorkflows.length === 0 ? (
                              <DropdownMenuItem disabled>No workflows yet</DropdownMenuItem>
                            ) : (
                              <>
                                {collapsedRootItems.map((item) =>
                                  item.kind === 'folder' ? (
                                    <CollapsedFolderItems
                                      key={item.id}
                                      nodes={[item.node]}
                                      workflowsByFolder={workflowsByFolder}
                                      workspaceId={workspaceId}
                                      currentWorkflowId={workflowId}
                                      editingWorkflowId={workflowFlyoutRename.editingId}
                                      editingValue={workflowFlyoutRename.value}
                                      editInputRef={workflowFlyoutRename.inputRef}
                                      isRenamingWorkflow={workflowFlyoutRename.isSaving}
                                      onEditValueChange={workflowFlyoutRename.setValue}
                                      onEditKeyDown={workflowFlyoutRename.handleKeyDown}
                                      onEditBlur={handleWorkflowRenameBlur}
                                      onWorkflowOpenInNewTab={handleCollapsedWorkflowOpenInNewTab}
                                      onWorkflowRename={handleCollapsedWorkflowRename}
                                      canRenameWorkflow={canEdit}
                                    />
                                  ) : (
                                    <CollapsedWorkflowFlyoutItem
                                      key={item.id}
                                      workflow={item.workflow}
                                      href={`/workspace/${workspaceId}/w/${item.workflow.id}`}
                                      isCurrentRoute={item.workflow.id === workflowId}
                                      isEditing={
                                        item.workflow.id === workflowFlyoutRename.editingId
                                      }
                                      editValue={workflowFlyoutRename.value}
                                      inputRef={workflowFlyoutRename.inputRef}
                                      isRenaming={workflowFlyoutRename.isSaving}
                                      onEditValueChange={workflowFlyoutRename.setValue}
                                      onEditKeyDown={workflowFlyoutRename.handleKeyDown}
                                      onEditBlur={handleWorkflowRenameBlur}
                                      onOpenInNewTab={() =>
                                        handleCollapsedWorkflowOpenInNewTab(item.workflow)
                                      }
                                      onRename={() => handleCollapsedWorkflowRename(item.workflow)}
                                      canRename={canEdit}
                                    />
                                  )
                                )}
                              </>
                            )}
                          </CollapsedSidebarMenu>
                        </div>
                      ) : (
                        <div className='px-2'>
                          {workflowsLoading && regularWorkflows.length === 0 ? (
                            <SidebarItemSkeleton />
                          ) : (
                            <WorkflowList
                              workspaceId={workspaceId}
                              workflowId={workflowId}
                              regularWorkflows={regularWorkflows}
                              isLoading={isLoading}
                              canReorder={canEdit}
                              scrollContainerRef={scrollContainerRef}
                              onCreateWorkflow={handleCreateWorkflow}
                              onCreateFolder={handleCreateFolder}
                              disableCreate={!canEdit || isCreatingWorkflow || isCreatingFolder}
                            />
                          )}
                        </div>
                      )}
                    </SidebarSection>
                  </div>
                </div>

                {(hosted || isStatusNoticePreviewEnabled) && !isCollapsed ? (
                  <StatusNotice preview={isStatusNoticePreviewEnabled} />
                ) : null}

                <SidebarFooter
                  workspaceId={workspaceId}
                  showDivider={scrollEdges.bottom}
                  isCollapsed={isCollapsed}
                  showCollapsedTooltips={showCollapsedTooltips}
                  getSettingsHref={(section) => getSettingsHref({ section })}
                  onOpenSettings={handleOpenSettings}
                  onOpenDocs={handleOpenDocs}
                  onJoinSlack={handleOpenSlackCommunity}
                  onContactSupport={handleOpenHelpFromMenu}
                />

                <NavItemContextMenu
                  isOpen={isNavContextMenuOpen}
                  position={navContextMenuPosition}
                  menuRef={navMenuRef}
                  onClose={handleNavContextMenuClose}
                  onOpenInNewTab={handleNavOpenInNewTab}
                  onCopyLink={handleNavCopyLink}
                />

                <ContextMenu
                  isOpen={isChatContextMenuOpen}
                  position={chatContextMenuPosition}
                  menuRef={chatMenuRef}
                  onClose={closeChatContextMenu}
                  onOpenInNewTab={handleChatOpenInNewTab}
                  onMarkAsRead={handleMarkChatAsRead}
                  onMarkAsUnread={handleMarkChatAsUnread}
                  onTogglePin={handleToggleChatPin}
                  onRename={handleStartChatRename}
                  onDelete={handleDeleteChat}
                  showOpenInNewTab={!isMultiChatContextMenu}
                  showMarkAsRead={!isMultiChatContextMenu && !!activeChatContextMenuItem?.isUnread}
                  showMarkAsUnread={
                    !isMultiChatContextMenu &&
                    !!activeChatContextMenuItem &&
                    !activeChatContextMenuItem.isUnread
                  }
                  showPin={!isMultiChatContextMenu && !!activeChatContextMenuItem}
                  isPinned={!!activeChatContextMenuItem?.isPinned}
                  showRename={!isMultiChatContextMenu}
                  showDuplicate={false}
                  disableRename={!canEdit}
                  disableDelete={!canEdit}
                  selectedCount={contextMenuSelectionRef.current.chatIds.length}
                />

                <DeleteModal
                  isOpen={isChatDeleteModalOpen}
                  onClose={handleCloseChatDeleteModal}
                  onConfirm={handleConfirmDeleteChats}
                  isDeleting={deleteChatMutation.isPending || deleteChatsMutation.isPending}
                  itemType='task'
                  itemName={contextMenuSelectionRef.current.names}
                />
              </>
            )}
          </div>
        </aside>

        {/* Not on the peek card: the resize hook writes an inline `--sidebar-width` that
            out-specifies the `[data-peek]` rule, stranding the card at a stale width. */}
        {!isPeeking && (
          <div
            className={cn(
              'absolute top-0 right-0 bottom-0 z-20 w-[8px] translate-x-1/2',
              isCollapsed ? 'cursor-e-resize' : 'cursor-ew-resize'
            )}
            onPointerDown={isCollapsed ? undefined : handlePointerDown}
            onClick={isCollapsed ? toggleCollapsed : undefined}
            onKeyDown={handleEdgeKeyDown}
            role={isCollapsed ? 'button' : 'separator'}
            tabIndex={0}
            aria-orientation={isCollapsed ? undefined : 'vertical'}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Resize sidebar'}
          />
        )}
      </div>

      <SearchModal
        open={isSearchModalOpen}
        onOpenChange={setIsSearchModalOpen}
        workflows={searchModalWorkflows}
        workspaces={searchModalWorkspaces}
        chats={chats}
        logs={searchModalLogs}
        integrations={searchModalIntegrations}
        connectedAccounts={searchModalConnectedAccounts}
        pageContext={searchModalPageContext}
        canEdit={canEdit}
        canAdmin={canAdmin}
        onCreateWorkflow={handleCreateWorkflow}
        onCreateFolder={handleCreateFolder}
        onImportWorkflow={handleImportWorkflow}
      />

      <HelpModal
        open={isHelpModalOpen}
        onOpenChange={setIsHelpModalOpen}
        workflowId={workflowId}
        workspaceId={workspaceId}
      />
    </>
  )
})
