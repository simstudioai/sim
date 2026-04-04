'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Command } from 'cmdk'
import { useParams, useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { Library } from '@/components/emcn'
import { Calendar, Database, File, HelpCircle, Settings, Table } from '@/components/emcn/icons'
import { Search } from '@/components/emcn/icons/search'
import { cn } from '@/lib/core/utils/cn'
import { hasTriggerCapability } from '@/lib/workflows/triggers/trigger-utils'
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
  BlocksGroup,
  DocsGroup,
  FilesGroup,
  KnowledgeBasesGroup,
  PagesGroup,
  TablesGroup,
  TasksGroup,
  ToolOpsGroup,
  ToolsGroup,
  TriggersGroup,
  WorkflowsGroup,
  WorkspacesGroup,
} from './components/search-groups'
import type { PageItem, SearchModalProps, TaskItem, WorkflowItem, WorkspaceItem } from './utils'
import { filterAndSort } from './utils'

export type { SearchModalProps } from './utils'

export function SearchModal({
  open,
  onOpenChange,
  workflows = [],
  workspaces = [],
  tasks = [],
  tables = [],
  files = [],
  knowledgeBases = [],
  isOnWorkflowPage = false,
}: SearchModalProps) {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const inputRef = useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = useState(false)
  const { navigateToSettings } = useSettingsNavigation()
  const { config: permissionConfig } = usePermissionConfig()

  const routerRef = useRef(router)
  routerRef.current = router
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange

  useEffect(() => {
    setMounted(true)
  }, [])

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
          name: 'Knowledge Base',
          icon: Database,
          href: `/workspace/${workspaceId}/knowledge`,
          hidden: permissionConfig.hideKnowledgeBaseTab,
        },
        {
          id: 'scheduled-tasks',
          name: 'Scheduled Tasks',
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
    ]
  )

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
          detail: { type: block.type, enableTriggerMode },
        })
      )
      onOpenChangeRef.current(false)
    },
    []
  )

  const handleToolOperationSelect = useCallback((op: SearchToolOperationItem) => {
    window.dispatchEvent(
      new CustomEvent('add-block-from-toolbar', {
        detail: { type: op.blockType, presetOperation: op.operationId },
      })
    )
    onOpenChangeRef.current(false)
  }, [])

  const handleWorkflowSelect = useCallback((workflow: WorkflowItem) => {
    if (!workflow.isCurrent && workflow.href) {
      routerRef.current.push(workflow.href)
      window.dispatchEvent(
        new CustomEvent(SIDEBAR_SCROLL_EVENT, { detail: { itemId: workflow.id } })
      )
    }
    onOpenChangeRef.current(false)
  }, [])

  const handleWorkspaceSelect = useCallback((workspace: WorkspaceItem) => {
    if (!workspace.isCurrent && workspace.href) {
      routerRef.current.push(workspace.href)
    }
    onOpenChangeRef.current(false)
  }, [])

  const handleTaskSelect = useCallback((task: TaskItem) => {
    routerRef.current.push(task.href)
    onOpenChangeRef.current(false)
  }, [])

  const handlePageSelect = useCallback((page: PageItem) => {
    if (page.onClick) {
      page.onClick()
    } else if (page.href) {
      if (page.href.startsWith('http')) {
        window.open(page.href, '_blank', 'noopener,noreferrer')
      } else {
        routerRef.current.push(page.href)
      }
    }
    onOpenChangeRef.current(false)
  }, [])

  const handleDocSelect = useCallback((doc: SearchDocItem) => {
    window.open(doc.href, '_blank', 'noopener,noreferrer')
    onOpenChangeRef.current(false)
  }, [])

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

  const filteredBlocks = useMemo(() => {
    if (!isOnWorkflowPage) return []
    return filterAndSort(blocks, (b) => `${b.name} block-${b.id}`, deferredSearch)
  }, [isOnWorkflowPage, blocks, deferredSearch])

  const filteredTools = useMemo(() => {
    if (!isOnWorkflowPage) return []
    return filterAndSort(tools, (t) => `${t.name} tool-${t.id}`, deferredSearch)
  }, [isOnWorkflowPage, tools, deferredSearch])

  const filteredTriggers = useMemo(() => {
    if (!isOnWorkflowPage) return []
    return filterAndSort(triggers, (t) => `${t.name} trigger-${t.id}`, deferredSearch)
  }, [isOnWorkflowPage, triggers, deferredSearch])

  const filteredToolOps = useMemo(() => {
    if (!isOnWorkflowPage) return []
    return filterAndSort(
      toolOperations,
      (op) => `${op.searchValue} operation-${op.id}`,
      deferredSearch
    )
  }, [isOnWorkflowPage, toolOperations, deferredSearch])

  const filteredDocs = useMemo(() => {
    if (!isOnWorkflowPage) return []
    return filterAndSort(docs, (d) => `${d.name} docs documentation doc-${d.id}`, deferredSearch)
  }, [isOnWorkflowPage, docs, deferredSearch])

  const filteredTables = useMemo(
    () => filterAndSort(tables, (t) => `${t.name} table-${t.id}`, deferredSearch),
    [tables, deferredSearch]
  )
  const filteredFiles = useMemo(
    () => filterAndSort(files, (f) => `${f.name} file-${f.id}`, deferredSearch),
    [files, deferredSearch]
  )
  const filteredKnowledgeBases = useMemo(
    () =>
      filterAndSort(knowledgeBases, (kb) => `${kb.name} knowledge-base-${kb.id}`, deferredSearch),
    [knowledgeBases, deferredSearch]
  )

  const filteredWorkflows = useMemo(
    () => filterAndSort(workflows, (w) => `${w.name} workflow-${w.id}`, deferredSearch),
    [workflows, deferredSearch]
  )
  const filteredTasks = useMemo(
    () => filterAndSort(tasks, (t) => `${t.name} task-${t.id}`, deferredSearch),
    [tasks, deferredSearch]
  )
  const filteredWorkspaces = useMemo(
    () => filterAndSort(workspaces, (w) => `${w.name} workspace-${w.id}`, deferredSearch),
    [workspaces, deferredSearch]
  )
  const filteredPages = useMemo(
    () => filterAndSort(pages, (p) => `${p.name} page-${p.id}`, deferredSearch),
    [pages, deferredSearch]
  )

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
          '-translate-x-1/2 fixed top-[15%] z-50 w-[500px] rounded-xl border-[4px] border-black/[0.06] bg-[var(--bg)] shadow-[0_24px_80px_-16px_rgba(0,0,0,0.15)] dark:border-white/[0.06] dark:shadow-[0_24px_80px_-16px_rgba(0,0,0,0.4)]',
          open ? 'visible opacity-100' : 'invisible opacity-0'
        )}
        style={{
          left: isOnWorkflowPage
            ? 'calc(50% + (var(--sidebar-width) - var(--panel-width)) / 2)'
            : 'calc(var(--sidebar-width) / 2 + 50%)',
        }}
      >
        <Command label='Search' shouldFilter={false}>
          <div className='mx-2 mt-2 mb-1 flex items-center gap-1.5 rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 dark:bg-[var(--surface-4)]'>
            <Search className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-muted)]' />
            <Command.Input
              ref={inputRef}
              autoFocus
              onValueChange={handleSearchChange}
              placeholder='Search anything...'
              className='w-full bg-transparent py-1.5 font-base text-[var(--text-primary)] text-sm outline-none placeholder:text-[var(--text-muted)] focus:outline-none'
            />
          </div>
          <Command.List className='scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent max-h-[400px] overflow-y-auto overflow-x-hidden p-2 [&_[cmdk-group]+[cmdk-group]]:mt-2.5'>
            <Command.Empty className='flex items-center justify-center px-4 py-6 text-[var(--text-subtle)] text-sm'>
              No results found.
            </Command.Empty>

            <BlocksGroup items={filteredBlocks} onSelect={handleBlockSelectAsBlock} />
            <ToolsGroup items={filteredTools} onSelect={handleBlockSelectAsTool} />
            <TriggersGroup items={filteredTriggers} onSelect={handleBlockSelectAsTrigger} />
            <WorkflowsGroup items={filteredWorkflows} onSelect={handleWorkflowSelect} />
            <TasksGroup items={filteredTasks} onSelect={handleTaskSelect} />
            <TablesGroup items={filteredTables} onSelect={handleTaskSelect} />
            <FilesGroup items={filteredFiles} onSelect={handleTaskSelect} />
            <KnowledgeBasesGroup items={filteredKnowledgeBases} onSelect={handleTaskSelect} />
            <ToolOpsGroup items={filteredToolOps} onSelect={handleToolOperationSelect} />
            <WorkspacesGroup items={filteredWorkspaces} onSelect={handleWorkspaceSelect} />
            <DocsGroup items={filteredDocs} onSelect={handleDocSelect} />
            <PagesGroup items={filteredPages} onSelect={handlePageSelect} />
          </Command.List>
        </Command>
      </div>
    </>,
    document.body
  )
}
