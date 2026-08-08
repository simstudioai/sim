'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { cn, Library } from '@sim/emcn'
import {
  Calendar,
  Columns3,
  Database,
  Download,
  Duplicate,
  File,
  FolderPlus,
  HelpCircle,
  Home,
  Integration,
  Key,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Send,
  Settings,
  Table,
  TagIcon,
  Trash,
  Upload,
} from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { Command } from 'cmdk'
import { Scan } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { createPortal } from 'react-dom'
import { isChatEnabled } from '@/lib/core/config/env-flags'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { sendMothershipMessage } from '@/lib/mothership/events'
import { captureEvent } from '@/lib/posthog/client'
import { toSearchToken } from '@/lib/search/tokens'
import { getMothershipHandoffHref } from '@/app/workspace/[workspaceId]/home/search-params'
import { useInvokeGlobalCommand } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import {
  CommandFadedList,
  CommandSearch,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/components/command-chrome'
import { MemoizedActionItem } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/components/command-items'
import { SearchEntryGroup } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/components/search-groups'
import type {
  ActionGroupLabel,
  ActionItem,
  FileItem,
  IntegrationSearchItem,
  LogItem,
  PageItem,
  SearchEntry,
  SearchEntryHandlers,
  SearchModalProps,
  SearchSection,
  TaskItem,
  WorkflowItem,
  WorkspaceItem,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import {
  getActionGroupLabel,
  getGlobalSearchResults,
  getPageActionGroupLabel,
  MAX_RESULTS_PER_GROUP,
  PAGE_CONTEXT_HOISTED_SECTION,
  SEARCH_SECTIONS,
  SECTION_LABELS,
  scoreActions,
  scoreSectionItems,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import {
  CMDK_ITEM_GAP_CLASS,
  CMDK_SECTION_GAP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { SIDEBAR_SCROLL_EVENT } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

const logger = createLogger('SearchModal')

export type { SearchModalProps } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'

export function SearchModal({
  open,
  onOpenChange,
  workflows = [],
  workspaces = [],
  chats = [],
  tables = [],
  files = [],
  knowledgeBases = [],
  logs = [],
  integrations = [],
  connectedAccounts = [],
  isOnWorkflowPage = false,
  pageContext = null,
  canEdit = false,
  onCreateWorkflow,
  onCreateFolder,
  onImportWorkflow,
}: SearchModalProps) {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  const { navigateToSettings } = useSettingsNavigation()
  const { config: permissionConfig } = usePermissionConfig()
  const invokeCommand = useInvokeGlobalCommand()
  const posthog = usePostHog()

  const routerRef = useRef(router)
  routerRef.current = router
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange
  const posthogRef = useRef(posthog)
  posthogRef.current = posthog

  useEffect(() => {
    setMounted(true)
  }, [])

  const openHelpModal = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-help-modal'))
  }, [])

  const pages = useMemo(
    (): PageItem[] =>
      [
        {
          id: 'integrations',
          name: 'Integrations',
          icon: Integration,
          href: `/workspace/${workspaceId}/integrations`,
          hidden: permissionConfig.hideIntegrationsTab,
        },
        {
          id: 'tables',
          name: 'Tables',
          icon: Table,
          href: `/workspace/${workspaceId}/tables`,
          hidden: permissionConfig.hideTablesTab,
        },
        {
          id: 'files',
          name: 'Files',
          icon: File,
          href: `/workspace/${workspaceId}/files`,
          hidden: permissionConfig.hideFilesTab,
        },
        {
          id: 'knowledge-base',
          name: 'Knowledge base',
          icon: Database,
          href: `/workspace/${workspaceId}/knowledge`,
          hidden: permissionConfig.hideKnowledgeBaseTab,
        },
        {
          id: 'scheduled-tasks',
          name: 'Scheduled tasks',
          icon: Calendar,
          href: `/workspace/${workspaceId}/scheduled-tasks`,
        },
        {
          id: 'logs',
          name: 'Logs',
          icon: Library,
          href: `/workspace/${workspaceId}/logs`,
          shortcut: '⇧⌘L',
        },
        {
          id: 'secrets',
          name: 'Secrets',
          icon: Key,
          href: `/workspace/${workspaceId}/settings/secrets`,
        },
        {
          id: 'help',
          name: 'Help',
          icon: HelpCircle,
          onClick: openHelpModal,
        },
        {
          id: 'settings',
          name: 'Settings',
          icon: Settings,
          onClick: navigateToSettings,
        },
      ].filter((page) => !page.hidden),
    [
      workspaceId,
      openHelpModal,
      navigateToSettings,
      permissionConfig.hideKnowledgeBaseTab,
      permissionConfig.hideTablesTab,
      permissionConfig.hideFilesTab,
      permissionConfig.hideIntegrationsTab,
    ]
  )

  /**
   * Verbs the palette can run directly. Entity navigation lives in the groups
   * below; this list is for "do something" intents (run, create, import, copy,
   * invite).
   */
  const actions = useMemo((): ActionItem[] => {
    const list: ActionItem[] = []
    const onCanvas = pageContext === 'workflow'
    const invoke = (id: string) => () => invokeCommand(id)

    list.push(
      {
        id: 'run-workflow',
        name: 'Run workflow',
        keywords: 'execute start play test',
        icon: Play,
        shortcut: '⌘↵',
        context: 'workflow',
        run: invoke('run-workflow'),
      },
      {
        id: 'deploy-workflow',
        name: 'Deploy workflow',
        keywords: 'ship release publish api',
        icon: Rocket,
        context: 'workflow',
        run: invoke('deploy-workflow'),
      },
      {
        id: 'fit-to-view',
        name: 'Fit workflow to view',
        keywords: 'zoom center recenter canvas reset',
        icon: Scan,
        shortcut: '⇧⌘F',
        context: 'workflow',
        run: invoke('fit-to-view'),
      },
      {
        id: 'copy-workflow-url',
        name: 'Copy workflow link',
        keywords: 'url share clipboard',
        icon: Duplicate,
        context: 'workflow',
        run: () => {
          navigator.clipboard.writeText(window.location.href).catch((error) => {
            logger.error('Failed to copy workflow link to clipboard', { error })
          })
        },
      }
    )
    if (isChatEnabled) {
      list.push({
        id: 'new-chat',
        name: 'New chat',
        keywords: 'chat message ask sim assistant home',
        icon: Home,
        context: 'global',
        run: () => routerRef.current.push(`/workspace/${workspaceId}/home`),
      })
    }
    /* On the canvas these three join the Workflow Actions group; everywhere
       else they are platform verbs. */
    if (canEdit && onCreateWorkflow) {
      list.push({
        id: 'create-workflow',
        name: 'Create workflow',
        keywords: 'new add build',
        icon: Plus,
        context: onCanvas ? 'workflow' : 'global',
        run: onCreateWorkflow,
      })
    }
    if (canEdit && onCreateFolder) {
      list.push({
        id: 'create-folder',
        name: 'Create folder',
        keywords: 'new add group',
        icon: FolderPlus,
        context: onCanvas ? 'workflow' : 'global',
        run: onCreateFolder,
      })
    }
    if (canEdit && onImportWorkflow) {
      list.push({
        id: 'import-workflow',
        name: 'Import workflow',
        keywords: 'upload add',
        icon: Upload,
        context: onCanvas ? 'workflow' : 'global',
        run: onImportWorkflow,
      })
    }
    list.push({
      id: 'invite-teammates',
      name: 'Invite teammates',
      keywords: 'members people add user organization',
      icon: Send,
      context: 'global',
      run: () => navigateToSettings({ section: 'teammates' }),
    })

    if (canEdit && pageContext === 'tables') {
      list.push(
        {
          id: 'tables-new-table',
          name: 'New table',
          keywords: 'create add',
          icon: Plus,
          context: 'tables',
          run: invoke('tables-new-table'),
        },
        {
          id: 'tables-new-folder',
          name: 'New folder',
          keywords: 'create add group',
          icon: FolderPlus,
          context: 'tables',
          run: invoke('tables-new-folder'),
        },
        {
          id: 'tables-import-csv',
          name: 'Import CSV',
          keywords: 'upload tsv spreadsheet',
          icon: Upload,
          context: 'tables',
          run: invoke('tables-import-csv'),
        }
      )
    }
    if (canEdit && pageContext === 'tableDetail') {
      list.push(
        {
          id: 'table-new-column',
          name: 'New column',
          keywords: 'create add field',
          icon: Columns3,
          context: 'tableDetail',
          run: invoke('table-new-column'),
        },
        {
          id: 'table-export-csv',
          name: 'Export CSV',
          keywords: 'download spreadsheet',
          icon: Download,
          context: 'tableDetail',
          run: invoke('table-export-csv'),
        },
        {
          id: 'table-import-csv',
          name: 'Import CSV',
          keywords: 'upload tsv spreadsheet',
          icon: Upload,
          context: 'tableDetail',
          run: invoke('table-import-csv'),
        }
      )
    }
    if (canEdit && pageContext === 'files') {
      list.push(
        {
          id: 'files-new-file',
          name: 'New file',
          keywords: 'create add document markdown',
          icon: File,
          context: 'files',
          run: invoke('files-new-file'),
        },
        {
          id: 'files-new-folder',
          name: 'New folder',
          keywords: 'create add group',
          icon: FolderPlus,
          context: 'files',
          run: invoke('files-new-folder'),
        },
        {
          id: 'files-upload',
          name: 'Upload',
          keywords: 'add import file',
          icon: Upload,
          context: 'files',
          run: invoke('files-upload'),
        }
      )
    }
    if (pageContext === 'fileDetail') {
      list.push({
        id: 'file-download',
        name: 'Download',
        keywords: 'save export',
        icon: Download,
        context: 'fileDetail',
        run: invoke('file-download'),
      })
      if (canEdit) {
        list.push(
          {
            id: 'file-rename',
            name: 'Rename',
            keywords: 'edit name',
            icon: Pencil,
            context: 'fileDetail',
            run: invoke('file-rename'),
          },
          {
            id: 'file-share',
            name: 'Share',
            keywords: 'link send',
            icon: Send,
            context: 'fileDetail',
            run: invoke('file-share'),
          },
          {
            id: 'file-delete',
            name: 'Delete',
            keywords: 'remove trash',
            icon: Trash,
            context: 'fileDetail',
            run: invoke('file-delete'),
          }
        )
      }
    }
    if (canEdit && pageContext === 'knowledge') {
      list.push(
        {
          id: 'knowledge-new-base',
          name: 'New base',
          keywords: 'create add knowledge kb',
          icon: Plus,
          context: 'knowledge',
          run: invoke('knowledge-new-base'),
        },
        {
          id: 'knowledge-new-folder',
          name: 'New folder',
          keywords: 'create add group',
          icon: FolderPlus,
          context: 'knowledge',
          run: invoke('knowledge-new-folder'),
        }
      )
    }
    if (canEdit && pageContext === 'knowledgeBase') {
      list.push(
        {
          id: 'knowledge-base-new-documents',
          name: 'New documents',
          keywords: 'add upload document',
          icon: Plus,
          context: 'knowledgeBase',
          run: invoke('knowledge-base-new-documents'),
        },
        {
          id: 'knowledge-base-new-connector',
          name: 'New connector',
          keywords: 'add sync source connect',
          icon: Integration,
          context: 'knowledgeBase',
          run: invoke('knowledge-base-new-connector'),
        },
        {
          id: 'knowledge-base-rename',
          name: 'Rename',
          keywords: 'edit name',
          icon: Pencil,
          context: 'knowledgeBase',
          run: invoke('knowledge-base-rename'),
        },
        {
          id: 'knowledge-base-tags',
          name: 'Edit tags',
          keywords: 'label metadata',
          icon: TagIcon,
          context: 'knowledgeBase',
          run: invoke('knowledge-base-tags'),
        },
        {
          id: 'knowledge-base-delete',
          name: 'Delete',
          keywords: 'remove trash',
          icon: Trash,
          context: 'knowledgeBase',
          run: invoke('knowledge-base-delete'),
        }
      )
    }
    if (pageContext === 'logs' || pageContext === 'logsDashboard') {
      list.push({
        id: 'logs-refresh',
        name: 'Refresh',
        keywords: 'reload update',
        icon: RefreshCw,
        context: pageContext,
        run: invoke('logs-refresh'),
      })
      if (canEdit) {
        list.push({
          id: 'logs-export',
          name: 'Export',
          keywords: 'download csv',
          icon: Download,
          context: pageContext,
          run: invoke('logs-export'),
        })
      }
      list.push(
        pageContext === 'logs'
          ? {
              id: 'logs-show-dashboard',
              name: 'Visit dashboard',
              keywords: 'charts stats overview',
              icon: Library,
              context: 'logs',
              run: invoke('logs-show-dashboard'),
            }
          : {
              id: 'logs-show-logs',
              name: 'Visit logs',
              keywords: 'list executions runs',
              icon: Library,
              context: 'logsDashboard',
              run: invoke('logs-show-logs'),
            }
      )
    }
    if (canEdit && pageContext === 'scheduledTasks') {
      list.push({
        id: 'scheduled-tasks-new',
        name: 'New scheduled task',
        keywords: 'create add schedule cron recurring',
        icon: Plus,
        context: 'scheduledTasks',
        run: invoke('scheduled-tasks-new'),
      })
    }
    return list
  }, [
    workspaceId,
    canEdit,
    pageContext,
    onCreateWorkflow,
    onCreateFolder,
    onImportWorkflow,
    invokeCommand,
    navigateToSettings,
  ])

  const [search, setSearch] = useState('')
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setSearch('')
  }

  useEffect(() => {
    if (!open || !inputRef.current) return
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(inputRef.current, '')
      inputRef.current.dispatchEvent(new Event('input', { bubbles: true }))
    }
    inputRef.current.focus()
    /**
     * cmdk keeps its last selected value across closes and does not re-anchor
     * when items mount above it (it only auto-selects when nothing is selected
     * yet), so a palette whose top rows appeared after mount — e.g. page
     * actions gated on async permissions — would open with a mid-list row
     * selected. Home re-selects the first row on every open.
     */
    inputRef.current.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    /**
     * After the frame settles, pin the list back to the very top. cmdk's own
     * `scrollIntoView({ block: 'nearest' })` stops as soon as the selected row
     * edges into the scrollport, which parks it under the floating search
     * input; and without any reset a reopened palette keeps its previous
     * scroll offset.
     */
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = 0
    })
  }, [open])

  const deferredSearch = useDeferredValue(search)
  const deferredSearchRef = useRef(deferredSearch)
  deferredSearchRef.current = deferredSearch

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = 0
    })
  }, [])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onOpenChangeRef.current(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const handleWorkflowSelect = useCallback(
    (workflow: WorkflowItem) => {
      if (!workflow.isCurrent && workflow.href) {
        routerRef.current.push(workflow.href)
        window.dispatchEvent(
          new CustomEvent(SIDEBAR_SCROLL_EVENT, { detail: { itemId: workflow.id } })
        )
      }
      captureEvent(posthogRef.current, 'search_result_selected', {
        result_type: 'workflow',
        query_length: deferredSearchRef.current.length,
        workspace_id: workspaceId,
      })
      onOpenChangeRef.current(false)
    },
    [workspaceId]
  )

  const handleWorkspaceSelect = useCallback(
    (workspace: WorkspaceItem) => {
      if (!workspace.isCurrent && workspace.href) {
        routerRef.current.push(workspace.href)
      }
      captureEvent(posthogRef.current, 'search_result_selected', {
        result_type: 'workspace',
        query_length: deferredSearchRef.current.length,
        workspace_id: workspaceId,
      })
      onOpenChangeRef.current(false)
    },
    [workspaceId]
  )

  const handleChatSelect = useCallback(
    (chat: TaskItem) => {
      routerRef.current.push(chat.href)
      captureEvent(posthogRef.current, 'search_result_selected', {
        result_type: 'task',
        query_length: deferredSearchRef.current.length,
        workspace_id: workspaceId,
      })
      onOpenChangeRef.current(false)
    },
    [workspaceId]
  )

  const handleTableSelect = useCallback(
    (item: TaskItem) => {
      routerRef.current.push(item.href)
      captureEvent(posthogRef.current, 'search_result_selected', {
        result_type: 'table',
        query_length: deferredSearchRef.current.length,
        workspace_id: workspaceId,
      })
      onOpenChangeRef.current(false)
    },
    [workspaceId]
  )

  const handleFileSelect = useCallback(
    (item: FileItem) => {
      routerRef.current.push(item.href)
      captureEvent(posthogRef.current, 'search_result_selected', {
        result_type: 'file',
        query_length: deferredSearchRef.current.length,
        workspace_id: workspaceId,
      })
      onOpenChangeRef.current(false)
    },
    [workspaceId]
  )

  const handleKbSelect = useCallback(
    (item: TaskItem) => {
      routerRef.current.push(item.href)
      captureEvent(posthogRef.current, 'search_result_selected', {
        result_type: 'knowledge_base',
        query_length: deferredSearchRef.current.length,
        workspace_id: workspaceId,
      })
      onOpenChangeRef.current(false)
    },
    [workspaceId]
  )

  const handlePageSelect = useCallback(
    (page: PageItem) => {
      if (page.onClick) {
        page.onClick()
      } else if (page.href) {
        if (page.href.startsWith('http')) {
          window.open(page.href, '_blank', 'noopener,noreferrer')
        } else {
          routerRef.current.push(page.href)
        }
      }
      captureEvent(posthogRef.current, 'search_result_selected', {
        result_type: 'page',
        query_length: deferredSearchRef.current.length,
        workspace_id: workspaceId,
      })
      onOpenChangeRef.current(false)
    },
    [workspaceId]
  )

  const handleLogSelect = useCallback(
    (item: LogItem) => {
      routerRef.current.push(item.href)
      captureEvent(posthogRef.current, 'search_result_selected', {
        result_type: 'log',
        query_length: deferredSearchRef.current.length,
        workspace_id: workspaceId,
      })
      onOpenChangeRef.current(false)
    },
    [workspaceId]
  )

  const handleConnectedAccountSelect = useCallback(
    (item: IntegrationSearchItem) => {
      routerRef.current.push(item.href)
      captureEvent(posthogRef.current, 'search_result_selected', {
        result_type: 'connected_account',
        query_length: deferredSearchRef.current.length,
        workspace_id: workspaceId,
      })
      onOpenChangeRef.current(false)
    },
    [workspaceId]
  )

  const handleIntegrationSelect = useCallback(
    (item: IntegrationSearchItem) => {
      routerRef.current.push(item.href)
      captureEvent(posthogRef.current, 'search_result_selected', {
        result_type: 'integration',
        query_length: deferredSearchRef.current.length,
        workspace_id: workspaceId,
      })
      onOpenChangeRef.current(false)
    },
    [workspaceId]
  )

  const handleActionSelect = useCallback(
    (item: ActionItem) => {
      onOpenChangeRef.current(false)
      item.run()
      captureEvent(posthogRef.current, 'search_result_selected', {
        result_type: 'action',
        action_id: item.id,
        query_length: deferredSearchRef.current.length,
        workspace_id: workspaceId,
      })
    },
    [workspaceId]
  )

  const handleNewChatFromQuery = useCallback(() => {
    const query = deferredSearchRef.current.trim()
    if (!query) return

    const homeHref = `/workspace/${workspaceId}/home`
    const sentToMountedHome = window.location.pathname === homeHref && sendMothershipMessage(query)

    if (!sentToMountedHome) {
      if (!MothershipHandoffStorage.store({ message: query }, workspaceId)) {
        logger.warn('Failed to persist command palette query for a new chat', {
          workspaceId,
        })
        return
      }
      routerRef.current.push(getMothershipHandoffHref(workspaceId))
    }

    onOpenChangeRef.current(false)
    captureEvent(posthogRef.current, 'search_result_selected', {
      result_type: 'action',
      action_id: 'new-chat-from-query',
      query_length: query.length,
      workspace_id: workspaceId,
    })
  }, [workspaceId])

  const handleOverlayClick = useCallback(() => {
    onOpenChangeRef.current(false)
  }, [])

  const entriesBySection = useMemo((): Record<SearchSection, SearchEntry[]> => {
    const query = deferredSearch.trim()
    const rank = <T,>(
      section: SearchSection,
      items: T[],
      toValue: (item: T) => string,
      toExtra?: (item: T) => string | undefined
    ) =>
      query
        ? scoreSectionItems(section, items, toValue, deferredSearch, toExtra, MAX_RESULTS_PER_GROUP)
        : items.map((item) => ({ item, score: 0 }))
    const availableActions = actions.filter(
      (action) => action.context === 'global' || action.context === pageContext
    )
    const rankActionGroup = (items: ActionItem[], groupLabel: ActionGroupLabel) =>
      query
        ? scoreActions(items, deferredSearch, MAX_RESULTS_PER_GROUP, groupLabel)
        : items.map((item) => ({ item, score: 0 }))
    const pageGroupLabel = pageContext ? getPageActionGroupLabel(pageContext) : null
    const rankedActions = [
      ...(pageGroupLabel
        ? rankActionGroup(
            availableActions.filter((action) => getActionGroupLabel(action) === pageGroupLabel),
            pageGroupLabel
          )
        : []),
      ...rankActionGroup(
        availableActions.filter((action) => getActionGroupLabel(action) === 'Platform'),
        'Platform'
      ),
    ]

    return {
      actions: rankedActions.map(({ item, score }) => ({ section: 'actions', item, score })),
      pages: rank('pages', pages, (item) => item.name).map(({ item, score }) => ({
        section: 'pages',
        item,
        score,
      })),
      workflows: rank(
        'workflows',
        workflows,
        (item) => item.name,
        (item) => item.folderPath?.map(toSearchToken).join(' ')
      ).map(({ item, score }) => ({ section: 'workflows', item, score })),
      workspaces: rank('workspaces', workspaces, (item) => item.name).map(({ item, score }) => ({
        section: 'workspaces',
        item,
        score,
      })),
      files: rank(
        'files',
        files,
        (item) => item.name,
        (item) => item.folderPath?.map(toSearchToken).join(' ')
      ).map(({ item, score }) => ({ section: 'files', item, score })),
      tables: rank(
        'tables',
        tables,
        (item) => item.name,
        (item) => item.folderPath?.map(toSearchToken).join(' ')
      ).map(({ item, score }) => ({ section: 'tables', item, score })),
      knowledgeBases: rank(
        'knowledgeBases',
        knowledgeBases,
        (item) => item.name,
        (item) => item.folderPath?.map(toSearchToken).join(' ')
      ).map(({ item, score }) => ({ section: 'knowledgeBases', item, score })),
      logs: rank('logs', logs, (item) => item.name).map(({ item, score }) => ({
        section: 'logs',
        item,
        score,
      })),
      connectedAccounts: rank('connectedAccounts', connectedAccounts, (item) => item.name).map(
        ({ item, score }) => ({ section: 'connectedAccounts', item, score })
      ),
      integrations: rank('integrations', integrations, (item) => item.name).map(
        ({ item, score }) => ({ section: 'integrations', item, score })
      ),
      chats: rank('chats', chats, (item) => item.name).map(({ item, score }) => ({
        section: 'chats',
        item,
        score,
      })),
    }
  }, [
    deferredSearch,
    actions,
    pageContext,
    integrations,
    connectedAccounts,
    chats,
    workflows,
    tables,
    files,
    knowledgeBases,
    logs,
    workspaces,
    pages,
  ])

  const searchQuery = deferredSearch.trim()
  const isSearching = Boolean(searchQuery)
  /**
   * Section order for both the browse list and the flat search tie-break: the
   * page's own entity section is hoisted directly under `actions`, the rest
   * keep the canonical order.
   */
  const orderedSections = useMemo((): SearchSection[] => {
    const hoisted = pageContext ? PAGE_CONTEXT_HOISTED_SECTION[pageContext] : undefined
    if (!hoisted) return [...SEARCH_SECTIONS]
    return [
      'actions',
      hoisted,
      ...SEARCH_SECTIONS.filter((section) => section !== 'actions' && section !== hoisted),
    ]
  }, [pageContext])
  const searchResults = useMemo(
    () => (isSearching ? getGlobalSearchResults(entriesBySection, orderedSections) : []),
    [orderedSections, entriesBySection, isSearching]
  )
  const showNewChatFallback = isSearching && searchResults.length === 0 && isChatEnabled
  const newChatFallbackLabel = `New Chat: ${searchQuery}`
  const sectionGroups = useMemo(() => {
    const actionEntriesByLabel = (label: ActionGroupLabel) =>
      entriesBySection.actions.filter(
        (entry) => entry.section === 'actions' && getActionGroupLabel(entry.item) === label
      )
    const entityGroup = (section: SearchSection) => ({
      key: section,
      heading: SECTION_LABELS[section],
      entries: entriesBySection[section],
    })
    const pageGroupLabel = pageContext ? getPageActionGroupLabel(pageContext) : null
    const hoisted = pageContext ? PAGE_CONTEXT_HOISTED_SECTION[pageContext] : undefined

    return [
      ...(pageGroupLabel
        ? [
            {
              key: 'page-actions',
              heading: pageGroupLabel,
              entries: actionEntriesByLabel(pageGroupLabel),
            },
          ]
        : []),
      ...(hoisted ? [entityGroup(hoisted)] : []),
      {
        key: 'platform-actions',
        heading: 'Platform',
        entries: actionEntriesByLabel('Platform'),
      },
      ...SEARCH_SECTIONS.filter((section) => section !== 'actions' && section !== hoisted).map(
        entityGroup
      ),
    ]
  }, [entriesBySection, pageContext])

  const entryHandlers = useMemo(
    (): SearchEntryHandlers => ({
      onSelectAction: handleActionSelect,
      onSelectConnectedAccount: handleConnectedAccountSelect,
      onSelectIntegration: handleIntegrationSelect,
      onSelectChat: handleChatSelect,
      onSelectWorkflow: handleWorkflowSelect,
      onSelectTable: handleTableSelect,
      onSelectFile: handleFileSelect,
      onSelectKnowledgeBase: handleKbSelect,
      onSelectLog: handleLogSelect,
      onSelectWorkspace: handleWorkspaceSelect,
      onSelectPage: handlePageSelect,
    }),
    [
      handleActionSelect,
      handleConnectedAccountSelect,
      handleIntegrationSelect,
      handleChatSelect,
      handleWorkflowSelect,
      handleTableSelect,
      handleFileSelect,
      handleKbSelect,
      handleLogSelect,
      handleWorkspaceSelect,
      handlePageSelect,
    ]
  )

  if (!mounted) return null

  return createPortal(
    <>
      <div
        className={cn(
          'fixed inset-0 z-[var(--z-modal)] transition-opacity duration-100',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={handleOverlayClick}
        aria-hidden={!open}
      />

      <div
        role='dialog'
        aria-modal={open}
        aria-hidden={!open}
        aria-label='Search'
        className={cn(
          '-translate-x-1/2 fixed top-[15%] z-[var(--z-modal)] w-[500px] rounded-xl border border-[var(--border-muted)] bg-[var(--surface-4)] p-[3px] shadow-[var(--shadow-overlay)] dark:bg-[var(--surface-5)]',
          open ? 'visible opacity-100' : 'invisible opacity-0'
        )}
        style={{
          left: isOnWorkflowPage
            ? 'calc(50% + (var(--sidebar-width) - var(--panel-width)) / 2)'
            : 'calc(var(--sidebar-width) / 2 + 50%)',
        }}
      >
        <div className='overflow-hidden rounded-lg border border-[var(--border-1)] bg-[var(--bg)]'>
          <Command
            label='Search'
            shouldFilter={false}
            loop
            value={showNewChatFallback ? newChatFallbackLabel : undefined}
          >
            <div className='relative'>
              <CommandFadedList
                ref={listRef}
                fade='palette'
                className={cn(
                  'scrollbar-none max-h-[448px] [clip-path:inset(3px_round_13px)]',
                  CMDK_ITEM_GAP_CLASS,
                  CMDK_SECTION_GAP_CLASS
                )}
              >
                <Command.Empty className='flex items-center justify-center px-4 py-6 text-[var(--text-subtle)] text-sm'>
                  No results found.
                </Command.Empty>

                {showNewChatFallback ? (
                  <MemoizedActionItem
                    value={newChatFallbackLabel}
                    onSelect={handleNewChatFromQuery}
                    icon={Home}
                    name={newChatFallbackLabel}
                  />
                ) : isSearching ? (
                  <SearchEntryGroup
                    variant='results'
                    entries={searchResults}
                    handlers={entryHandlers}
                  />
                ) : (
                  sectionGroups.map(({ key, heading, entries }) => (
                    <SearchEntryGroup
                      key={key}
                      variant='section'
                      heading={heading}
                      entries={entries}
                      handlers={entryHandlers}
                    />
                  ))
                )}
              </CommandFadedList>
              <CommandSearch
                ref={inputRef}
                surface='palette'
                cycleResultsOnTab
                autoFocus
                aria-label='Search anything'
                onValueChange={handleSearchChange}
                placeholder='Search anything...'
              />
            </div>
          </Command>
        </div>
      </div>
    </>,
    document.body
  )
}
