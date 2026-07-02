'use client'

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { cn, Library } from '@sim/emcn'
import {
  Calendar,
  Database,
  Duplicate,
  File,
  FolderPlus,
  HelpCircle,
  Home,
  Integration,
  Key,
  Play,
  Plus,
  Search,
  Send,
  Settings,
  Table,
  Upload,
} from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { Command } from 'cmdk'
import { Scan, X } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { createPortal } from 'react-dom'
import { captureEvent } from '@/lib/posthog/client'
import { hasTriggerCapability } from '@/lib/workflows/triggers/trigger-utils'
import { useInvokeGlobalCommand } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import {
  CMDK_ITEM_GAP_CLASS,
  CMDK_SECTION_GAP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { SIDEBAR_SCROLL_EVENT } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { frecencyScore, useSearchRecentsStore } from '@/stores/modals/search/recents'
import { useSearchModalStore } from '@/stores/modals/search/store'
import type {
  SearchBlockItem,
  SearchCategory,
  SearchDocItem,
  SearchToolOperationItem,
} from '@/stores/modals/search/types'
import {
  ActionsGroup,
  BlocksGroup,
  BrowseGroup,
  ChatsGroup,
  ConnectedAccountsGroup,
  DocsGroup,
  FilesGroup,
  IntegrationsGroup,
  KnowledgeBasesGroup,
  PagesGroup,
  type RecentRenderItem,
  RecentsGroup,
  TablesGroup,
  ToolOpsGroup,
  ToolsGroup,
  TriggersGroup,
  WorkflowsGroup,
  WorkspacesGroup,
} from './components/search-groups'
import type {
  ActionItem,
  FileItem,
  IntegrationSearchItem,
  PageItem,
  SearchModalProps,
  TaskItem,
  WorkflowItem,
  WorkspaceItem,
} from './utils'
import { filterAndScore, filterAndSort } from './utils'

const logger = createLogger('SearchModal')

/**
 * Per-group cap on rendered search results. Results are score-sorted, so the
 * cap only trims the long, low-relevance tail of broad queries — keeping the
 * DOM bounded (the catalog has 1,000+ tool operations) without hiding good
 * matches in practice.
 */
const MAX_RESULTS_PER_GROUP = 50

/** Number of recent blocks surfaced in the empty state. */
const MAX_RECENTS = 5

/** Maps a block/tool/operation into the shared recent-row shape (sans handler). */
function toRecentRow(
  key: string,
  item: { name: string; icon: RecentRenderItem['icon']; bgColor: string }
): Omit<RecentRenderItem, 'onSelect'> {
  return { id: key, label: item.name, icon: item.icon, bgColor: item.bgColor }
}

/** Resolves one recent entry to a render row, or `null` when its block/tool/trigger/op no longer exists. */
function resolveRecentRow<
  T extends { name: string; icon: RecentRenderItem['icon']; bgColor: string },
>(key: string, item: T | undefined, onSelect: (item: T) => void): RecentRenderItem | null {
  if (!item) return null
  return { ...toRecentRow(key, item), onSelect: () => onSelect(item) }
}

/**
 * A capped, score-sorted group. `topScore` drives cross-group ordering;
 * `truncatedCount` is how many additional matches were cut by the cap — shown
 * as a "+N more, refine your search" row so truncation is never silent.
 */
interface CappedGroup<T> {
  items: T[]
  topScore: number
  truncatedCount: number
}

/**
 * Score-sorts a group and caps it to {@link MAX_RESULTS_PER_GROUP} so no single
 * group can flood the DOM — neither a broad query nor a large workspace (which
 * can hold thousands of workflows/files). Results are ranked, so the cap only
 * trims the long, low-relevance tail. Also surfaces the group's best score so
 * the caller can rank *groups* against each other (see `catalogGroups` below)
 * — without this, a highly-relevant Docs hit would always render below a
 * weakly relevant Blocks hit purely because of fixed group order.
 */
function filterAndCap<T>(items: T[], toValue: (item: T) => string, search: string): CappedGroup<T> {
  const scored = filterAndScore(items, toValue, search)
  const capped = scored.slice(0, MAX_RESULTS_PER_GROUP)
  return {
    items: capped.map((entry) => entry.item),
    topScore: capped[0]?.score ?? 0,
    truncatedCount: scored.length - capped.length,
  }
}

/**
 * {@link filterAndCap} for the catalog groups, which stay empty until the user
 * is actually searching (`enabled`). Single source of the gate-and-cap rule
 * shared by the blocks, tools, triggers, tool-operations, and docs groups.
 */
function cappedCatalog<T>(
  enabled: boolean,
  items: T[],
  toValue: (item: T) => string,
  search: string
): CappedGroup<T> {
  return enabled
    ? filterAndCap(items, toValue, search)
    : { items: [], topScore: 0, truncatedCount: 0 }
}

export type { SearchModalProps } from './utils'

export function SearchModal({
  open,
  onOpenChange,
  workflows = [],
  workspaces = [],
  chats = [],
  tables = [],
  files = [],
  knowledgeBases = [],
  integrations = [],
  connectedAccounts = [],
  isOnWorkflowPage = false,
  isOnIntegrationsPage = false,
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

  const { blocks, tools, triggers, toolOperations, docs, categories } = useSearchModalStore(
    (state) => state.data
  )

  const recentEntries = useSearchRecentsStore((state) => state.entries)
  const recordRecent = useSearchRecentsStore((state) => state.record)

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
          shortcut: '⌘⇧L',
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
    list.push({
      id: 'run-workflow',
      name: 'Run workflow',
      keywords: 'execute start play test',
      icon: Play,
      shortcut: '⌘↵',
      context: 'workflow',
      run: () => invokeCommand('run-workflow'),
    })
    list.push({
      id: 'new-chat',
      name: 'New chat',
      keywords: 'chat message ask sim assistant home',
      icon: Home,
      context: 'global',
      run: () => routerRef.current.push(`/workspace/${workspaceId}/home`),
    })
    if (canEdit && onCreateWorkflow) {
      list.push({
        id: 'create-workflow',
        name: 'Create workflow',
        keywords: 'new add build',
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
      id: 'fit-to-view',
      name: 'Fit workflow to view',
      keywords: 'zoom center recenter canvas reset',
      icon: Scan,
      shortcut: '⌘⇧F',
      context: 'workflow',
      run: () => invokeCommand('fit-to-view'),
    })
    list.push({
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
    })
    list.push({
      id: 'invite-teammates',
      name: 'Invite teammates',
      keywords: 'members people add user organization',
      icon: Send,
      context: 'global',
      run: () => navigateToSettings({ section: 'teammates' }),
    })
    return list
  }, [
    workspaceId,
    canEdit,
    onCreateWorkflow,
    onCreateFolder,
    onImportWorkflow,
    invokeCommand,
    navigateToSettings,
  ])

  const [search, setSearch] = useState('')
  /** Active browse drill-down. `null` is the root (home / global search). */
  const [scope, setScope] = useState<SearchCategory | null>(null)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setSearch('')
      setScope(null)
    }
  }

  /**
   * Clears and focuses the search input. The `Command.Input` is uncontrolled
   * (cmdk owns its value), so resetting requires the native value setter plus a
   * synthetic `input` event to drive cmdk's internal state back to empty —
   * `setSearch('')` alone would only update our mirror, leaving stale text on
   * screen.
   */
  const clearInput = useCallback(() => {
    setSearch('')
    const input = inputRef.current
    if (!input) return
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    input.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    clearInput()
  }, [open, clearInput])

  const deferredSearch = useDeferredValue(search)
  const deferredSearchRef = useRef(deferredSearch)
  deferredSearchRef.current = deferredSearch
  const isSearching = deferredSearch.trim().length > 0
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  const enterScope = useCallback(
    (category: SearchCategory) => {
      setScope(category)
      clearInput()
    },
    [clearInput]
  )

  const exitScope = useCallback(() => {
    setScope(null)
    clearInput()
  }, [clearInput])

  /**
   * Not `useCallback` — only ever passed to cmdk's `Command.Input`, which is a
   * plain `forwardRef` (not `React.memo`), and nothing else depends on either
   * function's identity, so memoizing them would add hook overhead for zero
   * benefit.
   */
  function handleSearchChange(value: string) {
    setSearch(value)
    requestAnimationFrame(() => {
      const list = listRef.current
      if (list) {
        list.scrollTop = 0
      }
    })
  }

  /** Backspace on an empty input steps back out of a browse drill-down. */
  function handleInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && scopeRef.current && e.currentTarget.value === '') {
      e.preventDefault()
      exitScope()
    }
  }

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (scopeRef.current) {
          exitScope()
        } else {
          onOpenChangeRef.current(false)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, exitScope])

  const handleBlockSelect = useCallback(
    (block: SearchBlockItem, type: 'block' | 'trigger' | 'tool') => {
      const enableTriggerMode =
        type === 'trigger' && block.config ? hasTriggerCapability(block.config) : false
      window.dispatchEvent(
        new CustomEvent('add-block-from-toolbar', {
          detail: {
            type: block.type,
            enableTriggerMode,
          },
        })
      )
      recordRecent(`${type}:${block.type}`)
      captureEvent(posthogRef.current, 'search_result_selected', {
        result_type: type,
        query_length: deferredSearchRef.current.length,
        workspace_id: workspaceId,
      })
      onOpenChangeRef.current(false)
    },
    [workspaceId, recordRecent]
  )

  const handleToolOperationSelect = useCallback(
    (op: SearchToolOperationItem) => {
      window.dispatchEvent(
        new CustomEvent('add-block-from-toolbar', {
          detail: { type: op.blockType, presetOperation: op.operationId },
        })
      )
      recordRecent(`op:${op.id}`)
      captureEvent(posthogRef.current, 'search_result_selected', {
        result_type: 'tool_operation',
        query_length: deferredSearchRef.current.length,
        workspace_id: workspaceId,
      })
      onOpenChangeRef.current(false)
    },
    [workspaceId, recordRecent]
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

  const handleDocSelect = useCallback(
    (doc: SearchDocItem) => {
      window.open(doc.href, '_blank', 'noopener,noreferrer')
      captureEvent(posthogRef.current, 'search_result_selected', {
        result_type: 'docs',
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

  const filteredActions = useMemo(() => {
    const available = actions.filter(
      (a) =>
        a.context === 'global' ||
        (a.context === 'workflow' && isOnWorkflowPage) ||
        (a.context === 'integrations' && isOnIntegrationsPage)
    )
    return filterAndSort(available, (a) => `${a.name} ${a.keywords ?? ''}`, deferredSearch)
  }, [actions, isOnWorkflowPage, isOnIntegrationsPage, deferredSearch])

  /**
   * Blocks, tools, triggers, tool operations, and docs are surfaced only once
   * the user types (mirroring the integrations group). The empty state browses
   * them via {@link RecentsGroup} and {@link BrowseGroup} instead of dumping the
   * full ~1,500-item catalog into the DOM. They are also suppressed while a
   * browse scope is active — the scoped list renders those items directly.
   *
   * Ranking matches against clean, human-meaningful text only (names, types,
   * aliases, folder paths) — never the structural `<type>-<id>`/uuid tokens used
   * for cmdk row identity. Those tokens carry letters (e.g. "block", "tool") that
   * would otherwise let short fuzzy queries scatter-match unrelated items.
   */
  const showCatalogResults = isOnWorkflowPage && isSearching && !scope

  const {
    items: filteredBlocks,
    topScore: blocksScore,
    truncatedCount: blocksTruncated,
  } = useMemo(
    () => cappedCatalog(showCatalogResults, blocks, (b) => b.searchValue ?? b.name, deferredSearch),
    [showCatalogResults, blocks, deferredSearch]
  )

  const {
    items: filteredTools,
    topScore: toolsScore,
    truncatedCount: toolsTruncated,
  } = useMemo(
    () => cappedCatalog(showCatalogResults, tools, (t) => t.searchValue ?? t.name, deferredSearch),
    [showCatalogResults, tools, deferredSearch]
  )

  const {
    items: filteredTriggers,
    topScore: triggersScore,
    truncatedCount: triggersTruncated,
  } = useMemo(
    () => cappedCatalog(showCatalogResults, triggers, (t) => `${t.name} ${t.id}`, deferredSearch),
    [showCatalogResults, triggers, deferredSearch]
  )

  const {
    items: filteredToolOps,
    topScore: toolOpsScore,
    truncatedCount: toolOpsTruncated,
  } = useMemo(
    () => cappedCatalog(showCatalogResults, toolOperations, (op) => op.searchValue, deferredSearch),
    [showCatalogResults, toolOperations, deferredSearch]
  )

  const {
    items: filteredDocs,
    topScore: docsScore,
    truncatedCount: docsTruncated,
  } = useMemo(
    () =>
      cappedCatalog(
        showCatalogResults,
        docs,
        (d) => `${d.name} docs documentation`,
        deferredSearch
      ),
    [showCatalogResults, docs, deferredSearch]
  )

  /**
   * The catalog partition a browse category drills into. Split from
   * {@link scopedItems} so switching keystrokes within a scope doesn't re-run
   * this partition — only `scope`/`blocks`/`triggers`/`tools` changing does.
   */
  const scopedCatalog = useMemo(() => {
    if (!scope) return []
    if (scope.id === 'blocks') return blocks
    if (scope.id === 'triggers') return triggers
    return tools.filter((t) => t.integrationType === scope.id)
  }, [scope, blocks, triggers, tools])

  /** Items shown while drilled into a browse category, filtered within scope. */
  const scopedItems = useMemo(
    () => filterAndSort(scopedCatalog, (b) => b.searchValue ?? b.name, deferredSearch),
    [scopedCatalog, deferredSearch]
  )

  const handleScopedSelect = useCallback(
    (item: SearchBlockItem) => handleBlockSelect(item, scopeRef.current?.kind ?? 'tool'),
    [handleBlockSelect]
  )

  /**
   * Resolves recorded selections (keyed `<kind>:<id>`) back into renderable rows,
   * ordered by frecency and dropping any whose block no longer exists. Recents
   * are an add-block affordance, so they only surface on the workflow page.
   */
  const recents = useMemo<RecentRenderItem[]>(() => {
    const recentKeys = Object.keys(recentEntries)
    if (!isOnWorkflowPage || recentKeys.length === 0) return []
    const blocksByType = new Map(blocks.map((b) => [b.type, b]))
    const toolsByType = new Map(tools.map((t) => [t.type, t]))
    const triggersByType = new Map(triggers.map((t) => [t.type, t]))
    const opsById = new Map(toolOperations.map((op) => [op.id, op]))

    const now = Date.now()
    const orderedKeys = recentKeys.sort(
      (a, b) => frecencyScore(recentEntries[b], now) - frecencyScore(recentEntries[a], now)
    )

    const resolved: RecentRenderItem[] = []
    for (const key of orderedKeys) {
      if (resolved.length >= MAX_RECENTS) break
      const separator = key.indexOf(':')
      const kind = key.slice(0, separator)
      const id = key.slice(separator + 1)

      const row =
        kind === 'block'
          ? resolveRecentRow(key, blocksByType.get(id), handleBlockSelectAsBlock)
          : kind === 'tool'
            ? resolveRecentRow(key, toolsByType.get(id), handleBlockSelectAsTool)
            : kind === 'trigger'
              ? resolveRecentRow(key, triggersByType.get(id), handleBlockSelectAsTrigger)
              : kind === 'op'
                ? resolveRecentRow(key, opsById.get(id), handleToolOperationSelect)
                : null
      if (row) resolved.push(row)
    }
    return resolved
  }, [
    isOnWorkflowPage,
    recentEntries,
    blocks,
    tools,
    triggers,
    toolOperations,
    handleBlockSelectAsBlock,
    handleBlockSelectAsTool,
    handleBlockSelectAsTrigger,
    handleToolOperationSelect,
  ])

  const {
    items: filteredTables,
    topScore: tablesScore,
    truncatedCount: tablesTruncated,
  } = useMemo(() => filterAndCap(tables, (t) => t.name, deferredSearch), [tables, deferredSearch])
  const {
    items: filteredFiles,
    topScore: filesScore,
    truncatedCount: filesTruncated,
  } = useMemo(
    () => filterAndCap(files, (f) => `${f.name} ${f.folderPath?.join(' ') ?? ''}`, deferredSearch),
    [files, deferredSearch]
  )
  const {
    items: filteredKnowledgeBases,
    topScore: kbsScore,
    truncatedCount: kbsTruncated,
  } = useMemo(
    () => filterAndCap(knowledgeBases, (kb) => kb.name, deferredSearch),
    [knowledgeBases, deferredSearch]
  )

  const {
    items: filteredWorkflows,
    topScore: workflowsScore,
    truncatedCount: workflowsTruncated,
  } = useMemo(
    () =>
      filterAndCap(workflows, (w) => `${w.name} ${w.folderPath?.join(' ') ?? ''}`, deferredSearch),
    [workflows, deferredSearch]
  )
  const {
    items: filteredChats,
    topScore: chatsScore,
    truncatedCount: chatsTruncated,
  } = useMemo(() => filterAndCap(chats, (t) => t.name, deferredSearch), [chats, deferredSearch])
  const {
    items: filteredWorkspaces,
    topScore: workspacesScore,
    truncatedCount: workspacesTruncated,
  } = useMemo(
    () => filterAndCap(workspaces, (w) => w.name, deferredSearch),
    [workspaces, deferredSearch]
  )
  const {
    items: filteredPages,
    topScore: pagesScore,
    truncatedCount: pagesTruncated,
  } = useMemo(() => filterAndCap(pages, (p) => p.name, deferredSearch), [pages, deferredSearch])

  /** Connected accounts: visible on the integrations page even with empty input. */
  const {
    items: filteredConnectedAccounts,
    topScore: connectedScore,
    truncatedCount: connectedTruncated,
  } = useMemo(() => {
    if (!isOnIntegrationsPage) return { items: [], topScore: 0, truncatedCount: 0 }
    return filterAndCap(connectedAccounts, (a) => a.name, deferredSearch)
  }, [isOnIntegrationsPage, connectedAccounts, deferredSearch])

  /** Catalog integrations: only shown once the user has typed something. */
  const {
    items: filteredIntegrations,
    topScore: integrationsScore,
    truncatedCount: integrationsTruncated,
  } = useMemo(() => {
    if (!isOnIntegrationsPage || !deferredSearch)
      return { items: [], topScore: 0, truncatedCount: 0 }
    return filterAndCap(integrations, (i) => i.name, deferredSearch)
  }, [isOnIntegrationsPage, deferredSearch, integrations])

  /**
   * The typed catalog groups, ranked by their best-matching item so the most
   * relevant hit surfaces first regardless of type — a highly-relevant Docs
   * result no longer sits below a weakly-relevant Blocks result purely
   * because of a fixed group order. `Array.prototype.sort` is stable, so
   * ties (all-zero scores when the input is empty) preserve this authored
   * order, matching the previous fixed sequence exactly when not searching.
   * Each element carries its own `key` so React reorders existing group
   * instances (and their memoized rows) instead of remounting them. Skipped
   * entirely while a browse scope is active — none of these render then (the
   * scoped list renders those items directly), so there's nothing to sort.
   */
  const catalogGroups: Array<{ score: number; node: ReactNode }> = scope
    ? []
    : [
        {
          score: connectedScore,
          node: (
            <ConnectedAccountsGroup
              key='connected'
              items={filteredConnectedAccounts}
              onSelect={handleConnectedAccountSelect}
              query={deferredSearch}
              truncatedCount={connectedTruncated}
            />
          ),
        },
        {
          score: integrationsScore,
          node: (
            <IntegrationsGroup
              key='integrations'
              items={filteredIntegrations}
              onSelect={handleIntegrationSelect}
              query={deferredSearch}
              truncatedCount={integrationsTruncated}
            />
          ),
        },
        {
          score: blocksScore,
          node: (
            <BlocksGroup
              key='blocks'
              items={filteredBlocks}
              onSelect={handleBlockSelectAsBlock}
              query={deferredSearch}
              truncatedCount={blocksTruncated}
            />
          ),
        },
        {
          score: toolsScore,
          node: (
            <ToolsGroup
              key='tools'
              items={filteredTools}
              onSelect={handleBlockSelectAsTool}
              query={deferredSearch}
              truncatedCount={toolsTruncated}
            />
          ),
        },
        {
          score: triggersScore,
          node: (
            <TriggersGroup
              key='triggers'
              items={filteredTriggers}
              onSelect={handleBlockSelectAsTrigger}
              query={deferredSearch}
              truncatedCount={triggersTruncated}
            />
          ),
        },
        {
          score: chatsScore,
          node: (
            <ChatsGroup
              key='chats'
              items={filteredChats}
              onSelect={handleChatSelect}
              query={deferredSearch}
              truncatedCount={chatsTruncated}
            />
          ),
        },
        {
          score: workflowsScore,
          node: (
            <WorkflowsGroup
              key='workflows'
              items={filteredWorkflows}
              onSelect={handleWorkflowSelect}
              query={deferredSearch}
              truncatedCount={workflowsTruncated}
            />
          ),
        },
        {
          score: tablesScore,
          node: (
            <TablesGroup
              key='tables'
              items={filteredTables}
              onSelect={handleTableSelect}
              query={deferredSearch}
              truncatedCount={tablesTruncated}
            />
          ),
        },
        {
          score: filesScore,
          node: (
            <FilesGroup
              key='files'
              items={filteredFiles}
              onSelect={handleFileSelect}
              query={deferredSearch}
              truncatedCount={filesTruncated}
            />
          ),
        },
        {
          score: kbsScore,
          node: (
            <KnowledgeBasesGroup
              key='kbs'
              items={filteredKnowledgeBases}
              onSelect={handleKbSelect}
              query={deferredSearch}
              truncatedCount={kbsTruncated}
            />
          ),
        },
        {
          score: toolOpsScore,
          node: (
            <ToolOpsGroup
              key='toolops'
              items={filteredToolOps}
              onSelect={handleToolOperationSelect}
              query={deferredSearch}
              truncatedCount={toolOpsTruncated}
            />
          ),
        },
        {
          score: workspacesScore,
          node: (
            <WorkspacesGroup
              key='workspaces'
              items={filteredWorkspaces}
              onSelect={handleWorkspaceSelect}
              query={deferredSearch}
              truncatedCount={workspacesTruncated}
            />
          ),
        },
        {
          score: docsScore,
          node: (
            <DocsGroup
              key='docs'
              items={filteredDocs}
              onSelect={handleDocSelect}
              query={deferredSearch}
              truncatedCount={docsTruncated}
            />
          ),
        },
        {
          score: pagesScore,
          node: (
            <PagesGroup
              key='pages'
              items={filteredPages}
              onSelect={handlePageSelect}
              query={deferredSearch}
              truncatedCount={pagesTruncated}
            />
          ),
        },
      ].sort((a, b) => b.score - a.score)

  if (!mounted) return null

  return createPortal(
    <>
      <div
        className={cn(
          'fixed inset-0 z-[var(--z-modal)] transition-opacity duration-150',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={() => onOpenChangeRef.current(false)}
        aria-hidden={!open}
      />

      {/*
       * Transitioning `visibility` alongside `opacity`/`transform` isn't a no-op: per spec
       * it flips to visible at the START of the transition but to hidden at the END, so
       * this animates both directions while still becoming inert once fully closed.
       */}
      <div
        role='dialog'
        aria-modal={open}
        aria-hidden={!open}
        aria-label='Search'
        className={cn(
          '-translate-x-1/2 fixed top-[15%] z-[var(--z-modal)] w-[500px] rounded-xl border border-[var(--border-muted)] bg-[var(--surface-4)] p-[3px] shadow-[var(--shadow-overlay)] transition-[visibility,opacity,transform] duration-150 ease-out dark:bg-[var(--surface-5)]',
          open ? 'visible scale-100 opacity-100' : 'invisible scale-95 opacity-0'
        )}
        style={{
          left: isOnWorkflowPage
            ? 'calc(50% + (var(--sidebar-width) - var(--panel-width)) / 2)'
            : 'calc(var(--sidebar-width) / 2 + 50%)',
        }}
      >
        <div className='overflow-hidden rounded-lg border border-[var(--border-1)] bg-[var(--bg)]'>
          <Command label='Search' shouldFilter={false}>
            <div className='mx-2 mt-2 flex h-[30px] items-center gap-1.5 rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 dark:bg-[var(--surface-4)]'>
              <Search className='size-[14px] flex-shrink-0 text-[var(--text-muted)]' />
              {scope && (
                <button
                  type='button'
                  onClick={exitScope}
                  className='flex h-[20px] flex-shrink-0 items-center gap-1 rounded-md bg-[var(--surface-active)] pr-1 pl-1.5 text-[var(--text-body)] text-caption transition-colors hover:bg-[var(--border-1)]'
                  aria-label={`Exit ${scope.label}`}
                >
                  {scope.label}
                  <X className='size-[12px] text-[var(--text-muted)]' />
                </button>
              )}
              <Command.Input
                ref={inputRef}
                autoFocus
                onValueChange={handleSearchChange}
                onKeyDown={handleInputKeyDown}
                placeholder={scope ? 'Search…' : 'Search anything...'}
                className='h-full w-full bg-transparent text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)] focus:outline-none'
              />
            </div>
            <Command.List
              ref={listRef}
              className={cn(
                'scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent max-h-[400px] overflow-y-auto overflow-x-hidden px-2 pt-3 pb-2 [&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:flex-col',
                CMDK_ITEM_GAP_CLASS,
                CMDK_SECTION_GAP_CLASS
              )}
            >
              <Command.Empty className='flex items-center justify-center px-4 py-6 text-[var(--text-subtle)] text-sm'>
                {scope
                  ? `No results in ${scope.label}. Backspace to search everywhere.`
                  : 'No results found.'}
              </Command.Empty>

              {scope ? (
                <>
                  {scope.kind === 'block' && (
                    <BlocksGroup
                      items={scopedItems}
                      onSelect={handleScopedSelect}
                      query={deferredSearch}
                      heading={scope.label}
                    />
                  )}
                  {scope.kind === 'trigger' && (
                    <TriggersGroup
                      items={scopedItems}
                      onSelect={handleScopedSelect}
                      query={deferredSearch}
                      heading={scope.label}
                    />
                  )}
                  {scope.kind === 'tool' && (
                    <ToolsGroup
                      items={scopedItems}
                      onSelect={handleScopedSelect}
                      query={deferredSearch}
                      heading={scope.label}
                    />
                  )}
                </>
              ) : (
                <>
                  <ActionsGroup
                    items={filteredActions}
                    onSelect={handleActionSelect}
                    query={deferredSearch}
                  />
                  {!isSearching && isOnWorkflowPage && <RecentsGroup items={recents} />}
                  {!isSearching && isOnWorkflowPage && (
                    <BrowseGroup items={categories} onSelect={enterScope} />
                  )}
                  {catalogGroups.map((group) => group.node)}
                </>
              )}
            </Command.List>
          </Command>
        </div>
      </div>
    </>,
    document.body
  )
}
