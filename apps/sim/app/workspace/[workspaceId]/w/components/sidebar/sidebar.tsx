'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Chip,
  ChipLink,
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
  Skeleton,
  Tooltip,
  toast,
  Upload,
} from '@sim/emcn'
import {
  BookOpen,
  Calendar,
  Database,
  Files,
  HelpCircle,
  Integration,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Table,
  Task,
  Workflow,
} from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { MoreHorizontal, Pin } from 'lucide-react'
import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { useSession } from '@/lib/auth/auth-client'
import { SIM_RESOURCES_DRAG_TYPE } from '@/lib/copilot/resource-types'
import { isMacPlatform } from '@/lib/core/utils/platform'
import { buildFolderTree, getFolderPath } from '@/lib/folders/tree'
import { captureEvent } from '@/lib/posthog/client'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import {
  CollapsedChatFlyoutItem,
  CollapsedFolderItems,
  CollapsedSidebarMenu,
  CollapsedWorkflowFlyoutItem,
  HelpModal,
  NavItemContextMenu,
  SearchModal,
  SettingsSidebar,
  WorkflowList,
  WorkspaceHeader,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import {
  buildConnectedAccountSearchItems,
  buildIntegrationSearchItems,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/integration-search-items'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'
import { DeleteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/delete-modal/delete-modal'
import {
  SIDEBAR_ITEM_GAP_CLASS,
  SIDEBAR_SECTION_GAP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import {
  useChatSelection,
  useContextMenu,
  useFlyoutInlineRename,
  useFolderOperations,
  useHoverMenu,
  useSidebarResize,
  useWorkflowOperations,
  useWorkspaceLogoUpload,
  useWorkspaceManagement,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import {
  compareByOrder,
  createSidebarDragGhost,
  groupWorkflowsByFolder,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/utils'
import { useImportWorkflow } from '@/app/workspace/[workspaceId]/w/hooks'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useFolderMap, useFolders } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import {
  useDeleteMothershipChat,
  useDeleteMothershipChats,
  useForkMothershipChat,
  useMarkMothershipChatRead,
  useMarkMothershipChatUnread,
  useMothershipChats,
  useRenameMothershipChat,
  useSetMothershipChatPinned,
} from '@/hooks/queries/mothership-chats'
import { useTablesList } from '@/hooks/queries/tables'
import { useUpdateWorkflow } from '@/hooks/queries/workflows'
import type { Workspace } from '@/hooks/queries/workspace'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useMothershipChatEvents } from '@/hooks/use-mothership-chat-events'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { useFolderStore } from '@/stores/folders/store'
import { useSearchModalStore } from '@/stores/modals/search/store'
import { useProvidersStore } from '@/stores/providers'
import { useSidebarStore } from '@/stores/sidebar/store'

const logger = createLogger('Sidebar')

export function SidebarTooltip({
  children,
  label,
  enabled,
  side = 'right',
}: {
  children: React.ReactElement
  label: string
  enabled: boolean
  side?: 'right' | 'bottom'
}) {
  if (!enabled) return children
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Content side={side}>
        <p>{label}</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

function SidebarItemSkeleton() {
  return (
    <div className='sidebar-collapse-hide mx-0.5 flex h-[30px] items-center gap-2 rounded-lg px-2'>
      <Skeleton className='h-[16px] w-[16px] flex-shrink-0 rounded-sm' />
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
      <Link
        href={chat.href}
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
        <div className='min-w-0 flex-1 truncate text-[var(--text-body)]'>{chat.name}</div>
        {chat.id !== 'new' && (
          <div className='relative flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center'>
            {(isActive || (!isCurrentRoute && isUnread)) && (
              <span
                aria-hidden='true'
                className={cn(
                  'h-[6px] w-[6px] rounded-full transition-opacity',
                  isMenuOpen ? 'opacity-0' : 'group-hover:opacity-0'
                )}
                style={{
                  backgroundColor: isActive ? '#EAB308' : 'var(--brand-accent)',
                }}
              />
            )}
            {!isActive && !isUnread && isPinned && !isCurrentRoute && !isMenuOpen && (
              <Pin
                aria-hidden='true'
                className='absolute size-[12px] text-[var(--text-icon)] group-hover:hidden'
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
              <MoreHorizontal className='h-[16px] w-[16px] text-[var(--text-icon)]' />
            </button>
          </div>
        )}
      </Link>
    </SidebarTooltip>
  )
})

interface SidebarNavItemData {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  href?: string
  onClick?: () => void
  /** Extra path prefixes that should also mark this item as active (e.g. sibling tabs). */
  additionalActivePaths?: string[]
}

/**
 * Returns true when the current pathname matches `item.href` or any
 * `additionalActivePaths` at a segment boundary (avoids `/foo` matching `/foo-bar`).
 */
function isNavItemActive(item: SidebarNavItemData, pathname: string | null): boolean {
  if (!pathname) return false
  const matches = (p: string) => pathname === p || pathname.startsWith(`${p}/`)
  if (item.href && matches(item.href)) return true
  return item.additionalActivePaths?.some(matches) ?? false
}

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
  const element = item.href ? (
    <ChipLink
      href={item.href}
      data-item-id={item.id}
      leftIcon={item.icon}
      active={active}
      fullWidth
      onClick={
        item.onClick
          ? (e) => {
              if (e.ctrlKey || e.metaKey || e.shiftKey) return
              e.preventDefault()
              item.onClick!()
            }
          : undefined
      }
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, item.href!) : undefined}
    >
      {item.label}
    </ChipLink>
  ) : item.onClick ? (
    <Chip
      data-item-id={item.id}
      leftIcon={item.icon}
      active={active}
      fullWidth
      onClick={item.onClick}
    >
      {item.label}
    </Chip>
  ) : null

  if (!element) return null

  return (
    <SidebarTooltip label={item.label} enabled={showCollapsedTooltips}>
      {element}
    </SidebarTooltip>
  )
})

/** Event name for sidebar scroll operations - centralized for consistency */
export const SIDEBAR_SCROLL_EVENT = 'sidebar-scroll-to-item'

const HIDDEN_STYLE = { display: 'none' } as const

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
 * @returns Sidebar with workflows panel
 */
interface SidebarProps {
  /**
   * Authoritative collapse state, derived once in {@link WorkspaceChrome} from the
   * `sidebar_collapsed` cookie (server prop → store after hydration) and passed in
   * so the rail's structure, labels, and width all read a single source.
   */
  isCollapsed: boolean
}

export const Sidebar = memo(function Sidebar({ isCollapsed }: SidebarProps) {
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
  const { canEdit, isLoading: permissionsLoading } = useUserPermissionsContext()
  const { config: permissionConfig, filterBlocks } = usePermissionConfig()
  const { navigateToSettings, getSettingsHref } = useSettingsNavigation()
  const initializeSearchData = useSearchModalStore((state) => state.initializeData)
  const providers = useProvidersStore((state) => state.providers)
  const providerModelSignature = useMemo(
    () =>
      Object.values(providers)
        .map((provider) => provider.models.join('\x00'))
        .join('\x01'),
    [providers]
  )

  useEffect(() => {
    initializeSearchData(filterBlocks)
  }, [initializeSearchData, filterBlocks, providerModelSignature])

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
  const { data: folderMap = {} } = useFolderMap(workspaceId)
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
  const forkChatMutation = useForkMothershipChat(workspaceId)
  const markChatReadMutation = useMarkMothershipChatRead(workspaceId)
  const markChatUnreadMutation = useMarkMothershipChatUnread(workspaceId)
  const renameChatMutation = useRenameMothershipChat(workspaceId)
  const setChatPinnedMutation = useSetMothershipChatPinned(workspaceId)
  const chatsHover = useHoverMenu()
  const workflowsHover = useHoverMenu()

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
      regularWorkflows.map((workflow) => {
        const folderPath = workflow.folderId
          ? getFolderPath(folderMap, workflow.folderId).map((folder) => folder.name)
          : []
        return {
          id: workflow.id,
          name: workflow.name,
          href: `/workspace/${workspaceId}/w/${workflow.id}`,
          folderPath: folderPath.length > 0 ? folderPath : undefined,
          isCurrent: workflow.id === workflowId,
        }
      }),
    [regularWorkflows, folderMap, workspaceId, workflowId]
  )

  const searchModalWorkspaces = useMemo(
    () =>
      workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        href: `/workspace/${workspace.id}/w`,
        isCurrent: workspace.id === workspaceId,
      })),
    [workspaces, workspaceId]
  )

  const topNavItems = useMemo(
    () =>
      [
        {
          id: 'home',
          label: 'New chat',
          icon: Home,
          href: `/workspace/${workspaceId}/home`,
        },
        {
          id: 'search',
          label: 'Search',
          icon: Search,
          onClick: openSearchModal,
        },
        {
          id: 'integrations',
          label: 'Integrations',
          icon: Integration,
          href: `/workspace/${workspaceId}/integrations`,
          additionalActivePaths: [`/workspace/${workspaceId}/skills`],
          hidden: permissionConfig.hideIntegrationsTab,
        },
      ].filter((item) => !item.hidden),
    [workspaceId, openSearchModal, permissionConfig.hideIntegrationsTab]
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
          label: 'Knowledge base',
          icon: Database,
          href: `/workspace/${workspaceId}/knowledge`,
          hidden: permissionConfig.hideKnowledgeBaseTab,
        },
        {
          id: 'scheduled-tasks',
          label: 'Scheduled tasks',
          icon: Calendar,
          href: `/workspace/${workspaceId}/scheduled-tasks`,
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

  const footerItems = useMemo(
    () => [
      {
        id: 'settings',
        label: 'Settings',
        icon: Settings,
        href: getSettingsHref(),
        onClick: () => {
          if (!isCollapsedRef.current) {
            setSidebarWidth(SIDEBAR_WIDTH.MIN)
          }
          navigateToSettings()
        },
      },
    ],
    [navigateToSettings, getSettingsHref, setSidebarWidth]
  )

  const { data: fetchedChats = [], isLoading: chatsLoading } = useMothershipChats(workspaceId)

  useMothershipChatEvents(workspaceId)

  const chats = useMemo(
    () =>
      fetchedChats
        ? fetchedChats.map((t) => ({
            ...t,
            href: `/workspace/${workspaceId}/chat/${t.id}`,
          }))
        : [],
    [fetchedChats, workspaceId]
  )

  const { data: fetchedTables = [] } = useTablesList(workspaceId)
  const { data: fetchedFiles = [] } = useWorkspaceFiles(workspaceId)
  const { data: fetchedKnowledgeBases = [] } = useKnowledgeBasesQuery(workspaceId)

  const searchModalTables = useMemo(
    () =>
      permissionConfig.hideTablesTab
        ? []
        : fetchedTables.map((t) => ({
            id: t.id,
            name: t.name,
            href: `/workspace/${workspaceId}/tables/${t.id}`,
          })),
    [fetchedTables, workspaceId, permissionConfig.hideTablesTab]
  )

  const searchModalFiles = useMemo(
    () =>
      permissionConfig.hideFilesTab
        ? []
        : fetchedFiles.map((f) => ({
            id: f.id,
            name: f.name,
            href: `/workspace/${workspaceId}/files/${f.id}`,
            folderPath: f.folderPath ? f.folderPath.split('/').filter(Boolean) : undefined,
          })),
    [fetchedFiles, workspaceId, permissionConfig.hideFilesTab]
  )

  const searchModalKnowledgeBases = useMemo(
    () =>
      permissionConfig.hideKnowledgeBaseTab
        ? []
        : fetchedKnowledgeBases.map((kb) => ({
            id: kb.id,
            name: kb.name,
            href: `/workspace/${workspaceId}/knowledge/${kb.id}`,
          })),
    [fetchedKnowledgeBases, workspaceId, permissionConfig.hideKnowledgeBaseTab]
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

  const handleDuplicateChat = useCallback(() => {
    const { chatIds: ids } = contextMenuSelectionRef.current
    if (ids.length !== 1) return
    // No upToMessageId: the fork route treats this as a whole-chat duplicate.
    forkChatMutation.mutate(
      { chatId: ids[0] },
      {
        onSuccess: (result) => {
          if (result.failedFileCopies) {
            toast.warning(
              `${result.failedFileCopies} file${result.failedFileCopies === 1 ? '' : 's'} could not be copied to the duplicate`
            )
          }
          useFolderStore.getState().clearChatSelection()
          navigateToPage(`/workspace/${workspaceId}/chat/${result.id}`)
        },
      }
    )
  }, [navigateToPage, workspaceId])

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

  const [hasOverflowTop, setHasOverflowTop] = useState(false)
  const [hasOverflowBottom, setHasOverflowBottom] = useState(false)

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const updateScrollState = () => {
      setHasOverflowTop(container.scrollTop > 1)
      setHasOverflowBottom(
        container.scrollHeight > container.scrollTop + container.clientHeight + 1
      )
    }

    updateScrollState()
    container.addEventListener('scroll', updateScrollState, { passive: true })
    const observer = new ResizeObserver(updateScrollState)
    observer.observe(container)
    if (scrollContentRef.current) {
      observer.observe(scrollContentRef.current)
    }

    return () => {
      container.removeEventListener('scroll', updateScrollState)
      observer.disconnect()
    }
  }, [])

  const isOnSettingsPage = pathname?.startsWith(`/workspace/${workspaceId}/settings`) ?? false
  const isOnIntegrationsPage =
    pathname?.startsWith(`/workspace/${workspaceId}/integrations`) ?? false

  const { data: fetchedCredentials = [] } = useWorkspaceCredentials({
    workspaceId,
    enabled: isOnIntegrationsPage && !permissionConfig.hideIntegrationsTab,
  })

  const searchModalIntegrations = useMemo(
    () => (permissionConfig.hideIntegrationsTab ? [] : buildIntegrationSearchItems(workspaceId)),
    [workspaceId, permissionConfig.hideIntegrationsTab]
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

  const handleWorkspaceSwitch = useCallback(
    async (workspace: Workspace) => {
      if (workspace.id === workspaceId) {
        setIsWorkspaceMenuOpen(false)
        return
      }
      await switchWorkspace(workspace)
      setIsWorkspaceMenuOpen(false)
    },
    [workspaceId, switchWorkspace]
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

  const chatsCollapsedIcon = <Task className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />

  const workflowsCollapsedIcon = (
    <Workflow className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
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

  const handleOpenHelpFromMenu = useCallback(() => setIsHelpModalOpen(true), [])

  const handleOpenDocs = useCallback(() => {
    window.open('https://docs.sim.ai', '_blank', 'noopener,noreferrer')
    captureEvent(posthog, 'docs_opened', { source: 'help_menu' })
  }, [posthog])

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
          openSearchModal()
        },
      },
      {
        id: 'add-workflow',
        handler: () => {
          if (!canEdit || isCreatingWorkflow) return
          handleCreateWorkflow()
        },
      },
    ])
  )

  return (
    <>
      <input
        ref={logoFileInputRef}
        type='file'
        accept='image/png,image/jpeg,image/jpg,image/svg+xml,image/webp'
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
          className='sidebar-container relative h-full overflow-hidden bg-[var(--surface-1)]'
          data-collapsed={isCollapsed || undefined}
          aria-label='Workspace sidebar'
          onClick={handleSidebarClick}
        >
          <div className='flex h-full flex-col'>
            <div className='flex flex-shrink-0 items-center px-2 pt-3'>
              <WorkspaceHeader
                activeWorkspace={activeWorkspace}
                workspaceId={workspaceId}
                workspaces={workspaces}
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
              <SidebarTooltip label='Collapse sidebar' enabled={!isCollapsed} side='bottom'>
                <button
                  type='button'
                  onClick={toggleCollapsed}
                  className={cn(
                    'ml-2 flex h-[30px] items-center justify-center overflow-hidden rounded-lg transition-all duration-200 hover-hover:bg-[var(--surface-active)]',
                    isCollapsed ? 'w-0 opacity-0' : 'w-[30px] opacity-100'
                  )}
                  aria-label='Collapse sidebar'
                  tabIndex={isCollapsed ? -1 : undefined}
                >
                  <PanelLeft className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
                </button>
              </SidebarTooltip>
            </div>

            {isOnSettingsPage ? (
              <SettingsSidebar
                isCollapsed={isCollapsed}
                showCollapsedTooltips={showCollapsedTooltips}
              />
            ) : (
              <>
                <div
                  className={cn(
                    SIDEBAR_SECTION_GAP_CLASS,
                    SIDEBAR_ITEM_GAP_CLASS,
                    'flex flex-shrink-0 flex-col px-2 pb-1.5'
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
                    'flex flex-1 flex-col overflow-y-auto overflow-x-hidden border-t pt-1.5 transition-colors duration-150',
                    !hasOverflowTop && 'border-transparent'
                  )}
                >
                  <div ref={scrollContentRef} className='flex flex-col'>
                    <div className='chats-section flex flex-shrink-0 flex-col'>
                      <div className='flex h-[18px] flex-shrink-0 items-center justify-between px-4'>
                        <div className='text-[var(--text-muted)] text-small'>Chats</div>
                      </div>
                      {isCollapsed ? (
                        <CollapsedSidebarMenu
                          icon={chatsCollapsedIcon}
                          hover={chatsHover}
                          ariaLabel='Chats'
                          className='mt-2'
                        >
                          {chatsLoading ? (
                            <DropdownMenuItem disabled>
                              <Loader className='h-[14px] w-[14px]' animate />
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
                      ) : (
                        <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'mt-2 flex flex-col px-2')}>
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
                                        onChange={(e) => chatFlyoutRename.setValue(e.target.value)}
                                        onKeyDown={chatFlyoutRename.handleKeyDown}
                                        onBlur={handleChatRenameBlur}
                                        className='min-w-0 flex-1 border-none bg-transparent text-[14px] text-[var(--text-body)] outline-none'
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
                    </div>

                    <div className={cn(SIDEBAR_SECTION_GAP_CLASS, 'flex flex-shrink-0 flex-col')}>
                      <div className='px-4 pb-2'>
                        <div className='text-[var(--text-muted)] text-small'>Workspace</div>
                      </div>
                      <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
                        {workspaceNavItems.map((item) => (
                          <SidebarNavItem
                            key={item.id}
                            item={item}
                            active={isNavItemActive(item, pathname)}
                            showCollapsedTooltips={showCollapsedTooltips}
                            onContextMenu={handleNavItemContextMenu}
                          />
                        ))}
                      </div>
                    </div>

                    <div
                      className={cn(
                        SIDEBAR_SECTION_GAP_CLASS,
                        'workflows-section relative flex flex-col'
                      )}
                    >
                      <div className='flex h-[18px] flex-shrink-0 items-center justify-between px-4'>
                        <div className='text-[var(--text-muted)] text-small'>Workflows</div>
                        {!isCollapsed && (
                          <div className='flex items-center justify-center gap-2'>
                            <DropdownMenu>
                              <Tooltip.Root>
                                <Tooltip.Trigger asChild>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant='quiet'
                                      className='h-[18px] w-[18px] rounded-sm p-0'
                                      disabled={!permissionsLoading && !canEdit}
                                    >
                                      {isImporting || isCreatingFolder ? (
                                        <Loader className='h-[16px] w-[16px]' animate />
                                      ) : (
                                        <MoreHorizontal className='h-[16px] w-[16px]' />
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
                                  className='h-[18px] w-[18px] rounded-sm p-0'
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
                        )}
                      </div>
                      {isCollapsed ? (
                        <CollapsedSidebarMenu
                          icon={workflowsCollapsedIcon}
                          hover={workflowsHover}
                          ariaLabel='Workflows'
                          className='mt-2'
                          primaryAction={workflowsPrimaryAction}
                        >
                          {workflowsLoading && regularWorkflows.length === 0 ? (
                            <DropdownMenuItem disabled>
                              <Loader className='h-[14px] w-[14px]' animate />
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
                                    isEditing={item.workflow.id === workflowFlyoutRename.editingId}
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
                      ) : (
                        <div className='mt-2 px-2'>
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
                    </div>
                  </div>
                </div>

                <div
                  className={cn(
                    SIDEBAR_ITEM_GAP_CLASS,
                    'flex flex-shrink-0 flex-col border-t px-2 pt-[9px] pb-2 transition-colors duration-150',
                    !hasOverflowBottom && 'border-transparent'
                  )}
                >
                  <DropdownMenu>
                    <SidebarTooltip label='Help' enabled={showCollapsedTooltips}>
                      <DropdownMenuTrigger asChild>
                        <button
                          type='button'
                          data-item-id='help'
                          className={chipVariants({ fullWidth: true })}
                        >
                          <HelpCircle className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
                          <span className='sidebar-collapse-hide truncate text-[var(--text-body)]'>
                            Help
                          </span>
                        </button>
                      </DropdownMenuTrigger>
                    </SidebarTooltip>
                    <DropdownMenuContent align='start' side='top' sideOffset={4}>
                      <DropdownMenuItem onSelect={handleOpenDocs}>
                        <BookOpen className='h-[14px] w-[14px]' />
                        Docs
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={handleOpenHelpFromMenu}>
                        <HelpCircle className='h-[14px] w-[14px]' />
                        Report an issue
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {footerItems.map((item) => (
                    <SidebarNavItem
                      key={item.id}
                      item={item}
                      active={false}
                      showCollapsedTooltips={showCollapsedTooltips}
                      onContextMenu={item.href ? handleNavItemContextMenu : undefined}
                    />
                  ))}
                </div>

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
                  onDuplicate={handleDuplicateChat}
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
                  showDuplicate={!isMultiChatContextMenu}
                  disableRename={!canEdit}
                  disableDuplicate={!canEdit || forkChatMutation.isPending}
                  disableDelete={!canEdit}
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
      </div>

      <SearchModal
        open={isSearchModalOpen}
        onOpenChange={setIsSearchModalOpen}
        workflows={searchModalWorkflows}
        workspaces={searchModalWorkspaces}
        chats={chats}
        tables={searchModalTables}
        files={searchModalFiles}
        knowledgeBases={searchModalKnowledgeBases}
        integrations={searchModalIntegrations}
        connectedAccounts={searchModalConnectedAccounts}
        isOnWorkflowPage={!!workflowId}
        isOnIntegrationsPage={isOnIntegrationsPage}
        canEdit={canEdit}
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
