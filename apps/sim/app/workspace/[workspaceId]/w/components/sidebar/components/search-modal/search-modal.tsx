'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Command } from 'cmdk'
import { Database, HelpCircle, Layout, Settings } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { Library } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { hasTriggerCapability } from '@/lib/workflows/triggers/trigger-utils'
import { SIDEBAR_SCROLL_EVENT } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSearchModalStore } from '@/stores/modals/search/store'
import type {
  SearchBlockItem,
  SearchDocItem,
  SearchToolOperationItem,
} from '@/stores/modals/search/types'
import { useSettingsModalStore } from '@/stores/modals/settings/store'

function customFilter(value: string, search: string): number {
  const searchLower = search.toLowerCase()
  const valueLower = value.toLowerCase()

  if (valueLower === searchLower) return 1
  if (valueLower.startsWith(searchLower)) return 0.9
  if (valueLower.includes(searchLower)) return 0.7

  const searchWords = searchLower.split(/\s+/).filter(Boolean)
  if (searchWords.length > 1) {
    const allWordsMatch = searchWords.every((word) => valueLower.includes(word))
    if (allWordsMatch) return 0.5
  }

  return 0
}

interface SearchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflows?: WorkflowItem[]
  workspaces?: WorkspaceItem[]
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
  isOnWorkflowPage = false,
}: SearchModalProps) {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const inputRef = useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = useState(false)
  const openSettingsModal = useSettingsModalStore((state) => state.openModal)
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
          id: 'logs',
          name: 'Logs',
          icon: Library,
          href: `/workspace/${workspaceId}/logs`,
          shortcut: '⌘⇧L',
        },
        {
          id: 'templates',
          name: 'Templates',
          icon: Layout,
          href: `/workspace/${workspaceId}/templates`,
          hidden: permissionConfig.hideTemplates,
        },
        {
          id: 'knowledge-base',
          name: 'Knowledge Base',
          icon: Database,
          href: `/workspace/${workspaceId}/knowledge`,
          hidden: permissionConfig.hideKnowledgeBaseTab,
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
          onClick: openSettingsModal,
        },
      ].filter((page) => !page.hidden),
    [
      workspaceId,
      openHelpModal,
      openSettingsModal,
      permissionConfig.hideTemplates,
      permissionConfig.hideKnowledgeBaseTab,
    ]
  )

  useEffect(() => {
    if (open && inputRef.current) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(inputRef.current, '')
        inputRef.current.dispatchEvent(new Event('input', { bubbles: true }))
      }
      inputRef.current.focus()
    }
  }, [open])

  const handleSearchChange = useCallback(() => {
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

  const showBlocks = isOnWorkflowPage && blocks.length > 0
  const showTools = isOnWorkflowPage && tools.length > 0
  const showTriggers = isOnWorkflowPage && triggers.length > 0
  const showToolOperations = isOnWorkflowPage && toolOperations.length > 0
  const showDocs = isOnWorkflowPage && docs.length > 0

  if (!mounted) return null

  return createPortal(
    <>
      {/* Overlay */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-[#E4E4E4]/50 backdrop-blur-[0.75px] transition-opacity duration-100 dark:bg-[#0D0D0D]/50',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={() => onOpenChange(false)}
        aria-hidden={!open}
      />

      {/* Command palette - always rendered for instant opening, hidden with CSS */}
      <div
        role='dialog'
        aria-modal={open}
        aria-hidden={!open}
        aria-label='Search'
        className={cn(
          '-translate-x-1/2 fixed top-[15%] left-1/2 z-50 w-[500px] overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface-4)] shadow-lg',
          open ? 'visible opacity-100' : 'invisible opacity-0'
        )}
      >
        <Command label='Search' filter={customFilter}>
          <Command.Input
            ref={inputRef}
            autoFocus
            onValueChange={handleSearchChange}
            placeholder='Search anything...'
            className='w-full border-0 border-[var(--border)] border-b bg-transparent px-[12px] py-[10px] font-base text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none'
          />
          <Command.List className='scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent max-h-[400px] overflow-y-auto p-[8px]'>
            <Command.Empty className='flex items-center justify-center px-[16px] py-[24px] text-[15px] text-[var(--text-subtle)]'>
              No results found.
            </Command.Empty>

            {showBlocks && (
              <Command.Group heading='Blocks' className={groupHeadingClassName}>
                {blocks.map((block) => (
                  <CommandItem
                    key={block.id}
                    value={`${block.name} block-${block.id}`}
                    onSelect={() => handleBlockSelect(block, 'block')}
                    icon={block.icon}
                    bgColor={block.bgColor}
                    showColoredIcon
                  >
                    {block.name}
                  </CommandItem>
                ))}
              </Command.Group>
            )}

            {showTools && (
              <Command.Group heading='Tools' className={groupHeadingClassName}>
                {tools.map((tool) => (
                  <CommandItem
                    key={tool.id}
                    value={`${tool.name} tool-${tool.id}`}
                    onSelect={() => handleBlockSelect(tool, 'tool')}
                    icon={tool.icon}
                    bgColor={tool.bgColor}
                    showColoredIcon
                  >
                    {tool.name}
                  </CommandItem>
                ))}
              </Command.Group>
            )}

            {showTriggers && (
              <Command.Group heading='Triggers' className={groupHeadingClassName}>
                {triggers.map((trigger) => (
                  <CommandItem
                    key={trigger.id}
                    value={`${trigger.name} trigger-${trigger.id}`}
                    onSelect={() => handleBlockSelect(trigger, 'trigger')}
                    icon={trigger.icon}
                    bgColor={trigger.bgColor}
                    showColoredIcon
                  >
                    {trigger.name}
                  </CommandItem>
                ))}
              </Command.Group>
            )}

            {workflows.length > 0 && (
              <Command.Group heading='Workflows' className={groupHeadingClassName}>
                {workflows.map((workflow) => (
                  <Command.Item
                    key={workflow.id}
                    value={`${workflow.name} workflow-${workflow.id}`}
                    onSelect={() => handleWorkflowSelect(workflow)}
                    className='group flex h-[28px] w-full cursor-pointer items-center gap-[8px] rounded-[6px] px-[10px] text-left text-[15px] aria-selected:bg-[var(--border)] aria-selected:shadow-sm data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50'
                  >
                    <div
                      className='h-[14px] w-[14px] flex-shrink-0 rounded-[3px]'
                      style={{ backgroundColor: workflow.color }}
                    />
                    <span className='truncate font-medium text-[var(--text-tertiary)] group-aria-selected:text-[var(--text-primary)]'>
                      {workflow.name}
                      {workflow.isCurrent && ' (current)'}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {showToolOperations && (
              <Command.Group heading='Tool Operations' className={groupHeadingClassName}>
                {toolOperations.map((op) => (
                  <CommandItem
                    key={op.id}
                    value={`${op.searchValue} operation-${op.id}`}
                    onSelect={() => handleToolOperationSelect(op)}
                    icon={op.icon}
                    bgColor={op.bgColor}
                    showColoredIcon
                  >
                    {op.name}
                  </CommandItem>
                ))}
              </Command.Group>
            )}

            {workspaces.length > 0 && (
              <Command.Group heading='Workspaces' className={groupHeadingClassName}>
                {workspaces.map((workspace) => (
                  <Command.Item
                    key={workspace.id}
                    value={`${workspace.name} workspace-${workspace.id}`}
                    onSelect={() => handleWorkspaceSelect(workspace)}
                    className='group flex h-[28px] w-full cursor-pointer items-center gap-[8px] rounded-[6px] px-[10px] text-left text-[15px] aria-selected:bg-[var(--border)] aria-selected:shadow-sm data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50'
                  >
                    <span className='truncate font-medium text-[var(--text-tertiary)] group-aria-selected:text-[var(--text-primary)]'>
                      {workspace.name}
                      {workspace.isCurrent && ' (current)'}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {showDocs && (
              <Command.Group heading='Docs' className={groupHeadingClassName}>
                {docs.map((doc) => (
                  <CommandItem
                    key={doc.id}
                    value={`${doc.name} docs documentation doc-${doc.id}`}
                    onSelect={() => handleDocSelect(doc)}
                    icon={doc.icon}
                    bgColor='#6B7280'
                    showColoredIcon
                  >
                    {doc.name}
                  </CommandItem>
                ))}
              </Command.Group>
            )}

            {pages.length > 0 && (
              <Command.Group heading='Pages' className={groupHeadingClassName}>
                {pages.map((page) => {
                  const Icon = page.icon
                  return (
                    <Command.Item
                      key={page.id}
                      value={`${page.name} page-${page.id}`}
                      onSelect={() => handlePageSelect(page)}
                      className='group flex h-[28px] w-full cursor-pointer items-center gap-[8px] rounded-[6px] px-[10px] text-left text-[15px] aria-selected:bg-[var(--border)] aria-selected:shadow-sm data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50'
                    >
                      <div className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
                        <Icon className='h-[14px] w-[14px] text-[var(--text-tertiary)] group-aria-selected:text-[var(--text-primary)]' />
                      </div>
                      <span className='truncate font-medium text-[var(--text-tertiary)] group-aria-selected:text-[var(--text-primary)]'>
                        {page.name}
                      </span>
                      {page.shortcut && (
                        <span className='ml-auto flex-shrink-0 font-medium text-[13px] text-[var(--text-subtle)]'>
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
  '[&_[cmdk-group-heading]]:pt-[2px] [&_[cmdk-group-heading]]:pb-[4px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[13px] [&_[cmdk-group-heading]]:text-[var(--text-subtle)] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide'

interface CommandItemProps {
  value: string
  onSelect: () => void
  icon: React.ComponentType<{ className?: string }>
  bgColor: string
  showColoredIcon?: boolean
  children: React.ReactNode
}

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
      className='group flex h-[28px] w-full cursor-pointer items-center gap-[8px] rounded-[6px] px-[10px] text-left text-[15px] aria-selected:bg-[var(--border)] aria-selected:shadow-sm data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50'
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
              : 'h-[14px] w-[14px] text-[var(--text-tertiary)] group-aria-selected:text-[var(--text-primary)]'
          )}
        />
      </div>
      <span className='truncate font-medium text-[var(--text-tertiary)] group-aria-selected:text-[var(--text-primary)]'>
        {children}
      </span>
    </Command.Item>
  )
}
