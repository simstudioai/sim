'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { usePathname, useRouter } from 'next/navigation'
import { focusVisibleBrowserOmnibox } from '@/lib/browser-agent/renderer-shortcuts'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { getFolderPathNames } from '@/lib/folders/tree'
import { CONNECT_MODE } from '@/app/workspace/[workspaceId]/integrations/connect-route'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import {
  buildConnectedAccountSearchItems,
  buildIntegrationSearchItems,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/integration-search-items'
import type {
  IntegrationSearchItem,
  LogItem,
  PageActionContext,
  TaskItem,
  WorkflowItem,
  WorkspaceItem,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import {
  useFolderOperations,
  useWorkflowOperations,
  useWorkspaceWorkflowsRoom,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useImportWorkflow } from '@/app/workspace/[workspaceId]/w/hooks'
import { useCustomBlockOverlayVersion } from '@/blocks/custom/client-overlay'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useFolderMap } from '@/hooks/queries/folders'
import { type LogFilters, useLogsList } from '@/hooks/queries/logs'
import { type MothershipChatMetadata, useMothershipChats } from '@/hooks/queries/mothership-chats'
import { useOrderedWorkspacesQuery } from '@/hooks/queries/workspace'
import { useMothershipChatEvents } from '@/hooks/use-mothership-chat-events'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import type { WorkflowFolder } from '@/stores/folders/types'
import { useFilterStore } from '@/stores/logs/filters/store'
import { useSearchModalStore } from '@/stores/modals/search/store'
import { useProvidersStore } from '@/stores/providers'
import { useSidebarStore } from '@/stores/sidebar/store'

const logger = createLogger('WorkspaceSidebarServices')

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

/** A workspace chat as the sidebar lists it and the palette searches it. */
export type SidebarChat = MothershipChatMetadata & TaskItem

interface UseWorkspaceSidebarServicesProps {
  workspaceId: string
  /** The open canvas, when the route is one. */
  workflowId?: string
  /**
   * Runs after a workflow the palette, the header button, or the shortcut created
   * exists. The workspace sidebar scrolls the new row into view; a sidebar without a
   * tree omits it.
   */
  onWorkflowCreated?: (workflowId: string) => void
  /** Same as {@link UseWorkspaceSidebarServicesProps.onWorkflowCreated}, for folders. */
  onFolderCreated?: (folderId: string) => void
}

/**
 * The invisible services every workspace sidebar must mount, whatever it looks like.
 *
 * Other surfaces rely on these being alive on every workspace route: the canvas's
 * connection block picker reads the search data this seeds into `useSearchModalStore`,
 * `Cmd+K` and the help modal are mounted by {@link WorkspaceSidebarModals} from this
 * hook's return, the global shortcuts (`add-agent`, `goto-logs`, `open-search`,
 * `add-workflow`, `toggle-sidebar`) are registered here, and the chat list stays live
 * through `useMothershipChatEvents`. A sidebar calls this once with its `workspaceId`
 * and renders `<WorkspaceSidebarModals services={services} />`; the workspace sidebar
 * and the project Build sidebar then behave identically underneath their chrome.
 *
 * The workflow list, folder map, chat list, and the create/import handlers are returned
 * as well so the sidebar that draws them shares one query and one mutation instance
 * with the palette instead of racing a second `isPending`.
 */
export function useWorkspaceSidebarServices({
  workspaceId,
  workflowId,
  onWorkflowCreated,
  onFolderCreated,
}: UseWorkspaceSidebarServicesProps) {
  const router = useRouter()
  const pathname = usePathname()
  const importFileInputRef = useRef<HTMLInputElement>(null)
  const onWorkflowCreatedRef = useRef(onWorkflowCreated)
  const onFolderCreatedRef = useRef(onFolderCreated)

  const { chatEnabled } = useDeploymentShape()
  const { canAdmin, canEdit } = useUserPermissionsContext()
  const {
    config: permissionConfig,
    filterBlocks,
    isBlockAllowed,
    isToolAllowed,
    integrationAvailability,
  } = usePermissionConfig()

  const initializeSearchData = useSearchModalStore((state) => state.initializeData)
  const isSearchModalOpen = useSearchModalStore((state) => state.isOpen)
  const toggleCollapsed = useSidebarStore((state) => state.toggleCollapsed)
  const logsViewMode = useFilterStore((state) => state.viewMode)
  const customBlockOverlayVersion = useCustomBlockOverlayVersion()
  const providers = useProvidersStore((state) => state.providers)
  const providerModelSignature = useMemo(
    () =>
      Object.values(providers)
        .map((provider) => provider.models.join('\x00'))
        .join('\x01'),
    [providers]
  )

  const { data: workspaces = [] } = useOrderedWorkspacesQuery()
  const {
    regularWorkflows,
    workflowsLoading,
    isCreatingWorkflow,
    handleCreateWorkflow: createWorkflow,
  } = useWorkflowOperations({ workspaceId })
  const { isCreatingFolder, handleCreateFolder: createFolder } = useFolderOperations({
    workspaceId,
  })
  const { isImporting, handleFileChange: handleImportFileChange } = useImportWorkflow({
    workspaceId,
  })
  useWorkspaceWorkflowsRoom(workspaceId)
  const { data: folderMap = EMPTY_FOLDER_MAP } = useFolderMap(workspaceId)

  const chatsEnabled = chatEnabled && !permissionConfig.hideCopilot
  const { data: fetchedChats = EMPTY_CHATS, isLoading: chatsLoading } = useMothershipChats(
    workspaceId,
    { enabled: chatsEnabled }
  )
  useMothershipChatEvents(workspaceId, chatsEnabled)

  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false)

  /**
   * Stays empty when Chat is disabled, which also drops the command palette's
   * Chats group — `SearchGroups` renders nothing for an empty list.
   */
  const chats = useMemo(
    (): SidebarChat[] =>
      (chatsEnabled ? fetchedChats : EMPTY_CHATS).map((t) => ({
        ...t,
        href: `/workspace/${workspaceId}/chat/${t.id}`,
        date: SEARCH_MODAL_DATE_FORMAT.format(t.updatedAt),
      })),
    [fetchedChats, workspaceId, chatsEnabled]
  )

  const searchModalWorkflows = useMemo(
    (): WorkflowItem[] =>
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
    (): WorkspaceItem[] =>
      workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        href: `/workspace/${workspace.id}/w`,
        isCurrent: workspace.id === workspaceId,
        logoUrl: workspace.logoUrl,
      })),
    [workspaces, workspaceId]
  )

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
    (): IntegrationSearchItem[] =>
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
    (): IntegrationSearchItem[] =>
      permissionConfig.hideIntegrationsTab
        ? []
        : buildConnectedAccountSearchItems(fetchedCredentials, workspaceId),
    [fetchedCredentials, workspaceId, permissionConfig.hideIntegrationsTab]
  )

  const handleCreateWorkflow = useCallback(async () => {
    const createdId = await createWorkflow()
    if (createdId) onWorkflowCreatedRef.current?.(createdId)
  }, [createWorkflow])

  const handleCreateFolder = useCallback(async () => {
    const folderId = await createFolder()
    if (folderId) onFolderCreatedRef.current?.(folderId)
  }, [createFolder])

  const handleImportWorkflow = useCallback(() => {
    importFileInputRef.current?.click()
  }, [])

  const openHelpModal = useCallback(() => setIsHelpModalOpen(true), [])

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
          const searchModal = useSearchModalStore.getState()
          searchModal.setOpen(!searchModal.isOpen)
        },
      },
      {
        id: 'add-workflow',
        handler: () => {
          if (!canEdit || isCreatingWorkflow) return
          void handleCreateWorkflow()
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

  useEffect(() => {
    onWorkflowCreatedRef.current = onWorkflowCreated
    onFolderCreatedRef.current = onFolderCreated
  }, [onWorkflowCreated, onFolderCreated])

  useEffect(() => {
    initializeSearchData(filterBlocks, isToolAllowed)
  }, [
    initializeSearchData,
    filterBlocks,
    isToolAllowed,
    providerModelSignature,
    customBlockOverlayVersion,
  ])

  /** Listens for external events to open help modal */
  useEffect(() => {
    const handleOpenHelpModal = () => setIsHelpModalOpen(true)
    window.addEventListener('open-help-modal', handleOpenHelpModal)
    return () => window.removeEventListener('open-help-modal', handleOpenHelpModal)
  }, [])

  return {
    workspaceId,
    workflowId,
    /** Whether the workspace lists chats at all: Chat is on and not hidden by policy. */
    chatsEnabled,
    chats,
    chatsLoading,
    regularWorkflows,
    workflowsLoading,
    folderMap,
    isCreatingWorkflow,
    isCreatingFolder,
    isImporting,
    canEdit,
    canAdmin,
    /** Creates without the `onWorkflowCreated` follow-up; the wrapped handler below runs it. */
    createWorkflow,
    handleCreateWorkflow,
    handleCreateFolder,
    handleImportWorkflow,
    /** Bound to the hidden import input {@link WorkspaceSidebarModals} renders. */
    importFileInputRef,
    handleImportFileChange,
    isHelpModalOpen,
    setIsHelpModalOpen,
    openHelpModal,
    searchModal: {
      workflows: searchModalWorkflows,
      workspaces: searchModalWorkspaces,
      logs: searchModalLogs,
      integrations: searchModalIntegrations,
      connectedAccounts: searchModalConnectedAccounts,
      pageContext: searchModalPageContext,
    },
  }
}

export type WorkspaceSidebarServices = ReturnType<typeof useWorkspaceSidebarServices>
