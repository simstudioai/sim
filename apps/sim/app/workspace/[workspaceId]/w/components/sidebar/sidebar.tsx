'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { MoreHorizontal } from 'lucide-react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import {
  Button,
  Chip,
  ChipLink,
  chipVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FolderPlus,
  Library,
  Loader,
  Skeleton,
  Tooltip,
  Upload,
} from '@/components/emcn'
import {
  BookOpen,
  Clock,
  Database,
  Files,
  HelpCircle,
  Integration,
  MessageCircle,
  Plus,
  Search,
  Settings,
  Table,
} from '@/components/emcn/icons'
import { useSession } from '@/lib/auth/auth-client'
import { MOTHERSHIP_PAGES, type MothershipPageId } from '@/lib/copilot/resources/types'
import { cn } from '@/lib/core/utils/cn'
import { isMacPlatform } from '@/lib/core/utils/platform'
import { getFolderPath } from '@/lib/folders/tree'
import { stageResourceForOpenChat } from '@/lib/mothership/chat-aware-nav'
import { captureEvent } from '@/lib/posthog/client'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import {
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
import {
  SIDEBAR_ITEM_GAP_CLASS,
  SIDEBAR_SECTION_GAP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import {
  useContextMenu,
  useFolderOperations,
  useSidebarResize,
  useWorkflowOperations,
  useWorkspaceLogoUpload,
  useWorkspaceManagement,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useImportWorkflow } from '@/app/workspace/[workspaceId]/w/hooks'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useFolderMap, useFolders } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useMothershipChats } from '@/hooks/queries/mothership-chats'
import { useTablesList } from '@/hooks/queries/tables'
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
  onContextMenu,
}: {
  item: SidebarNavItemData
  active: boolean
  onContextMenu?: (e: React.MouseEvent, href: string) => void
}) {
  return item.href ? (
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
})

/** Event name for sidebar scroll operations - centralized for consistency */
export const SIDEBAR_SCROLL_EVENT = 'sidebar-scroll-to-item'

interface SidebarProps {
  /**
   * `docked` fills the chrome shell at full height. `flyout` renders inside the
   * hover dropdown panel: content-sized (dropdown-like) on the popover surface,
   * shrinking and scrolling internally when taller than the panel's max height.
   */
  variant?: 'docked' | 'flyout'
}

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
export const Sidebar = memo(function Sidebar({ variant = 'docked' }: SidebarProps) {
  const isFlyout = variant === 'flyout'
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
  const isCollapsed = useSidebarStore((state) => state.isCollapsed)
  const isOnWorkflowPage = !!workflowId

  const isCollapsedRef = useRef(isCollapsed)
  useLayoutEffect(() => {
    isCollapsedRef.current = isCollapsed
  }, [isCollapsed])

  const isMac = isMacPlatform()

  const { isImporting, handleFileChange: handleImportFileChange } = useImportWorkflow({
    workspaceId,
  })

  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false)
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false)

  const setFlyoutPinned = useSidebarStore((state) => state.setFlyoutPinned)

  /**
   * Popups launched from the flyout (workspace menu) portal outside it, so
   * hovering them would otherwise dismiss the flyout. Pin it while they're open.
   */
  useEffect(() => {
    if (!isFlyout) return
    setFlyoutPinned(isWorkspaceMenuOpen)
    return () => setFlyoutPinned(false)
  }, [isFlyout, isWorkspaceMenuOpen, setFlyoutPinned])

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
          icon: MessageCircle,
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

  /**
   * Workspace area navigation that keeps an open chat open: when a Mothership
   * chat is on screen, the page stages on its resource panel (only the panel
   * switches); without one, this is plain page navigation. Modifier clicks
   * never reach here — the ChipLink lets them follow the href.
   */
  const handleWorkspacePageNav = useCallback(
    (pageId: MothershipPageId, href: string) => {
      const staged = stageResourceForOpenChat(
        workspaceId,
        { type: 'page', id: pageId, title: MOTHERSHIP_PAGES[pageId] },
        router.push
      )
      if (!staged) router.push(href)
    },
    [workspaceId, router]
  )

  const workspaceNavItems = useMemo(
    () =>
      [
        {
          id: 'tables',
          label: 'Tables',
          icon: Table,
          href: `/workspace/${workspaceId}/tables`,
          onClick: () => handleWorkspacePageNav('tables', `/workspace/${workspaceId}/tables`),
          hidden: permissionConfig.hideTablesTab,
        },
        {
          id: 'files',
          label: 'Files',
          icon: Files,
          href: `/workspace/${workspaceId}/files`,
          onClick: () => handleWorkspacePageNav('files', `/workspace/${workspaceId}/files`),
          hidden: permissionConfig.hideFilesTab,
        },
        {
          id: 'knowledge-base',
          label: 'Knowledge base',
          icon: Database,
          href: `/workspace/${workspaceId}/knowledge`,
          onClick: () => handleWorkspacePageNav('knowledge', `/workspace/${workspaceId}/knowledge`),
          hidden: permissionConfig.hideKnowledgeBaseTab,
        },
        {
          id: 'scheduled-tasks',
          label: 'Scheduled tasks',
          icon: Clock,
          href: `/workspace/${workspaceId}/scheduled-tasks`,
          onClick: () =>
            handleWorkspacePageNav('scheduled-tasks', `/workspace/${workspaceId}/scheduled-tasks`),
        },
        {
          id: 'logs',
          label: 'Logs',
          icon: Library,
          href: `/workspace/${workspaceId}/logs`,
          onClick: () => handleWorkspacePageNav('logs', `/workspace/${workspaceId}/logs`),
        },
      ].filter((item) => !item.hidden),
    [
      workspaceId,
      handleWorkspacePageNav,
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

  const { data: fetchedChats = [] } = useMothershipChats(workspaceId)

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

  const navigateToPage = useCallback(
    (path: string) => {
      if (!isCollapsedRef.current) {
        setSidebarWidth(SIDEBAR_WIDTH.MIN)
      }
      router.push(path)
    },
    [setSidebarWidth, router]
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

  const handleOpenHelpFromMenu = useCallback(() => setIsHelpModalOpen(true), [])

  const handleOpenDocs = useCallback(() => {
    window.open('https://docs.sim.ai', '_blank', 'noopener,noreferrer')
    captureEvent(posthog, 'docs_opened', { source: 'help_menu' })
  }, [posthog])

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
      <div className={cn('relative', isFlyout ? 'flex max-h-full min-h-0 flex-col' : 'h-full')}>
        <aside
          className={cn(
            'sidebar-container relative overflow-hidden',
            isFlyout ? 'flex min-h-0 flex-col bg-[var(--bg)]' : 'h-full bg-[var(--surface-1)]'
          )}
          aria-label='Workspace sidebar'
          onClick={handleSidebarClick}
        >
          <div className={cn('flex flex-col', isFlyout ? 'min-h-0' : 'h-full')}>
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
              />
            </div>

            {isOnSettingsPage ? (
              <SettingsSidebar />
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
                      onContextMenu={item.href ? handleNavItemContextMenu : undefined}
                    />
                  ))}
                </div>

                <div
                  ref={scrollContainerRef}
                  className={cn(
                    'flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden border-t pt-1.5 transition-colors duration-150',
                    !hasOverflowTop && 'border-transparent'
                  )}
                >
                  <div ref={scrollContentRef} className='flex flex-col'>
                    <div className='flex flex-shrink-0 flex-col'>
                      <div className='px-4 pb-2'>
                        <div className='text-[var(--text-muted)] text-small'>Workspace</div>
                      </div>
                      <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
                        {workspaceNavItems.map((item) => (
                          <SidebarNavItem
                            key={item.id}
                            item={item}
                            active={isNavItemActive(item, pathname)}
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
                      </div>
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
                    <DropdownMenuTrigger asChild>
                      <button
                        type='button'
                        data-item-id='help'
                        className={chipVariants({ fullWidth: true })}
                      >
                        <HelpCircle className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
                        <span className='truncate text-[var(--text-body)]'>Help</span>
                      </button>
                    </DropdownMenuTrigger>
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
              </>
            )}
          </div>
        </aside>

        {!isCollapsed && (
          <div
            className='absolute top-0 right-0 bottom-0 z-20 w-[8px] translate-x-1/2 cursor-ew-resize'
            onPointerDown={handlePointerDown}
            role='separator'
            tabIndex={0}
            aria-orientation='vertical'
            aria-label='Resize sidebar'
          />
        )}
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
