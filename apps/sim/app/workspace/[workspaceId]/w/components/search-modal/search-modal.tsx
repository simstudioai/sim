'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { BookOpen, Building2, LibraryBig, ScrollText, Search, Shapes, Workflow } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { getAllBlocks } from '@/blocks'
import { TemplateCard, TemplateCardSkeleton } from '../../../templates/components/template-card'
import { getKeyboardShortcutText } from '../../hooks/use-keyboard-shortcuts'

interface SearchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  templates?: TemplateData[]
  workflows?: WorkflowItem[]
  workspaces?: WorkspaceItem[]
  loading?: boolean
  isOnWorkflowPage?: boolean
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

interface WorkflowItem {
  id: string
  name: string
  href: string
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
  longDescription?: string
  icon: React.ComponentType<any>
  bgColor: string
  type: string
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
  const [selectedIndex, setSelectedIndex] = useState(0)
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  // Local state for templates to handle star changes
  const [localTemplates, setLocalTemplates] = useState<TemplateData[]>(templates)

  // Update local templates when props change
  useEffect(() => {
    setLocalTemplates(templates)
  }, [templates])

  // Get all available blocks - only when on workflow page
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
          description: block.description || '',
          longDescription: block.longDescription,
          icon: block.icon,
          bgColor: block.bgColor || '#6B7280',
          type: block.type,
        })
      )
      .sort((a, b) => a.name.localeCompare(b.name))
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
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [isOnWorkflowPage])

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
          type: block.category === 'blocks' || block.category === 'triggers' ? 'block' : 'tool',
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

  // Create flattened list of navigatable items for keyboard navigation
  const navigatableItems = useMemo(() => {
    const items: Array<{
      type: 'workspace' | 'workflow' | 'page' | 'doc' | 'block' | 'tool'
      data: any
      section: string
    }> = []

    // Add blocks first (highest priority)
    filteredBlocks.forEach((block) => {
      items.push({ type: 'block', data: block, section: 'Blocks' })
    })

    // Add tools second
    filteredTools.forEach((tool) => {
      items.push({ type: 'tool', data: tool, section: 'Tools' })
    })

    // Skip templates for now

    // Add workspaces
    filteredWorkspaces.forEach((workspace) => {
      items.push({ type: 'workspace', data: workspace, section: 'Workspaces' })
    })

    // Add workflows
    filteredWorkflows.forEach((workflow) => {
      items.push({ type: 'workflow', data: workflow, section: 'Workflows' })
    })

    // Add pages
    filteredPages.forEach((page) => {
      items.push({ type: 'page', data: page, section: 'Pages' })
    })

    // Add docs
    filteredDocs.forEach((doc) => {
      items.push({ type: 'doc', data: doc, section: 'Docs' })
    })

    return items
  }, [
    filteredBlocks,
    filteredTools,
    filteredWorkspaces,
    filteredWorkflows,
    filteredPages,
    filteredDocs,
  ])

  // Reset selected index when items change or modal opens
  useEffect(() => {
    setSelectedIndex(0)
  }, [navigatableItems, open])

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

  // Handle workflow/workspace navigation (same as page navigation)
  const handleNavigationClick = useCallback(
    (href: string) => {
      router.push(href)
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

      const isMac =
        typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const isModifierPressed = isMac ? e.metaKey : e.ctrlKey

      // Check if this is one of our specific shortcuts
      const isOurShortcut =
        isModifierPressed &&
        e.shiftKey &&
        (e.key.toLowerCase() === 'l' || e.key.toLowerCase() === 'k')

      // Don't trigger other shortcuts if user is typing in the search input
      // But allow our specific shortcuts to pass through
      if (!isOurShortcut) {
        const activeElement = document.activeElement
        const isEditableElement =
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          activeElement?.hasAttribute('contenteditable')

        if (isEditableElement) return
      }

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

  // Handle item selection based on type
  const handleItemSelection = useCallback(
    (item: (typeof navigatableItems)[0]) => {
      switch (item.type) {
        case 'block':
        case 'tool':
          handleBlockClick(item.data.type)
          break
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
    },
    [handleBlockClick, handleNavigationClick, handlePageClick, handleDocsClick, onOpenChange]
  )

  // Get section boundaries for navigation
  const getSectionBoundaries = useCallback(() => {
    const boundaries: { [key: string]: { start: number; end: number } } = {}
    let currentIndex = 0

    const sections = ['Blocks', 'Tools', 'Workspaces', 'Workflows', 'Pages', 'Docs']

    sections.forEach((section) => {
      const sectionItems = navigatableItems.filter((item) => item.section === section)
      if (sectionItems.length > 0) {
        boundaries[section] = {
          start: currentIndex,
          end: currentIndex + sectionItems.length - 1,
        }
        currentIndex += sectionItems.length
      }
    })

    return boundaries
  }, [navigatableItems])

  // Get current section from selected index
  const getCurrentSection = useCallback(
    (index: number) => {
      const boundaries = getSectionBoundaries()
      for (const [section, boundary] of Object.entries(boundaries)) {
        if (index >= boundary.start && index <= boundary.end) {
          return section
        }
      }
      return null
    },
    [getSectionBoundaries]
  )

  // Handle keyboard navigation
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const boundaries = getSectionBoundaries()
      const currentSection = getCurrentSection(selectedIndex)

      // Check if we're in blocks or tools sections (special navigation)
      const isInBlocksOrTools = currentSection === 'Blocks' || currentSection === 'Tools'

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          if (isInBlocksOrTools) {
            // Jump to next section for blocks/tools
            if (currentSection) {
              const sections = Object.keys(boundaries)
              const currentSectionIndex = sections.indexOf(currentSection)
              if (currentSectionIndex < sections.length - 1) {
                const nextSection = sections[currentSectionIndex + 1]
                setSelectedIndex(boundaries[nextSection].start)
              }
            }
          } else {
            // Regular navigation within section for other sections
            setSelectedIndex((prev) => Math.min(prev + 1, navigatableItems.length - 1))
          }
          break
        case 'ArrowUp':
          e.preventDefault()
          if (isInBlocksOrTools) {
            // Jump to previous section for blocks/tools
            if (currentSection) {
              const sections = Object.keys(boundaries)
              const currentSectionIndex = sections.indexOf(currentSection)
              if (currentSectionIndex > 0) {
                const prevSection = sections[currentSectionIndex - 1]
                setSelectedIndex(boundaries[prevSection].start)
              }
            }
          } else {
            // Check if moving up would go into blocks or tools section
            const newIndex = Math.max(selectedIndex - 1, 0)
            const newSection = getCurrentSection(newIndex)

            if (newSection === 'Blocks' || newSection === 'Tools') {
              // Jump to start of the blocks/tools section
              setSelectedIndex(boundaries[newSection].start)
            } else {
              // Regular navigation for other sections
              setSelectedIndex(newIndex)
            }
          }
          break
        case 'ArrowRight':
          e.preventDefault()
          if (isInBlocksOrTools) {
            // Navigate within current section for blocks/tools
            if (currentSection && boundaries[currentSection]) {
              const { end } = boundaries[currentSection]
              setSelectedIndex((prev) => Math.min(prev + 1, end))
            }
          } else {
            // For other sections, right arrow does nothing or same as down
            setSelectedIndex((prev) => Math.min(prev + 1, navigatableItems.length - 1))
          }
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (isInBlocksOrTools) {
            // Navigate within current section for blocks/tools
            if (currentSection && boundaries[currentSection]) {
              const { start } = boundaries[currentSection]
              setSelectedIndex((prev) => Math.max(prev - 1, start))
            }
          } else {
            // For other sections, left arrow does nothing or same as up
            setSelectedIndex((prev) => Math.max(prev - 1, 0))
          }
          break
        case 'Enter':
          e.preventDefault()
          if (navigatableItems.length > 0 && selectedIndex < navigatableItems.length) {
            const selectedItem = navigatableItems[selectedIndex]
            handleItemSelection(selectedItem)
          }
          break
        case 'Escape':
          onOpenChange(false)
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    open,
    selectedIndex,
    navigatableItems,
    onOpenChange,
    handleItemSelection,
    getSectionBoundaries,
    getCurrentSection,
  ])

  // Helper function to check if an item is selected
  const isItemSelected = useCallback(
    (item: any, itemType: string) => {
      if (navigatableItems.length === 0 || selectedIndex >= navigatableItems.length) return false
      const selectedItem = navigatableItems[selectedIndex]
      return selectedItem.type === itemType && selectedItem.data.id === item.id
    },
    [navigatableItems, selectedIndex]
  )

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && navigatableItems.length > 0) {
      const selectedItem = navigatableItems[selectedIndex]
      const itemElement = document.querySelector(
        `[data-search-item="${selectedItem.type}-${selectedItem.data.id}"]`
      )

      if (itemElement) {
        // Special handling for edge items in blocks/tools sections (horizontal scrolling)
        if (selectedItem.type === 'block' || selectedItem.type === 'tool') {
          const boundaries = getSectionBoundaries()
          const isFirstBlock =
            selectedItem.type === 'block' && selectedIndex === (boundaries.Blocks?.start ?? -1)
          const isLastBlock =
            selectedItem.type === 'block' && selectedIndex === (boundaries.Blocks?.end ?? -1)
          const isFirstTool =
            selectedItem.type === 'tool' && selectedIndex === (boundaries.Tools?.start ?? -1)
          const isLastTool =
            selectedItem.type === 'tool' && selectedIndex === (boundaries.Tools?.end ?? -1)

          if (isFirstBlock || isFirstTool) {
            // Find the horizontal scroll container and scroll to left
            const container = itemElement.closest('.scrollbar-none.flex.gap-2.overflow-x-auto')
            if (container) {
              ;(container as HTMLElement).scrollLeft = 0
            }
          } else if (isLastBlock || isLastTool) {
            // Find the horizontal scroll container and scroll to right
            const container = itemElement.closest('.scrollbar-none.flex.gap-2.overflow-x-auto')
            if (container) {
              const scrollContainer = container as HTMLElement
              scrollContainer.scrollLeft = scrollContainer.scrollWidth - scrollContainer.clientWidth
            }
          }
        }

        // Default behavior for all items (ensure they're in view vertically)
        itemElement.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex, navigatableItems, getSectionBoundaries])

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
          style={{ backdropFilter: 'blur(1.5px)' }}
        />
        <DialogPrimitive.Content className='data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] fixed top-[50%] left-[50%] z-50 flex h-[580px] w-[700px] translate-x-[-50%] translate-y-[-50%] flex-col gap-0 overflow-hidden rounded-[8px] border border-border bg-background p-0 focus:outline-none focus-visible:outline-none data-[state=closed]:animate-out data-[state=open]:animate-in'>
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
              className='!font-[300] !text-lg placeholder:!text-lg border-0 bg-transparent font-sans text-muted-foreground leading-10 tracking-normal placeholder:text-muted-foreground focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
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
                    className='scrollbar-none flex gap-2 overflow-x-auto px-6 pb-1'
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  >
                    {filteredBlocks.map((block) => (
                      <button
                        key={block.id}
                        onClick={() => handleBlockClick(block.type)}
                        data-search-item={`block-${block.id}`}
                        className={`flex h-auto w-[180px] flex-shrink-0 cursor-pointer flex-col items-start gap-2 rounded-[8px] border p-3 transition-all duration-200 ${
                          isItemSelected(block, 'block')
                            ? 'border-border bg-secondary/80'
                            : 'border-border/40 bg-background/60 hover:border-border hover:bg-secondary/80'
                        }`}
                      >
                        <div className='flex items-center gap-2'>
                          <div
                            className='flex h-5 w-5 items-center justify-center rounded-[4px]'
                            style={{ backgroundColor: block.bgColor }}
                          >
                            <block.icon className='!h-3.5 !w-3.5 text-white' />
                          </div>
                          <span className='font-medium font-sans text-foreground text-sm leading-none tracking-normal'>
                            {block.name}
                          </span>
                        </div>
                        {(block.longDescription || block.description) && (
                          <p className='line-clamp-2 text-left text-muted-foreground text-xs'>
                            {block.longDescription || block.description}
                          </p>
                        )}
                      </button>
                    ))}
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
                    className='scrollbar-none flex gap-2 overflow-x-auto px-6 pb-1'
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  >
                    {filteredTools.map((tool) => (
                      <button
                        key={tool.id}
                        onClick={() => handleBlockClick(tool.type)}
                        data-search-item={`tool-${tool.id}`}
                        className={`flex h-auto w-[180px] flex-shrink-0 cursor-pointer flex-col items-start gap-2 rounded-[8px] border p-3 transition-all duration-200 ${
                          isItemSelected(tool, 'tool')
                            ? 'border-border bg-secondary/80'
                            : 'border-border/40 bg-background/60 hover:border-border hover:bg-secondary/80'
                        }`}
                      >
                        <div className='flex items-center gap-2'>
                          <div
                            className='flex h-5 w-5 items-center justify-center rounded-[4px]'
                            style={{ backgroundColor: tool.bgColor }}
                          >
                            <tool.icon className='!h-3.5 !w-3.5 text-white' />
                          </div>
                          <span className='font-medium font-sans text-foreground text-sm leading-none tracking-normal'>
                            {tool.name}
                          </span>
                        </div>
                        {tool.description && (
                          <p className='line-clamp-2 text-left text-muted-foreground text-xs'>
                            {tool.description}
                          </p>
                        )}
                      </button>
                    ))}
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

              {/* Workspaces Section */}
              {filteredWorkspaces.length > 0 && (
                <div>
                  <h3 className='mb-3 ml-6 font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                    Workspaces
                  </h3>
                  <div className='space-y-1 px-6'>
                    {filteredWorkspaces.map((workspace) => (
                      <button
                        key={workspace.id}
                        onClick={() =>
                          workspace.isCurrent
                            ? onOpenChange(false)
                            : handleNavigationClick(workspace.href)
                        }
                        data-search-item={`workspace-${workspace.id}`}
                        className={`flex h-10 w-full items-center gap-3 rounded-[8px] px-3 py-2 transition-colors focus:outline-none ${
                          isItemSelected(workspace, 'workspace')
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
                    ))}
                  </div>
                </div>
              )}

              {/* Workflows Section */}
              {filteredWorkflows.length > 0 && (
                <div>
                  <h3 className='mb-3 ml-6 font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
                    Workflows
                  </h3>
                  <div className='space-y-1 px-6'>
                    {filteredWorkflows.map((workflow) => (
                      <button
                        key={workflow.id}
                        onClick={() =>
                          workflow.isCurrent
                            ? onOpenChange(false)
                            : handleNavigationClick(workflow.href)
                        }
                        data-search-item={`workflow-${workflow.id}`}
                        className={`flex h-10 w-full items-center gap-3 rounded-[8px] px-3 py-2 transition-colors focus:outline-none ${
                          isItemSelected(workflow, 'workflow')
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
                        data-search-item={`page-${page.id}`}
                        className={`flex h-10 w-full items-center gap-3 rounded-[8px] px-3 py-2 transition-colors focus:outline-none ${
                          isItemSelected(page, 'page')
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
                        {page.shortcut && <KeyboardShortcut shortcut={page.shortcut} />}
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
                        data-search-item={`doc-${doc.id}`}
                        className={`flex h-10 w-full items-center gap-3 rounded-[8px] px-3 py-2 transition-colors focus:outline-none ${
                          isItemSelected(doc, 'doc')
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
                    ))}
                  </div>
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

// Keyboard Shortcut Component
interface KeyboardShortcutProps {
  shortcut: string
  className?: string
}

const KeyboardShortcut = ({ shortcut, className }: KeyboardShortcutProps) => {
  const parts = shortcut.split('+')

  // Helper function to determine if a part is a symbol that should be larger
  const isSymbol = (part: string) => {
    return ['⌘', '⇧', '⌥', '⌃'].includes(part)
  }

  // Helper function to determine if a part is the shift symbol that needs special positioning
  const isShiftSymbol = (part: string) => {
    return part === '⇧'
  }

  return (
    <kbd
      className={cn(
        'flex h-6 w-9 items-center justify-center rounded-[5px] border border-border bg-background font-mono text-[#CDCDCD] text-xs dark:text-[#454545]',
        className
      )}
    >
      <span className='flex items-center justify-center gap-[1px] pt-[1px]'>
        {parts.map((part, index) => (
          <span
            key={index}
            className={cn(
              isSymbol(part) ? 'text-[17px]' : 'text-xs',
              isShiftSymbol(part) && 'pb-[4px]'
            )}
          >
            {part}
          </span>
        ))}
      </span>
    </kbd>
  )
}
