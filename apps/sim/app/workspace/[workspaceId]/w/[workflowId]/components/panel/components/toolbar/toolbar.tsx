'use client'

import {
  type ComponentType,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import clsx from 'clsx'
import { ChevronDown, Search } from 'lucide-react'
import { usePostHog } from 'posthog-js/react'
import { Button, chipVariants, Expandable, ExpandableContent, Info } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { handleKeyboardActivation } from '@/lib/core/utils/keyboard'
import { captureEvent } from '@/lib/posthog/client'
import { getTriggersForSidebar, hasTriggerCapability } from '@/lib/workflows/triggers/trigger-utils'
import { ToolbarItemContextMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/toolbar/components'
import { useToolbarItemInteractions } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/toolbar/hooks'
import { LoopTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/loop/loop-config'
import { ParallelTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-config'
import { getCanonicalBlocksByCategory } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSandboxBlockConstraints } from '@/hooks/use-sandbox-block-constraints'
import { useToolbarStore } from '@/stores/panel'
import type { ToolbarSectionKey } from '@/stores/panel/toolbar/store'

interface BlockItem {
  name: string
  type: string
  config?: BlockConfig
  icon?: ComponentType<{ className?: string }>
  bgColor?: string
  docsLink?: string
}

interface ToolbarItemProps {
  item: BlockItem
  isTrigger: boolean
  onDragStart: (
    e: React.DragEvent<HTMLElement>,
    type: string,
    enableTriggerMode: boolean,
    dragItemInfo?: { name: string; bgColor: string; iconElement: HTMLElement | null }
  ) => void
  onClick: (type: string, enableTriggerMode: boolean) => void
  onContextMenu: (e: React.MouseEvent, type: string, isTrigger: boolean, docsLink?: string) => void
  itemRef: (el: HTMLDivElement | null) => void
}

const ToolbarItem = memo(function ToolbarItem({
  item,
  isTrigger,
  onDragStart,
  onClick,
  onContextMenu,
  itemRef,
}: ToolbarItemProps) {
  const Icon = item.icon
  const isTriggerCapable = isTrigger && item.config ? hasTriggerCapability(item.config) : false

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      const iconElement = e.currentTarget.querySelector('.toolbar-item-icon')
      onDragStart(e, item.type, isTriggerCapable, {
        name: item.name,
        bgColor: item.bgColor ?? '#666666',
        iconElement: iconElement as HTMLElement | null,
      })
    },
    [item.type, item.name, item.bgColor, isTriggerCapable, onDragStart]
  )

  const addBlockToPanel = useCallback(() => {
    onClick(item.type, isTriggerCapable)
  }, [item.type, isTriggerCapable, onClick])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      onContextMenu(e, item.type, isTrigger, item.docsLink ?? item.config?.docsLink)
    },
    [item, isTrigger, onContextMenu]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      handleKeyboardActivation(event, () => onClick(item.type, isTriggerCapable), {
        stopPropagation: true,
      })
    },
    [item.type, isTriggerCapable, onClick]
  )

  return (
    <div
      ref={itemRef}
      role='button'
      aria-label={`Add ${item.name}`}
      tabIndex={-1}
      draggable
      onDragStart={handleDragStart}
      onClick={addBlockToPanel}
      onContextMenu={handleContextMenu}
      className={cn(
        chipVariants({ fullWidth: true }),
        'focus-visible:bg-[var(--surface-active)] focus-visible:outline-none active:cursor-grabbing'
      )}
      onKeyDown={handleKeyDown}
    >
      <div
        className='relative flex size-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-sm'
        style={{ background: item.bgColor }}
      >
        {Icon && (
          <Icon
            className={clsx(
              'toolbar-item-icon text-white transition-transform duration-200',
              'group-hover:scale-110',
              '!size-[10px]'
            )}
          />
        )}
      </div>
      <span className='min-w-0 flex-1 truncate text-[var(--text-body)]'>{item.name}</span>
    </div>
  )
})

/**
 * Cached triggers data - lazy initialized on first access (client-side only)
 */
let cachedTriggers: BlockItem[] | null = null

/**
 * Gets triggers data, computing it once and caching for subsequent calls.
 * Non-integration triggers (Start, Schedule, Webhook) are prioritized first,
 * followed by all other triggers sorted alphabetically.
 */
function getTriggers(): BlockItem[] {
  if (cachedTriggers === null) {
    const allTriggers = getTriggersForSidebar()
    const priorityOrder = ['Start', 'Schedule', 'Webhook']

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

    cachedTriggers = sortedTriggers.map((trigger) => ({
      name: trigger.name,
      type: trigger.type,
      config: trigger,
      icon: trigger.icon,
      bgColor: trigger.bgColor,
      docsLink: trigger.docsLink,
    }))
  }
  return cachedTriggers
}

/**
 * Cached first-party blocks (`category === 'blocks'`) plus Loop / Parallel subflow tools.
 * Lazy initialized on first access (client-side only).
 */
let cachedBlocks: BlockItem[] | null = null

/**
 * Cached third-party integration tools (`category === 'tools'`).
 * Lazy initialized on first access (client-side only).
 */
let cachedTools: BlockItem[] | null = null

function ensureBlockCaches() {
  if (cachedBlocks !== null && cachedTools !== null) return

  const regularBlockConfigs = getCanonicalBlocksByCategory('blocks')
  const toolConfigs = getCanonicalBlocksByCategory('tools')

  const regularBlockItems: BlockItem[] = regularBlockConfigs.map((block) => ({
    name: block.name,
    type: block.type,
    config: block,
    icon: block.icon,
    bgColor: block.bgColor,
  }))

  regularBlockItems.push({
    name: LoopTool.name,
    type: LoopTool.type,
    icon: LoopTool.icon,
    bgColor: LoopTool.bgColor,
    docsLink: LoopTool.docsLink,
  })

  regularBlockItems.push({
    name: ParallelTool.name,
    type: ParallelTool.type,
    icon: ParallelTool.icon,
    bgColor: ParallelTool.bgColor,
    docsLink: ParallelTool.docsLink,
  })

  const toolItems: BlockItem[] = toolConfigs.map((block) => ({
    name: block.name,
    type: block.type,
    config: block,
    icon: block.icon,
    bgColor: block.bgColor,
  }))

  regularBlockItems.sort((a, b) => a.name.localeCompare(b.name))
  toolItems.sort((a, b) => a.name.localeCompare(b.name))

  cachedBlocks = regularBlockItems
  cachedTools = toolItems
}

function getBlocks(): BlockItem[] {
  ensureBlockCaches()
  return cachedBlocks as BlockItem[]
}

function getTools(): BlockItem[] {
  ensureBlockCaches()
  return cachedTools as BlockItem[]
}

interface ToolbarSectionProps {
  label: string
  tooltip: string
  sectionKey: ToolbarSectionKey
  items: BlockItem[]
  isTrigger: boolean
  expanded: boolean
  searching: boolean
  animate: boolean
  onToggle: (key: ToolbarSectionKey) => void
  getItemRef: (index: number) => (el: HTMLDivElement | null) => void
  onDragStart: ToolbarItemProps['onDragStart']
  onItemClick: ToolbarItemProps['onClick']
  onContextMenu: ToolbarItemProps['onContextMenu']
}

const ToolbarSection = memo(function ToolbarSection({
  label,
  tooltip,
  sectionKey,
  items,
  isTrigger,
  expanded,
  searching,
  animate,
  onToggle,
  getItemRef,
  onDragStart,
  onItemClick,
  onContextMenu,
}: ToolbarSectionProps) {
  const toggle = useCallback(() => onToggle(sectionKey), [onToggle, sectionKey])

  if (items.length === 0) return null

  return (
    <section>
      <div className='sticky top-0 z-10 flex w-full flex-shrink-0 items-center gap-2 bg-[var(--bg)] px-4 pt-3 pb-2'>
        <button
          type='button'
          onClick={toggle}
          aria-expanded={expanded}
          disabled={searching}
          className='flex flex-1 items-center gap-2 text-left'
        >
          <span className='text-[var(--text-muted)] text-small'>{label}</span>
          <ChevronDown
            className={clsx(
              'size-[14px] text-[var(--text-icon)] transition-transform duration-150',
              !expanded && '-rotate-90'
            )}
          />
        </button>
        <Info>{tooltip}</Info>
      </div>
      <Expandable expanded={expanded}>
        <ExpandableContent className={animate ? undefined : '!animate-none'}>
          <div className='flex flex-col gap-0.5 px-2'>
            {items.map((item, index) => (
              <ToolbarItem
                key={item.type}
                item={item}
                isTrigger={isTrigger}
                onDragStart={onDragStart}
                onClick={onItemClick}
                onContextMenu={onContextMenu}
                itemRef={getItemRef(index)}
              />
            ))}
          </div>
        </ExpandableContent>
      </Expandable>
    </section>
  )
})

interface ToolbarProps {
  /** Whether the toolbar tab is currently active */
  isActive?: boolean
}

/**
 * Imperative handle exposed by the Toolbar component.
 */
interface ToolbarRef {
  /**
   * Focuses the search input and ensures search mode is active.
   */
  focusSearch: () => void
}

/**
 * Toolbar component displaying triggers, blocks, and tools in a single scrollable
 * view with three collapsible sections. Each section is independently expandable
 * and its state is persisted across reloads.
 *
 * @param props - Component props
 * @param props.isActive - Whether the toolbar tab is currently active
 * @returns Toolbar view with triggers, blocks, and tools sections
 */
export const Toolbar = memo(
  forwardRef<ToolbarRef, ToolbarProps>(function Toolbar({ isActive = true }: ToolbarProps, ref) {
    const rootRef = useRef<HTMLDivElement>(null)
    const searchInputRef = useRef<HTMLInputElement>(null)
    const triggerItemRefs = useRef<Array<HTMLDivElement | null>>([])
    const blockItemRefs = useRef<Array<HTMLDivElement | null>>([])
    const toolItemRefs = useRef<Array<HTMLDivElement | null>>([])

    const triggerRefCallbacks = useRef<Record<number, (el: HTMLDivElement | null) => void>>({})
    const blockRefCallbacks = useRef<Record<number, (el: HTMLDivElement | null) => void>>({})
    const toolRefCallbacks = useRef<Record<number, (el: HTMLDivElement | null) => void>>({})

    const getTriggerRefCallback = useCallback((index: number) => {
      if (!triggerRefCallbacks.current[index]) {
        triggerRefCallbacks.current[index] = (el) => {
          triggerItemRefs.current[index] = el
        }
      }
      return triggerRefCallbacks.current[index]
    }, [])

    const getBlockRefCallback = useCallback((index: number) => {
      if (!blockRefCallbacks.current[index]) {
        blockRefCallbacks.current[index] = (el) => {
          blockItemRefs.current[index] = el
        }
      }
      return blockRefCallbacks.current[index]
    }, [])

    const getToolRefCallback = useCallback((index: number) => {
      if (!toolRefCallbacks.current[index]) {
        toolRefCallbacks.current[index] = (el) => {
          toolItemRefs.current[index] = el
        }
      }
      return toolRefCallbacks.current[index]
    }, [])

    const posthog = usePostHog()
    const { filterBlocks } = usePermissionConfig()
    const sandboxAllowedBlocks = useSandboxBlockConstraints()

    const expandedSections = useToolbarStore((state) => state.expandedSections)
    const setSectionExpanded = useToolbarStore((state) => state.setSectionExpanded)

    const [isSearchActive, setIsSearchActive] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    /**
     * Collapsible animations are only enabled after the user explicitly toggles
     * a section. Reset when the tab becomes inactive so the next visibility
     * cycle (display: none → block) does not replay the open animation —
     * CSS animations restart whenever a hidden ancestor becomes visible again.
     */
    const [animationsEnabled, setAnimationsEnabled] = useState(false)
    const [prevIsActive, setPrevIsActive] = useState(isActive)
    if (isActive !== prevIsActive) {
      setPrevIsActive(isActive)
      if (!isActive) {
        setIsSearchActive(false)
        setSearchQuery('')
        setAnimationsEnabled(false)
      }
    }

    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
    const contextMenuRef = useRef<HTMLDivElement>(null)
    const [activeItemInfo, setActiveItemInfo] = useState<{
      type: string
      isTrigger: boolean
      docsLink?: string
    } | null>(null)
    const isContextMenuOpen = activeItemInfo !== null

    const { handleDragStart, handleItemClick } = useToolbarItemInteractions()

    const allTriggers = getTriggers()
    const allBlocks = getBlocks()
    const allTools = getTools()

    const visibleTriggers = useMemo(() => {
      if (sandboxAllowedBlocks !== null) return []
      return filterBlocks(allTriggers)
    }, [filterBlocks, allTriggers, sandboxAllowedBlocks])

    const visibleBlocks = useMemo(() => {
      const permitted = filterBlocks(allBlocks)
      if (sandboxAllowedBlocks === null) return permitted
      return permitted.filter((b) => sandboxAllowedBlocks.includes(b.type))
    }, [filterBlocks, allBlocks, sandboxAllowedBlocks])

    const visibleTools = useMemo(() => {
      const permitted = filterBlocks(allTools)
      if (sandboxAllowedBlocks === null) return permitted
      return permitted.filter((b) => sandboxAllowedBlocks.includes(b.type))
    }, [filterBlocks, allTools, sandboxAllowedBlocks])

    const normalizedQuery = searchQuery.trim().toLowerCase()
    const isSearching = normalizedQuery.length > 0

    const filteredTriggers = useMemo(() => {
      if (!isSearching) return visibleTriggers
      return visibleTriggers.filter((trigger) =>
        trigger.name.toLowerCase().includes(normalizedQuery)
      )
    }, [visibleTriggers, isSearching, normalizedQuery])

    const filteredBlocks = useMemo(() => {
      if (!isSearching) return visibleBlocks
      return visibleBlocks.filter((block) => block.name.toLowerCase().includes(normalizedQuery))
    }, [visibleBlocks, isSearching, normalizedQuery])

    const filteredTools = useMemo(() => {
      if (!isSearching) return visibleTools
      return visibleTools.filter((tool) => tool.name.toLowerCase().includes(normalizedQuery))
    }, [visibleTools, isSearching, normalizedQuery])

    /**
     * Trim ref arrays to current filtered length to prevent stale refs from
     * polluting keyboard navigation when items disappear (search, sandbox).
     */
    triggerItemRefs.current.length = filteredTriggers.length
    blockItemRefs.current.length = filteredBlocks.length
    toolItemRefs.current.length = filteredTools.length

    /**
     * Section expansion is derived during search (force-expand sections with
     * matches, hide sections with zero matches via items.length === 0). When
     * not searching, the persisted store state drives expansion.
     */
    const sectionExpanded: Record<ToolbarSectionKey, boolean> = {
      triggers: isSearching ? filteredTriggers.length > 0 : expandedSections.triggers,
      blocks: isSearching ? filteredBlocks.length > 0 : expandedSections.blocks,
      tools: isSearching ? filteredTools.length > 0 : expandedSections.tools,
    }

    const handleSectionToggle = useCallback(
      (key: ToolbarSectionKey) => {
        if (isSearching) return
        setAnimationsEnabled(true)
        setSectionExpanded(key, !expandedSections[key])
      },
      [isSearching, expandedSections, setSectionExpanded]
    )

    const focusSearch = useCallback(() => {
      setIsSearchActive(true)
      queueMicrotask(() => searchInputRef.current?.focus())
    }, [])

    useImperativeHandle(ref, () => ({ focusSearch }), [focusSearch])

    /**
     * Handle search input blur.
     *
     * If the search query is empty, deactivate search mode to show the search icon again.
     * If there's a query, keep search mode active so ArrowUp/Down navigation continues
     * to work after focus moves into the section lists.
     */
    const handleSearchBlur = useCallback(() => {
      if (!searchQuery.trim()) {
        setIsSearchActive(false)
      }
    }, [searchQuery])

    const handleItemContextMenu = useCallback(
      (e: React.MouseEvent, type: string, isTrigger: boolean, docsLink?: string) => {
        e.preventDefault()
        e.stopPropagation()
        setContextMenuPosition({ x: e.clientX, y: e.clientY })
        setActiveItemInfo({ type, isTrigger, docsLink })
      },
      []
    )

    const closeContextMenu = useCallback(() => {
      setActiveItemInfo(null)
    }, [])

    const handleContextMenuAddToCanvas = useCallback(() => {
      if (activeItemInfo) {
        handleItemClick(activeItemInfo.type, activeItemInfo.isTrigger)
      }
    }, [activeItemInfo, handleItemClick])

    const handleViewDocumentation = useCallback(() => {
      if (activeItemInfo?.docsLink) {
        window.open(activeItemInfo.docsLink, '_blank', 'noopener,noreferrer')
        captureEvent(posthog, 'docs_opened', {
          source: 'toolbar_context_menu',
          block_type: activeItemInfo.type,
        })
      }
    }, [activeItemInfo, posthog])

    useEffect(() => {
      if (!isContextMenuOpen) return

      const handleClickOutside = (e: MouseEvent) => {
        if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
          closeContextMenu()
        }
      }

      const timeoutId = setTimeout(() => {
        document.addEventListener('click', handleClickOutside)
      }, 0)

      return () => {
        clearTimeout(timeoutId)
        document.removeEventListener('click', handleClickOutside)
      }
    }, [isContextMenuOpen, closeContextMenu])

    /**
     * Keyboard navigation across the three sections.
     *
     * - Active only when the toolbar tab is active and search mode is on.
     * - Skips collapsed or empty sections so focus only lands on visible items.
     * - ArrowDown traverses search → triggers → blocks → tools.
     * - ArrowUp moves backward; from the first item of the first visible section
     *   it wraps back to the search input.
     */
    useEffect(() => {
      if (!isActive || !isSearchActive) return

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

        const activeEl = document.activeElement as HTMLElement | null
        const toolbarRoot = rootRef.current
        if (!toolbarRoot || !activeEl || !toolbarRoot.contains(activeEl)) return

        type SectionList = {
          key: ToolbarSectionKey
          items: HTMLDivElement[]
        }

        const allSections: SectionList[] = [
          {
            key: 'triggers',
            items: sectionExpanded.triggers
              ? triggerItemRefs.current.filter((el): el is HTMLDivElement => el !== null)
              : [],
          },
          {
            key: 'blocks',
            items: sectionExpanded.blocks
              ? blockItemRefs.current.filter((el): el is HTMLDivElement => el !== null)
              : [],
          },
          {
            key: 'tools',
            items: sectionExpanded.tools
              ? toolItemRefs.current.filter((el): el is HTMLDivElement => el !== null)
              : [],
          },
        ]
        const sections = allSections.filter((section) => section.items.length > 0)

        let sectionIndex = -1
        let itemIndex = -1
        const isSearch = activeEl === searchInputRef.current

        if (!isSearch) {
          for (let s = 0; s < sections.length; s++) {
            const idx = sections[s].items.findIndex(
              (el) => el === activeEl || el.contains(activeEl)
            )
            if (idx !== -1) {
              sectionIndex = s
              itemIndex = idx
              break
            }
          }
        }

        const focusItem = (sIdx: number, iIdx: number) => {
          const el = sections[sIdx]?.items[iIdx]
          if (el) {
            event.preventDefault()
            event.stopPropagation()
            el.focus()
          }
        }

        const focusSearchInput = () => {
          if (searchInputRef.current) {
            event.preventDefault()
            event.stopPropagation()
            searchInputRef.current.focus()
          }
        }

        if (event.key === 'ArrowDown') {
          if (isSearch || sectionIndex === -1) {
            if (sections.length > 0) focusItem(0, 0)
            return
          }
          const currentSection = sections[sectionIndex]
          if (itemIndex < currentSection.items.length - 1) {
            focusItem(sectionIndex, itemIndex + 1)
            return
          }
          if (sectionIndex < sections.length - 1) {
            focusItem(sectionIndex + 1, 0)
          }
          return
        }

        if (event.key === 'ArrowUp') {
          if (isSearch || sectionIndex === -1) return
          if (itemIndex > 0) {
            focusItem(sectionIndex, itemIndex - 1)
            return
          }
          if (sectionIndex > 0) {
            const prev = sections[sectionIndex - 1]
            focusItem(sectionIndex - 1, prev.items.length - 1)
            return
          }
          focusSearchInput()
        }
      }

      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }, [
      isActive,
      isSearchActive,
      sectionExpanded.triggers,
      sectionExpanded.blocks,
      sectionExpanded.tools,
    ])

    return (
      <div
        ref={rootRef}
        data-toolbar-root
        data-search-active={isSearchActive ? 'true' : 'false'}
        className='flex h-full flex-col'
      >
        {/* Header */}
        <div
          role='button'
          tabIndex={0}
          className='mx-[-1px] flex flex-shrink-0 cursor-pointer items-center justify-between border border-[var(--border)] bg-[var(--surface-4)] px-3 py-1.5'
          onClick={focusSearch}
          onKeyDown={(event) => handleKeyboardActivation(event, focusSearch)}
        >
          <h2 className='font-medium text-[var(--text-primary)] text-sm'>{t('toolbar')}</h2>
          <div className='flex shrink-0 items-center gap-2'>
            {!isSearchActive ? (
              <Button
                variant='ghost'
                className='p-0'
                aria-label={t('search_toolbar')}
                onClick={focusSearch}
              >
                <Search className='size-[14px]' />
              </Button>
            ) : (
              <input
                ref={searchInputRef}
                type='text'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onBlur={handleSearchBlur}
                className='w-full border-none bg-transparent pr-0.5 text-right font-medium text-[var(--text-primary)] text-small placeholder:text-[var(--text-muted)] focus:outline-none'
              />
            )}
          </div>
        </div>

        {/* Single scroll container with three collapsible sections */}
        <div className='flex flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-none pb-3'>
          <ToolbarSection
            label={t('triggers')}
            tooltip={t('events_that_start_a_workflow')}
            sectionKey='triggers'
            items={filteredTriggers}
            isTrigger={true}
            expanded={sectionExpanded.triggers}
            searching={isSearching}
            animate={animationsEnabled}
            onToggle={handleSectionToggle}
            getItemRef={getTriggerRefCallback}
            onDragStart={handleDragStart}
            onItemClick={handleItemClick}
            onContextMenu={handleItemContextMenu}
          />
          <ToolbarSection
            label={t('core_blocks')}
            tooltip={t('core_building_blocks_for_agent_logic')}
            sectionKey='blocks'
            items={filteredBlocks}
            isTrigger={false}
            expanded={sectionExpanded.blocks}
            searching={isSearching}
            animate={animationsEnabled}
            onToggle={handleSectionToggle}
            getItemRef={getBlockRefCallback}
            onDragStart={handleDragStart}
            onItemClick={handleItemClick}
            onContextMenu={handleItemContextMenu}
          />
          <ToolbarSection
            label={t('integrations')}
            tooltip={t('connect_agents_to_external_services')}
            sectionKey='tools'
            items={filteredTools}
            isTrigger={false}
            expanded={sectionExpanded.tools}
            searching={isSearching}
            animate={animationsEnabled}
            onToggle={handleSectionToggle}
            getItemRef={getToolRefCallback}
            onDragStart={handleDragStart}
            onItemClick={handleItemClick}
            onContextMenu={handleItemContextMenu}
          />
        </div>

        {/* Toolbar Item Context Menu */}
        <ToolbarItemContextMenu
          isOpen={isContextMenuOpen}
          position={contextMenuPosition}
          menuRef={contextMenuRef}
          onClose={closeContextMenu}
          onAddToCanvas={handleContextMenuAddToCanvas}
          onViewDocumentation={handleViewDocumentation}
          showViewDocumentation={Boolean(activeItemInfo?.docsLink)}
        />
      </div>
    )
  })
)
