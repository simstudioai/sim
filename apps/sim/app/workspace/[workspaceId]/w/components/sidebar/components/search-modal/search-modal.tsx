'use client'

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Command } from 'cmdk'
import { useParams, useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { Blimp, Library } from '@/components/emcn'
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

function scoreMatch(value: string, search: string): number {
  if (!search) return 1
  const valueLower = value.toLowerCase()
  const searchLower = search.toLowerCase()

  if (valueLower === searchLower) return 1
  if (valueLower.startsWith(searchLower)) return 0.9
  if (valueLower.includes(searchLower)) return 0.7

  const words = searchLower.split(/\s+/).filter(Boolean)
  if (words.length > 1) {
    if (words.every((w) => valueLower.includes(w))) return 0.5
  }

  return 0
}

function filterAndSort<T>(items: T[], toValue: (item: T) => string, search: string): T[] {
  if (!search) return items
  const scored: [T, number][] = []
  for (const item of items) {
    const s = scoreMatch(toValue(item), search)
    if (s > 0) scored.push([item, s])
  }
  scored.sort((a, b) => b[1] - a[1])
  return scored.map(([item]) => item)
}

interface TaskItem {
  id: string
  name: string
  href: string
}

interface SearchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflows?: WorkflowItem[]
  workspaces?: WorkspaceItem[]
  tasks?: TaskItem[]
  isOnWorkflowPage?: boolean
}

interface WorkflowItem {
  id: string
  name: string
  href: string
  color: string
  isCurrent?: boolean
}

interface WorkspaceItem {
  id: string
  name: string
  href: string
  isCurrent?: boolean
}

interface PageItem {
  id: string
  name: string
  icon: React.ComponentType<{ className?: string }>
  href?: string
  onClick?: () => void
  shortcut?: string
  hidden?: boolean
}

export function SearchModal({
  open,
  onOpenChange,
  workflows = [],
  workspaces = [],
  tasks = [],
  isOnWorkflowPage = false,
}: SearchModalProps) {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const inputRef = useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = useState(false)
  const { navigateToSettings } = useSettingsNavigation()
  const { config: permissionConfig } = usePermissionConfig()

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
        onOpenChange(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange])

  const handleBlockSelect = useCallback(
    (block: SearchBlockItem, type: 'block' | 'trigger' | 'tool') => {
      const enableTriggerMode =
        type === 'trigger' && block.config ? hasTriggerCapability(block.config) : false
      window.dispatchEvent(
        new CustomEvent('add-block-from-toolbar', {
          detail: { type: block.type, enableTriggerMode },
        })
      )
      onOpenChange(false)
    },
    [onOpenChange]
  )

  const handleToolOperationSelect = useCallback(
    (op: SearchToolOperationItem) => {
      window.dispatchEvent(
        new CustomEvent('add-block-from-toolbar', {
          detail: { type: op.blockType, presetOperation: op.operationId },
        })
      )
      onOpenChange(false)
    },
    [onOpenChange]
  )

  const handleWorkflowSelect = useCallback(
    (workflow: WorkflowItem) => {
      if (!workflow.isCurrent && workflow.href) {
        router.push(workflow.href)
        window.dispatchEvent(
          new CustomEvent(SIDEBAR_SCROLL_EVENT, { detail: { itemId: workflow.id } })
        )
      }
      onOpenChange(false)
    },
    [router, onOpenChange]
  )

  const handleWorkspaceSelect = useCallback(
    (workspace: WorkspaceItem) => {
      if (!workspace.isCurrent && workspace.href) {
        router.push(workspace.href)
      }
      onOpenChange(false)
    },
    [router, onOpenChange]
  )

  const handlePageSelect = useCallback(
    (page: PageItem) => {
      if (page.onClick) {
        page.onClick()
      } else if (page.href) {
        if (page.href.startsWith('http')) {
          window.open(page.href, '_blank', 'noopener,noreferrer')
        } else {
          router.push(page.href)
        }
      }
      onOpenChange(false)
    },
    [router, onOpenChange]
  )

  const handleDocSelect = useCallback(
    (doc: SearchDocItem) => {
      window.open(doc.href, '_blank', 'noopener,noreferrer')
      onOpenChange(false)
    },
    [onOpenChange]
  )

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
      {/* Overlay */}
      <div
        className={cn(
          'fixed inset-0 z-40 transition-opacity duration-100',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={() => onOpenChange(false)}
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
        style={{ left: '50%' }}
      >
        <Command label='Search' shouldFilter={false}>
          <div className='mx-[8px] mt-[8px] mb-[4px] flex items-center gap-[6px] rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[8px] dark:bg-[var(--surface-4)]'>
            <Search className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-muted)]' />
            <Command.Input
              ref={inputRef}
              autoFocus
              onValueChange={handleSearchChange}
              placeholder='Search anything...'
              className='w-full bg-transparent py-[6px] font-base text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:outline-none'
            />
          </div>
          <Command.List className='scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent max-h-[400px] overflow-y-auto overflow-x-hidden p-[8px] [&_[cmdk-group]+[cmdk-group]]:mt-[10px]'>
            <Command.Empty className='flex items-center justify-center px-[16px] py-[24px] text-[14px] text-[var(--text-subtle)]'>
              No results found.
            </Command.Empty>

            {filteredBlocks.length > 0 && (
              <Command.Group heading='Blocks' className={groupHeadingClassName}>
                {filteredBlocks.map((block) => (
                  <MemoizedCommandItem
                    key={block.id}
                    value={`${block.name} block-${block.id}`}
                    onSelect={() => handleBlockSelect(block, 'block')}
                    icon={block.icon}
                    bgColor={block.bgColor}
                    showColoredIcon
                  >
                    {block.name}
                  </MemoizedCommandItem>
                ))}
              </Command.Group>
            )}

            {filteredTools.length > 0 && (
              <Command.Group heading='Tools' className={groupHeadingClassName}>
                {filteredTools.map((tool) => (
                  <MemoizedCommandItem
                    key={tool.id}
                    value={`${tool.name} tool-${tool.id}`}
                    onSelect={() => handleBlockSelect(tool, 'tool')}
                    icon={tool.icon}
                    bgColor={tool.bgColor}
                    showColoredIcon
                  >
                    {tool.name}
                  </MemoizedCommandItem>
                ))}
              </Command.Group>
            )}

            {filteredTriggers.length > 0 && (
              <Command.Group heading='Triggers' className={groupHeadingClassName}>
                {filteredTriggers.map((trigger) => (
                  <MemoizedCommandItem
                    key={trigger.id}
                    value={`${trigger.name} trigger-${trigger.id}`}
                    onSelect={() => handleBlockSelect(trigger, 'trigger')}
                    icon={trigger.icon}
                    bgColor={trigger.bgColor}
                    showColoredIcon
                  >
                    {trigger.name}
                  </MemoizedCommandItem>
                ))}
              </Command.Group>
            )}

            {filteredWorkflows.length > 0 && open && (
              <Command.Group heading='Workflows' className={groupHeadingClassName}>
                {filteredWorkflows.map((workflow) => (
                  <Command.Item
                    key={workflow.id}
                    value={`${workflow.name} workflow-${workflow.id}`}
                    onSelect={() => handleWorkflowSelect(workflow)}
                    className='group flex h-[30px] w-full cursor-pointer items-center gap-[8px] rounded-[8px] border border-transparent px-[8px] text-left text-[14px] aria-selected:border-[var(--border-1)] aria-selected:bg-[var(--surface-5)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 dark:aria-selected:bg-[var(--surface-4)]'
                  >
                    <div
                      className='h-[14px] w-[14px] flex-shrink-0 rounded-[4px] border-[2px]'
                      style={{
                        backgroundColor: workflow.color,
                        borderColor: `${workflow.color}60`,
                        backgroundClip: 'padding-box',
                      }}
                    />
                    <span className='truncate font-base text-[var(--text-body)]'>
                      {workflow.name}
                      {workflow.isCurrent && ' (current)'}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {filteredTasks.length > 0 && open && (
              <Command.Group heading='Tasks' className={groupHeadingClassName}>
                {filteredTasks.map((task) => (
                  <Command.Item
                    key={task.id}
                    value={`${task.name} task-${task.id}`}
                    onSelect={() => {
                      router.push(task.href)
                      onOpenChange(false)
                    }}
                    className='group flex h-[30px] w-full cursor-pointer items-center gap-[8px] rounded-[8px] border border-transparent px-[8px] text-left text-[14px] aria-selected:border-[var(--border-1)] aria-selected:bg-[var(--surface-5)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 dark:aria-selected:bg-[var(--surface-4)]'
                  >
                    <div className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
                      <Blimp className='h-[14px] w-[14px] text-[var(--text-icon)]' />
                    </div>
                    <span className='truncate font-base text-[var(--text-body)]'>{task.name}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {filteredToolOps.length > 0 && (
              <Command.Group heading='Tool Operations' className={groupHeadingClassName}>
                {filteredToolOps.map((op) => (
                  <MemoizedCommandItem
                    key={op.id}
                    value={`${op.searchValue} operation-${op.id}`}
                    onSelect={() => handleToolOperationSelect(op)}
                    icon={op.icon}
                    bgColor={op.bgColor}
                    showColoredIcon
                  >
                    {op.name}
                  </MemoizedCommandItem>
                ))}
              </Command.Group>
            )}

            {filteredWorkspaces.length > 0 && open && (
              <Command.Group heading='Workspaces' className={groupHeadingClassName}>
                {filteredWorkspaces.map((workspace) => (
                  <Command.Item
                    key={workspace.id}
                    value={`${workspace.name} workspace-${workspace.id}`}
                    onSelect={() => handleWorkspaceSelect(workspace)}
                    className='group flex h-[30px] w-full cursor-pointer items-center gap-[8px] rounded-[8px] border border-transparent px-[8px] text-left text-[14px] aria-selected:border-[var(--border-1)] aria-selected:bg-[var(--surface-5)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 dark:aria-selected:bg-[var(--surface-4)]'
                  >
                    <span className='truncate font-base text-[var(--text-body)]'>
                      {workspace.name}
                      {workspace.isCurrent && ' (current)'}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {filteredDocs.length > 0 && (
              <Command.Group heading='Docs' className={groupHeadingClassName}>
                {filteredDocs.map((doc) => (
                  <MemoizedCommandItem
                    key={doc.id}
                    value={`${doc.name} docs documentation doc-${doc.id}`}
                    onSelect={() => handleDocSelect(doc)}
                    icon={doc.icon}
                    bgColor='#6B7280'
                    showColoredIcon
                  >
                    {doc.name}
                  </MemoizedCommandItem>
                ))}
              </Command.Group>
            )}

            {filteredPages.length > 0 && open && (
              <Command.Group heading='Pages' className={groupHeadingClassName}>
                {filteredPages.map((page) => {
                  const Icon = page.icon
                  return (
                    <Command.Item
                      key={page.id}
                      value={`${page.name} page-${page.id}`}
                      onSelect={() => handlePageSelect(page)}
                      className='group flex h-[30px] w-full cursor-pointer items-center gap-[8px] rounded-[8px] border border-transparent px-[8px] text-left text-[14px] aria-selected:border-[var(--border-1)] aria-selected:bg-[var(--surface-5)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 dark:aria-selected:bg-[var(--surface-4)]'
                    >
                      <div className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
                        <Icon className='h-[14px] w-[14px] text-[var(--text-icon)]' />
                      </div>
                      <span className='truncate font-base text-[var(--text-body)]'>
                        {page.name}
                      </span>
                      {page.shortcut && (
                        <span className='ml-auto flex-shrink-0 font-base text-[13px] text-[var(--text-subtle)]'>
                          {page.shortcut}
                        </span>
                      )}
                    </Command.Item>
                  )
                })}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </>,
    document.body
  )
}

const groupHeadingClassName =
  '[&_[cmdk-group-heading]]:px-[8px] [&_[cmdk-group-heading]]:pt-[2px] [&_[cmdk-group-heading]]:pb-[6px] [&_[cmdk-group-heading]]:font-base [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:text-[var(--text-icon)]'

interface CommandItemProps {
  value: string
  onSelect: () => void
  icon: React.ComponentType<{ className?: string }>
  bgColor: string
  showColoredIcon?: boolean
  children: React.ReactNode
}

// onSelect is safe to exclude: cmdk stores it in a ref (useAsRef) internally,
// so the latest closure is always invoked regardless of whether React re-renders.
const MemoizedCommandItem = memo(
  function CommandItem({
    value,
    onSelect,
    icon: Icon,
    bgColor,
    showColoredIcon,
    children,
  }: CommandItemProps) {
    return (
      <Command.Item
        value={value}
        onSelect={onSelect}
        className='group flex h-[30px] w-full cursor-pointer items-center gap-[8px] rounded-[8px] border border-transparent px-[8px] text-left text-[14px] aria-selected:border-[var(--border-1)] aria-selected:bg-[var(--surface-5)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 dark:aria-selected:bg-[var(--surface-4)]'
      >
        <div
          className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
          style={{ background: showColoredIcon ? bgColor : 'transparent' }}
        >
          <Icon
            className={cn(
              'transition-transform duration-100 group-hover:scale-110',
              showColoredIcon
                ? '!h-[10px] !w-[10px] text-white'
                : 'h-[14px] w-[14px] text-[var(--text-icon)]'
            )}
          />
        </div>
        <span className='truncate font-base text-[var(--text-body)]'>{children}</span>
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.icon === next.icon &&
    prev.bgColor === next.bgColor &&
    prev.showColoredIcon === next.showColoredIcon &&
    prev.children === next.children
)
