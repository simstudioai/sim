'use client'

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cn, Library, useNativeSurfaceOcclusionReady } from '@sim/emcn'
import {
  Columns3,
  Database,
  Download,
  Duplicate,
  File,
  FolderPlus,
  Hammer,
  HelpCircle,
  Home,
  Integration,
  Key,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  SelectAll,
  Send,
  Settings,
  Table,
  TagIcon,
  Trash,
  Upload,
} from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { Command } from 'cmdk'
import { useParams, useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { createPortal } from 'react-dom'
import { supportsAtomicBrowserPanelOcclusion } from '@/lib/browser-agent/transport'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { getFolderPathNames } from '@/lib/folders/tree'
import { sendMothershipMessage } from '@/lib/mothership/events'
import { captureEvent } from '@/lib/posthog/client'
import { toSearchToken } from '@/lib/search/tokens'
import { hasTriggerCapability } from '@/lib/workflows/triggers/trigger-utils'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'
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
  CANVAS_SECTIONS,
  getActionGroupLabel,
  getGlobalSearchResults,
  MAX_RESULTS_PER_GROUP,
  PAGE_CONTEXT_HOISTED_SECTION,
  PAGE_MATCH_TIER,
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
import { useFolderMap } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import type { WorkflowFolder } from '@/stores/folders/types'
import { useSearchModalStore } from '@/stores/modals/search/store'
import type { SearchBlockItem, SearchToolOperationItem } from '@/stores/modals/search/types'

const logger = createLogger('SearchModal')

/**
 * Half of the dialog's effective width (`min(500px, 100% - 32px)`), used to
 * clamp the centered `left` position. The dialog centers over the content
 * area — offset right by the sidebar (and panel on the canvas) — so on narrow
 * viewports the unclamped position pushes it past the right edge, clipping
 * the input adornment and the empty state. Clamping keeps a 16px gutter on
 * both sides; when the viewport is narrower than the dialog plus gutters,
 * both clamp bounds collapse to `50%` and the dialog re-centers.
 */
const PALETTE_HALF_WIDTH = 'min(250px, 50% - 16px)'
/**
 * Global row budget for the browse (empty-query) list, applied cumulatively in
 * section order. Individual sections are never capped in browse — the budget
 * exists purely to bound render cost when the combined lists are huge.
 * Currently disabled (Infinity); set a finite number to re-enable the bound.
 */
export const MAX_BROWSE_RESULTS = Number.POSITIVE_INFINITY
const MAX_SEARCH_RESULTS = 50

/** Stable empty default so a pending folder map does not remount the memos below. */
const EMPTY_FOLDER_MAP: Record<string, WorkflowFolder> = {}

export type { SearchModalProps } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'

type SearchModalContentProps = Omit<SearchModalProps, 'open'>

export function SearchModal({ open, ...props }: SearchModalProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted || !open) return null
  return <SearchModalContent {...props} />
}

function SearchModalContent({
  onOpenChange,
  workflows = [],
  workspaces = [],
  chats = [],
  logs = [],
  integrations = [],
  connectedAccounts = [],
  pageContext = null,
  canEdit = false,
  canAdmin = false,
  onCreateWorkflow,
  onCreateFolder,
  onImportWorkflow,
}: SearchModalContentProps) {
  const params = useParams()
  const router = useRouter()
  const { chatEnabled } = useDeploymentShape()
  const workspaceId = params.workspaceId as string
  const currentWorkflowId = params.workflowId as string | undefined
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const atomicBrowserOcclusion = supportsAtomicBrowserPanelOcclusion()
  const nativeSurfaceReady = useNativeSurfaceOcclusionReady(true, 'modal')
  const visuallyOpen = nativeSurfaceReady
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

  const { blocks, tools, triggers, toolOperations } = useSearchModalStore((state) => state.data)

  /**
   * Read here rather than passed down from the sidebar. This component mounts only while the
   * palette is open, so these workspace-wide lists are fetched — and registered in the query
   * cache — only then. The sidebar renders on every workspace route, so holding them there put
   * three lists and two folder maps in the cache on routes that never display them, and a
   * registered key also blocks a page from seeding it during the server render.
   */
  const { data: fetchedTables = [] } = useTablesList(workspaceId, 'active', {
    enabled: !permissionConfig.hideTablesTab,
  })
  const { data: fetchedFiles = [] } = useWorkspaceFiles(workspaceId, 'active', {
    enabled: !permissionConfig.hideFilesTab,
  })
  const { data: fetchedKnowledgeBases = [] } = useKnowledgeBasesQuery(workspaceId, {
    enabled: !permissionConfig.hideKnowledgeBaseTab,
  })
  const { data: tableFolderMap = EMPTY_FOLDER_MAP } = useFolderMap(
    permissionConfig.hideTablesTab ? undefined : workspaceId,
    'table'
  )
  const { data: knowledgeBaseFolderMap = EMPTY_FOLDER_MAP } = useFolderMap(
    permissionConfig.hideKnowledgeBaseTab ? undefined : workspaceId,
    'knowledge_base'
  )

  /**
   * The hidden-tab checks are repeated here, not left to `enabled`. A disabled query still
   * returns whatever is already cached — another surface may have filled it, or the permission
   * config may have flipped after it did — so gating only the fetch would let the palette list
   * entities a permission group hides.
   */
  const tables = useMemo(
    () =>
      permissionConfig.hideTablesTab
        ? []
        : fetchedTables.map((t) => ({
            id: t.id,
            name: t.name,
            href: `/workspace/${workspaceId}/tables/${t.id}`,
            folderPath: getFolderPathNames(tableFolderMap, t.folderId),
          })),
    [fetchedTables, tableFolderMap, workspaceId, permissionConfig.hideTablesTab]
  )

  const files = useMemo(
    () =>
      permissionConfig.hideFilesTab
        ? []
        : fetchedFiles.map((f) => ({
            id: f.id,
            name: f.name,
            href: `/workspace/${workspaceId}/files/${f.id}`,
            folderPath: f.folderPath
              ? parseWorkspaceFileFolderDisplayPath(f.folderPath)
              : undefined,
          })),
    [fetchedFiles, workspaceId, permissionConfig.hideFilesTab]
  )

  const knowledgeBases = useMemo(
    () =>
      permissionConfig.hideKnowledgeBaseTab
        ? []
        : fetchedKnowledgeBases.map((kb) => ({
            id: kb.id,
            name: kb.name,
            href: `/workspace/${workspaceId}/knowledge/${kb.id}`,
            folderPath: getFolderPathNames(knowledgeBaseFolderMap, kb.folderId),
          })),
    [
      fetchedKnowledgeBases,
      knowledgeBaseFolderMap,
      workspaceId,
      permissionConfig.hideKnowledgeBaseTab,
    ]
  )

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
          id: 'skills',
          name: 'Skills',
          icon: Hammer,
          href: `/workspace/${workspaceId}/skills`,
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
          name: 'Knowledge bases',
          icon: Database,
          href: `/workspace/${workspaceId}/knowledge`,
          hidden: permissionConfig.hideKnowledgeBaseTab,
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
    const invoke = (id: string) => () => invokeCommand(id)

    list.push({
      id: 'run-workflow',
      name: 'Run workflow',
      keywords: 'execute start play test',
      icon: Play,
      shortcut: '⌘↵',
      context: 'workflow',
      run: invoke('run-workflow'),
    })
    if (canAdmin) {
      list.push({
        id: 'deploy-workflow',
        name: 'Deploy workflow',
        keywords: 'ship release publish api',
        exactQueries: ['deploy'],
        icon: Rocket,
        context: 'workflow',
        run: invoke('deploy-workflow'),
      })
    }
    list.push(
      {
        id: 'fit-to-view',
        name: 'Fit workflow to view',
        keywords: 'zoom center recenter canvas reset',
        icon: SelectAll,
        shortcut: '⇧⌘F',
        context: 'workflow',
        run: invoke('fit-to-view'),
      },
      {
        id: 'copy-workflow-url',
        name: 'Copy workflow link',
        keywords: 'url share clipboard',
        exactQueries: ['copy'],
        icon: Duplicate,
        context: 'workflow',
        run: () => {
          navigator.clipboard.writeText(window.location.href).catch((error) => {
            logger.error('Failed to copy workflow link to clipboard', { error })
          })
        },
      }
    )
    if (chatEnabled) {
      list.push({
        id: 'new-chat',
        name: 'New chat',
        keywords: 'chat chats message ask sim assistant home',
        exactQueries: ['chats'],
        icon: Home,
        context: 'global',
        run: () => routerRef.current.push(`/workspace/${workspaceId}/home`),
      })
    }
    if (canEdit && onCreateWorkflow) {
      list.push({
        id: 'create-workflow',
        name: 'Create workflow',
        keywords: 'new add build workflows',
        exactQueries: ['workflows'],
        icon: Plus,
        context: 'global',
        run: onCreateWorkflow,
      })
    }
    if (canEdit && onCreateFolder) {
      list.push({
        id: 'create-folder',
        name: 'Create folder',
        keywords: 'new add group',
        icon: FolderPlus,
        context: 'global',
        run: onCreateFolder,
      })
    }
    if (canEdit && onImportWorkflow) {
      list.push({
        id: 'import-workflow',
        name: 'Import workflow',
        keywords: 'upload add',
        icon: Upload,
        context: 'global',
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
    if (pageContext === 'tableDetail') {
      list.push({
        id: 'table-export-csv',
        name: 'Export CSV',
        keywords: 'download spreadsheet',
        icon: Download,
        context: 'tableDetail',
        run: invoke('table-export-csv'),
      })
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
              name: 'Switch to Dashboard',
              keywords: 'charts stats overview',
              icon: Library,
              context: 'logs',
              run: invoke('logs-show-dashboard'),
            }
          : {
              id: 'logs-show-logs',
              name: 'Switch to Logs',
              keywords: 'list executions runs',
              icon: Library,
              context: 'logsDashboard',
              run: invoke('logs-show-logs'),
            }
      )
    }
    return list
  }, [
    workspaceId,
    canEdit,
    canAdmin,
    chatEnabled,
    pageContext,
    onCreateWorkflow,
    onCreateFolder,
    onImportWorkflow,
    invokeCommand,
    navigateToSettings,
  ])

  const [search, setSearch] = useState('')
  /**
   * Ranking runs against the deferred query: the full cross-section re-rank
   * (1000+ rows on the canvas) would otherwise block every keystroke's
   * commit. Handlers keep reading the live value via `searchRef`.
   */
  const deferredSearch = useDeferredValue(search)
  /** Tab-toggled ask mode: Enter hands the typed query to Sim as a new chat. */
  const [askMode, setAskMode] = useState(false)
  const searchRef = useRef(search)
  searchRef.current = search

  /**
   * Focus once the dialog is actually visible: under atomic browser-panel
   * occlusion `autoFocus` is suppressed, and `.focus()` is a no-op while the
   * surface still carries `invisible`.
   */
  useEffect(() => {
    if (!visuallyOpen) return
    inputRef.current?.focus()
  }, [visuallyOpen])

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = 0
    })
  }, [])

  /**
   * Tab flips between searching and asking Sim, keeping the typed text. On the
   * way back the ask row unmounts while cmdk still remembers it as selected,
   * so Home re-anchors the selection once the result rows are back.
   */
  const handleSearchKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Tab' || !chatEnabled) return
      event.preventDefault()
      setAskMode((mode) => !mode)
      requestAnimationFrame(() => {
        inputRef.current?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Home', bubbles: true })
        )
      })
    },
    [chatEnabled]
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onOpenChangeRef.current(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  /**
   * cmdk re-anchors selection on input change against the rows the DOM still
   * shows, but ranking runs against the deferred query, so those rows are one
   * keystroke stale. When the re-ranked list lands, the stale pick either
   * lingers mid-list (it still matches, demoted) or dangles on an unmounted
   * row (cmdk only self-heals when the selected row is the last one removed),
   * leaving the first visible row unfocused. Re-anchor once the list the
   * ranking agrees with has committed.
   */
  useEffect(() => {
    inputRef.current?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
  }, [deferredSearch])

  const handleBlockSelect = useCallback(
    (block: SearchBlockItem, type: 'block' | 'trigger' | 'tool') => {
      const enableTriggerMode =
        type === 'trigger' && block.config ? hasTriggerCapability(block.config) : false
      window.dispatchEvent(
        new CustomEvent('add-block-from-toolbar', {
          detail: { type: block.type, enableTriggerMode },
        })
      )
      captureEvent(posthogRef.current, 'search_result_selected', {
        result_type: type,
        query_length: searchRef.current.length,
        workspace_id: workspaceId,
      })
      onOpenChangeRef.current(false)
    },
    [workspaceId]
  )

  const handleToolOperationSelect = useCallback(
    (op: SearchToolOperationItem) => {
      window.dispatchEvent(
        new CustomEvent('add-block-from-toolbar', {
          detail: { type: op.blockType, presetOperation: op.operationId },
        })
      )
      captureEvent(posthogRef.current, 'search_result_selected', {
        result_type: 'tool_operation',
        query_length: searchRef.current.length,
        workspace_id: workspaceId,
      })
      onOpenChangeRef.current(false)
    },
    [workspaceId]
  )

  const handleBlockSelectAsBlock = useCallback(
    (block: SearchBlockItem) => handleBlockSelect(block, 'block'),
    [handleBlockSelect]
  )

  const handleBlockSelectAsTool = useCallback(
    (tool: SearchBlockItem) => handleBlockSelect(tool, 'tool'),
    [handleBlockSelect]
  )

  const handleBlockSelectAsTrigger = useCallback(
    (trigger: SearchBlockItem) => handleBlockSelect(trigger, 'trigger'),
    [handleBlockSelect]
  )

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
        query_length: searchRef.current.length,
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
        query_length: searchRef.current.length,
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
        query_length: searchRef.current.length,
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
        query_length: searchRef.current.length,
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
        query_length: searchRef.current.length,
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
        query_length: searchRef.current.length,
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
        query_length: searchRef.current.length,
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
        query_length: searchRef.current.length,
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
        query_length: searchRef.current.length,
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
        query_length: searchRef.current.length,
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
        query_length: searchRef.current.length,
        workspace_id: workspaceId,
      })
    },
    [workspaceId]
  )

  const handleNewChatFromQuery = useCallback(() => {
    const query = searchRef.current.trim()
    if (!query) return

    const homeHref = `/workspace/${workspaceId}/home`
    const sentToMountedHome = window.location.pathname === homeHref && sendMothershipMessage(query)

    if (!sentToMountedHome) {
      /* One-shot auto-send handoff: Home's mount consumer sends it on arrival,
         so both routes deliver the raw query identically. use-chat's queued
         send dispatch now survives the mount-settling effect cycle that used
         to silently abort programmatic sends (the old reason this was a
         prefill). */
      if (!MothershipHandoffStorage.store({ message: query }, workspaceId)) {
        logger.warn('Failed to persist command palette query for a new chat', {
          workspaceId,
        })
        return
      }
      routerRef.current.push(homeHref)
    }

    onOpenChangeRef.current(false)
    captureEvent(posthogRef.current, 'search_result_selected', {
      result_type: 'action',
      action_id: 'new-chat-from-query',
      query_length: query.length,
      workspace_id: workspaceId,
    })
  }, [workspaceId])

  /** Enter in ask mode: hand the query to Sim, or just open a new chat when empty. */
  const handleAskSim = useCallback(() => {
    if (searchRef.current.trim()) {
      handleNewChatFromQuery()
      return
    }
    routerRef.current.push(`/workspace/${workspaceId}/home`)
    onOpenChangeRef.current(false)
    captureEvent(posthogRef.current, 'search_result_selected', {
      result_type: 'action',
      action_id: 'new-chat',
      query_length: 0,
      workspace_id: workspaceId,
    })
  }, [workspaceId, handleNewChatFromQuery])

  const handleOverlayClick = useCallback(() => {
    onOpenChangeRef.current(false)
  }, [])

  const onCanvas = pageContext === 'workflow'
  const actionsByGroup = useMemo(() => {
    const available = actions.filter(
      (action) => action.context === 'global' || action.context === pageContext
    )
    return {
      page: pageContext
        ? available.filter((action) => getActionGroupLabel(action) === 'Actions')
        : [],
      sim: available.filter((action) => getActionGroupLabel(action) === 'Sim'),
    }
  }, [actions, pageContext])
  const availableBlocks = useMemo(
    () =>
      onCanvas
        ? blocks.filter(
            (block) => !block.sourceWorkflowId || block.sourceWorkflowId !== currentWorkflowId
          )
        : [],
    [onCanvas, blocks, currentWorkflowId]
  )
  const availableTools = useMemo(
    () =>
      onCanvas
        ? tools.filter(
            (tool) => !tool.sourceWorkflowId || tool.sourceWorkflowId !== currentWorkflowId
          )
        : [],
    [onCanvas, tools, currentWorkflowId]
  )
  /** Palette triggers carry a display suffix; `baseName` keeps the true name rankable. */
  const displayTriggers = useMemo(
    () =>
      onCanvas
        ? triggers.map((trigger) => ({
            ...trigger,
            baseName: trigger.name,
            name: trigger.name.endsWith('Trigger') ? trigger.name : `${trigger.name} Trigger`,
          }))
        : [],
    [onCanvas, triggers]
  )

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
    const rankActionGroup = (items: ActionItem[], groupLabel: ActionGroupLabel) =>
      query
        ? scoreActions(items, deferredSearch, MAX_RESULTS_PER_GROUP, groupLabel)
        : items.map((item) => ({ item, score: 0 }))
    const rankedActions = [
      ...(pageContext ? rankActionGroup(actionsByGroup.page, 'Actions') : []),
      ...rankActionGroup(actionsByGroup.sim, 'Sim'),
    ]
    const blockNames = new Set(
      [...availableBlocks, ...availableTools].map((item) => item.name.toLowerCase())
    )

    return {
      actions: rankedActions.map(({ item, score }) => ({ section: 'actions', item, score })),
      blocks: rank(
        'blocks',
        availableBlocks,
        (item) => item.name,
        (item) => item.searchValue
      ).map(({ item, score }) => ({
        section: 'blocks',
        item,
        score: item.name.toLowerCase() === query.toLowerCase() ? PAGE_MATCH_TIER : score,
      })),
      triggers: rank(
        'triggers',
        displayTriggers,
        (item) => item.name,
        (item) => `${toSearchToken(item.name)} ${item.id}`
      ).map(({ item, score }) => ({
        section: 'triggers',
        item,
        /* The display rename ("Start" → "Start Trigger") costs the exact-name
           bonus, so a query that IS the trigger's name ranks it like a page row
           — unless a block shares that name (Gmail, Slack). Then the query names
           the block first, and the lift would leapfrog its exact-name match. */
        score:
          item.baseName.toLowerCase() === query.toLowerCase() &&
          !blockNames.has(item.baseName.toLowerCase())
            ? PAGE_MATCH_TIER
            : score,
      })),
      tools: rank(
        'tools',
        availableTools,
        (item) => item.name,
        (item) => item.searchValue
      ).map(({ item, score }) => ({ section: 'tools', item, score })),
      /* Tool operations are the one huge list (1000+ rows); browsing them
         uncapped makes modal open/close laggy, so they are search-only. */
      toolOperations: rank(
        'toolOperations',
        onCanvas && query ? toolOperations : [],
        (item) => item.name,
        (item) => item.searchValue
      ).map(({ item, score }) => ({ section: 'toolOperations', item, score })),
      pages: rank('pages', pages, (item) => item.name).map(({ item, score }) => ({
        section: 'pages',
        item,
        score: item.name.toLowerCase() === query.toLowerCase() ? PAGE_MATCH_TIER : score,
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
      connectedAccounts: rank(
        'connectedAccounts',
        onCanvas ? [] : connectedAccounts,
        (item) => item.name
      ).map(({ item, score }) => ({ section: 'connectedAccounts', item, score })),
      integrations: rank('integrations', onCanvas ? [] : integrations, (item) => item.name).map(
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
    actionsByGroup,
    pageContext,
    onCanvas,
    availableBlocks,
    availableTools,
    displayTriggers,
    toolOperations,
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

  const searchQuery = search.trim()
  /* Mode follows the DEFERRED query the ranking ran against — keying it on the
     live value would flip the layout a frame before the entries agree with it. */
  const isSearching = Boolean(deferredSearch.trim())
  /**
   * Section order for both the browse list and the flat search tie-break: the
   * page's own entity section is hoisted directly under `actions`, the rest
   * keep the canonical order.
   */
  const hoistedSection = pageContext ? PAGE_CONTEXT_HOISTED_SECTION[pageContext] : undefined
  const orderedSections = useMemo((): SearchSection[] => {
    if (!hoistedSection) return [...SEARCH_SECTIONS]
    return [
      'actions',
      hoistedSection,
      ...SEARCH_SECTIONS.filter((section) => section !== 'actions' && section !== hoistedSection),
    ]
  }, [hoistedSection])
  const searchResults = useMemo(
    () =>
      isSearching
        ? getGlobalSearchResults(entriesBySection, orderedSections).slice(0, MAX_SEARCH_RESULTS)
        : [],
    [orderedSections, entriesBySection, isSearching]
  )
  const askSimLabel = searchQuery ? `New chat: ${searchQuery}` : 'Start a new chat'
  const sectionGroups = useMemo(() => {
    if (isSearching) return []
    const actionEntriesByLabel = (label: ActionGroupLabel) =>
      entriesBySection.actions.filter(
        (entry) => entry.section === 'actions' && getActionGroupLabel(entry.item) === label
      )
    const entityGroup = (section: SearchSection) => ({
      key: section,
      heading: SECTION_LABELS[section],
      entries: entriesBySection[section],
    })

    const canvasSections = new Set<SearchSection>(CANVAS_SECTIONS)
    const groups = [
      ...(pageContext
        ? [
            {
              key: 'page-actions',
              heading: 'Actions',
              entries: actionEntriesByLabel('Actions'),
            },
          ]
        : []),
      {
        key: 'platform-actions',
        heading: 'Sim',
        entries: actionEntriesByLabel('Sim'),
      },
      ...(hoistedSection ? [entityGroup(hoistedSection)] : []),
      ...CANVAS_SECTIONS.map(entityGroup),
      ...SEARCH_SECTIONS.filter(
        (section) =>
          section !== 'actions' && section !== hoistedSection && !canvasSections.has(section)
      ).map(entityGroup),
    ]

    let remaining = MAX_BROWSE_RESULTS
    return groups.map((group) => {
      if (group.entries.length <= remaining) {
        remaining -= group.entries.length
        return group
      }
      const truncated = { ...group, entries: group.entries.slice(0, remaining) }
      remaining = 0
      return truncated
    })
  }, [entriesBySection, pageContext, hoistedSection, isSearching])

  const entryHandlers = useMemo(
    (): SearchEntryHandlers => ({
      onSelectAction: handleActionSelect,
      onSelectBlock: handleBlockSelectAsBlock,
      onSelectTool: handleBlockSelectAsTool,
      onSelectTrigger: handleBlockSelectAsTrigger,
      onSelectToolOperation: handleToolOperationSelect,
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
      handleBlockSelectAsBlock,
      handleBlockSelectAsTool,
      handleBlockSelectAsTrigger,
      handleToolOperationSelect,
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

  return createPortal(
    <>
      <div
        className={cn(
          'fixed inset-0 z-[var(--z-modal)] transition-opacity duration-100',
          visuallyOpen ? 'opacity-100' : 'opacity-0'
        )}
        onClick={handleOverlayClick}
        aria-hidden={!visuallyOpen}
        data-native-surface-occlusion='modal'
      />

      <div
        role='dialog'
        aria-modal={visuallyOpen}
        aria-hidden={!visuallyOpen}
        aria-label='Search'
        className={cn(
          '-translate-x-1/2 fixed top-[15%] z-[var(--z-modal)] w-[min(500px,calc(100%-32px))] rounded-xl border border-[var(--border-muted)] bg-[var(--surface-4)] p-[3px] dark:bg-[var(--surface-5)]',
          visuallyOpen ? 'visible opacity-100' : 'invisible opacity-0'
        )}
        style={{
          left: `clamp(calc(16px + ${PALETTE_HALF_WIDTH}), ${
            pageContext === 'workflow'
              ? 'calc(50% + (var(--sidebar-width) - var(--panel-width)) / 2)'
              : 'calc(var(--sidebar-width) / 2 + 50%)'
          }, calc(100% - 16px - ${PALETTE_HALF_WIDTH}))`,
        }}
      >
        <div className='overflow-hidden rounded-lg border border-[var(--border-1)] bg-[var(--bg)]'>
          <Command
            label='Search'
            shouldFilter={false}
            loop
            value={askMode ? askSimLabel : undefined}
          >
            <div className='relative'>
              {/* 85dvh - 26px = viewport minus the 15% top offset, 10px of
                  dialog chrome, and a 16px bottom gutter. The cap keeps the
                  scroll box fully on-screen: cmdk aligns the selected row to
                  the box's bottom edge, so a box past the fold parks the
                  selection below the viewport and held arrow keys judder
                  rows against an edge the user cannot see. */}
              <CommandFadedList
                ref={listRef}
                className={cn(
                  'scrollbar-none max-h-[min(448px,calc(85dvh-26px))] [clip-path:inset(3px_round_13px)]',
                  CMDK_ITEM_GAP_CLASS,
                  CMDK_SECTION_GAP_CLASS
                )}
              >
                <Command.Empty className='flex items-center justify-center px-4 py-6 text-[var(--text-subtle)] text-sm'>
                  No results found.
                </Command.Empty>

                {askMode ? (
                  <MemoizedActionItem
                    value={askSimLabel}
                    onSelect={handleAskSim}
                    icon={Home}
                    name={askSimLabel}
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
                cycleResultsOnTab={!chatEnabled}
                autoFocus={!atomicBrowserOcclusion}
                aria-label={askMode ? 'Ask Sim' : 'Search anything'}
                value={search}
                onValueChange={handleSearchChange}
                onKeyDown={handleSearchKeyDown}
                placeholder={askMode ? 'Ask Sim anything...' : 'Search anything...'}
                endAdornment={
                  chatEnabled ? (
                    <span className='shrink-0 whitespace-nowrap text-[var(--text-subtle)] text-xs'>
                      {askMode ? '⇥ Search' : '⇥ Ask Sim'}
                    </span>
                  ) : undefined
                }
              />
            </div>
          </Command>
        </div>
      </div>
    </>,
    document.body
  )
}
