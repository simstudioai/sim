'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { BookOpen, Layout, RepeatIcon, ScrollText, Search, SplitIcon } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import { useBrandConfig } from '@/lib/branding/branding'
import { cn } from '@/lib/utils'
import { getTriggersForSidebar, hasTriggerCapability } from '@/lib/workflows/trigger-utils'
import { getAllBlocks } from '@/blocks'

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

interface BlockItem {
  id: string
  name: string
  description: string
  icon: React.ComponentType<any>
  bgColor: string
  type: string
  config?: any
}

interface ToolItem {
  id: string
  name: string
  description: string
  icon: React.ComponentType<any>
  bgColor: string
  type: string
}

interface PageItem {
  id: string
  name: string
  icon: React.ComponentType<any>
  href: string
  shortcut?: string
}

interface DocItem {
  id: string
  name: string
  icon: React.ComponentType<any>
  href: string
  type: 'main' | 'block' | 'tool'
}

type SearchItem = {
  id: string
  name: string
  description?: string
  icon?: React.ComponentType<any>
  bgColor?: string
  color?: string
  href?: string
  shortcut?: string
  type: 'block' | 'trigger' | 'tool' | 'workflow' | 'workspace' | 'page' | 'doc'
  isCurrent?: boolean
  blockType?: string
  config?: any
}

export function SearchModal({
  open,
  onOpenChange,
  workflows = [],
  workspaces = [],
  isOnWorkflowPage = false,
}: SearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const brand = useBrandConfig()

  // Get all available blocks - only when on workflow page
  const blocks = useMemo(() => {
    if (!isOnWorkflowPage) return []

    const allBlocks = getAllBlocks()
    const regularBlocks = allBlocks
      .filter(
        (block) => block.type !== 'starter' && !block.hideFromToolbar && block.category === 'blocks'
      )
      .map(
        (block): BlockItem => ({
          id: block.type,
          name: block.name,
          description: block.description || '',
          icon: block.icon,
          bgColor: block.bgColor || '#6B7280',
          type: block.type,
        })
      )

    // Add special blocks (loop and parallel)
    const specialBlocks: BlockItem[] = [
      {
        id: 'loop',
        name: 'Loop',
        description: 'Create a Loop',
        icon: RepeatIcon,
        bgColor: '#2FB3FF',
        type: 'loop',
      },
      {
        id: 'parallel',
        name: 'Parallel',
        description: 'Parallel Execution',
        icon: SplitIcon,
        bgColor: '#FEE12B',
        type: 'parallel',
      },
    ]

    return [...regularBlocks, ...specialBlocks]
  }, [isOnWorkflowPage])

  const triggers = useMemo(() => {
    if (!isOnWorkflowPage) return []

    const allTriggers = getTriggersForSidebar()
    const priorityOrder = ['Start', 'Schedule', 'Webhook']

    // Sort triggers with priority order matching toolbar
    const sortedTriggers = allTriggers.sort((a, b) => {
      const aIndex = priorityOrder.indexOf(a.name)
      const bIndex = priorityOrder.indexOf(b.name)
      const aHasPriority = aIndex !== -1
      const bHasPriority = bIndex !== -1

      if (aHasPriority && bHasPriority) return aIndex - bIndex
      if (aHasPriority) return -1
      if (bHasPriority) return 1
      return a.name.localeCompare(b.name)
    })

    return sortedTriggers.map(
      (block): BlockItem => ({
        id: block.type,
        name: block.name,
        description: block.description || '',
        icon: block.icon,
        bgColor: block.bgColor || '#6B7280',
        type: block.type,
        config: block,
      })
    )
  }, [isOnWorkflowPage])

  // Get all available tools - only when on workflow page
  const tools = useMemo(() => {
    if (!isOnWorkflowPage) return []

    const allBlocks = getAllBlocks()
    return allBlocks
      .filter((block) => block.category === 'tools')
      .map(
        (block): ToolItem => ({
          id: block.type,
          name: block.name,
          description: block.description || '',
          icon: block.icon,
          bgColor: block.bgColor || '#6B7280',
          type: block.type,
        })
      )
  }, [isOnWorkflowPage])

  // Define pages
  const pages = useMemo(
    (): PageItem[] => [
      {
        id: 'logs',
        name: 'Logs',
        icon: ScrollText,
        href: `/workspace/${workspaceId}/logs`,
        shortcut: '⌘⇧L',
      },
      {
        id: 'templates',
        name: 'Templates',
        icon: Layout,
        href: `/workspace/${workspaceId}/templates`,
      },
      {
        id: 'docs',
        name: 'Docs',
        icon: BookOpen,
        href: brand.documentationUrl || 'https://docs.sim.ai/',
      },
    ],
    [workspaceId, brand.documentationUrl]
  )

  // Define docs
  const docs = useMemo((): DocItem[] => {
    const allBlocks = getAllBlocks()
    const docsItems: DocItem[] = []

    allBlocks.forEach((block) => {
      if (block.docsLink) {
        docsItems.push({
          id: `docs-${block.type}`,
          name: block.name,
          icon: block.icon,
          href: block.docsLink,
          type: block.category === 'blocks' || block.category === 'triggers' ? 'block' : 'tool',
        })
      }
    })

    return docsItems
  }, [])

  // Combine all items into a single flattened list
  const allItems = useMemo((): SearchItem[] => {
    const items: SearchItem[] = []

    // Add workspaces
    workspaces.forEach((workspace) => {
      items.push({
        id: workspace.id,
        name: workspace.name,
        href: workspace.href,
        type: 'workspace',
        isCurrent: workspace.isCurrent,
      })
    })

    // Add workflows
    workflows.forEach((workflow) => {
      items.push({
        id: workflow.id,
        name: workflow.name,
        href: workflow.href,
        type: 'workflow',
        color: workflow.color,
        isCurrent: workflow.isCurrent,
      })
    })

    // Add pages
    pages.forEach((page) => {
      items.push({
        id: page.id,
        name: page.name,
        icon: page.icon,
        href: page.href,
        shortcut: page.shortcut,
        type: 'page',
      })
    })

    // Add blocks
    blocks.forEach((block) => {
      items.push({
        id: block.id,
        name: block.name,
        description: block.description,
        icon: block.icon,
        bgColor: block.bgColor,
        type: 'block',
        blockType: block.type,
      })
    })

    // Add triggers
    triggers.forEach((trigger) => {
      items.push({
        id: trigger.id,
        name: trigger.name,
        description: trigger.description,
        icon: trigger.icon,
        bgColor: trigger.bgColor,
        type: 'trigger',
        blockType: trigger.type,
        config: trigger.config,
      })
    })

    // Add tools
    tools.forEach((tool) => {
      items.push({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        icon: tool.icon,
        bgColor: tool.bgColor,
        type: 'tool',
        blockType: tool.type,
      })
    })

    // Add docs
    docs.forEach((doc) => {
      items.push({
        id: doc.id,
        name: doc.name,
        icon: doc.icon,
        href: doc.href,
        type: 'doc',
      })
    })

    return items
  }, [workspaces, workflows, pages, blocks, triggers, tools, docs])

  // Filter items based on search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return allItems

    const query = searchQuery.toLowerCase()
    return allItems.filter(
      (item) =>
        item.name.toLowerCase().includes(query) || item.description?.toLowerCase().includes(query)
    )
  }, [allItems, searchQuery])

  // Reset selected index when filtered items change
  useEffect(() => {
    setSelectedIndex(0)
  }, [filteredItems])

  // Clear search when modal closes
  useEffect(() => {
    if (!open) {
      setSearchQuery('')
      setSelectedIndex(0)
    }
  }, [open])

  // Handle item selection
  const handleItemClick = useCallback(
    (item: SearchItem) => {
      switch (item.type) {
        case 'block':
        case 'trigger':
        case 'tool':
          if (item.blockType) {
            const enableTriggerMode =
              item.type === 'trigger' && item.config ? hasTriggerCapability(item.config) : false
            const event = new CustomEvent('add-block-from-toolbar', {
              detail: {
                type: item.blockType,
                enableTriggerMode,
              },
            })
            window.dispatchEvent(event)
          }
          break
        case 'workspace':
        case 'workflow':
        case 'page':
        case 'doc':
          if (item.href) {
            if (item.href.startsWith('http')) {
              window.open(item.href, '_blank', 'noopener,noreferrer')
            } else {
              router.push(item.href)
            }
          }
          break
      }
      onOpenChange(false)
    },
    [router, onOpenChange]
  )

  // Handle keyboard navigation
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (filteredItems[selectedIndex]) {
            handleItemClick(filteredItems[selectedIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          onOpenChange(false)
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, selectedIndex, filteredItems, handleItemClick, onOpenChange])

  // Scroll selected item into view
  useEffect(() => {
    if (open && selectedIndex >= 0) {
      const element = document.querySelector(`[data-search-item-index="${selectedIndex}"]`)
      if (element) {
        element.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex, open])

  // Group items by type for sectioned display
  const groupedItems = useMemo(() => {
    const groups: Record<string, SearchItem[]> = {
      workspace: [],
      workflow: [],
      page: [],
      trigger: [],
      block: [],
      tool: [],
      doc: [],
    }

    filteredItems.forEach((item) => {
      if (groups[item.type]) {
        groups[item.type].push(item)
      }
    })

    return groups
  }, [filteredItems])

  // Section titles mapping
  const sectionTitles: Record<string, string> = {
    workspace: 'Workspaces',
    workflow: 'Workflows',
    page: 'Pages',
    trigger: 'Triggers',
    block: 'Blocks',
    tool: 'Tools',
    doc: 'Documentation',
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay
          className='bg-white/80 dark:bg-[#1b1b1b]/90'
          style={{ backdropFilter: 'blur(4px)' }}
        />
        <DialogPrimitive.Content className='fixed top-[15%] left-[50%] z-50 flex w-[500px] translate-x-[-50%] flex-col gap-[12px] p-0 focus:outline-none focus-visible:outline-none'>
          <VisuallyHidden.Root>
            <DialogTitle>Search</DialogTitle>
          </VisuallyHidden.Root>

          {/* Search input container */}
          <div className='flex items-center gap-[8px] rounded-[10px] border border-[var(--border)] bg-[var(--surface-5)] px-[12px] py-[8px] shadow-sm dark:border-[var(--border)] dark:bg-[var(--surface-5)]'>
            <Search className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-subtle)] dark:text-[var(--text-subtle)]' />
            <input
              type='text'
              placeholder='Search anything...'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className='w-full border-0 bg-transparent font-base text-[18px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none dark:text-[var(--text-primary)] dark:placeholder:text-[var(--text-secondary)]'
              autoFocus
            />
          </div>

          {/* Floating results container */}
          {filteredItems.length > 0 ? (
            <div className='scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent max-h-[400px] overflow-y-auto rounded-[10px] py-[10px] shadow-sm'>
              {Object.entries(groupedItems).map(([type, items]) => {
                if (items.length === 0) return null

                return (
                  <div key={type} className='mb-[10px] last:mb-0'>
                    {/* Section header */}
                    <div className='pt-[2px] pb-[4px] font-medium text-[13px] text-[var(--text-subtle)] uppercase tracking-wide dark:text-[var(--text-subtle)]'>
                      {sectionTitles[type]}
                    </div>

                    {/* Section items */}
                    <div className='space-y-[2px]'>
                      {items.map((item, itemIndex) => {
                        const Icon = item.icon
                        const globalIndex = filteredItems.indexOf(item)
                        const isSelected = globalIndex === selectedIndex
                        const showColoredIcon =
                          item.type === 'block' || item.type === 'trigger' || item.type === 'tool'
                        const isWorkflow = item.type === 'workflow'
                        const isWorkspace = item.type === 'workspace'

                        return (
                          <button
                            key={`${item.type}-${item.id}`}
                            data-search-item-index={globalIndex}
                            onClick={() => handleItemClick(item)}
                            className={cn(
                              'group flex h-[28px] w-full items-center gap-[8px] rounded-[6px] bg-[var(--surface-4)]/60 px-[10px] text-left text-[15px] transition-all focus:outline-none dark:bg-[var(--surface-4)]/60',
                              isSelected
                                ? 'bg-[var(--border)] shadow-sm dark:bg-[var(--border)]'
                                : 'hover:bg-[var(--border)] dark:hover:bg-[var(--border)]'
                            )}
                          >
                            {/* Icon - different rendering for workflows vs others */}
                            {!isWorkspace && (
                              <>
                                {isWorkflow ? (
                                  <div
                                    className='h-[14px] w-[14px] flex-shrink-0 rounded-[3px]'
                                    style={{ backgroundColor: item.color }}
                                  />
                                ) : (
                                  Icon && (
                                    <div
                                      className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
                                      style={{
                                        backgroundColor: showColoredIcon
                                          ? item.bgColor
                                          : 'transparent',
                                      }}
                                    >
                                      <Icon
                                        className={cn(
                                          'transition-transform duration-100 group-hover:scale-110',
                                          showColoredIcon
                                            ? '!h-[10px] !w-[10px] text-white'
                                            : 'h-[14px] w-[14px] text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)] dark:text-[var(--text-tertiary)] dark:group-hover:text-[var(--text-primary)]'
                                        )}
                                      />
                                    </div>
                                  )
                                )}
                              </>
                            )}

                            {/* Content */}
                            <span
                              className={cn(
                                'truncate font-medium',
                                isSelected
                                  ? 'text-[var(--text-primary)] dark:text-[var(--text-primary)]'
                                  : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)] dark:text-[var(--text-tertiary)] dark:group-hover:text-[var(--text-primary)]'
                              )}
                            >
                              {item.name}
                              {item.isCurrent && ' (current)'}
                            </span>

                            {/* Shortcut */}
                            {item.shortcut && (
                              <span className='ml-auto flex-shrink-0 font-medium text-[13px] text-[var(--text-subtle)] dark:text-[var(--text-subtle)]'>
                                {item.shortcut}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : searchQuery ? (
            <div className='flex items-center justify-center rounded-[10px] bg-[var(--surface-5)] px-[16px] py-[24px] shadow-sm dark:bg-[var(--surface-5)]'>
              <p className='text-[15px] text-[var(--text-subtle)] dark:text-[var(--text-subtle)]'>
                No results found for "{searchQuery}"
              </p>
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
