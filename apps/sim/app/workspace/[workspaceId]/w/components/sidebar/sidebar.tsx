'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Database, Files, HelpCircle, MoreHorizontal, Plus, Search, Settings } from 'lucide-react'
import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import {
  Blimp,
  Button,
  Download,
  FolderPlus,
  Home,
  Library,
  Loader,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  Tooltip,
} from '@/components/emcn'
import { Table } from '@/components/emcn/icons'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
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
  useContextMenu,
  useFolderOperations,
  useSidebarResize,
  useWorkflowOperations,
  useWorkspaceManagement,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import {
  useDuplicateWorkspace,
  useExportWorkspace,
  useImportWorkflow,
  useImportWorkspace,
} from '@/app/workspace/[workspaceId]/w/hooks'
import { useDeleteTask, useTasks } from '@/hooks/queries/tasks'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { useFolderStore } from '@/stores/folders/store'
import { useSearchModalStore } from '@/stores/modals/search/store'
import { useSidebarStore } from '@/stores/sidebar/store'

const logger = createLogger('Sidebar')

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
  const initializeSearchData = useSearchModalStore((state) => state.initializeData)

  useEffect(() => {
    initializeSearchData(filterBlocks)
  }, [initializeSearchData, filterBlocks])

  const setSidebarWidth = useSidebarStore((state) => state.setSidebarWidth)
  const isOnWorkflowPage = !!workflowId

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
    updateWorkspaceName,
    confirmDeleteWorkspace,
    handleLeaveWorkspace,
  } = useWorkspaceManagement({
    workspaceId,
    sessionUserId: sessionData?.user?.id,
  })

  const { handleMouseDown } = useSidebarResize()

  const {
    regularWorkflows,
    workflowsLoading,
    isCreatingWorkflow,
    handleCreateWorkflow: createWorkflow,
  } = useWorkflowOperations({ workspaceId })

  const { isCreatingFolder, handleCreateFolder: createFolder } = useFolderOperations({
    workspaceId,
  })

  const [activeNavItemHref, setActiveNavItemHref] = useState<string | null>(null)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const {
    isOpen: isNavContextMenuOpen,
    position: navContextMenuPosition,
    menuRef: navMenuRef,
    handleContextMenu: handleNavContextMenuBase,
    closeMenu: closeNavContextMenu,
  } = useContextMenu()

  const deleteTaskMutation = useDeleteTask(workspaceId)

  const handleNavItemContextMenu = useCallback(
    (e: React.MouseEvent, href: string) => {
      setActiveNavItemHref(href)
      setActiveTaskId(null)
      handleNavContextMenuBase(e)
    },
    [handleNavContextMenuBase]
  )

  const handleTaskContextMenu = useCallback(
    (e: React.MouseEvent, href: string, taskId: string) => {
      setActiveNavItemHref(href)
      setActiveTaskId(taskId)
      handleNavContextMenuBase(e)
    },
    [handleNavContextMenuBase]
  )

  const handleNavContextMenuClose = useCallback(() => {
    closeNavContextMenu()
    setActiveNavItemHref(null)
    setActiveTaskId(null)
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

  const handleDeleteTask = useCallback(() => {
    if (!activeTaskId) return
    const isViewingDeletedTask = pathname === `/workspace/${workspaceId}/task/${activeTaskId}`
    deleteTaskMutation.mutate(activeTaskId, {
      onSuccess: () => {
        if (isViewingDeletedTask) {
          router.push(`/workspace/${workspaceId}/home`)
        }
      },
    })
  }, [activeTaskId, pathname, workspaceId, deleteTaskMutation, router])

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
          id: 'knowledge-base',
          label: 'Knowledge Base',
          icon: Database,
          href: `/workspace/${workspaceId}/knowledge`,
          hidden: permissionConfig.hideKnowledgeBaseTab,
        },
        {
          id: 'files',
          label: 'Files',
          icon: Files,
          href: `/workspace/${workspaceId}/files`,
          hidden: permissionConfig.hideFilesTab,
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
        href: `/workspace/${workspaceId}/settings/general`,
      },
    ],
    [workspaceId]
  )

  const { data: fetchedTasks = [] } = useTasks(workspaceId)

  const tasks = useMemo(
    () =>
      fetchedTasks.length > 0
        ? fetchedTasks.map((t) => ({
            ...t,
            href: `/workspace/${workspaceId}/task/${t.id}`,
          }))
        : [{ id: 'new', name: 'New task', href: `/workspace/${workspaceId}/home` }],
    [fetchedTasks, workspaceId]
  )

  const [hasOverflowBottom, setHasOverflowBottom] = useState(false)

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const updateScrollState = () => {
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
    if (!isOnWorkflowPage) {
      setSidebarWidth(SIDEBAR_WIDTH.MIN)
    }
  }, [isOnWorkflowPage, setSidebarWidth])

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
      const { selectOnly, clearSelection } = useFolderStore.getState()
      workflowId ? selectOnly(workflowId) : clearSelection()
    },
    [workflowId]
  )

  const handleRenameWorkspace = useCallback(
    async (workspaceIdToRename: string, newName: string) => {
      await updateWorkspaceName(workspaceIdToRename, newName)
    },
    [updateWorkspaceName]
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

  const handleExportWorkspace = useCallback(
    async (workspaceIdToExport: string, workspaceName: string) => {
      await exportWorkspace(workspaceIdToExport, workspaceName)
    },
    [exportWorkspace]
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
      {
        id: 'goto-templates',
        handler: () => {
          try {
            const pathWorkspaceId = resolveWorkspaceIdFromPath()
            if (pathWorkspaceId) {
              router.push(`/workspace/${pathWorkspaceId}/templates`)
              logger.info('Navigated to templates', { workspaceId: pathWorkspaceId })
            } else {
              logger.warn('No workspace ID found, cannot navigate to templates')
            }
          } catch (err) {
            logger.error('Failed to navigate to templates', { err })
          }
        },
      },
      {
        id: 'goto-logs',
        handler: () => {
          try {
            const pathWorkspaceId = resolveWorkspaceIdFromPath()
            if (pathWorkspaceId) {
              router.push(`/workspace/${pathWorkspaceId}/logs`)
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
        className='sidebar-container relative h-full overflow-hidden bg-[var(--surface-1)]'
        aria-label='Workspace sidebar'
        onClick={handleSidebarClick}
      >
        <div className='flex h-full flex-col pt-[12px]'>
          {/* Header */}
          <div className='flex-shrink-0 px-[8px]'>
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
              onExportWorkspace={handleExportWorkspace}
              onImportWorkspace={handleImportWorkspace}
              isImportingWorkspace={isImportingWorkspace}
              onLeaveWorkspace={handleLeaveWorkspaceWrapper}
              sessionUserId={sessionData?.user?.id}
            />
          </div>

          {isOnSettingsPage ? (
            <>
              {/* Settings sidebar navigation */}
              <SettingsSidebar />
            </>
          ) : (
            <>
              {/* Top Navigation: Home, Search */}
              <div className='mt-[10px] flex flex-shrink-0 flex-col gap-[2px] px-[8px]'>
                {topNavItems.map((item) => {
                  const Icon = item.icon
                  const active = item.href ? pathname?.startsWith(item.href) : false
                  const baseClasses =
                    'group flex h-[30px] items-center gap-[8px] rounded-[8px] mx-[2px] px-[8px] text-[14px] hover:bg-[var(--surface-active)]'
                  const activeClasses = active ? 'bg-[var(--surface-active)]' : ''
                  const textColor = active
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)]'
                  const iconColor = active
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)]'

                  if (item.onClick) {
                    return (
                      <button
                        key={item.id}
                        type='button'
                        data-item-id={item.id}
                        className={`${baseClasses} ${activeClasses}`}
                        onClick={item.onClick}
                      >
                        <Icon className={`h-[16px] w-[16px] flex-shrink-0 ${iconColor}`} />
                        <span className={`truncate font-base ${textColor}`}>{item.label}</span>
                      </button>
                    )
                  }

                  return (
                    <Link
                      key={item.id}
                      href={item.href!}
                      data-item-id={item.id}
                      className={`${baseClasses} ${activeClasses}`}
                      onContextMenu={(e) => handleNavItemContextMenu(e, item.href!)}
                    >
                      <Icon className={`h-[16px] w-[16px] flex-shrink-0 ${iconColor}`} />
                      <span className={`truncate font-base ${textColor}`}>{item.label}</span>
                    </Link>
                  )
                })}
              </div>

              {/* Workspace */}
              <div className='mt-[14px] flex flex-shrink-0 flex-col pb-[5px]'>
                <div className='px-[16px] pb-[6px]'>
                  <div className='font-base text-[var(--text-tertiary)] text-small'>Workspace</div>
                </div>
                <div className='flex flex-col gap-[2px] px-[8px]'>
                  {workspaceNavItems.map((item) => {
                    const Icon = item.icon
                    const active = item.href ? pathname?.startsWith(item.href) : false
                    const baseClasses =
                      'group flex h-[30px] items-center gap-[8px] rounded-[8px] mx-[2px] px-[8px] text-[14px] hover:bg-[var(--surface-active)]'
                    const activeClasses = active ? 'bg-[var(--surface-active)]' : ''
                    const textColor = active
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)]'
                    const iconColor = active
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-muted)]'

                    return (
                      <Link
                        key={item.id}
                        href={item.href!}
                        data-item-id={item.id}
                        className={`${baseClasses} ${activeClasses}`}
                        onContextMenu={(e) => handleNavItemContextMenu(e, item.href!)}
                      >
                        <Icon className={`h-[16px] w-[16px] flex-shrink-0 ${iconColor}`} />
                        <span className={`truncate font-base ${textColor}`}>{item.label}</span>
                      </Link>
                    )
                  })}
                </div>
              </div>

              {/* Scrollable Tasks + Workflows */}
              <div
                ref={scrollContainerRef}
                className='mt-[9px] flex flex-1 flex-col overflow-y-auto overflow-x-hidden'
              >
                {/* Tasks */}
                <div className='flex flex-shrink-0 flex-col'>
                  <div className='px-[16px]'>
                    <div className='font-base text-[var(--text-tertiary)] text-small'>
                      All tasks
                    </div>
                  </div>
                  <div className='mt-[6px] flex flex-col gap-[2px] px-[8px]'>
                    {tasks.map((task) => {
                      const active = task.id !== 'new' && pathname === task.href
                      const textColor = active
                        ? 'text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)]'
                      const iconColor = active
                        ? 'text-[var(--text-primary)]'
                        : 'text-[var(--text-muted)]'

                      return (
                        <Link
                          key={task.id}
                          href={task.href}
                          className={`mx-[2px] flex h-[30px] items-center gap-[8px] rounded-[8px] px-[8px] text-[14px] hover:bg-[var(--surface-active)] ${active ? 'bg-[var(--surface-active)]' : ''}`}
                          onContextMenu={(e) => handleTaskContextMenu(e, task.href, task.id)}
                        >
                          <Blimp className={`h-[16px] w-[16px] flex-shrink-0 ${iconColor}`} />
                          <div className={`min-w-0 truncate font-base ${textColor}`}>
                            {task.name}
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </div>

                {/* Workflows */}
                <div className='workflows-section mt-[14px] flex flex-col'>
                  <div className='flex flex-shrink-0 flex-col space-y-[4px] px-[16px]'>
                    <div className='flex items-center justify-between'>
                      <div className='font-base text-[var(--text-tertiary)] text-small'>
                        Workflows
                      </div>
                      <div className='flex items-center justify-center gap-[8px]'>
                        <Popover>
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>
                              <PopoverTrigger asChild>
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
                              </PopoverTrigger>
                            </Tooltip.Trigger>
                            <Tooltip.Content>
                              <p>More actions</p>
                            </Tooltip.Content>
                          </Tooltip.Root>
                          <PopoverContent align='end' sideOffset={8} minWidth={160}>
                            <PopoverItem
                              onClick={handleImportWorkflow}
                              disabled={!canEdit || isImporting}
                            >
                              <Download className='h-[16px] w-[16px]' />
                              <span>{isImporting ? 'Importing...' : 'Import workflow'}</span>
                            </PopoverItem>
                            <PopoverItem
                              onClick={handleCreateFolder}
                              disabled={!canEdit || isCreatingFolder}
                            >
                              <FolderPlus className='h-[16px] w-[16px]' />
                              <span>
                                {isCreatingFolder ? 'Creating folder...' : 'Create folder'}
                              </span>
                            </PopoverItem>
                          </PopoverContent>
                        </Popover>
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
                            <p>{isCreatingWorkflow ? 'Creating workflow...' : 'Create workflow'}</p>
                          </Tooltip.Content>
                        </Tooltip.Root>
                      </div>
                    </div>
                  </div>

                  <div className='mt-[6px] px-[8px]'>
                    <WorkflowList
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
                </div>
              </div>

              {/* Footer */}
              <div
                className={cn(
                  'flex flex-shrink-0 flex-col gap-[2px] border-t px-[8px] pt-[9px] pb-[8px] transition-colors duration-150',
                  !hasOverflowBottom && 'border-transparent'
                )}
              >
                {footerItems.map((item) => {
                  const Icon = item.icon

                  if (item.href) {
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        data-item-id={item.id}
                        className='group mx-[2px] flex h-[30px] items-center gap-[8px] rounded-[8px] px-[8px] text-[14px] hover:bg-[var(--surface-active)]'
                      >
                        <Icon className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-muted)]' />
                        <span className='truncate font-base text-[var(--text-secondary)]'>
                          {item.label}
                        </span>
                      </Link>
                    )
                  }

                  return (
                    <button
                      key={item.id}
                      type='button'
                      data-item-id={item.id}
                      className='group mx-[2px] flex h-[30px] items-center gap-[8px] rounded-[8px] px-[8px] text-[14px] hover:bg-[var(--surface-active)]'
                      onClick={item.onClick}
                    >
                      <Icon className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-muted)]' />
                      <span className='truncate font-base text-[var(--text-secondary)]'>
                        {item.label}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Nav Item Context Menu */}
              <NavItemContextMenu
                isOpen={isNavContextMenuOpen}
                position={navContextMenuPosition}
                menuRef={navMenuRef}
                onClose={handleNavContextMenuClose}
                onOpenInNewTab={handleNavOpenInNewTab}
                onCopyLink={handleNavCopyLink}
                onDelete={activeTaskId ? handleDeleteTask : undefined}
              />
            </>
          )}
        </div>

        {/* Resize Handle */}
        {isOnWorkflowPage && (
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
