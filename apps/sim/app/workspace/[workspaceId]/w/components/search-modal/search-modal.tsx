'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { BookOpen, Building2, LibraryBig, ScrollText, Search, Shapes, Workflow } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  TemplateCard,
  TemplateCardSkeleton,
} from '@/app/workspace/[workspaceId]/templates/components/template-card'
import { getKeyboardShortcutText } from '@/app/workspace/[workspaceId]/w/hooks/use-keyboard-shortcuts'
import { getAllBlocks } from '@/blocks'
import { useSearchNavigation } from './hooks/use-search-navigation'

export interface SearchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  templates?: TemplateData[]
  workflows?: WorkflowItem[]
  workspaces?: WorkspaceItem[]
  loading?: boolean
  isOnWorkflowPage?: boolean
}

export interface TemplateData {
  id: string
  title: string
  description: string
  author: string
  usageCount: string
  stars: number
  icon: string
  iconColor: string
  state?: {
    blocks?: Record<string, { type: string; name?: string }>
  }
  isStarred?: boolean
}

export interface WorkflowItem {
  id: string
  name: string
  href: string
  isCurrent?: boolean
}

export interface WorkspaceItem {
  id: string
  name: string
  href: string
  isCurrent?: boolean
}

export interface BlockItem {
  id: string
  name: string
  icon: React.ComponentType<any>
  bgColor: string
  type: string
}

export interface ToolItem {
  id: string
  name: string
  icon: React.ComponentType<any>
  bgColor: string
  type: string
}

export interface PageItem {
  id: string
  name: string
  icon: React.ComponentType<any>
  href: string
  shortcut?: string
}

export interface DocItem {
  id: string
  name: string
  icon: React.ComponentType<any>
  href: string
  type: 'main' | 'block' | 'tool'
}

export interface NavigationPosition {
  sectionIndex: number
  itemIndex: number
}

export interface NavigationSection {
  id: string
  name: string
  type: 'grid' | 'list'
  items: any[]
  gridCols?: number // How many columns per row for grid sections
}

export function SearchModal({
  open,
  onOpenChange,
  templates = [],
  workflows = [],
  workspaces = [],
  loading = false,
  isOnWorkflowPage = false,
}: SearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const [localTemplates, setLocalTemplates] = useState<TemplateData[]>(templates)

  useEffect(() => {
    setLocalTemplates(templates)
  }, [templates])

  const blocks = useMemo(() => {
    if (!isOnWorkflowPage) return []

    const allBlocks = getAllBlocks()
    return allBlocks
      .filter(
        (block) =>
          block.type !== 'starter' &&
          !block.hideFromToolbar &&
          (block.category === 'blocks' || block.category === 'triggers')
      )
      .map(
        (block): BlockItem => ({
          id: block.type,
          name: block.name,
          icon: block.icon,
          bgColor: block.bgColor || '#6B7280',
          type: block.type,
        })
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [isOnWorkflowPage])

  const tools = useMemo(() => {
    if (!isOnWorkflowPage) return []

    const allBlocks = getAllBlocks()
    return allBlocks
      .filter((block) => block.category === 'tools')
      .map(
        (block): ToolItem => ({
          id: block.type,
          name: block.name,
          icon: block.icon,
          bgColor: block.bgColor || '#6B7280',
          type: block.type,
        })
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [isOnWorkflowPage])

  const pages = useMemo(
    (): PageItem[] => [
      {
        id: 'logs',
        name: 'Logs',
        icon: ScrollText,
        href: `/workspace/${workspaceId}/logs`,
        shortcut: getKeyboardShortcutText('L', true, true),
      },
      {
        id: 'knowledge',
        name: 'Knowledge',
        icon: LibraryBig,
        href: `/workspace/${workspaceId}/knowledge`,
        shortcut: getKeyboardShortcutText('K', true, true),
      },
      {
        id: 'templates',
        name: 'Templates',
        icon: Shapes,
        href: `/workspace/${workspaceId}/templates`,
      },
      {
        id: 'docs',
        name: 'Docs',
        icon: BookOpen,
        href: 'https://docs.sim.ai/',
      },
    ],
    [workspaceId]
  )

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

    return docsItems.sort((a, b) => a.name.localeCompare(b.name))
  }, [])

  const filteredBlocks = useMemo(() => {
    if (!searchQuery.trim()) return blocks
    const query = searchQuery.toLowerCase()
    return blocks.filter((block) => block.name.toLowerCase().includes(query))
  }, [blocks, searchQuery])

  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return tools
    const query = searchQuery.toLowerCase()
    return tools.filter((tool) => tool.name.toLowerCase().includes(query))
  }, [tools, searchQuery])

  const filteredTemplates = useMemo(() => {
    if (!searchQuery.trim()) return localTemplates.slice(0, 8)
    const query = searchQuery.toLowerCase()
    return localTemplates
      .filter(
        (template) =>
          template.title.toLowerCase().includes(query) ||
          template.description.toLowerCase().includes(query)
      )
      .slice(0, 8)
  }, [localTemplates, searchQuery])

  const filteredWorkflows = useMemo(() => {
    if (!searchQuery.trim()) return workflows
    const query = searchQuery.toLowerCase()
    return workflows.filter((workflow) => workflow.name.toLowerCase().includes(query))
  }, [workflows, searchQuery])

  const filteredWorkspaces = useMemo(() => {
    if (!searchQuery.trim()) return workspaces
    const query = searchQuery.toLowerCase()
    return workspaces.filter((workspace) => workspace.name.toLowerCase().includes(query))
  }, [workspaces, searchQuery])

  const filteredPages = useMemo(() => {
    if (!searchQuery.trim()) return pages
    const query = searchQuery.toLowerCase()
    return pages.filter((page) => page.name.toLowerCase().includes(query))
  }, [pages, searchQuery])

  const filteredDocs = useMemo(() => {
    if (!searchQuery.trim()) return docs
    const query = searchQuery.toLowerCase()
    return docs.filter((doc) => doc.name.toLowerCase().includes(query))
  }, [docs, searchQuery])

  const navigationSections = useMemo((): NavigationSection[] => {
    const sections: NavigationSection[] = []

    if (filteredBlocks.length > 0) {
      sections.push({
        id: 'blocks',
        name: 'Blocks',
        type: 'grid',
        items: filteredBlocks,
        gridCols: 4, // 4 items per row
      })
    }

    if (filteredTools.length > 0) {
      sections.push({
        id: 'tools',
        name: 'Tools',
        type: 'grid',
        items: filteredTools,
        gridCols: 4, // 4 items per row
      })
    }

    if (filteredTemplates.length > 0) {
      sections.push({
        id: 'templates',
        name: 'Templates',
        type: 'grid',
        items: filteredTemplates,
        gridCols: 2, // 2 templates per row
      })
    }

    const listItems = [
      ...filteredWorkspaces.map((item) => ({ type: 'workspace', data: item })),
      ...filteredWorkflows.map((item) => ({ type: 'workflow', data: item })),
      ...filteredPages.map((item) => ({ type: 'page', data: item })),
      ...filteredDocs.map((item) => ({ type: 'doc', data: item })),
    ]

    if (listItems.length > 0) {
      sections.push({
        id: 'list',
        name: 'Navigation',
        type: 'list',
        items: listItems,
      })
    }

    return sections
  }, [
    filteredBlocks,
    filteredTools,
    filteredTemplates,
    filteredWorkspaces,
    filteredWorkflows,
    filteredPages,
    filteredDocs,
  ])

  const { navigate, getCurrentItem, scrollRefs } = useSearchNavigation(navigationSections, open)

  useEffect(() => {
    if (!open) {
      setSearchQuery('')
    }
  }, [open])

  const handleBlockClick = useCallback(
    (blockType: string) => {
      const event = new CustomEvent('add-block-from-toolbar', {
        detail: { type: blockType },
      })
      window.dispatchEvent(event)
      onOpenChange(false)
    },
    [onOpenChange]
  )

  const handlePageClick = useCallback(
    (href: string) => {
      if (href.startsWith('http')) {
        window.open(href, '_blank', 'noopener,noreferrer')
      } else {
        router.push(href)
      }
      onOpenChange(false)
    },
    [router, onOpenChange]
  )

  const handleNavigationClick = useCallback(
    (href: string) => {
      router.push(href)
      onOpenChange(false)
    },
    [router, onOpenChange]
  )

  const handleDocsClick = useCallback(
    (href: string) => {
      if (href.startsWith('http')) {
        window.open(href, '_blank', 'noopener,noreferrer')
      } else {
        router.push(href)
      }
      onOpenChange(false)
    },
    [router, onOpenChange]
  )

  const handleItemSelection = useCallback(() => {
    const current = getCurrentItem()
    if (!current) return

    const { section, item } = current

    if (section.id === 'blocks' || section.id === 'tools') {
      handleBlockClick(item.type)
    } else if (section.id === 'templates') {
      onOpenChange(false)
    } else if (section.id === 'list') {
      switch (item.type) {
        case 'workspace':
          if (item.data.isCurrent) {
            onOpenChange(false)
          } else {
            handleNavigationClick(item.data.href)
          }
          break
        case 'workflow':
          if (item.data.isCurrent) {
            onOpenChange(false)
          } else {
            handleNavigationClick(item.data.href)
          }
          break
        case 'page':
          handlePageClick(item.data.href)
          break
        case 'doc':
          handleDocsClick(item.data.href)
          break
      }
    }
  }, [
    getCurrentItem,
    handleBlockClick,
    handleNavigationClick,
    handlePageClick,
    handleDocsClick,
    onOpenChange,
  ])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          navigate('down')
          break
        case 'ArrowUp':
          e.preventDefault()
          navigate('up')
          break
        case 'ArrowRight':
          e.preventDefault()
          navigate('right')
          break
        case 'ArrowLeft':
          e.preventDefault()
          navigate('left')
          break
        case 'Enter':
          e.preventDefault()
          handleItemSelection()
          break
        case 'Escape':
          onOpenChange(false)
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, navigate, handleItemSelection, onOpenChange])

  const handleStarChange = useCallback(
    (templateId: string, isStarred: boolean, newStarCount: number) => {
      setLocalTemplates((prevTemplates) =>
        prevTemplates.map((template) =>
          template.id === templateId ? { ...template, isStarred, stars: newStarCount } : template
        )
      )
    },
    []
  )

  const isItemSelected = useCallback(
    (sectionId: string, itemIndex: number) => {
      const current = getCurrentItem()
      return current?.section.id === sectionId && current.position.itemIndex === itemIndex
    },
    [getCurrentItem]
  )

  const renderSkeletonCards = () => {
    return Array.from({ length: 8 }).map((_, index) => (
      <div key={`skeleton-${index}`} className='w-80 flex-shrink-0'>
        <TemplateCardSkeleton />
      </div>
    ))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay
          className='bg-white/50 dark:bg-black/50'
          style={{ backdropFilter: 'blur(4.8px)' }}
        />
        <DialogPrimitive.Content className='data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] fixed top-[50%] left-[50%] z-50 flex h-[580px] w-[700px] translate-x-[-50%] translate-y-[-50%] flex-col gap-0 overflow-hidden rounded-xl border border-border bg-background p-0 shadow-lg duration-200 focus:outline-none focus-visible:outline-none data-[state=closed]:animate-out data-[state=open]:animate-in'>
          <VisuallyHidden.Root>
            <DialogTitle>Search</DialogTitle>
          </VisuallyHidden.Root>

          {/* Header with search input */}
          <div className='flex items-center border-b px-6 py-2'>
            <Search className='h-5 w-5 font-sans text-muted-foreground text-xl' />
            <Input
              placeholder='Search anything'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className='!font-[300] !text-lg placeholder:!text-lg border-0 bg-transparent font-sans text-muted-foreground leading-10 tracking-normal placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
              autoFocus
            />
          </div>

          {/* Content */}
          <div
            className='scrollbar-none flex-1 overflow-y-auto'
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            <div className='space-y-6 pt-6 pb-6'>
              {/* Blocks Section */}
              {filteredBlocks.length > 0 && (
                <div>
                  <h3 className='mb-3 ml-6 font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                    Blocks
                  </h3>
                  <div
                    ref={(el) => {
                      if (el) scrollRefs.current.set('blocks', el)
                    }}
                    className='scrollbar-none overflow-x-auto pr-6 pb-1 pl-6'
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  >
                    <div
                      className='grid auto-cols-max grid-flow-col gap-2'
                      style={{ gridTemplateRows: 'repeat(2, minmax(0, 1fr))' }}
                    >
                      {filteredBlocks.map((block, index) => (
                        <button
                          key={block.id}
                          onClick={() => handleBlockClick(block.type)}
                          data-nav-item={`blocks-${index}`}
                          className={`flex h-9 w-[153.5px] flex-shrink-0 items-center gap-3 whitespace-nowrap rounded-xl p-2 transition-all duration-200 ${
                            isItemSelected('blocks', index)
                              ? 'bg-accent'
                              : 'bg-secondary hover:bg-secondary/80'
                          }`}
                        >
                          <div
                            className='flex h-5 w-5 items-center justify-center rounded-md'
                            style={{ backgroundColor: block.bgColor }}
                          >
                            <block.icon className='h-4 w-4 text-white' />
                          </div>
                          <span className='font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                            {block.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Tools Section */}
              {filteredTools.length > 0 && (
                <div>
                  <h3 className='mb-3 ml-6 font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                    Tools
                  </h3>
                  <div
                    ref={(el) => {
                      if (el) scrollRefs.current.set('tools', el)
                    }}
                    className='scrollbar-none overflow-x-auto pr-6 pb-1 pl-6'
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  >
                    <div
                      className='grid auto-cols-max grid-flow-col gap-2'
                      style={{ gridTemplateRows: 'repeat(2, minmax(0, 1fr))' }}
                    >
                      {filteredTools.map((tool, index) => (
                        <button
                          key={tool.id}
                          onClick={() => handleBlockClick(tool.type)}
                          data-nav-item={`tools-${index}`}
                          className={`flex h-9 w-[153.5px] flex-shrink-0 items-center gap-3 whitespace-nowrap rounded-xl p-2 transition-all duration-200 ${
                            isItemSelected('tools', index)
                              ? 'bg-accent'
                              : 'bg-secondary hover:bg-secondary/80'
                          }`}
                        >
                          <div
                            className='flex h-5 w-5 items-center justify-center rounded-md'
                            style={{ backgroundColor: tool.bgColor }}
                          >
                            <tool.icon className='h-4 w-4 text-white' />
                          </div>
                          <span className='font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                            {tool.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Templates Section */}
              {(loading || filteredTemplates.length > 0) && (
                <div>
                  <h3 className='mb-3 ml-6 font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                    Templates
                  </h3>
                  <div
                    ref={(el) => {
                      if (el) scrollRefs.current.set('templates', el)
                    }}
                    className='scrollbar-none flex gap-4 overflow-x-auto pr-6 pb-1 pl-6'
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  >
                    {loading
                      ? renderSkeletonCards()
                      : filteredTemplates.map((template, index) => (
                          <div
                            key={template.id}
                            data-nav-item={`templates-${index}`}
                            className={`w-80 flex-shrink-0 rounded-lg transition-all duration-200 ${
                              isItemSelected('templates', index) ? 'bg-accent' : ''
                            }`}
                          >
                            <TemplateCard
                              id={template.id}
                              title={template.title}
                              description={template.description}
                              author={template.author}
                              usageCount={template.usageCount}
                              stars={template.stars}
                              icon={template.icon}
                              iconColor={template.iconColor}
                              state={template.state}
                              isStarred={template.isStarred}
                              onTemplateUsed={() => onOpenChange(false)}
                              onStarChange={handleStarChange}
                            />
                          </div>
                        ))}
                  </div>
                </div>
              )}

              {/* List sections (Workspaces, Workflows, Pages, Docs) */}
              {navigationSections.find((s) => s.id === 'list') && (
                <div
                  ref={(el) => {
                    if (el) scrollRefs.current.set('list', el)
                  }}
                >
                  {/* Workspaces */}
                  {filteredWorkspaces.length > 0 && (
                    <div className='mb-6'>
                      <h3 className='mb-3 ml-6 font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                        Workspaces
                      </h3>
                      <div className='space-y-1 px-6'>
                        {filteredWorkspaces.map((workspace, workspaceIndex) => {
                          const globalIndex = workspaceIndex
                          return (
                            <button
                              key={workspace.id}
                              onClick={() =>
                                workspace.isCurrent
                                  ? onOpenChange(false)
                                  : handleNavigationClick(workspace.href)
                              }
                              data-nav-item={`list-${globalIndex}`}
                              className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 py-2 transition-colors focus:outline-none ${
                                isItemSelected('list', globalIndex)
                                  ? 'bg-accent text-accent-foreground'
                                  : 'hover:bg-accent/60 focus:bg-accent/60'
                              }`}
                            >
                              <div className='flex h-5 w-5 items-center justify-center'>
                                <Building2 className='h-4 w-4 text-muted-foreground' />
                              </div>
                              <span className='flex-1 text-left font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                                {workspace.name}
                                {workspace.isCurrent && ' (current)'}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Workflows */}
                  {filteredWorkflows.length > 0 && (
                    <div className='mb-6'>
                      <h3 className='mb-3 ml-6 font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                        Workflows
                      </h3>
                      <div className='space-y-1 px-6'>
                        {filteredWorkflows.map((workflow, workflowIndex) => {
                          const globalIndex = filteredWorkspaces.length + workflowIndex
                          return (
                            <button
                              key={workflow.id}
                              onClick={() =>
                                workflow.isCurrent
                                  ? onOpenChange(false)
                                  : handleNavigationClick(workflow.href)
                              }
                              data-nav-item={`list-${globalIndex}`}
                              className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 py-2 transition-colors focus:outline-none ${
                                isItemSelected('list', globalIndex)
                                  ? 'bg-accent text-accent-foreground'
                                  : 'hover:bg-accent/60 focus:bg-accent/60'
                              }`}
                            >
                              <div className='flex h-5 w-5 items-center justify-center'>
                                <Workflow className='h-4 w-4 text-muted-foreground' />
                              </div>
                              <span className='flex-1 text-left font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                                {workflow.name}
                                {workflow.isCurrent && ' (current)'}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Pages */}
                  {filteredPages.length > 0 && (
                    <div className='mb-6'>
                      <h3 className='mb-3 ml-6 font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                        Pages
                      </h3>
                      <div className='space-y-1 px-6'>
                        {filteredPages.map((page, pageIndex) => {
                          const globalIndex =
                            filteredWorkspaces.length + filteredWorkflows.length + pageIndex
                          return (
                            <button
                              key={page.id}
                              onClick={() => handlePageClick(page.href)}
                              data-nav-item={`list-${globalIndex}`}
                              className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 py-2 transition-colors focus:outline-none ${
                                isItemSelected('list', globalIndex)
                                  ? 'bg-accent text-accent-foreground'
                                  : 'hover:bg-accent/60 focus:bg-accent/60'
                              }`}
                            >
                              <div className='flex h-5 w-5 items-center justify-center'>
                                <page.icon className='h-4 w-4 text-muted-foreground' />
                              </div>
                              <span className='flex-1 text-left font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                                {page.name}
                              </span>
                              {page.shortcut && (
                                <kbd className='flex h-6 w-10 items-center justify-center rounded-[5px] border border-border bg-background font-mono text-[#CDCDCD] text-xs dark:text-[#454545]'>
                                  <span className='flex items-center justify-center gap-[1px] pt-[1px]'>
                                    <span className='text-lg'>⌘</span>
                                    <span className='pb-[4px] text-lg'>⇧</span>
                                    <span className='text-xs'>{page.shortcut.slice(-1)}</span>
                                  </span>
                                </kbd>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Docs */}
                  {filteredDocs.length > 0 && (
                    <div>
                      <h3 className='mb-3 ml-6 font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                        Docs
                      </h3>
                      <div className='space-y-1 px-6'>
                        {filteredDocs.map((doc, docIndex) => {
                          const globalIndex =
                            filteredWorkspaces.length +
                            filteredWorkflows.length +
                            filteredPages.length +
                            docIndex
                          return (
                            <button
                              key={doc.id}
                              onClick={() => handleDocsClick(doc.href)}
                              data-nav-item={`list-${globalIndex}`}
                              className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 py-2 transition-colors focus:outline-none ${
                                isItemSelected('list', globalIndex)
                                  ? 'bg-accent text-accent-foreground'
                                  : 'hover:bg-accent/60 focus:bg-accent/60'
                              }`}
                            >
                              <div className='flex h-5 w-5 items-center justify-center'>
                                <doc.icon className='h-4 w-4 text-muted-foreground' />
                              </div>
                              <span className='flex-1 text-left font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                                {doc.name}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Empty state */}
              {searchQuery &&
                !loading &&
                filteredWorkflows.length === 0 &&
                filteredWorkspaces.length === 0 &&
                filteredPages.length === 0 &&
                filteredDocs.length === 0 &&
                filteredBlocks.length === 0 &&
                filteredTools.length === 0 &&
                filteredTemplates.length === 0 && (
                  <div className='ml-6 py-12 text-center'>
                    <p className='text-muted-foreground'>No results found for "{searchQuery}"</p>
                  </div>
                )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
