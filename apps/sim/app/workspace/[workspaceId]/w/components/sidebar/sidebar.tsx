'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Database, HelpCircle, Layout, Plus, Search, Settings } from 'lucide-react'
import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { Button, Download, FolderPlus, Library, Loader, Tooltip } from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import {
  HelpModal,
  NavItemContextMenu,
  SearchModal,
  SettingsModal,
  UsageIndicator,
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
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { useFolderStore } from '@/stores/folders/store'
import { useSearchModalStore } from '@/stores/modals/search/store'
import { useSettingsModalStore } from '@/stores/modals/settings/store'
import { useSidebarStore } from '@/stores/sidebar/store'

const logger = createLogger('Sidebar')

/** Feature flag for billing usage indicator visibility */
const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))

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

  /**
   * Sidebar state from store with hydration tracking to prevent SSR mismatch.
   * Uses default (expanded) state until hydrated.
   */
  const hasHydrated = useSidebarStore((state) => state._hasHydrated)
  const isCollapsedStore = useSidebarStore((state) => state.isCollapsed)
  const setIsCollapsed = useSidebarStore((state) => state.setIsCollapsed)
  const setSidebarWidth = useSidebarStore((state) => state.setSidebarWidth)
  const isCollapsed = hasHydrated ? isCollapsedStore : false
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
  const {
    isOpen: isSettingsModalOpen,
    openModal: openSettingsModal,
    closeModal: closeSettingsModal,
  } = useSettingsModalStore()

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

  const footerNavigationItems = useMemo(
    () =>
      [
        {
          id: 'logs',
          label: 'Logs',
          icon: Library,
          href: `/workspace/${workspaceId}/logs`,
        },
        {
          id: 'templates',
          label: 'Templates',
          icon: Layout,
          href: `/workspace/${workspaceId}/templates`,
          hidden: permissionConfig.hideTemplates,
        },
        {
          id: 'knowledge-base',
          label: 'Knowledge Base',
          icon: Database,
          href: `/workspace/${workspaceId}/knowledge`,
          hidden: permissionConfig.hideKnowledgeBaseTab,
        },
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
          onClick: () => openSettingsModal(),
        },
      ].filter((item) => !item.hidden),
    [workspaceId, permissionConfig.hideTemplates, permissionConfig.hideKnowledgeBaseTab]
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

  useEffect(() => {
    if (!isOnWorkflowPage) {
      if (isCollapsed) {
        setIsCollapsed(false)
      }
      setSidebarWidth(SIDEBAR_WIDTH.MIN)
    }
  }, [isOnWorkflowPage, isCollapsed, setIsCollapsed, setSidebarWidth])

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

  const handleToggleCollapse = useCallback(() => {
    setIsCollapsed(!isCollapsed)
  }, [isCollapsed, setIsCollapsed])

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
      {isCollapsed ? (
        /* Floating collapsed header - minimal pill showing workspace name and expand toggle */
        <div className='fixed top-[14px] left-[10px] z-10 w-fit rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] py-[4px] pr-[10px] pl-[6px]'>
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
            onToggleCollapse={handleToggleCollapse}
            isCollapsed={isCollapsed}
            onRenameWorkspace={handleRenameWorkspace}
            onDeleteWorkspace={handleDeleteWorkspace}
            onDuplicateWorkspace={handleDuplicateWorkspace}
            onExportWorkspace={handleExportWorkspace}
            onImportWorkspace={handleImportWorkspace}
            isImportingWorkspace={isImportingWorkspace}
            showCollapseButton={isOnWorkflowPage}
            onLeaveWorkspace={handleLeaveWorkspaceWrapper}
            sessionUserId={sessionData?.user?.id}
          />
        </div>
      ) : (
        /* Full sidebar */
        <>
          <aside
            ref={sidebarRef}
            className='sidebar-container fixed inset-y-0 left-0 z-10 overflow-hidden bg-[var(--surface-1)]'
            aria-label='Workspace sidebar'
            onClick={handleSidebarClick}
          >
            <div className='flex h-full flex-col border-[var(--border)] border-r pt-[12px]'>
              {/* Header */}
              <div className='flex-shrink-0 px-[14px]'>
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
                  onToggleCollapse={handleToggleCollapse}
                  isCollapsed={isCollapsed}
                  onRenameWorkspace={handleRenameWorkspace}
                  onDeleteWorkspace={handleDeleteWorkspace}
                  onDuplicateWorkspace={handleDuplicateWorkspace}
                  onExportWorkspace={handleExportWorkspace}
                  onImportWorkspace={handleImportWorkspace}
                  isImportingWorkspace={isImportingWorkspace}
                  showCollapseButton={isOnWorkflowPage}
                  onLeaveWorkspace={handleLeaveWorkspaceWrapper}
                  sessionUserId={sessionData?.user?.id}
                />
              </div>

              {/* Search */}
              <div
                className='mx-[8px] mt-[10px] flex flex-shrink-0 cursor-pointer items-center justify-between rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[6px] transition-colors duration-100 hover:border-[var(--border-1)] hover:bg-[var(--surface-6)] dark:bg-[var(--surface-4)] dark:hover:border-[var(--border-1)] dark:hover:bg-[var(--surface-5)]'
                onClick={() => setIsSearchModalOpen(true)}
              >
                <div className='flex items-center gap-[6px]'>
                  <Search className='h-[14px] w-[14px] text-[var(--text-subtle)]' />
                  <p className='translate-y-[0.25px] font-medium text-[var(--text-tertiary)] text-small'>
                    Search
                  </p>
                </div>
                <p className='font-medium text-[var(--text-subtle)] text-small'>⌘K</p>
              </div>

              {/* Workflows */}
              <div className='workflows-section relative mt-[14px] flex flex-1 flex-col overflow-hidden'>
                {/* Header - Always visible */}
                <div className='flex flex-shrink-0 flex-col space-y-[4px] px-[14px]'>
                  <div className='flex items-center justify-between'>
                    <div className='font-medium text-[var(--text-tertiary)] text-small'>
                      Workflows
                    </div>
                    <div className='flex items-center justify-center gap-[10px]'>
                      {isImporting ? (
                        <Button
                          variant='ghost'
                          className='translate-y-[-0.25px] p-[1px]'
                          disabled={!canEdit || isImporting}
                        >
                          <Loader className='h-[14px] w-[14px]' animate />
                        </Button>
                      ) : (
                        <Tooltip.Root>
                          <Tooltip.Trigger asChild>
                            <Button
                              variant='ghost'
                              className='translate-y-[-0.25px] p-[1px]'
                              onClick={handleImportWorkflow}
                              disabled={!canEdit}
                            >
                              <Download className='h-[14px] w-[14px]' />
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content>
                            <p>Import workflows</p>
                          </Tooltip.Content>
                        </Tooltip.Root>
                      )}
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <Button
                            variant='ghost'
                            className='mr-[1px] translate-y-[-0.25px] p-[1px]'
                            onClick={handleCreateFolder}
                            disabled={isCreatingFolder || !canEdit}
                          >
                            <FolderPlus className='h-[14px] w-[14px]' />
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content>
                          <p>{isCreatingFolder ? 'Creating folder...' : 'Create folder'}</p>
                        </Tooltip.Content>
                      </Tooltip.Root>
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <Button
                            variant='outline'
                            className='translate-y-[-0.25px] p-[1px]'
                            onClick={handleCreateWorkflow}
                            disabled={isCreatingWorkflow || !canEdit}
                          >
                            <Plus className='h-[14px] w-[14px]' />
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content>
                          <p>{isCreatingWorkflow ? 'Creating workflow...' : 'Create workflow'}</p>
                        </Tooltip.Content>
                      </Tooltip.Root>
                    </div>
                  </div>
                </div>

                {/* Scrollable workflow list */}
                <div
                  ref={scrollContainerRef}
                  className='mt-[6px] flex-1 overflow-y-auto overflow-x-hidden px-[8px]'
                >
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

              {/* Usage Indicator */}
              {isBillingEnabled && <UsageIndicator />}

              {/* Footer Navigation */}
              <div className='flex flex-shrink-0 flex-col gap-[2px] border-[var(--border)] border-t px-[7.75px] pt-[8px] pb-[8px]'>
                {footerNavigationItems.map((item) => {
                  const Icon = item.icon
                  const active = item.href ? pathname?.startsWith(item.href) : false
                  const baseClasses =
                    'group flex h-[26px] items-center gap-[8px] rounded-[8px] px-[6px] text-[14px] hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]'
                  const activeClasses = active
                    ? 'bg-[var(--surface-6)] dark:bg-[var(--surface-5)]'
                    : ''
                  const textClasses = active
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]'

                  const content = (
                    <>
                      <Icon className={`h-[14px] w-[14px] flex-shrink-0 ${textClasses}`} />
                      <span className={`truncate font-medium text-[13px] ${textClasses}`}>
                        {item.label}
                      </span>
                    </>
                  )

                  if (item.onClick) {
                    return (
                      <button
                        key={item.id}
                        type='button'
                        data-item-id={item.id}
                        className={`${baseClasses} ${activeClasses}`}
                        onClick={item.onClick}
                      >
                        {content}
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
                      {content}
                    </Link>
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
              />
            </div>
          </aside>

          {/* Resize Handle - Only visible on workflow pages */}
          {isOnWorkflowPage && (
            <div
              className='fixed top-0 bottom-0 left-[calc(var(--sidebar-width)-4px)] z-20 w-[8px] cursor-ew-resize'
              onMouseDown={handleMouseDown}
              role='separator'
              aria-orientation='vertical'
              aria-label='Resize sidebar'
            />
          )}
        </>
      )}

      {/* Universal Search Modal */}
      <SearchModal
        open={isSearchModalOpen}
        onOpenChange={setIsSearchModalOpen}
        workflows={searchModalWorkflows}
        workspaces={searchModalWorkspaces}
        isOnWorkflowPage={!!workflowId}
      />

      {/* Footer Navigation Modals */}
      <HelpModal
        open={isHelpModalOpen}
        onOpenChange={setIsHelpModalOpen}
        workflowId={workflowId}
        workspaceId={workspaceId}
      />
      <SettingsModal
        open={isSettingsModalOpen}
        onOpenChange={(open) => (open ? openSettingsModal() : closeSettingsModal())}
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
