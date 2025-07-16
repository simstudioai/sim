'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { BookOpen, LibraryBig, ScrollText, Search, Shapes } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { getAllBlocks } from '@/blocks'
import { TemplateCard, TemplateCardSkeleton } from '../../../templates/components/template-card'
import { getKeyboardShortcutText } from '../../hooks/use-keyboard-shortcuts'

interface SearchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  templates?: TemplateData[]
  loading?: boolean
}

interface TemplateData {
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

interface BlockItem {
  id: string
  name: string
  icon: React.ComponentType<any>
  bgColor: string
  type: string
}

interface ToolItem {
  id: string
  name: string
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

export function SearchModal({
  open,
  onOpenChange,
  templates = [],
  loading = false,
}: SearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  // Local state for templates to handle star changes
  const [localTemplates, setLocalTemplates] = useState<TemplateData[]>(templates)

  // Update local templates when props change
  useEffect(() => {
    setLocalTemplates(templates)
  }, [templates])

  // Refs for synchronized scrolling
  const blocksRow1Ref = useRef<HTMLDivElement>(null)
  const blocksRow2Ref = useRef<HTMLDivElement>(null)
  const toolsRow1Ref = useRef<HTMLDivElement>(null)
  const toolsRow2Ref = useRef<HTMLDivElement>(null)

  // Synchronized scrolling functions
  const handleBlocksRow1Scroll = useCallback(() => {
    if (blocksRow1Ref.current && blocksRow2Ref.current) {
      blocksRow2Ref.current.scrollLeft = blocksRow1Ref.current.scrollLeft
    }
  }, [])

  const handleBlocksRow2Scroll = useCallback(() => {
    if (blocksRow1Ref.current && blocksRow2Ref.current) {
      blocksRow1Ref.current.scrollLeft = blocksRow2Ref.current.scrollLeft
    }
  }, [])

  const handleToolsRow1Scroll = useCallback(() => {
    if (toolsRow1Ref.current && toolsRow2Ref.current) {
      toolsRow2Ref.current.scrollLeft = toolsRow1Ref.current.scrollLeft
    }
  }, [])

  const handleToolsRow2Scroll = useCallback(() => {
    if (toolsRow1Ref.current && toolsRow2Ref.current) {
      toolsRow1Ref.current.scrollLeft = toolsRow2Ref.current.scrollLeft
    }
  }, [])

  // Get all available blocks
  const blocks = useMemo(() => {
    const allBlocks = getAllBlocks()
    return allBlocks
      .filter(
        (block) => block.type !== 'starter' && !block.hideFromToolbar && block.category === 'blocks'
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
  }, [])

  // Get all available tools
  const tools = useMemo(() => {
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
  }, [])

  // Define pages
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
        href: 'https://docs.simstudio.ai/',
      },
    ],
    [workspaceId]
  )

  // Define docs
  const docs = useMemo((): DocItem[] => {
    const allBlocks = getAllBlocks()
    const docsItems: DocItem[] = []

    // Add individual block/tool docs
    allBlocks.forEach((block) => {
      if (block.docsLink) {
        docsItems.push({
          id: `docs-${block.type}`,
          name: block.name,
          icon: block.icon,
          href: block.docsLink,
          type: block.category === 'blocks' ? 'block' : 'tool',
        })
      }
    })

    return docsItems.sort((a, b) => a.name.localeCompare(b.name))
  }, [])

  // Filter all items based on search query
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

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onOpenChange(false)
      }
    }

    if (open) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onOpenChange])

  // Clear search when modal closes
  useEffect(() => {
    if (!open) {
      setSearchQuery('')
    }
  }, [open])

  // Handle block/tool click (same as toolbar interaction)
  const handleBlockClick = useCallback(
    (blockType: string) => {
      // Dispatch a custom event to be caught by the workflow component
      const event = new CustomEvent('add-block-from-toolbar', {
        detail: {
          type: blockType,
        },
      })
      window.dispatchEvent(event)
      onOpenChange(false)
    },
    [onOpenChange]
  )

  // Handle page navigation
  const handlePageClick = useCallback(
    (href: string) => {
      // External links open in new tab
      if (href.startsWith('http')) {
        window.open(href, '_blank', 'noopener,noreferrer')
      } else {
        router.push(href)
      }
      onOpenChange(false)
    },
    [router, onOpenChange]
  )

  // Handle docs navigation
  const handleDocsClick = useCallback(
    (href: string) => {
      // External links open in new tab
      if (href.startsWith('http')) {
        window.open(href, '_blank', 'noopener,noreferrer')
      } else {
        router.push(href)
      }
      onOpenChange(false)
    },
    [router, onOpenChange]
  )

  // Handle page navigation shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when modal is open
      if (!open) return

      // Don't trigger if user is typing in the search input
      const activeElement = document.activeElement
      const isEditableElement =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement?.hasAttribute('contenteditable')

      if (isEditableElement) return

      const isMac =
        typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const isModifierPressed = isMac ? e.metaKey : e.ctrlKey

      if (isModifierPressed && e.shiftKey) {
        // Command+Shift+L - Navigate to Logs
        if (e.key.toLowerCase() === 'l') {
          e.preventDefault()
          handlePageClick(`/workspace/${workspaceId}/logs`)
        }
        // Command+Shift+K - Navigate to Knowledge
        else if (e.key.toLowerCase() === 'k') {
          e.preventDefault()
          handlePageClick(`/workspace/${workspaceId}/knowledge`)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, handlePageClick, workspaceId])

  // Handle template usage callback (closes modal after template is used)
  const handleTemplateUsed = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  // Handle star change callback from template card
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

  // Render skeleton cards for loading state
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
        <DialogPrimitive.Content className='data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] fixed top-[50%] left-[50%] z-50 flex h-[580px] w-[700px] translate-x-[-50%] translate-y-[-50%] flex-col gap-0 overflow-hidden rounded-xl border border-border bg-background p-0 shadow-lg duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in'>
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
                  <div className='space-y-2'>
                    {/* First row */}
                    <div
                      ref={blocksRow1Ref}
                      onScroll={handleBlocksRow1Scroll}
                      className='scrollbar-none flex gap-2 overflow-x-auto pr-6 pb-1 pl-6'
                      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    >
                      {filteredBlocks
                        .slice(0, Math.ceil(filteredBlocks.length / 2))
                        .map((block) => (
                          <button
                            key={block.id}
                            onClick={() => handleBlockClick(block.type)}
                            className='flex h-9 w-[153.5px] flex-shrink-0 items-center gap-3 whitespace-nowrap rounded-xl bg-secondary p-2 transition-colors hover:bg-secondary/80'
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
                    {/* Second row */}
                    {filteredBlocks.length > Math.ceil(filteredBlocks.length / 2) && (
                      <div
                        ref={blocksRow2Ref}
                        onScroll={handleBlocksRow2Scroll}
                        className='scrollbar-none flex gap-2 overflow-x-auto pr-6 pb-1 pl-6'
                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                      >
                        {filteredBlocks.slice(Math.ceil(filteredBlocks.length / 2)).map((block) => (
                          <button
                            key={block.id}
                            onClick={() => handleBlockClick(block.type)}
                            className='flex h-9 w-[153.5px] flex-shrink-0 items-center gap-3 whitespace-nowrap rounded-xl bg-secondary p-2 transition-colors hover:bg-secondary/80'
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
                    )}
                  </div>
                </div>
              )}

              {/* Tools Section */}
              {filteredTools.length > 0 && (
                <div>
                  <h3 className='mb-3 ml-6 font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                    Tools
                  </h3>
                  <div className='space-y-2'>
                    {/* First row */}
                    <div
                      ref={toolsRow1Ref}
                      onScroll={handleToolsRow1Scroll}
                      className='scrollbar-none flex gap-2 overflow-x-auto pr-6 pb-1 pl-6'
                      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    >
                      {filteredTools.slice(0, Math.ceil(filteredTools.length / 2)).map((tool) => (
                        <button
                          key={tool.id}
                          onClick={() => handleBlockClick(tool.type)}
                          className='flex h-9 w-[153.5px] flex-shrink-0 items-center gap-3 whitespace-nowrap rounded-xl bg-secondary p-2 transition-colors hover:bg-secondary/80'
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
                    {/* Second row */}
                    {filteredTools.length > Math.ceil(filteredTools.length / 2) && (
                      <div
                        ref={toolsRow2Ref}
                        onScroll={handleToolsRow2Scroll}
                        className='scrollbar-none flex gap-2 overflow-x-auto pr-6 pb-1 pl-6'
                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                      >
                        {filteredTools.slice(Math.ceil(filteredTools.length / 2)).map((tool) => (
                          <button
                            key={tool.id}
                            onClick={() => handleBlockClick(tool.type)}
                            className='flex h-9 w-[153.5px] flex-shrink-0 items-center gap-3 whitespace-nowrap rounded-xl bg-secondary p-2 transition-colors hover:bg-secondary/80'
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
                    )}
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
                    className='scrollbar-none flex gap-4 overflow-x-auto pr-6 pb-1 pl-6'
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  >
                    {loading
                      ? renderSkeletonCards()
                      : filteredTemplates.map((template) => (
                          <div key={template.id} className='w-80 flex-shrink-0'>
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
                              onTemplateUsed={handleTemplateUsed}
                              onStarChange={handleStarChange}
                            />
                          </div>
                        ))}
                  </div>
                </div>
              )}

              {/* Pages Section */}
              {filteredPages.length > 0 && (
                <div>
                  <h3 className='mb-3 ml-6 font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                    Pages
                  </h3>
                  <div className='space-y-1 px-6'>
                    {filteredPages.map((page) => (
                      <button
                        key={page.id}
                        onClick={() => handlePageClick(page.href)}
                        className='flex h-10 w-full items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-accent/60 focus:bg-accent/60 focus:outline-none'
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
                    ))}
                  </div>
                </div>
              )}

              {/* Docs Section */}
              {filteredDocs.length > 0 && (
                <div>
                  <h3 className='mb-3 ml-6 font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                    Docs
                  </h3>
                  <div className='space-y-1 px-6'>
                    {filteredDocs.map((doc) => (
                      <button
                        key={doc.id}
                        onClick={() => handleDocsClick(doc.href)}
                        className='flex h-10 w-full items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-accent/60 focus:bg-accent/60 focus:outline-none'
                      >
                        <div className='flex h-5 w-5 items-center justify-center'>
                          <doc.icon className='h-4 w-4 text-muted-foreground' />
                        </div>
                        <span className='flex-1 text-left font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                          {doc.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {searchQuery &&
                !loading &&
                filteredBlocks.length === 0 &&
                filteredTools.length === 0 &&
                filteredTemplates.length === 0 &&
                filteredPages.length === 0 &&
                filteredDocs.length === 0 && (
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
