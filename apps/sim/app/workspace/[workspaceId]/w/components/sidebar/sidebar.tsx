'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { MoreHorizontal } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
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
} from '@/components/emcn/icons'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import {
  CollapsedFolderItems,
  CollapsedSidebarMenu,
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
import { useFolders } from '@/hooks/queries/folders'
import { useDeleteTask, useDeleteTasks, useRenameTask, useTasks } from '@/hooks/queries/tasks'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useTaskEvents } from '@/hooks/use-task-events'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { useFolderStore } from '@/stores/folders/store'
import { useSearchModalStore } from '@/stores/modals/search/store'
import { useSidebarStore } from '@/stores/sidebar/store'

const logger = createLogger('Sidebar')

function SidebarItemSkeleton() {
  return (
    <div className='sidebar-collapse-hide mx-[2px] flex h-[30px] items-center px-[8px]'>
      <Skeleton className='h-[24px] w-full rounded-[4px]' />
    </div>
  )
}

const SidebarTaskItem = memo(function SidebarTaskItem({
  task,
  isCurrentRoute,
  isSelected,
  isActive,
  isUnread,
  showCollapsedContent,
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
  showCollapsedContent: boolean
  onMultiSelectClick: (taskId: string, shiftKey: boolean, metaKey: boolean) => void
  onContextMenu: (e: React.MouseEvent, taskId: string) => void
  onMorePointerDown: () => void
  onMoreClick: (e: React.MouseEvent<HTMLButtonElement>, taskId: string) => void
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Link
          href={task.href}
          className={cn(
            'group mx-[2px] flex h-[30px] items-center gap-[8px] rounded-[8px] px-[8px] text-[14px] hover:bg-[var(--surface-active)]',
            (isCurrentRoute || isSelected) && 'bg-[var(--surface-active)]'
          )}
          onClick={(e) => {
            if (task.id === 'new') return
            if (e.shiftKey || e.metaKey || e.ctrlKey) {
              e.preventDefault()
              onMultiSelectClick(task.id, e.shiftKey, e.metaKey || e.ctrlKey)
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
          <div className='min-w-0 flex-1 truncate font-base text-[var(--text-body)]'>
            {task.name}
          </div>
          {task.id !== 'new' && (
            <div className='relative flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center'>
              {isActive && !isCurrentRoute && (
                <span className='absolute h-[7px] w-[7px] animate-ping rounded-full bg-amber-400 opacity-30 group-hover:hidden' />
              )}
              {isActive && !isCurrentRoute && (
                <span className='absolute h-[7px] w-[7px] rounded-full bg-amber-400 group-hover:hidden' />
              )}
              {!isActive && isUnread && !isCurrentRoute && (
                <span className='absolute h-[7px] w-[7px] rounded-full bg-[#33C482] group-hover:hidden' />
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
                className='flex h-[18px] w-[18px] items-center justify-center rounded-[4px] opacity-0 hover:bg-[var(--surface-7)] group-hover:opacity-100'
              >
                <MoreHorizontal className='h-[16px] w-[16px] text-[var(--text-icon)]' />
              </button>
            </div>
          )}
        </Link>
      </Tooltip.Trigger>
      {showCollapsedContent && (
        <Tooltip.Content side='right'>
          <p>{task.name}</p>
        </Tooltip.Content>
      )}
    </Tooltip.Root>
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
  showCollapsedContent,
  onContextMenu,
}: {
  item: SidebarNavItemData
  active: boolean
  showCollapsedContent: boolean
  onContextMenu?: (e: React.MouseEvent, href: string) => void
}) {
  const Icon = item.icon
  const baseClasses =
    'group flex h-[30px] items-center gap-[8px] rounded-[8px] mx-[2px] px-[8px] text-[14px] hover:bg-[var(--surface-active)]'
  const activeClasses = active ? 'bg-[var(--surface-active)]' : ''

  const element = item.onClick ? (
    <button
      type='button'
      data-item-id={item.id}
      className={`${baseClasses} ${activeClasses}`}
      onClick={item.onClick}
    >
      <Icon className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
      <span className='truncate font-base text-[var(--text-body)]'>{item.label}</span>
    </button>
  ) : (
    <Link
      href={item.href!}
      data-item-id={item.id}
      className={`${baseClasses} ${activeClasses}`}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, item.href!) : undefined}
    >
      <Icon className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
      <span className='truncate font-base text-[var(--text-body)]'>{item.label}</span>
    </Link>
  )

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{element}</Tooltip.Trigger>
      {showCollapsedContent && (
        <Tooltip.Content side='right'>
          <p>{item.label}</p>
        </Tooltip.Content>
      )}
    </Tooltip.Root>
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

  const { data: sessionData, isPending: sessionLoading } = useSession()
  const { canEdit } = useUserPermissionsContext()
  const { config: permissionConfig, filterBlocks } = usePermissionConfig()
  const { navigateToSettings } = useSettingsNavigation()
  const initializeSearchData = useSearchModalStore((state) => state.initializeData)

  useEffect(() => {
    initializeSearchData(filterBlocks)
  }, [initializeSearchData, filterBlocks])

  const setSidebarWidth = useSidebarStore((state) => state.setSidebarWidth)
  const isCollapsed = useSidebarStore((state) => state.isCollapsed)
  const toggleCollapsed = useSidebarStore((state) => state.toggleCollapsed)
  const isOnWorkflowPage = !!workflowId

  const [showCollapsedContent, setShowCollapsedContent] = useState(isCollapsed)

  useLayoutEffect(() => {
    if (!isCollapsed) {
      document.documentElement.removeAttribute('data-sidebar-collapsed')
    }
  }, [isCollapsed])

  useEffect(() => {
    if (isCollapsed) {
      const timer = setTimeout(() => setShowCollapsedContent(true), 200)
      return () => clearTimeout(timer)
    }
    setShowCollapsedContent(false)
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
  const folders = useFolderStore((s) => s.folders)
  const getFolderTree = useFolderStore((s) => s.getFolderTree)

  const folderTree = useMemo(
    () => (isCollapsed && workspaceId ? getFolderTree(workspaceId) : []),
    [isCollapsed, workspaceId, folders, getFolderTree]
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
  const renameTaskMutation = useRenameTask(workspaceId)

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
      handleTaskContextMenuBase(e)
    },
    [captureTaskSelection, handleTaskContextMenuBase]
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
      captureTaskSelection(taskId)
      const rect = e.currentTarget.getBoundingClientRect()
      handleTaskContextMenuBase({
        preventDefault: () => {},
        stopPropagation: () => {},
        clientX: rect.right,
        clientY: rect.top,
      } as React.MouseEvent)
    },
    [isTaskContextMenuOpen, closeTaskContextMenu, captureTaskSelection, handleTaskContextMenuBase]
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
        id: 'help',
        label: 'Help',
        icon: HelpCircle,
        onClick: () => setIsHelpModalOpen(true),
      },
      {
        id: 'settings',
        label: 'Settings',
        icon: Settings,
        onClick: () => {
          if (!isCollapsed) {
            setSidebarWidth(SIDEBAR_WIDTH.MIN)
          }
          navigateToSettings()
        },
      },
    ],
    [workspaceId, navigateToSettings, isCollapsed, setSidebarWidth]
  )

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

  const taskIds = useMemo(() => tasks.map((t) => t.id).filter((id) => id !== 'new'), [tasks])

  const { selectedTasks, handleTaskClick } = useTaskSelection({ taskIds })

  const isMultiTaskContextMenu = contextMenuSelectionRef.current.taskIds.length > 1

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
      if (!isCollapsed) {
        setSidebarWidth(SIDEBAR_WIDTH.MIN)
      }
      router.push(path)
    },
    [isCollapsed, setSidebarWidth, router]
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
  const [renamingTaskId, setRenamingTaskId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const tasksHover = useHoverMenu()
  const workflowsHover = useHoverMenu()
  const renameInputRef = useRef<HTMLInputElement>(null)
  const renameCanceledRef = useRef(false)

  useEffect(() => {
    if (renamingTaskId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingTaskId])

  const handleTaskOpenInNewTab = useCallback(() => {
    const { taskIds: ids } = contextMenuSelectionRef.current
    if (ids.length !== 1) return
    window.open(`/workspace/${workspaceId}/task/${ids[0]}`, '_blank', 'noopener,noreferrer')
  }, [workspaceId])

  const handleStartTaskRename = useCallback(() => {
    const { taskIds: ids } = contextMenuSelectionRef.current
    if (ids.length !== 1) return
    const taskId = ids[0]
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
    renameCanceledRef.current = false
    setRenamingTaskId(taskId)
    setRenameValue(task.name)
  }, [tasks])

  const handleSaveTaskRename = useCallback(() => {
    if (renameCanceledRef.current) {
      renameCanceledRef.current = false
      return
    }
    const trimmed = renameValue.trim()
    if (!renamingTaskId || !trimmed) {
      setRenamingTaskId(null)
      return
    }
    const task = tasks.find((t) => t.id === renamingTaskId)
    if (task && trimmed !== task.name) {
      renameTaskMutation.mutate({ chatId: renamingTaskId, title: trimmed })
    }
    setRenamingTaskId(null)
  }, [renamingTaskId, renameValue, tasks, renameTaskMutation])

  const handleCancelTaskRename = useCallback(() => {
    renameCanceledRef.current = true
    setRenamingTaskId(null)
  }, [])

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSaveTaskRename()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleCancelTaskRename()
      }
    },
    [handleSaveTaskRename, handleCancelTaskRename]
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
    ])
  )

  return (
    <>
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
        <div className='flex h-full flex-col pt-[12px]'>
          {/* Top bar: Logo + Collapse toggle */}
          <div className='flex flex-shrink-0 items-center pr-[8px] pb-[8px] pl-[10px]'>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                {showCollapsedContent ? (
                  <button
                    type='button'
                    onClick={toggleCollapsed}
                    className='group flex h-[30px] w-[30px] items-center justify-center rounded-[8px] hover:bg-[var(--surface-active)]'
                    aria-label='Expand sidebar'
                  >
                    {brand.logoUrl ? (
                      <Image
                        src={brand.logoUrl}
                        alt={brand.name}
                        width={16}
                        height={16}
                        className='h-[16px] w-[16px] object-contain group-hover:hidden'
                        unoptimized
                      />
                    ) : (
                      <Sim className='h-[16px] w-[16px] text-[var(--text-icon)] group-hover:hidden' />
                    )}
                    <PanelLeft className='hidden h-[16px] w-[16px] rotate-180 text-[var(--text-icon)] group-hover:block' />
                  </button>
                ) : (
                  <Link
                    href={`/workspace/${workspaceId}/home`}
                    className='flex h-[30px] w-[30px] items-center justify-center rounded-[8px] hover:bg-[var(--surface-active)]'
                  >
                    {brand.logoUrl ? (
                      <Image
                        src={brand.logoUrl}
                        alt={brand.name}
                        width={16}
                        height={16}
                        className='h-[16px] w-[16px] object-contain'
                        unoptimized
                      />
                    ) : (
                      <Sim className='h-[16px] w-[16px] text-[var(--text-icon)]' />
                    )}
                  </Link>
                )}
              </Tooltip.Trigger>
              {showCollapsedContent && (
                <Tooltip.Content side='right'>
                  <p>Expand sidebar</p>
                </Tooltip.Content>
              )}
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  type='button'
                  onClick={toggleCollapsed}
                  className={cn(
                    'sidebar-collapse-btn ml-auto flex h-[30px] items-center justify-center overflow-hidden rounded-[8px] transition-all duration-200 hover:bg-[var(--surface-active)]',
                    isCollapsed ? 'w-0 opacity-0' : 'w-[30px] opacity-100'
                  )}
                  aria-label='Collapse sidebar'
                >
                  <PanelLeft className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
                </button>
              </Tooltip.Trigger>
              {!isCollapsed && (
                <Tooltip.Content side='bottom'>
                  <p>Collapse sidebar</p>
                </Tooltip.Content>
              )}
            </Tooltip.Root>
          </div>

          {/* Workspace Header */}
          <div className='flex-shrink-0 px-[10px]'>
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
              showCollapsedContent={showCollapsedContent}
            />
          ) : (
            <>
              {/* Top Navigation: Home, Search */}
              <div className='mt-[10px] flex flex-shrink-0 flex-col gap-[2px] px-[8px]'>
                {topNavItems.map((item) => (
                  <SidebarNavItem
                    key={`${item.id}-${isCollapsed}`}
                    item={item}
                    active={item.href ? !!pathname?.startsWith(item.href) : false}
                    showCollapsedContent={showCollapsedContent}
                    onContextMenu={item.href ? handleNavItemContextMenu : undefined}
                  />
                ))}
              </div>

              {/* Workspace */}
              <div className='mt-[14px] flex flex-shrink-0 flex-col pb-[8px]'>
                <div className='px-[16px] pb-[6px]'>
                  <div className='font-base text-[var(--text-icon)] text-small'>Workspace</div>
                </div>
                <div className='flex flex-col gap-[2px] px-[8px]'>
                  {workspaceNavItems.map((item) => (
                    <SidebarNavItem
                      key={`${item.id}-${isCollapsed}`}
                      item={item}
                      active={item.href ? !!pathname?.startsWith(item.href) : false}
                      showCollapsedContent={showCollapsedContent}
                      onContextMenu={handleNavItemContextMenu}
                    />
                  ))}
                </div>
              </div>

              {/* Scrollable Tasks + Workflows */}
              <div
                ref={isCollapsed ? undefined : scrollContainerRef}
                className={cn(
                  'flex flex-1 flex-col overflow-y-auto overflow-x-hidden border-t pt-[9px] transition-colors duration-150',
                  !hasOverflowTop && 'border-transparent'
                )}
              >
                {/* Tasks */}
                <div className='flex flex-shrink-0 flex-col'>
                  <div className='flex h-[18px] flex-shrink-0 items-center justify-between px-[16px]'>
                    <div className='font-base text-[var(--text-icon)] text-small'>All tasks</div>
                    {!isCollapsed && (
                      <div className='flex items-center justify-center gap-[8px]'>
                        <Tooltip.Root>
                          <Tooltip.Trigger asChild>
                            <Button
                              variant='ghost'
                              className='h-[18px] w-[18px] rounded-[4px] p-0 hover:bg-[var(--surface-active)]'
                              onClick={() => navigateToPage(`/workspace/${workspaceId}/home`)}
                            >
                              <Plus className='h-[16px] w-[16px]' />
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content>
                            <p>New task</p>
                          </Tooltip.Content>
                        </Tooltip.Root>
                      </div>
                    )}
                  </div>
                  {isCollapsed ? (
                    <CollapsedSidebarMenu
                      icon={
                        <Blimp className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
                      }
                      hover={tasksHover}
                      onClick={() => navigateToPage(`/workspace/${workspaceId}/home`)}
                      ariaLabel='Tasks'
                      className='mt-[6px]'
                    >
                      {tasksLoading ? (
                        <DropdownMenuItem disabled>
                          <Loader className='h-[14px] w-[14px]' animate />
                          Loading...
                        </DropdownMenuItem>
                      ) : (
                        tasks.map((task) => (
                          <DropdownMenuItem key={task.id} asChild>
                            <Link href={task.href}>
                              <span className='relative flex-shrink-0'>
                                <Blimp className='h-[16px] w-[16px]' />
                                {task.isActive && (
                                  <span className='-bottom-[1px] -right-[1px] absolute h-[6px] w-[6px] rounded-full border border-[var(--surface-1)] bg-amber-400' />
                                )}
                                {!task.isActive && task.isUnread && (
                                  <span className='-bottom-[1px] -right-[1px] absolute h-[6px] w-[6px] rounded-full border border-[var(--surface-1)] bg-[#33C482]' />
                                )}
                              </span>
                              <span>{task.name}</span>
                            </Link>
                          </DropdownMenuItem>
                        ))
                      )}
                    </CollapsedSidebarMenu>
                  ) : (
                    <div className='mt-[6px] flex flex-col gap-[2px] px-[8px]'>
                      {tasksLoading ? (
                        <SidebarItemSkeleton />
                      ) : (
                        <>
                          {tasks.slice(0, visibleTaskCount).map((task) => {
                            const isCurrentRoute = task.id !== 'new' && pathname === task.href
                            const isRenaming = renamingTaskId === task.id
                            const isSelected = task.id !== 'new' && selectedTasks.has(task.id)

                            if (isRenaming) {
                              return (
                                <div
                                  key={task.id}
                                  className='mx-[2px] flex h-[30px] items-center gap-[8px] rounded-[8px] bg-[var(--surface-active)] px-[8px] text-[14px]'
                                >
                                  <Blimp className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
                                  <input
                                    ref={renameInputRef}
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onKeyDown={handleRenameKeyDown}
                                    onBlur={handleSaveTaskRename}
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
                                showCollapsedContent={showCollapsedContent}
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
                              onClick={() => setVisibleTaskCount((prev) => prev + 5)}
                              className='mx-[2px] flex h-[30px] items-center gap-[8px] rounded-[8px] px-[8px] text-[14px] text-[var(--text-icon)] hover:bg-[var(--surface-active)]'
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

                {/* Workflows */}
                <div className='workflows-section relative mt-[14px] flex flex-col'>
                  <div className='flex h-[18px] flex-shrink-0 items-center justify-between px-[16px]'>
                    <div className='font-base text-[var(--text-icon)] text-small'>Workflows</div>
                    {!isCollapsed && (
                      <div className='flex items-center justify-center gap-[8px]'>
                        <DropdownMenu>
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant='ghost'
                                  className='h-[18px] w-[18px] rounded-[4px] p-0 hover:bg-[var(--surface-active)]'
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
                              className='h-[18px] w-[18px] rounded-[4px] p-0 hover:bg-[var(--surface-active)]'
                              onClick={handleCreateWorkflow}
                              disabled={isCreatingWorkflow || !canEdit}
                            >
                              <Plus className='h-[16px] w-[16px]' />
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content>
                            <p>{isCreatingWorkflow ? 'Creating workflow...' : 'New workflow'}</p>
                          </Tooltip.Content>
                        </Tooltip.Root>
                      </div>
                    )}
                  </div>
                  {isCollapsed ? (
                    <CollapsedSidebarMenu
                      icon={
                        <div
                          className='h-[16px] w-[16px] flex-shrink-0 rounded-[3px] border-[2px]'
                          style={{
                            backgroundColor: 'var(--text-icon)',
                            borderColor: 'color-mix(in srgb, var(--text-icon) 60%, transparent)',
                            backgroundClip: 'padding-box',
                          }}
                        />
                      }
                      hover={workflowsHover}
                      onClick={handleCreateWorkflow}
                      ariaLabel='Workflows'
                      className='mt-[6px]'
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
                          />
                          {(workflowsByFolder.root || []).map((workflow) => (
                            <DropdownMenuItem key={workflow.id} asChild>
                              <Link href={`/workspace/${workspaceId}/w/${workflow.id}`}>
                                <div
                                  className='h-[14px] w-[14px] flex-shrink-0 rounded-[3px] border-[2px]'
                                  style={{
                                    backgroundColor: workflow.color,
                                    borderColor: `${workflow.color}60`,
                                    backgroundClip: 'padding-box',
                                  }}
                                />
                                <span className='truncate'>{workflow.name}</span>
                              </Link>
                            </DropdownMenuItem>
                          ))}
                        </>
                      )}
                    </CollapsedSidebarMenu>
                  ) : (
                    <div className='mt-[6px] px-[8px]'>
                      {workflowsLoading && regularWorkflows.length === 0 && <SidebarItemSkeleton />}
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

              {/* Footer */}
              <div
                className={cn(
                  'flex flex-shrink-0 flex-col gap-[2px] border-t px-[8px] pt-[9px] pb-[8px] transition-colors duration-150',
                  !hasOverflowBottom && 'border-transparent'
                )}
              >
                {footerItems.map((item) => (
                  <SidebarNavItem
                    key={`${item.id}-${isCollapsed}`}
                    item={item}
                    active={false}
                    showCollapsedContent={showCollapsedContent}
                  />
                ))}
              </div>

              {/* Nav Item Context Menu */}
              <NavItemContextMenu
                isOpen={isNavContextMenuOpen}
                position={navContextMenuPosition}
                menuRef={navMenuRef}
                onClose={handleNavContextMenuClose}
                onOpenInNewTab={handleNavOpenInNewTab}
                onCopyLink={handleNavCopyLink}
              />

              {/* Task Context Menu */}
              <ContextMenu
                isOpen={isTaskContextMenuOpen}
                position={taskContextMenuPosition}
                menuRef={taskMenuRef}
                onClose={closeTaskContextMenu}
                onOpenInNewTab={handleTaskOpenInNewTab}
                onRename={handleStartTaskRename}
                onDelete={handleDeleteTask}
                showOpenInNewTab={!isMultiTaskContextMenu}
                showRename={!isMultiTaskContextMenu}
                showDuplicate={false}
                showColorChange={false}
                disableRename={!canEdit}
                disableDelete={!canEdit}
              />

              {/* Task Delete Confirmation Modal */}
              <DeleteModal
                isOpen={isTaskDeleteModalOpen}
                onClose={() => setIsTaskDeleteModalOpen(false)}
                onConfirm={handleConfirmDeleteTasks}
                isDeleting={deleteTaskMutation.isPending || deleteTasksMutation.isPending}
                itemType='task'
                itemName={contextMenuSelectionRef.current.names}
              />
            </>
          )}
        </div>

        {/* Resize Handle */}
        {isOnWorkflowPage && !isCollapsed && (
          <div
            className='absolute top-0 right-[-4px] bottom-0 z-20 w-[8px] cursor-ew-resize'
            onMouseDown={handleMouseDown}
            role='separator'
            aria-orientation='vertical'
            aria-label='Resize sidebar'
          />
        )}
      </aside>

      {/* Universal Search Modal */}
      <SearchModal
        open={isSearchModalOpen}
        onOpenChange={setIsSearchModalOpen}
        workflows={searchModalWorkflows}
        workspaces={searchModalWorkspaces}
        tasks={tasks}
        isOnWorkflowPage={!!workflowId}
      />

      {/* Footer Navigation Modals */}
      <HelpModal
        open={isHelpModalOpen}
        onOpenChange={setIsHelpModalOpen}
        workflowId={workflowId}
        workspaceId={workspaceId}
      />
      {/* Hidden file input for workspace import */}
      <input
        ref={workspaceFileInputRef}
        type='file'
        accept='.zip'
        style={{ display: 'none' }}
        onChange={handleWorkspaceFileChange}
      />
    </>
  )
})
