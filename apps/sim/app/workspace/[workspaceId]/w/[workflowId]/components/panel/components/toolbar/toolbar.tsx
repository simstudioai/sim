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
import { ChipInput, ChipTag, cn, handleKeyboardActivation, ScrollEdgeFade } from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import { getWorkflowTypeAccent } from '@sim/workflow-renderer'
import { useParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { captureEvent } from '@/lib/posthog/client'
import { getTriggersForSidebar, hasTriggerCapability } from '@/lib/workflows/triggers/trigger-utils'
import { ToolbarItemContextMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/toolbar/components'
import { useToolbarItemInteractions } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/toolbar/hooks'
import { LoopTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/loop/loop-config'
import { ParallelTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-config'
import {
  COMMAND_ITEM_CLASSNAME,
  filterAndCap,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import {
  buildCustomBlockConfig,
  CUSTOM_BLOCK_TILE_COLOR,
  isCustomBlockType,
} from '@/blocks/custom/build-config'
import { useCustomBlockOverlayVersion } from '@/blocks/custom/client-overlay'
import { getCustomBlockIcon } from '@/blocks/custom/custom-block-icon'
import { getTileIconColorClass } from '@/blocks/icon-color'
import { getCanonicalBlocksByCategory } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { useOrgBrandConfig } from '@/ee/whitelabeling/components/branding-provider'
import { useCustomBlocks } from '@/hooks/queries/custom-blocks'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSandboxBlockConstraints } from '@/hooks/use-sandbox-block-constraints'

interface BlockItem {
  name: string
  type: string
  description?: string
  config?: BlockConfig
  icon?: ComponentType<{ className?: string }>
  bgColor?: string
  docsLink?: string
}

interface ToolbarItemProps {
  item: BlockItem
  isTrigger: boolean
  showWorkflowAccent: boolean
  onDragStart: (
    e: React.DragEvent<HTMLElement>,
    type: string,
    enableTriggerMode: boolean,
    dragItemInfo?: { name: string; bgColor: string; iconElement: HTMLElement | null }
  ) => void
  onClick: (type: string, enableTriggerMode: boolean) => void
  onContextMenu: (e: React.MouseEvent, type: string, isTrigger: boolean, docsLink?: string) => void
}

const ToolbarItem = memo(function ToolbarItem({
  item,
  isTrigger,
  showWorkflowAccent,
  onDragStart,
  onClick,
  onContextMenu,
}: ToolbarItemProps) {
  const Icon = item.icon
  const isTriggerCapable = isTrigger && item.config ? hasTriggerCapability(item.config) : false
  const workflowAccent = showWorkflowAccent ? getWorkflowTypeAccent(item.type) : null

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
      data-toolbar-item
      role='button'
      aria-label={`Add ${item.name}`}
      tabIndex={-1}
      draggable
      onDragStart={handleDragStart}
      onClick={addBlockToPanel}
      onContextMenu={handleContextMenu}
      className={cn(
        COMMAND_ITEM_CLASSNAME,
        'mx-0 w-auto hover-hover:bg-[var(--surface-hover)] focus-visible:border-[var(--border)] focus-visible:bg-[var(--surface-active)] focus-visible:outline-none active:cursor-grabbing'
      )}
      onKeyDown={handleKeyDown}
    >
      {workflowAccent && Icon ? (
        <ChipTag
          variant={workflowAccent.variant}
          tone={workflowAccent.tone}
          className='size-[16px] flex-shrink-0 justify-center p-0'
        >
          <Icon className='toolbar-item-icon size-[10px]' />
        </ChipTag>
      ) : (
        <div
          className='relative flex size-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-sm [&_img]:size-full'
          style={{ background: item.bgColor }}
        >
          {Icon && (
            <Icon
              className={cn('toolbar-item-icon size-[10px]', getTileIconColorClass(item.bgColor))}
            />
          )}
        </div>
      )}
      <span className='min-w-0 flex-1 truncate text-[var(--text-body)]'>{item.name}</span>
    </div>
  )
})

/**
 * Cached triggers data - lazy initialized on first access (client-side only)
 */
let cachedTriggers: BlockItem[] | null = null

/**
 * Block-overlay version the caches below were built against. The registry's
 * output is no longer static — a block-visibility hydrate (preview reveal /
 * kill switch) bumps the shared overlay version — so the caches are keyed to
 * it and dropped when it moves. -1 = never built.
 */
let cachedAtOverlayVersion = -1

/** Drop all three caches when the overlay version moved since they were built. */
function syncCachesToOverlayVersion(version: number) {
  if (cachedAtOverlayVersion === version) return
  cachedAtOverlayVersion = version
  cachedTriggers = null
  cachedBlocks = null
  cachedTools = null
}

/**
 * Gets triggers data, computing it once per overlay version and caching for
 * subsequent calls. Non-integration triggers (Start, Schedule, Webhook Trigger) are
 * prioritized first, followed by all other triggers sorted alphabetically.
 */
function getTriggers(overlayVersion: number): BlockItem[] {
  syncCachesToOverlayVersion(overlayVersion)
  if (cachedTriggers === null) {
    const allTriggers = getTriggersForSidebar()
    const priorityOrder = ['Start', 'Schedule', 'Webhook Trigger']

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
      description: trigger.description,
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

  // Exclude custom (deploy-as-block) blocks — they render in their own reactive
  // "Custom Blocks" section, never in the static Core Blocks / Integrations caches.
  const regularBlockConfigs = getCanonicalBlocksByCategory('blocks').filter(
    (b) => !isCustomBlockType(b.type)
  )
  const toolConfigs = getCanonicalBlocksByCategory('tools').filter(
    (b) => !isCustomBlockType(b.type)
  )

  const regularBlockItems: BlockItem[] = regularBlockConfigs.map((block) => ({
    name: block.name,
    type: block.type,
    description: block.description,
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
    description: block.description,
    config: block,
    icon: block.icon,
    bgColor: block.bgColor,
  }))

  regularBlockItems.sort((a, b) => a.name.localeCompare(b.name))
  toolItems.sort((a, b) => a.name.localeCompare(b.name))

  cachedBlocks = regularBlockItems
  cachedTools = toolItems
}

function getBlocks(overlayVersion: number): BlockItem[] {
  syncCachesToOverlayVersion(overlayVersion)
  ensureBlockCaches()
  return cachedBlocks as BlockItem[]
}

function getTools(overlayVersion: number): BlockItem[] {
  syncCachesToOverlayVersion(overlayVersion)
  ensureBlockCaches()
  return cachedTools as BlockItem[]
}

interface ToolbarSectionProps {
  label: string
  items: BlockItem[]
  isTrigger: boolean
  showWorkflowAccent: boolean
  onDragStart: ToolbarItemProps['onDragStart']
  onItemClick: ToolbarItemProps['onClick']
  onContextMenu: ToolbarItemProps['onContextMenu']
}

const ToolbarSection = memo(function ToolbarSection({
  label,
  items,
  isTrigger,
  showWorkflowAccent,
  onDragStart,
  onItemClick,
  onContextMenu,
}: ToolbarSectionProps) {
  if (items.length === 0) return null

  return (
    <section>
      <div className='mb-2 flex h-[18px] items-center px-2 text-[var(--text-muted)] text-small'>
        {label}
      </div>
      <div className='flex flex-col gap-[1px]'>
        {items.map((item) => (
          <ToolbarItem
            key={`${isTrigger ? 'trigger' : 'block'}-${item.type}`}
            item={item}
            isTrigger={isTrigger}
            showWorkflowAccent={showWorkflowAccent}
            onDragStart={onDragStart}
            onClick={onItemClick}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
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
 * Toolbar component displaying the workflow block catalog in a single scrollable
 * view with the same search and list hierarchy as the on-canvas block selector.
 *
 * @param props - Component props
 * @param props.isActive - Whether the toolbar tab is currently active
 * @returns Toolbar view with triggers, blocks, and tools sections
 */
export const Toolbar = memo(
  forwardRef<ToolbarRef, ToolbarProps>(function Toolbar({ isActive = true }: ToolbarProps, ref) {
    const rootRef = useRef<HTMLDivElement>(null)
    const searchInputRef = useRef<HTMLInputElement>(null)
    const scrollContainerRef = useRef<HTMLDivElement>(null)

    const posthog = usePostHog()
    const { filterBlocks } = usePermissionConfig()
    const sandboxAllowedBlocks = useSandboxBlockConstraints()

    const [searchQuery, setSearchQuery] = useState('')
    const [hasScrolledContent, setHasScrolledContent] = useState(false)

    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
    const contextMenuRef = useRef<HTMLDivElement>(null)
    const [activeItemInfo, setActiveItemInfo] = useState<{
      type: string
      isTrigger: boolean
      docsLink?: string
    } | null>(null)
    const isContextMenuOpen = activeItemInfo !== null

    const { handleDragStart, handleItemClick } = useToolbarItemInteractions()

    const params = useParams()
    const workspaceId = params?.workspaceId as string | undefined
    const currentWorkflowId = params?.workflowId as string | undefined
    const { data: customBlocksData } = useCustomBlocks(workspaceId)
    /** No-icon custom blocks use the access-authorized workspace host logo, then the glyph. */
    const fallbackIconUrl = useOrgBrandConfig().logoUrl ?? null

    // Re-read the block lists whenever the overlay version bumps (custom-block
    // or block-visibility hydrate) — the module caches are keyed to it.
    const blockOverlayVersion = useCustomBlockOverlayVersion()
    const allTriggers = getTriggers(blockOverlayVersion)
    const allBlocks = getBlocks(blockOverlayVersion)
    const allTools = getTools(blockOverlayVersion)

    // Published custom blocks are their own section. Exclude disabled blocks (still
    // resolvable so placed instances survive, but not offered for new placement) and
    // the block bound to the CURRENT workflow — adding a workflow's own block recurses.
    const allCustomBlocks = useMemo(() => {
      if (!customBlocksData?.length) return []
      return customBlocksData
        .filter((cb) => cb.enabled && cb.workflowId !== currentWorkflowId)
        .map((cb) => {
          const icon = getCustomBlockIcon(cb.iconUrl, fallbackIconUrl)
          // An image (uploaded or whitelabel) renders on a transparent tile; the
          // default glyph keeps the neutral tile so it stays visible.
          const tileColor = cb.iconUrl || fallbackIconUrl ? 'transparent' : CUSTOM_BLOCK_TILE_COLOR
          return {
            name: cb.name,
            type: cb.type,
            description: cb.description,
            config: buildCustomBlockConfig(
              {
                type: cb.type,
                name: cb.name,
                description: cb.description,
                workflowId: cb.workflowId,
                exposedOutputs: cb.exposedOutputs,
              },
              cb.inputFields,
              { icon, bgColor: tileColor }
            ),
            icon,
            bgColor: tileColor,
          } satisfies BlockItem
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    }, [customBlocksData, currentWorkflowId, fallbackIconUrl])

    const visibleTriggers = useMemo(() => {
      if (sandboxAllowedBlocks !== null) return []
      return filterBlocks(allTriggers)
    }, [filterBlocks, allTriggers, sandboxAllowedBlocks])

    const visibleBlocks = useMemo(() => {
      const permitted = filterBlocks(allBlocks)
      if (sandboxAllowedBlocks === null) return permitted
      return permitted.filter((b) => sandboxAllowedBlocks.includes(b.type))
    }, [filterBlocks, allBlocks, sandboxAllowedBlocks])

    const visibleCustomBlocks = useMemo(() => {
      const permitted = filterBlocks(allCustomBlocks)
      if (sandboxAllowedBlocks === null) return permitted
      return permitted.filter((b) => sandboxAllowedBlocks.includes(b.type))
    }, [filterBlocks, allCustomBlocks, sandboxAllowedBlocks])

    const visibleTools = useMemo(() => {
      const permitted = filterBlocks(allTools)
      if (sandboxAllowedBlocks === null) return permitted
      return permitted.filter((b) => sandboxAllowedBlocks.includes(b.type))
    }, [filterBlocks, allTools, sandboxAllowedBlocks])

    const filteredTriggers = useMemo(
      () => filterAndCap(visibleTriggers, (item) => item.name, searchQuery),
      [searchQuery, visibleTriggers]
    )
    const filteredBlocks = useMemo(
      () => filterAndCap(visibleBlocks, (item) => item.name, searchQuery),
      [searchQuery, visibleBlocks]
    )
    const filteredCustomBlocks = useMemo(
      () => filterAndCap(visibleCustomBlocks, (item) => item.name, searchQuery),
      [searchQuery, visibleCustomBlocks]
    )
    const filteredTools = useMemo(
      () => filterAndCap(visibleTools, (item) => item.name, searchQuery),
      [searchQuery, visibleTools]
    )

    const hasVisibleResults =
      filteredTriggers.length > 0 ||
      filteredBlocks.length > 0 ||
      filteredTools.length > 0 ||
      filteredCustomBlocks.length > 0

    const focusSearch = useCallback(() => {
      queueMicrotask(() => searchInputRef.current?.focus())
    }, [])

    const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
      const nextHasScrolledContent = event.currentTarget.scrollTop > 4
      setHasScrolledContent((current) =>
        current === nextHasScrolledContent ? current : nextHasScrolledContent
      )
    }

    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(event.target.value)
      scrollContainerRef.current?.scrollTo({ top: 0 })
      setHasScrolledContent(false)
    }

    useImperativeHandle(ref, () => ({ focusSearch }), [focusSearch])

    useEffect(() => {
      if (!isActive) setSearchQuery('')
    }, [isActive])

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

    useEffect(() => {
      if (!isActive) return

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

        const activeEl = document.activeElement as HTMLElement | null
        const toolbarRoot = rootRef.current
        if (!toolbarRoot || !activeEl || !toolbarRoot.contains(activeEl)) return
        const items = Array.from(
          toolbarRoot.querySelectorAll<HTMLDivElement>('[data-toolbar-item]')
        )
        const activeIndex = items.findIndex((item) => item === activeEl || item.contains(activeEl))

        if (event.key === 'ArrowDown') {
          const nextItem = items[activeIndex + 1] ?? (activeIndex === -1 ? items[0] : null)
          if (!nextItem) return
          event.preventDefault()
          event.stopPropagation()
          nextItem.focus()
          return
        }

        if (activeIndex <= 0) {
          event.preventDefault()
          event.stopPropagation()
          searchInputRef.current?.focus()
          return
        }
        event.preventDefault()
        event.stopPropagation()
        items[activeIndex - 1]?.focus()
      }

      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isActive])

    return (
      <div ref={rootRef} data-toolbar-root className='relative flex h-full min-h-0 flex-col'>
        <div
          ref={scrollContainerRef}
          className='scrollbar-none h-full overflow-y-auto overflow-x-hidden overscroll-none px-1.5 pt-[55px] pb-12'
          onScroll={handleScroll}
        >
          {hasVisibleResults ? (
            <div className='flex flex-col gap-6'>
              <ToolbarSection
                label='Triggers'
                items={filteredTriggers}
                isTrigger={true}
                showWorkflowAccent={false}
                onDragStart={handleDragStart}
                onItemClick={handleItemClick}
                onContextMenu={handleItemContextMenu}
              />
              <ToolbarSection
                label='Core Blocks'
                items={filteredBlocks}
                isTrigger={false}
                showWorkflowAccent
                onDragStart={handleDragStart}
                onItemClick={handleItemClick}
                onContextMenu={handleItemContextMenu}
              />
              <ToolbarSection
                label='Integrations'
                items={filteredTools}
                isTrigger={false}
                showWorkflowAccent={false}
                onDragStart={handleDragStart}
                onItemClick={handleItemClick}
                onContextMenu={handleItemContextMenu}
              />
              <ToolbarSection
                label='Custom Blocks'
                items={filteredCustomBlocks}
                isTrigger={false}
                showWorkflowAccent
                onDragStart={handleDragStart}
                onItemClick={handleItemClick}
                onContextMenu={handleItemContextMenu}
              />
            </div>
          ) : (
            <div className='flex items-center justify-center px-4 py-8 text-center text-[var(--text-subtle)] text-sm'>
              No blocks found.
            </div>
          )}
        </div>

        <ScrollEdgeFade
          position='top'
          variant='panel'
          visible={hasScrolledContent}
          className='top-[32px] h-16'
        />
        <ScrollEdgeFade position='bottom' variant='panel' />

        <div
          className='absolute inset-x-0 top-0 z-20 h-16 cursor-text bg-[linear-gradient(to_bottom,var(--bg)_0%,var(--bg)_62%,transparent_100%)] pr-[160px] pl-3.5'
          onClick={focusSearch}
        >
          <div className='flex h-10 items-center'>
            <ChipInput
              ref={searchInputRef}
              icon={Search}
              type='search'
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder='Search blocks...'
              aria-label='Search blocks'
              className='min-w-0 flex-1'
            />
          </div>
        </div>

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
