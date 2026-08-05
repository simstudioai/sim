'use client'

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
import { isChatEnabled } from '@/lib/core/config/env-flags'
import { captureEvent } from '@/lib/posthog/client'
import { hasTriggerCapability } from '@/lib/workflows/triggers/trigger-utils'
import { useInvokeGlobalCommand } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import {
  CommandFadedList,
  CommandSearch,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/components/command-chrome'
import { SearchEntryGroup } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/components/search-groups'
import type {
  ActionGroupLabel,
  ActionItem,
  FileItem,
  IntegrationSearchItem,
  PageItem,
  SearchEntry,
  SearchEntryHandlers,
  SearchModalProps,
  TaskItem,
  WorkflowItem,
  WorkspaceItem,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import {
  getActionGroupLabel,
  getGlobalSearchResults,
  MAX_RESULTS_PER_GROUP,
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
import { useSearchModalStore } from '@/stores/modals/search/store'
import type {
  SearchBlockItem,
  SearchDocItem,
  SearchSection,
  SearchToolOperationItem,
} from '@/stores/modals/search/types'
import { SEARCH_SECTIONS } from '@/stores/modals/search/types'

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
  const currentWorkflowId = params.workflowId as string | undefined
  const inputRef = useRef<HTMLInputElement>(null)
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

  const { blocks, tools, triggers, toolOperations, docs } = useSearchModalStore(
    (state) => state.data
  )

  const sections = useSearchModalStore((state) => state.sections)
  const displaySections = useMemo(
    () => SEARCH_SECTIONS.filter((section) => !sections || sections.includes(section)),
    [sections]
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
    list.push({
      id: 'run-workflow',
      name: 'Run workflow',
      keywords: 'execute start play test',
      icon: Play,
      shortcut: '⌘↵',
      context: 'workflow',
      run: () => invokeCommand('run-workflow'),
    })
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
      shortcut: '⇧⌘F',
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
            pendingConnect: useSearchModalStore.getState().pendingConnect,
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
          detail: {
            type: op.blockType,
            presetOperation: op.operationId,
            pendingConnect: useSearchModalStore.getState().pendingConnect,
          },
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

  const entriesBySection = useMemo((): Record<SearchSection, SearchEntry[]> => {
    const query = deferredSearch.trim()
    const visibleSections = new Set(displaySections)
    const rank = <T,>(
      section: SearchSection,
      items: T[],
      toValue: (item: T) => string,
      toExtra?: (item: T) => string | undefined
    ) => {
      if (!visibleSections.has(section)) return []
      return query
        ? scoreSectionItems(section, items, toValue, deferredSearch, toExtra, MAX_RESULTS_PER_GROUP)
        : items.map((item) => ({ item, score: 0 }))
    }
    const availableActions = actions.filter(
      (action) =>
        action.context === 'global' ||
        (action.context === 'workflow' && isOnWorkflowPage) ||
        (action.context === 'integrations' && isOnIntegrationsPage)
    )
    const rankActionGroup = (items: ActionItem[], groupLabel: ActionGroupLabel) =>
      query
        ? scoreActions(items, deferredSearch, MAX_RESULTS_PER_GROUP, groupLabel)
        : items.map((item) => ({ item, score: 0 }))
    const rankedActions = visibleSections.has('actions')
      ? [
          ...rankActionGroup(
            availableActions.filter((action) => getActionGroupLabel(action) === 'Workflow'),
            'Workflow'
          ),
          ...rankActionGroup(
            availableActions.filter((action) => getActionGroupLabel(action) === 'Platform'),
            'Platform'
          ),
        ]
      : []
    const availableBlocks = isOnWorkflowPage
      ? blocks.filter(
          (block) => !block.sourceWorkflowId || block.sourceWorkflowId !== currentWorkflowId
        )
      : []
    const availableTools = isOnWorkflowPage
      ? tools.filter(
          (tool) => !tool.sourceWorkflowId || tool.sourceWorkflowId !== currentWorkflowId
        )
      : []
    const rankedIntegrations = isOnIntegrationsPage
      ? rank('integrations', integrations, (item) => item.name)
      : []

    return {
      actions: rankedActions.map(({ item, score }) => ({ section: 'actions', item, score })),
      connectedAccounts: (isOnIntegrationsPage
        ? rank('connectedAccounts', connectedAccounts, (item) => item.name)
        : []
      ).map(({ item, score }) => ({ section: 'connectedAccounts', item, score })),
      integrations: rankedIntegrations.map(({ item, score }) => ({
        section: 'integrations',
        item,
        score,
      })),
      blocks: rank(
        'blocks',
        availableBlocks,
        (item) => item.name,
        (item) => item.searchValue
      ).map(({ item, score }) => ({ section: 'blocks', item, score })),
      tools: rank(
        'tools',
        availableTools,
        (item) => item.name,
        (item) => item.searchValue
      ).map(({ item, score }) => ({ section: 'tools', item, score })),
      triggers: rank(
        'triggers',
        isOnWorkflowPage ? triggers : [],
        (item) => item.name,
        (item) => `${item.name} ${item.id}`
      ).map(({ item, score }) => ({ section: 'triggers', item, score })),
      chats: rank('chats', chats, (item) => item.name).map(({ item, score }) => ({
        section: 'chats',
        item,
        score,
      })),
      workflows: rank(
        'workflows',
        workflows,
        (item) => item.name,
        (item) => item.folderPath?.join(' ')
      ).map(({ item, score }) => ({ section: 'workflows', item, score })),
      tables: rank('tables', tables, (item) => item.name).map(({ item, score }) => ({
        section: 'tables',
        item,
        score,
      })),
      files: rank(
        'files',
        files,
        (item) => item.name,
        (item) => item.folderPath?.join(' ')
      ).map(({ item, score }) => ({ section: 'files', item, score })),
      knowledgeBases: rank('knowledgeBases', knowledgeBases, (item) => item.name).map(
        ({ item, score }) => ({ section: 'knowledgeBases', item, score })
      ),
      toolOperations: rank(
        'toolOperations',
        isOnWorkflowPage ? toolOperations : [],
        (item) => item.name,
        (item) => item.searchValue
      ).map(({ item, score }) => ({ section: 'toolOperations', item, score })),
      workspaces: rank('workspaces', workspaces, (item) => item.name).map(({ item, score }) => ({
        section: 'workspaces',
        item,
        score,
      })),
      docs: rank(
        'docs',
        isOnWorkflowPage ? docs : [],
        (item) => item.name,
        (item) => `${item.name} docs documentation`
      ).map(({ item, score }) => ({ section: 'docs', item, score })),
      pages: rank('pages', pages, (item) => item.name).map(({ item, score }) => ({
        section: 'pages',
        item,
        score,
      })),
    }
  }, [
    deferredSearch,
    displaySections,
    actions,
    isOnWorkflowPage,
    isOnIntegrationsPage,
    blocks,
    currentWorkflowId,
    tools,
    integrations,
    connectedAccounts,
    triggers,
    chats,
    workflows,
    tables,
    files,
    knowledgeBases,
    toolOperations,
    workspaces,
    docs,
    pages,
  ])

  const isSearching = Boolean(deferredSearch.trim())
  const searchResults = useMemo(
    () => (isSearching ? getGlobalSearchResults(entriesBySection, displaySections) : []),
    [displaySections, entriesBySection, isSearching]
  )
  const sectionGroups = useMemo(
    () =>
      displaySections.flatMap((section) => {
        const entries = entriesBySection[section]
        if (section !== 'actions') {
          return [{ key: section, heading: SECTION_LABELS[section], entries }]
        }

        const platformEntries = entries.filter(
          (entry) => entry.section === 'actions' && getActionGroupLabel(entry.item) === 'Platform'
        )
        const workflowEntries = entries.filter(
          (entry) => entry.section === 'actions' && getActionGroupLabel(entry.item) === 'Workflow'
        )

        return [
          ...(isOnWorkflowPage
            ? [{ key: 'workflow-actions', heading: 'Workflow', entries: workflowEntries }]
            : []),
          { key: 'platform-actions', heading: 'Platform', entries: platformEntries },
        ]
      }),
    [displaySections, entriesBySection, isOnWorkflowPage]
  )

  const entryHandlers = useMemo(
    (): SearchEntryHandlers => ({
      onSelectAction: handleActionSelect,
      onSelectConnectedAccount: handleConnectedAccountSelect,
      onSelectIntegration: handleIntegrationSelect,
      onSelectBlock: handleBlockSelectAsBlock,
      onSelectTool: handleBlockSelectAsTool,
      onSelectTrigger: handleBlockSelectAsTrigger,
      onSelectChat: handleChatSelect,
      onSelectWorkflow: handleWorkflowSelect,
      onSelectTable: handleTableSelect,
      onSelectFile: handleFileSelect,
      onSelectKnowledgeBase: handleKbSelect,
      onSelectToolOperation: handleToolOperationSelect,
      onSelectWorkspace: handleWorkspaceSelect,
      onSelectDoc: handleDocSelect,
      onSelectPage: handlePageSelect,
    }),
    [
      handleActionSelect,
      handleConnectedAccountSelect,
      handleIntegrationSelect,
      handleBlockSelectAsBlock,
      handleBlockSelectAsTool,
      handleBlockSelectAsTrigger,
      handleChatSelect,
      handleWorkflowSelect,
      handleTableSelect,
      handleFileSelect,
      handleKbSelect,
      handleToolOperationSelect,
      handleWorkspaceSelect,
      handleDocSelect,
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
          <Command label='Search' shouldFilter={false} loop>
            <div className='relative'>
              <CommandFadedList
                fade='palette'
                className={cn(
                  'scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent max-h-[448px] [clip-path:inset(3px_round_13px)]',
                  CMDK_ITEM_GAP_CLASS,
                  CMDK_SECTION_GAP_CLASS
                )}
              >
                <Command.Empty className='flex items-center justify-center px-4 py-6 text-[var(--text-subtle)] text-sm'>
                  No results found.
                </Command.Empty>

                {isSearching ? (
                  <SearchEntryGroup
                    variant='results'
                    search={deferredSearch}
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
