'use client'

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
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
import { Scan } from 'lucide-react'
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
import { useSearchModalStore } from '@/stores/modals/search/store'
import type {
  SearchBlockItem,
  SearchDocItem,
  SearchToolOperationItem,
} from '@/stores/modals/search/types'
import {
  ActionsGroup,
  BlocksGroup,
  ChatsGroup,
  ConnectedAccountsGroup,
  DocsGroup,
  FilesGroup,
  IntegrationsGroup,
  KnowledgeBasesGroup,
  PagesGroup,
  TablesGroup,
  ToolOpsGroup,
  ToolsGroup,
  TriggersGroup,
  WorkflowsGroup,
  WorkspacesGroup,
} from './components/search-groups/search-groups'
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
import { filterAndSort } from './utils'

const logger = createLogger('SearchModal')

export type { SearchModalProps } from './utils'

/** No-op subscribe for the client-mounted flag; the value never changes after mount. */
const subscribeNoop = () => () => {}
const getMountedClientSnapshot = () => true
const getMountedServerSnapshot = () => false

const EMPTY_WORKFLOWS: WorkflowItem[] = []
const EMPTY_WORKSPACES: WorkspaceItem[] = []
const EMPTY_TASKS: TaskItem[] = []
const EMPTY_FILES: FileItem[] = []
const EMPTY_INTEGRATIONS: IntegrationSearchItem[] = []

export function SearchModal({
  open,
  onOpenChange,
  workflows = EMPTY_WORKFLOWS,
  workspaces = EMPTY_WORKSPACES,
  chats = EMPTY_TASKS,
  tables = EMPTY_TASKS,
  files = EMPTY_FILES,
  knowledgeBases = EMPTY_TASKS,
  integrations = EMPTY_INTEGRATIONS,
  connectedAccounts = EMPTY_INTEGRATIONS,
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
  const mounted = useSyncExternalStore(
    subscribeNoop,
    getMountedClientSnapshot,
    getMountedServerSnapshot
  )
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

  const { blocks, tools, triggers, toolOperations, docs } = useSearchModalStore(
    (state) => state.data
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
  const prevOpenRef = useRef(open)
  if (open !== prevOpenRef.current) {
    prevOpenRef.current = open
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
  }, [open])

  const deferredSearch = useDeferredValue(search)
  const deferredSearchRef = useRef(deferredSearch)
  deferredSearchRef.current = deferredSearch

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    requestAnimationFrame(() => {
      const list = document.querySelector('[cmdk-list]')
      if (list) {
        list.scrollTop = 0
      }
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
      captureEvent(posthogRef.current, 'search_result_selected', {
        result_type: type,
        query_length: deferredSearchRef.current.length,
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
        query_length: deferredSearchRef.current.length,
        workspace_id: workspaceId,
      })
      onOpenChangeRef.current(false)
    },
    [workspaceId]
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

  const handleOverlayClick = useCallback(() => {
    onOpenChangeRef.current(false)
  }, [])

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
   * Ranking matches against clean, human-meaningful text only (names, types,
   * aliases, folder paths) — never the structural `<type>-<id>`/uuid tokens used
   * for cmdk row identity. Those tokens carry letters (e.g. "block", "tool") that
   * would otherwise let short fuzzy queries scatter-match unrelated items.
   */
  const filteredBlocks = useMemo(() => {
    if (!isOnWorkflowPage) return []
    return filterAndSort(blocks, (b) => b.searchValue ?? b.name, deferredSearch)
  }, [isOnWorkflowPage, blocks, deferredSearch])

  const filteredTools = useMemo(() => {
    if (!isOnWorkflowPage) return []
    return filterAndSort(tools, (t) => t.searchValue ?? t.name, deferredSearch)
  }, [isOnWorkflowPage, tools, deferredSearch])

  const filteredTriggers = useMemo(() => {
    if (!isOnWorkflowPage) return []
    return filterAndSort(triggers, (t) => `${t.name} ${t.id}`, deferredSearch)
  }, [isOnWorkflowPage, triggers, deferredSearch])

  const filteredToolOps = useMemo(() => {
    if (!isOnWorkflowPage) return []
    return filterAndSort(toolOperations, (op) => op.searchValue, deferredSearch)
  }, [isOnWorkflowPage, toolOperations, deferredSearch])

  const filteredDocs = useMemo(() => {
    if (!isOnWorkflowPage) return []
    return filterAndSort(docs, (d) => `${d.name} docs documentation`, deferredSearch)
  }, [isOnWorkflowPage, docs, deferredSearch])

  const filteredTables = useMemo(
    () => filterAndSort(tables, (t) => t.name, deferredSearch),
    [tables, deferredSearch]
  )
  const filteredFiles = useMemo(
    () => filterAndSort(files, (f) => `${f.name} ${f.folderPath?.join(' ') ?? ''}`, deferredSearch),
    [files, deferredSearch]
  )
  const filteredKnowledgeBases = useMemo(
    () => filterAndSort(knowledgeBases, (kb) => kb.name, deferredSearch),
    [knowledgeBases, deferredSearch]
  )

  const filteredWorkflows = useMemo(
    () =>
      filterAndSort(workflows, (w) => `${w.name} ${w.folderPath?.join(' ') ?? ''}`, deferredSearch),
    [workflows, deferredSearch]
  )
  const filteredChats = useMemo(
    () => filterAndSort(chats, (t) => t.name, deferredSearch),
    [chats, deferredSearch]
  )
  const filteredWorkspaces = useMemo(
    () => filterAndSort(workspaces, (w) => w.name, deferredSearch),
    [workspaces, deferredSearch]
  )
  const filteredPages = useMemo(
    () => filterAndSort(pages, (p) => p.name, deferredSearch),
    [pages, deferredSearch]
  )

  /** Connected accounts: visible on the integrations page even with empty input. */
  const filteredConnectedAccounts = useMemo(() => {
    if (!isOnIntegrationsPage) return []
    return filterAndSort(connectedAccounts, (a) => a.name, deferredSearch)
  }, [isOnIntegrationsPage, connectedAccounts, deferredSearch])

  /** Catalog integrations: only shown once the user has typed something. */
  const filteredIntegrations = useMemo(() => {
    if (!isOnIntegrationsPage || !deferredSearch) return []
    return filterAndSort(integrations, (i) => i.name, deferredSearch)
  }, [isOnIntegrationsPage, deferredSearch, integrations])

  if (!mounted) return null

  return createPortal(
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 transition-opacity duration-100',
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
          '-translate-x-1/2 fixed top-[15%] z-50 w-[500px] rounded-xl border border-[var(--border-muted)] bg-[var(--surface-4)] p-[3px] shadow-[var(--shadow-overlay)] dark:bg-[var(--surface-5)]',
          open ? 'visible opacity-100' : 'invisible opacity-0'
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
              <Command.Input
                ref={inputRef}
                autoFocus
                onValueChange={handleSearchChange}
                placeholder='Search anything...'
                className='h-full w-full bg-transparent text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)] focus:outline-none'
              />
            </div>
            <Command.List
              className={cn(
                'scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent max-h-[400px] overflow-y-auto overflow-x-hidden px-2 pt-3 pb-2 [&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:flex-col',
                CMDK_ITEM_GAP_CLASS,
                CMDK_SECTION_GAP_CLASS
              )}
            >
              <Command.Empty className='flex items-center justify-center px-4 py-6 text-[var(--text-subtle)] text-sm'>
                No results found.
              </Command.Empty>

              <ActionsGroup
                items={filteredActions}
                onSelect={handleActionSelect}
                query={deferredSearch}
              />
              <ConnectedAccountsGroup
                items={filteredConnectedAccounts}
                onSelect={handleConnectedAccountSelect}
                query={deferredSearch}
              />
              <IntegrationsGroup
                items={filteredIntegrations}
                onSelect={handleIntegrationSelect}
                query={deferredSearch}
              />
              <BlocksGroup
                items={filteredBlocks}
                onSelect={handleBlockSelectAsBlock}
                query={deferredSearch}
              />
              <ToolsGroup
                items={filteredTools}
                onSelect={handleBlockSelectAsTool}
                query={deferredSearch}
              />
              <TriggersGroup
                items={filteredTriggers}
                onSelect={handleBlockSelectAsTrigger}
                query={deferredSearch}
              />
              <ChatsGroup
                items={filteredChats}
                onSelect={handleChatSelect}
                query={deferredSearch}
              />
              <WorkflowsGroup
                items={filteredWorkflows}
                onSelect={handleWorkflowSelect}
                query={deferredSearch}
              />
              <TablesGroup
                items={filteredTables}
                onSelect={handleTableSelect}
                query={deferredSearch}
              />
              <FilesGroup
                items={filteredFiles}
                onSelect={handleFileSelect}
                query={deferredSearch}
              />
              <KnowledgeBasesGroup
                items={filteredKnowledgeBases}
                onSelect={handleKbSelect}
                query={deferredSearch}
              />
              <ToolOpsGroup
                items={filteredToolOps}
                onSelect={handleToolOperationSelect}
                query={deferredSearch}
              />
              <WorkspacesGroup
                items={filteredWorkspaces}
                onSelect={handleWorkspaceSelect}
                query={deferredSearch}
              />
              <DocsGroup items={filteredDocs} onSelect={handleDocSelect} query={deferredSearch} />
              <PagesGroup
                items={filteredPages}
                onSelect={handlePageSelect}
                query={deferredSearch}
              />
            </Command.List>
          </Command>
        </div>
      </div>
    </>,
    document.body
  )
}
