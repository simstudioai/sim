'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Compass, MoreHorizontal } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import {
  Blimp,
  Button,
  Download,
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
} from '@/components/emcn'
import {
  BookOpen,
  Calendar,
  Database,
  File,
  HelpCircle,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Sim,
  Table,
  Wordmark,
} from '@/components/emcn/icons'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import { isMacPlatform } from '@/lib/core/utils/platform'
import { buildFolderTree } from '@/lib/folders/tree'
import { captureEvent } from '@/lib/posthog/client'
import {
  START_NAV_TOUR_EVENT,
  START_WORKFLOW_TOUR_EVENT,
} from '@/app/workspace/[workspaceId]/components/product-tour'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import {
  CollapsedFolderItems,
  CollapsedSidebarMenu,
  CollapsedTaskFlyoutItem,
  CollapsedWorkflowFlyoutItem,
  HelpModal,
  NavItemContextMenu,
  SearchModal,
  SettingsSidebar,
  WorkflowList,
  WorkspaceHeader,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'
import { DeleteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/delete-modal/delete-modal'
import {
  useContextMenu,
  useFlyoutInlineRename,
  useFolderOperations,
  useHoverMenu,
  useSidebarResize,
  useTaskSelection,
  useWorkflowOperations,
  useWorkspaceManagement,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { groupWorkflowsByFolder } from '@/app/workspace/[workspaceId]/w/components/sidebar/utils'
import {
  useDuplicateWorkspace,
  useExportWorkspace,
  useImportWorkflow,
  useImportWorkspace,
} from '@/app/workspace/[workspaceId]/w/hooks'
import { getBrandConfig } from '@/ee/whitelabeling'
import { useFolderMap, useFolders } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import {
  useDeleteTask,
  useDeleteTasks,
  useMarkTaskRead,
  useMarkTaskUnread,
  useRenameTask,
  useTasks,
} from '@/hooks/queries/tasks'
import { useUpdateWorkflow } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useTaskEvents } from '@/hooks/use-task-events'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { useFolderStore } from '@/stores/folders/store'
import { useSearchModalStore } from '@/stores/modals/search/store'
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
      <Skeleton className='h-[14px] w-full rounded-sm' />
    </div>
  )
}

const SidebarTaskItem = memo(function SidebarTaskItem({
  task,
  isCurrentRoute,
  isSelected,
  isActive,
  isUnread,
  isMenuOpen,
  showCollapsedTooltips,
  onMultiSelectClick,
  onContextMenu,
  onMorePointerDown,
  onMoreClick,
}: {
  task: { id: string; href: string; name: string }
  isCurrentRoute: boolean
  isSelected: boolean
  isActive: boolean
  isUnread: boolean
  isMenuOpen: boolean
  showCollapsedTooltips: boolean
  onMultiSelectClick: (taskId: string, shiftKey: boolean) => void
  onContextMenu: (e: React.MouseEvent, taskId: string) => void
  onMorePointerDown: () => void
  onMoreClick: (e: React.MouseEvent<HTMLButtonElement>, taskId: string) => void
}) {
  return (
    <SidebarTooltip label={task.name} enabled={showCollapsedTooltips}>
      <Link
        href={task.href}
        className={cn(
          'group mx-0.5 flex h-[30px] items-center gap-2 rounded-lg px-2 text-sm',
          !(isCurrentRoute || isSelected || isMenuOpen) && 'hover-hover:bg-[var(--surface-hover)]',
          (isCurrentRoute || isSelected || isMenuOpen) && 'bg-[var(--surface-active)]'
        )}
        onClick={(e) => {
          if (task.id === 'new') return
          if (e.metaKey || e.ctrlKey) return
          if (e.shiftKey) {
            e.preventDefault()
            onMultiSelectClick(task.id, true)
          } else {
            useFolderStore.setState({
              selectedTasks: new Set<string>(),
              lastSelectedTaskId: task.id,
            })
          }
        }}
        onContextMenu={task.id !== 'new' ? (e) => onContextMenu(e, task.id) : undefined}
      >
        <Blimp className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
        <div className='min-w-0 flex-1 truncate font-base text-[var(--text-body)]'>{task.name}</div>
        {task.id !== 'new' && (
          <div className='relative flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center'>
            {isActive && !isCurrentRoute && !isMenuOpen && (
              <span className='absolute h-[7px] w-[7px] animate-ping rounded-full bg-amber-400 opacity-30 group-hover:hidden' />
            )}
            {isActive && !isCurrentRoute && !isMenuOpen && (
              <span className='absolute h-[7px] w-[7px] rounded-full bg-amber-400 group-hover:hidden' />
            )}
            {!isActive && isUnread && !isCurrentRoute && !isMenuOpen && (
              <span className='absolute h-[7px] w-[7px] rounded-full bg-[var(--brand-accent)] group-hover:hidden' />
            )}
            <button
              type='button'
              aria-label='Task options'
              onPointerDown={onMorePointerDown}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onMoreClick(e, task.id)
              }}
              className={cn(
                'flex h-[18px] w-[18px] items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100',
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
  const Icon = item.icon
  const baseClasses = 'group flex h-[30px] items-center gap-2 rounded-lg mx-0.5 px-2 text-sm'
  const hoverClasses = !active ? 'hover-hover:bg-[var(--surface-hover)]' : ''
  const activeClasses = active ? 'bg-[var(--surface-active)]' : ''

  const content = (
    <>
      <Icon className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
      <span className='truncate font-base text-[var(--text-body)]'>{item.label}</span>
    </>
  )

  const element = item.href ? (
    <Link
      href={item.href}
      data-item-id={item.id}
      data-tour={`nav-${item.id}`}
      className={`${baseClasses} ${hoverClasses} ${activeClasses}`}
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
      {content}
    </Link>
  ) : item.onClick ? (
    <button
      type='button'
      data-item-id={item.id}
      data-tour={`nav-${item.id}`}
      className={`${baseClasses} ${hoverClasses} ${activeClasses}`}
      onClick={item.onClick}
    >
      {content}
    </button>
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
export const Sidebar = memo(function Sidebar() {
  const brand = getBrandConfig()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const workflowId = params.workflowId as string | undefined
  const router = useRouter()
  const pathname = usePathname()

  const sidebarRef = useRef<HTMLElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const posthog = usePostHog()
  const { data: sessionData, isPending: sessionLoading } = useSession()
  const { canEdit } = useUserPermissionsContext()
  const { config: permissionConfig, filterBlocks } = usePermissionConfig()
  const { navigateToSettings, getSettingsHref } = useSettingsNavigation()
  const initializeSearchData = useSearchModalStore((state) => state.initializeData)

  useEffect(() => {
    initializeSearchData(filterBlocks)
  }, [initializeSearchData, filterBlocks])

  const setSidebarWidth = useSidebarStore((state) => state.setSidebarWidth)
  const isCollapsed = useSidebarStore((state) => state.isCollapsed)
  const toggleCollapsed = useSidebarStore((state) => state.toggleCollapsed)
  const _hasHydrated = useSidebarStore((state) => state._hasHydrated)
  const isOnWorkflowPage = !!workflowId

  const isCollapsedRef = useRef(isCollapsed)
  useLayoutEffect(() => {
    isCollapsedRef.current = isCollapsed
  }, [isCollapsed])

  const isMac = useMemo(() => isMacPlatform(), [])

  const [showCollapsedTooltips, setShowCollapsedTooltips] = useState(isCollapsed)

  useLayoutEffect(() => {
    if (!_hasHydrated) return
    document.documentElement.removeAttribute('data-sidebar-collapsed')
  }, [_hasHydrated])

  useEffect(() => {
    if (isCollapsed) {
      const timer = setTimeout(() => setShowCollapsedTooltips(true), 200)
      return () => clearTimeout(timer)
    }
    setShowCollapsedTooltips(false)
  }, [isCollapsed])

  const workspaceFileInputRef = useRef<HTMLInputElement>(null)

  const { isImporting, handleFileChange: handleImportFileChange } = useImportWorkflow({
    workspaceId,
  })
  const { isImporting: isImportingWorkspace, handleImportWorkspace: importWorkspace } =
    useImportWorkspace()
  const { handleExportWorkspace: exportWorkspace } = useExportWorkspace()

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
    activeWorkspace,
    isWorkspacesLoading,
    switchWorkspace,
    handleCreateWorkspace,
    isCreatingWorkspace,
    updateWorkspace,
    confirmDeleteWorkspace,
    handleLeaveWorkspace,
  } = useWorkspaceManagement({
    workspaceId,
    sessionUserId: sessionData?.user?.id,
  })

  const { handleMouseDown, isResizing } = useSidebarResize()

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

  const deleteTaskMutation = useDeleteTask(workspaceId)
  const deleteTasksMutation = useDeleteTasks(workspaceId)
  const markTaskReadMutation = useMarkTaskRead(workspaceId)
  const markTaskUnreadMutation = useMarkTaskUnread(workspaceId)
  const renameTaskMutation = useRenameTask(workspaceId)
  const tasksHover = useHoverMenu()
  const workflowsHover = useHoverMenu()

  const {
    isOpen: isTaskContextMenuOpen,
    position: taskContextMenuPosition,
    menuRef: taskMenuRef,
    handleContextMenu: handleTaskContextMenuBase,
    closeMenu: closeTaskContextMenu,
    preventDismiss: preventTaskDismiss,
  } = useContextMenu()

  const contextMenuSelectionRef = useRef<{ taskIds: string[]; names: string[] }>({
    taskIds: [],
    names: [],
  })
  const [menuOpenTaskId, setMenuOpenTaskId] = useState<string | null>(null)

  useEffect(() => {
    if (!isTaskContextMenuOpen) setMenuOpenTaskId(null)
  }, [isTaskContextMenuOpen])

  const captureTaskSelection = useCallback((taskId: string) => {
    const { selectedTasks, selectTaskOnly } = useFolderStore.getState()
    if (selectedTasks.size > 0 && selectedTasks.has(taskId)) {
      contextMenuSelectionRef.current = {
        taskIds: Array.from(selectedTasks),
        names: [],
      }
    } else {
      selectTaskOnly(taskId)
      contextMenuSelectionRef.current = { taskIds: [taskId], names: [] }
    }
  }, [])

  const handleTaskContextMenu = useCallback(
    (e: React.MouseEvent, taskId: string) => {
      captureTaskSelection(taskId)
      setMenuOpenTaskId(taskId)
      tasksHover.setLocked(true)
      preventTaskDismiss()
      handleTaskContextMenuBase(e)
    },
    [captureTaskSelection, handleTaskContextMenuBase, preventTaskDismiss, tasksHover]
  )

  const handleTaskMorePointerDown = useCallback(() => {
    if (isTaskContextMenuOpen) {
      preventTaskDismiss()
    }
  }, [isTaskContextMenuOpen, preventTaskDismiss])

  const handleTaskMoreClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, taskId: string) => {
      if (isTaskContextMenuOpen) {
        closeTaskContextMenu()
        return
      }
      tasksHover.setLocked(true)
      captureTaskSelection(taskId)
      setMenuOpenTaskId(taskId)
      const rect = e.currentTarget.getBoundingClientRect()
      handleTaskContextMenuBase({
        preventDefault: () => {},
        stopPropagation: () => {},
        clientX: rect.right,
        clientY: rect.top,
      } as React.MouseEvent)
    },
    [
      isTaskContextMenuOpen,
      closeTaskContextMenu,
      captureTaskSelection,
      handleTaskContextMenuBase,
      tasksHover,
    ]
  )

  const { handleDuplicateWorkspace: duplicateWorkspace } = useDuplicateWorkspace({
    workspaceId,
  })

  const searchModalWorkflows = useMemo(
    () =>
      regularWorkflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        href: `/workspace/${workspaceId}/w/${workflow.id}`,
        color: workflow.color,
        isCurrent: workflow.id === workflowId,
      })),
    [regularWorkflows, workspaceId, workflowId]
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
    () => [
      {
        id: 'home',
        label: 'Home',
        icon: Home,
        href: `/workspace/${workspaceId}/home`,
      },
      {
        id: 'search',
        label: 'Search',
        icon: Search,
        onClick: openSearchModal,
      },
    ],
    [workspaceId, openSearchModal]
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
          icon: File,
          href: `/workspace/${workspaceId}/files`,
          hidden: permissionConfig.hideFilesTab,
        },
        {
          id: 'knowledge-base',
          label: 'Knowledge Base',
          icon: Database,
          href: `/workspace/${workspaceId}/knowledge`,
          hidden: permissionConfig.hideKnowledgeBaseTab,
        },
        {
          id: 'scheduled-tasks',
          label: 'Scheduled Tasks',
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
      permissionConfig.hideKnowledgeBaseTab,
      permissionConfig.hideTablesTab,
      permissionConfig.hideFilesTab,
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

  const handleStartTour = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent(isOnWorkflowPage ? START_WORKFLOW_TOUR_EVENT : START_NAV_TOUR_EVENT)
    )
  }, [isOnWorkflowPage])

  const { data: fetchedTasks = [], isLoading: tasksLoading } = useTasks(workspaceId)

  useTaskEvents(workspaceId)

  const tasks = useMemo(
    () =>
      fetchedTasks.length > 0
        ? fetchedTasks.map((t) => ({
            ...t,
            href: `/workspace/${workspaceId}/task/${t.id}`,
          }))
        : [
            {
              id: 'new',
              name: 'New task',
              href: `/workspace/${workspaceId}/home`,
              isActive: false,
              isUnread: false,
            },
          ],
    [fetchedTasks, workspaceId]
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

  const taskIds = useMemo(() => tasks.map((t) => t.id).filter((id) => id !== 'new'), [tasks])

  const { selectedTasks, handleTaskClick } = useTaskSelection({ taskIds })

  const isMultiTaskContextMenu = contextMenuSelectionRef.current.taskIds.length > 1
  const activeTaskContextMenuItem =
    !isMultiTaskContextMenu && contextMenuSelectionRef.current.taskIds.length === 1
      ? tasks.find((task) => task.id === contextMenuSelectionRef.current.taskIds[0])
      : null

  const [isTaskDeleteModalOpen, setIsTaskDeleteModalOpen] = useState(false)

  const handleDeleteTask = useCallback(() => {
    const { taskIds: ids } = contextMenuSelectionRef.current
    if (ids.length === 0) return
    const names = ids.map((id) => tasks.find((t) => t.id === id)?.name).filter(Boolean) as string[]
    contextMenuSelectionRef.current = { taskIds: ids, names }
    setIsTaskDeleteModalOpen(true)
  }, [tasks])

  const navigateToPage = useCallback(
    (path: string) => {
      if (!isCollapsedRef.current) {
        setSidebarWidth(SIDEBAR_WIDTH.MIN)
      }
      router.push(path)
    },
    [setSidebarWidth, router]
  )

  const handleConfirmDeleteTasks = useCallback(() => {
    const { taskIds: taskIdsToDelete } = contextMenuSelectionRef.current
    if (taskIdsToDelete.length === 0) return

    const currentPath = pathname ?? ''
    const isViewingDeletedTask = taskIdsToDelete.some(
      (id) => currentPath === `/workspace/${workspaceId}/task/${id}`
    )

    const onDeleteSuccess = () => {
      useFolderStore.getState().clearTaskSelection()
      if (isViewingDeletedTask) {
        navigateToPage(`/workspace/${workspaceId}/home`)
      }
    }

    if (taskIdsToDelete.length === 1) {
      deleteTaskMutation.mutate(taskIdsToDelete[0], { onSuccess: onDeleteSuccess })
    } else {
      deleteTasksMutation.mutate(taskIdsToDelete, { onSuccess: onDeleteSuccess })
    }
    setIsTaskDeleteModalOpen(false)
  }, [pathname, workspaceId, deleteTaskMutation, deleteTasksMutation, navigateToPage])

  const [visibleTaskCount, setVisibleTaskCount] = useState(5)
  const taskFlyoutRename = useFlyoutInlineRename({
    itemType: 'task',
    onSave: async (taskId, name) => {
      await renameTaskMutation.mutateAsync({ chatId: taskId, title: name })
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
    tasksHover.setLocked(isTaskContextMenuOpen || !!taskFlyoutRename.editingId)
  }, [isTaskContextMenuOpen, taskFlyoutRename.editingId, tasksHover.setLocked])

  useEffect(() => {
    workflowsHover.setLocked(!!workflowFlyoutRename.editingId)
  }, [workflowFlyoutRename.editingId, workflowsHover.setLocked])

  const handleTaskOpenInNewTab = useCallback(() => {
    const { taskIds: ids } = contextMenuSelectionRef.current
    if (ids.length !== 1) return
    window.open(`/workspace/${workspaceId}/task/${ids[0]}`, '_blank', 'noopener,noreferrer')
  }, [workspaceId])

  const handleMarkTaskAsRead = useCallback(() => {
    const { taskIds: ids } = contextMenuSelectionRef.current
    if (ids.length !== 1) return
    markTaskReadMutation.mutate(ids[0])
  }, [markTaskReadMutation])

  const handleMarkTaskAsUnread = useCallback(() => {
    const { taskIds: ids } = contextMenuSelectionRef.current
    if (ids.length !== 1) return
    markTaskUnreadMutation.mutate(ids[0])
  }, [markTaskUnreadMutation])

  const handleStartTaskRename = useCallback(() => {
    const { taskIds: ids } = contextMenuSelectionRef.current
    if (ids.length !== 1) return
    const taskId = ids[0]
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
    tasksHover.setLocked(true)
    taskFlyoutRename.startRename({ id: taskId, name: task.name })
  }, [taskFlyoutRename, tasks, tasksHover])

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

    return () => {
      container.removeEventListener('scroll', updateScrollState)
      observer.disconnect()
    }
  }, [])

  const isOnSettingsPage = pathname?.startsWith(`/workspace/${workspaceId}/settings`) ?? false

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

  useEffect(() => {
    if (!isOnWorkflowPage && !isCollapsed) {
      setSidebarWidth(SIDEBAR_WIDTH.MIN)
    }
  }, [isOnWorkflowPage, isCollapsed, setSidebarWidth])

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

  const handleImportWorkflow = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleWorkspaceSwitch = useCallback(
    async (workspace: { id: string; name: string; ownerId: string; role?: string }) => {
      if (workspace.id === workspaceId) {
        setIsWorkspaceMenuOpen(false)
        return
      }
      await switchWorkspace(workspace)
      setIsWorkspaceMenuOpen(false)
    },
    [workspaceId, switchWorkspace]
  )

  const handleSidebarClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'BUTTON' || target.closest('button, [role="button"], a')) {
        return
      }
      const { selectOnly, clearAllSelection } = useFolderStore.getState()
      workflowId ? selectOnly(workflowId) : clearAllSelection()
    },
    [workflowId]
  )

  const handleRenameWorkspace = useCallback(
    async (workspaceIdToRename: string, newName: string) => {
      await updateWorkspace(workspaceIdToRename, { name: newName })
    },
    [updateWorkspace]
  )

  const handleColorChangeWorkspace = useCallback(
    async (workspaceIdToUpdate: string, color: string) => {
      await updateWorkspace(workspaceIdToUpdate, { color })
    },
    [updateWorkspace]
  )

  const handleDeleteWorkspace = useCallback(
    async (workspaceIdToDelete: string) => {
      const workspaceToDelete = workspaces.find((w) => w.id === workspaceIdToDelete)
      if (workspaceToDelete) {
        await confirmDeleteWorkspace(workspaceToDelete, 'keep')
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

  const handleDuplicateWorkspace = useCallback(
    async (_workspaceIdToDuplicate: string, workspaceName: string) => {
      await duplicateWorkspace(workspaceName)
    },
    [duplicateWorkspace]
  )

  const handleImportWorkspace = useCallback(() => {
    workspaceFileInputRef.current?.click()
  }, [])

  const handleWorkspaceFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (!files || files.length === 0) return

      const zipFile = files[0]
      await importWorkspace(zipFile)

      if (event.target) {
        event.target.value = ''
      }
    },
    [importWorkspace]
  )

  const tasksCollapsedIcon = useMemo(
    () => <Blimp className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />,
    []
  )

  const workflowIconStyle = useMemo<React.CSSProperties>(
    () => ({
      backgroundColor: 'var(--text-icon)',
      borderColor: 'color-mix(in srgb, var(--text-icon) 60%, transparent)',
      backgroundClip: 'padding-box',
    }),
    []
  )

  const workflowsCollapsedIcon = useMemo(
    () => (
      <div
        className='h-[16px] w-[16px] flex-shrink-0 rounded-sm border-[2.5px]'
        style={workflowIconStyle}
      />
    ),
    [workflowIconStyle]
  )

  const tasksPrimaryAction = useMemo(
    () => ({
      label: 'New task',
      onSelect: () => navigateToPage(`/workspace/${workspaceId}/home`),
    }),
    [navigateToPage, workspaceId]
  )

  const workflowsPrimaryAction = useMemo(
    () => ({
      label: 'New workflow',
      onSelect: handleCreateWorkflow,
    }),
    [handleCreateWorkflow]
  )

  const handleExpandSidebar = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      toggleCollapsed()
    },
    [toggleCollapsed]
  )

  const handleNewTask = useCallback(
    () => navigateToPage(`/workspace/${workspaceId}/home`),
    [navigateToPage, workspaceId]
  )

  const handleSeeMoreTasks = useCallback(() => setVisibleTaskCount((prev) => prev + 5), [])

  const handleCloseTaskDeleteModal = useCallback(() => setIsTaskDeleteModalOpen(false), [])

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

  const handleTaskRenameBlur = useCallback(
    () => void taskFlyoutRename.saveRename(),
    [taskFlyoutRename.saveRename]
  )

  const handleWorkflowRenameBlur = useCallback(
    () => void workflowFlyoutRename.saveRename(),
    [workflowFlyoutRename.saveRename]
  )

  const hiddenStyle = useMemo(() => ({ display: 'none' }) as const, [])

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
      // {
      //   id: 'goto-templates',
      //   handler: () => {
      //     try {
      //       const pathWorkspaceId = resolveWorkspaceIdFromPath()
      //       if (pathWorkspaceId) {
      //         navigateToPage(`/workspace/${pathWorkspaceId}/templates`)
      //         logger.info('Navigated to templates', { workspaceId: pathWorkspaceId })
      //       } else {
      //         logger.warn('No workspace ID found, cannot navigate to templates')
      //       }
      //     } catch (err) {
      //       logger.error('Failed to navigate to templates', { err })
      //     }
      //   },
      // },
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
      {
        id: 'add-task',
        handler: () => {
          handleNewTask()
        },
      },
    ])
  )

  return (
    <>
      <div className='relative h-full'>
        <aside
          ref={sidebarRef}
          className={cn(
            'sidebar-container relative h-full overflow-hidden bg-[var(--surface-1)]',
            isResizing && 'is-resizing'
          )}
          data-collapsed={isCollapsed || undefined}
          aria-label='Workspace sidebar'
          onClick={handleSidebarClick}
        >
          <div className='flex h-full flex-col pt-3'>
            <div className='flex flex-shrink-0 items-center pr-2 pb-2 pl-2.5'>
              <div className='flex h-[30px] items-center'>
                <div className='relative h-[30px]'>
                  <Link
                    href={`/workspace/${workspaceId}/home`}
                    className='sidebar-collapse-hide !transition-none group flex h-[30px] items-center rounded-[8px] px-[7px] hover-hover:bg-[var(--surface-hover)]'
                    tabIndex={isCollapsed ? -1 : undefined}
                    aria-label={brand.name}
                  >
                    {brand.logoUrl ? (
                      <Image
                        src={brand.logoUrl}
                        alt={brand.name}
                        width={16}
                        height={16}
                        className='h-[16px] w-[16px] flex-shrink-0 object-contain'
                        unoptimized
                      />
                    ) : (
                      <Wordmark className='h-[16px] w-auto text-[var(--text-body)]' />
                    )}
                  </Link>
                  <SidebarTooltip label='Expand sidebar' enabled={showCollapsedTooltips}>
                    <Link
                      href={`/workspace/${workspaceId}/home`}
                      onClick={handleExpandSidebar}
                      className='sidebar-collapse-show !transition-none group absolute top-0 left-0 flex h-[30px] w-[30px] items-center justify-center rounded-[8px] hover-hover:bg-[var(--surface-hover)]'
                      tabIndex={isCollapsed ? undefined : -1}
                      aria-label='Expand sidebar'
                    >
                      {brand.logoUrl ? (
                        <Image
                          src={brand.logoUrl}
                          alt=''
                          width={16}
                          height={16}
                          className='h-[16px] w-[16px] flex-shrink-0 object-contain group-hover:hidden'
                          unoptimized
                        />
                      ) : (
                        <Sim className='h-[16px] w-[16px] flex-shrink-0 group-hover:hidden' />
                      )}
                      <PanelLeft className='hidden h-[16px] w-[16px] rotate-180 text-[var(--text-icon)] group-hover:block' />
                    </Link>
                  </SidebarTooltip>
                </div>
              </div>
              <SidebarTooltip label='Collapse sidebar' enabled={!isCollapsed} side='bottom'>
                <button
                  type='button'
                  onClick={toggleCollapsed}
                  className={cn(
                    'sidebar-collapse-btn ml-auto flex h-[30px] items-center justify-center overflow-hidden rounded-lg transition-all duration-200 hover-hover:bg-[var(--surface-hover)]',
                    isCollapsed ? 'w-0 opacity-0' : 'w-[30px] opacity-100'
                  )}
                  aria-label='Collapse sidebar'
                >
                  <PanelLeft className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
                </button>
              </SidebarTooltip>
            </div>

            <div className='flex-shrink-0 pr-2.5 pl-[9px]'>
              <WorkspaceHeader
                activeWorkspace={activeWorkspace}
                workspaceId={workspaceId}
                workspaces={workspaces}
                isWorkspacesLoading={isWorkspacesLoading}
                isCreatingWorkspace={isCreatingWorkspace}
                isWorkspaceMenuOpen={isWorkspaceMenuOpen}
                setIsWorkspaceMenuOpen={setIsWorkspaceMenuOpen}
                onWorkspaceSwitch={handleWorkspaceSwitch}
                onCreateWorkspace={handleCreateWorkspace}
                onRenameWorkspace={handleRenameWorkspace}
                onDeleteWorkspace={handleDeleteWorkspace}
                onDuplicateWorkspace={handleDuplicateWorkspace}
                onExportWorkspace={exportWorkspace}
                onImportWorkspace={handleImportWorkspace}
                isImportingWorkspace={isImportingWorkspace}
                onColorChange={handleColorChangeWorkspace}
                onLeaveWorkspace={handleLeaveWorkspaceWrapper}
                sessionUserId={sessionData?.user?.id}
                isCollapsed={isCollapsed}
              />
            </div>

            {isOnSettingsPage ? (
              <SettingsSidebar
                isCollapsed={isCollapsed}
                showCollapsedTooltips={showCollapsedTooltips}
              />
            ) : (
              <>
                <div className='mt-2.5 flex flex-shrink-0 flex-col gap-0.5 px-2'>
                  {topNavItems.map((item) => (
                    <SidebarNavItem
                      key={item.id}
                      item={item}
                      active={item.href ? !!pathname?.startsWith(item.href) : false}
                      showCollapsedTooltips={showCollapsedTooltips}
                      onContextMenu={item.href ? handleNavItemContextMenu : undefined}
                    />
                  ))}
                </div>

                <div className='mt-3.5 flex flex-shrink-0 flex-col pb-2'>
                  <div className='px-4 pb-1.5'>
                    <div className='font-base text-[var(--text-icon)] text-small'>Workspace</div>
                  </div>
                  <div className='flex flex-col gap-0.5 px-2'>
                    {workspaceNavItems.map((item) => (
                      <SidebarNavItem
                        key={item.id}
                        item={item}
                        active={item.href ? !!pathname?.startsWith(item.href) : false}
                        showCollapsedTooltips={showCollapsedTooltips}
                        onContextMenu={handleNavItemContextMenu}
                      />
                    ))}
                  </div>
                </div>

                <div
                  ref={isCollapsed ? undefined : scrollContainerRef}
                  className={cn(
                    'flex flex-1 flex-col overflow-y-auto overflow-x-hidden border-t pt-2.5 transition-colors duration-150',
                    !hasOverflowTop && 'border-transparent'
                  )}
                >
                  <div className='tasks-section flex flex-shrink-0 flex-col' data-tour='nav-tasks'>
                    <div className='flex h-[18px] flex-shrink-0 items-center justify-between px-4'>
                      <div className='font-base text-[var(--text-icon)] text-small'>All tasks</div>
                      {!isCollapsed && (
                        <div className='flex items-center justify-center gap-2'>
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>
                              <Button
                                variant='ghost'
                                className='h-[18px] w-[18px] rounded-sm p-0 hover-hover:bg-[var(--surface-hover)]'
                                onClick={handleNewTask}
                              >
                                <Plus className='h-[16px] w-[16px]' />
                              </Button>
                            </Tooltip.Trigger>
                            <Tooltip.Content>
                              <Tooltip.Shortcut keys={isMac ? '⌘⇧K' : 'Ctrl+Shift+K'}>
                                New task
                              </Tooltip.Shortcut>
                            </Tooltip.Content>
                          </Tooltip.Root>
                        </div>
                      )}
                    </div>
                    {isCollapsed ? (
                      <CollapsedSidebarMenu
                        icon={tasksCollapsedIcon}
                        hover={tasksHover}
                        ariaLabel='Tasks'
                        className='mt-1.5'
                        primaryAction={tasksPrimaryAction}
                      >
                        {tasksLoading ? (
                          <DropdownMenuItem disabled>
                            <Loader className='h-[14px] w-[14px]' animate />
                            Loading...
                          </DropdownMenuItem>
                        ) : (
                          tasks.map((task) => (
                            <CollapsedTaskFlyoutItem
                              key={task.id}
                              task={task}
                              isCurrentRoute={task.id !== 'new' && pathname === task.href}
                              isMenuOpen={menuOpenTaskId === task.id}
                              isEditing={task.id === taskFlyoutRename.editingId}
                              editValue={taskFlyoutRename.value}
                              inputRef={taskFlyoutRename.inputRef}
                              isRenaming={taskFlyoutRename.isSaving}
                              onEditValueChange={taskFlyoutRename.setValue}
                              onEditKeyDown={taskFlyoutRename.handleKeyDown}
                              onEditBlur={handleTaskRenameBlur}
                              onContextMenu={handleTaskContextMenu}
                              onMorePointerDown={handleTaskMorePointerDown}
                              onMoreClick={handleTaskMoreClick}
                            />
                          ))
                        )}
                      </CollapsedSidebarMenu>
                    ) : (
                      <div className='mt-1.5 flex flex-col gap-0.5 px-2'>
                        {tasksLoading ? (
                          <SidebarItemSkeleton />
                        ) : (
                          <>
                            {tasks.slice(0, visibleTaskCount).map((task) => {
                              const isCurrentRoute = task.id !== 'new' && pathname === task.href
                              const isRenaming = taskFlyoutRename.editingId === task.id
                              const isSelected = task.id !== 'new' && selectedTasks.has(task.id)

                              if (isRenaming) {
                                return (
                                  <div
                                    key={task.id}
                                    className='mx-0.5 flex h-[30px] items-center gap-2 rounded-lg bg-[var(--surface-active)] px-2 text-sm'
                                  >
                                    <Blimp className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
                                    <input
                                      ref={taskFlyoutRename.inputRef}
                                      value={taskFlyoutRename.value}
                                      onChange={(e) => taskFlyoutRename.setValue(e.target.value)}
                                      onKeyDown={taskFlyoutRename.handleKeyDown}
                                      onBlur={handleTaskRenameBlur}
                                      className='min-w-0 flex-1 border-none bg-transparent font-base text-[14px] text-[var(--text-body)] outline-none'
                                    />
                                  </div>
                                )
                              }

                              return (
                                <SidebarTaskItem
                                  key={task.id}
                                  task={task}
                                  isCurrentRoute={isCurrentRoute}
                                  isSelected={isSelected}
                                  isActive={!!task.isActive}
                                  isUnread={!!task.isUnread}
                                  isMenuOpen={menuOpenTaskId === task.id}
                                  showCollapsedTooltips={showCollapsedTooltips}
                                  onMultiSelectClick={handleTaskClick}
                                  onContextMenu={handleTaskContextMenu}
                                  onMorePointerDown={handleTaskMorePointerDown}
                                  onMoreClick={handleTaskMoreClick}
                                />
                              )
                            })}
                            {tasks.length > visibleTaskCount && (
                              <button
                                type='button'
                                onClick={handleSeeMoreTasks}
                                className='mx-0.5 flex h-[30px] items-center gap-2 rounded-lg px-2 text-[var(--text-icon)] text-sm hover-hover:bg-[var(--surface-hover)]'
                              >
                                <MoreHorizontal className='h-[16px] w-[16px] flex-shrink-0' />
                                <span className='font-base'>See more</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div
                    className='workflows-section relative mt-3.5 flex flex-col'
                    data-tour='nav-workflows'
                  >
                    <div className='flex h-[18px] flex-shrink-0 items-center justify-between px-4'>
                      <div className='font-base text-[var(--text-icon)] text-small'>Workflows</div>
                      {!isCollapsed && (
                        <div className='flex items-center justify-center gap-2'>
                          <DropdownMenu>
                            <Tooltip.Root>
                              <Tooltip.Trigger asChild>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant='ghost'
                                    className='h-[18px] w-[18px] rounded-sm p-0 hover-hover:bg-[var(--surface-hover)]'
                                    disabled={!canEdit}
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
                                <Download />
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
                                variant='ghost'
                                className='h-[18px] w-[18px] rounded-sm p-0 hover-hover:bg-[var(--surface-hover)]'
                                onClick={handleCreateWorkflow}
                                disabled={isCreatingWorkflow || !canEdit}
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
                        className='mt-1.5'
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
                            <CollapsedFolderItems
                              nodes={folderTree}
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
                            {(workflowsByFolder.root || []).map((workflow) => (
                              <CollapsedWorkflowFlyoutItem
                                key={workflow.id}
                                workflow={workflow}
                                href={`/workspace/${workspaceId}/w/${workflow.id}`}
                                isCurrentRoute={workflow.id === workflowId}
                                isEditing={workflow.id === workflowFlyoutRename.editingId}
                                editValue={workflowFlyoutRename.value}
                                inputRef={workflowFlyoutRename.inputRef}
                                isRenaming={workflowFlyoutRename.isSaving}
                                onEditValueChange={workflowFlyoutRename.setValue}
                                onEditKeyDown={workflowFlyoutRename.handleKeyDown}
                                onEditBlur={handleWorkflowRenameBlur}
                                onOpenInNewTab={() => handleCollapsedWorkflowOpenInNewTab(workflow)}
                                onRename={() => handleCollapsedWorkflowRename(workflow)}
                                canRename={canEdit}
                              />
                            ))}
                          </>
                        )}
                      </CollapsedSidebarMenu>
                    ) : (
                      <div className='mt-1.5 px-2'>
                        {workflowsLoading && regularWorkflows.length === 0 && (
                          <SidebarItemSkeleton />
                        )}
                        <WorkflowList
                          workspaceId={workspaceId}
                          workflowId={workflowId}
                          regularWorkflows={regularWorkflows}
                          isLoading={isLoading}
                          canReorder={canEdit}
                          handleFileChange={handleImportFileChange}
                          fileInputRef={fileInputRef}
                          scrollContainerRef={scrollContainerRef}
                          onCreateWorkflow={handleCreateWorkflow}
                          onCreateFolder={handleCreateFolder}
                          disableCreate={!canEdit || isCreatingWorkflow || isCreatingFolder}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div
                  className={cn(
                    'flex flex-shrink-0 flex-col gap-0.5 border-t px-2 pt-[9px] pb-2 transition-colors duration-150',
                    !hasOverflowBottom && 'border-transparent'
                  )}
                >
                  <DropdownMenu>
                    <SidebarTooltip label='Help' enabled={showCollapsedTooltips}>
                      <DropdownMenuTrigger asChild>
                        <button
                          type='button'
                          data-item-id='help'
                          className='group mx-0.5 flex h-[30px] items-center gap-2 rounded-[8px] px-2 text-[14px] hover-hover:bg-[var(--surface-hover)]'
                        >
                          <HelpCircle className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
                          <span className='sidebar-collapse-hide truncate font-base text-[var(--text-body)]'>
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
                      <DropdownMenuItem onSelect={handleStartTour}>
                        <Compass className='h-[14px] w-[14px]' />
                        Take a tour
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
                  isOpen={isTaskContextMenuOpen}
                  position={taskContextMenuPosition}
                  menuRef={taskMenuRef}
                  onClose={closeTaskContextMenu}
                  onOpenInNewTab={handleTaskOpenInNewTab}
                  onMarkAsRead={handleMarkTaskAsRead}
                  onMarkAsUnread={handleMarkTaskAsUnread}
                  onRename={handleStartTaskRename}
                  onDelete={handleDeleteTask}
                  showOpenInNewTab={!isMultiTaskContextMenu}
                  showMarkAsRead={!isMultiTaskContextMenu && !!activeTaskContextMenuItem?.isUnread}
                  showMarkAsUnread={
                    !isMultiTaskContextMenu &&
                    !!activeTaskContextMenuItem &&
                    !activeTaskContextMenuItem.isUnread
                  }
                  showRename={!isMultiTaskContextMenu}
                  showDuplicate={false}
                  showColorChange={false}
                  disableRename={!canEdit}
                  disableDelete={!canEdit}
                />

                <DeleteModal
                  isOpen={isTaskDeleteModalOpen}
                  onClose={handleCloseTaskDeleteModal}
                  onConfirm={handleConfirmDeleteTasks}
                  isDeleting={deleteTaskMutation.isPending || deleteTasksMutation.isPending}
                  itemType='task'
                  itemName={contextMenuSelectionRef.current.names}
                />
              </>
            )}
          </div>
        </aside>

        {(isCollapsed || isOnWorkflowPage) && (
          <div
            className={cn(
              'absolute top-0 right-0 bottom-0 z-20 w-[8px] translate-x-1/2',
              isCollapsed ? 'cursor-e-resize' : 'cursor-ew-resize'
            )}
            onMouseDown={isCollapsed ? undefined : handleMouseDown}
            onClick={isCollapsed ? toggleCollapsed : undefined}
            onKeyDown={isCollapsed ? handleEdgeKeyDown : undefined}
            role={isCollapsed ? 'button' : 'separator'}
            tabIndex={isCollapsed ? 0 : undefined}
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
        tasks={tasks}
        tables={searchModalTables}
        files={searchModalFiles}
        knowledgeBases={searchModalKnowledgeBases}
        isOnWorkflowPage={!!workflowId}
      />

      <HelpModal
        open={isHelpModalOpen}
        onOpenChange={setIsHelpModalOpen}
        workflowId={workflowId}
        workspaceId={workspaceId}
      />
      <input
        ref={workspaceFileInputRef}
        type='file'
        accept='.zip'
        style={hiddenStyle}
        onChange={handleWorkspaceFileChange}
      />
    </>
  )
})
