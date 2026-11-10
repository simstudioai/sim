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
import { IconButton } from '@sim/emcn/button'
import { ControlRow } from '@sim/emcn/button/control-row'
import { Disclosure } from '@sim/emcn/disclosure'
import { Icon } from '@sim/emcn/icon'
import { ContextActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { SearchField } from '@sim/emcn/search-field'
import { useRouter } from 'next/navigation'
import { RequestAccessModal } from '@/app/(product)/_components/request-access-modal/request-access-modal'
import { BlockTile } from '@/app/(product)/_components/workspace/workflows/canvas/block-tile/block-tile'
import { getCustomBlockTile } from '@/app/(product)/_components/workspace/workflows/canvas/block-tile/custom-block-tile'
import type { DragItemInfo } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/toolbar/drag-preview'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/toolbar/toolbar.module.css'
import { useToolbarItemInteractions } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/toolbar/use-toolbar-item-interactions'
import { getMyAccessRequestHref } from '@/platform/lib/data/requests'
import {
  type BlockConfig,
  buildCustomBlockConfig,
  captureClientEvent,
  getCanonicalBlocksByCategory,
  getTriggersForSidebar,
  hasTriggerCapability,
  isCustomBlockType,
  LoopTool,
  ParallelTool,
  type ToolbarSectionKey,
  useCustomBlockOverlayVersion,
  useCustomBlocks,
  usePermissionConfig,
  useSandboxBlockConstraints,
  useToolbarStore,
  useWorkflowScope,
} from '@/platform/lib/data/workflows'
import { usePlatformHref } from '@/platform/lib/navigation'
import { compareText } from '@/platform/shared/time'

interface BlockItem {
  name: string
  type: string
  config?: BlockConfig
  icon?: ComponentType<{ className?: string }>
  bgColor?: string
  docsLink?: string
  restricted?: boolean
}

interface RestrictedBlockItem extends BlockItem {
  section: 'triggers' | 'blocks' | 'tools'
}

interface ToolbarItemProps {
  item: BlockItem
  isTrigger: boolean
  onDragStart: (
    e: React.DragEvent<HTMLElement>,
    type: string,
    enableTriggerMode: boolean,
    dragItemInfo?: DragItemInfo
  ) => void
  onClick: (type: string, enableTriggerMode: boolean) => void
  onAddToCanvas: (type: string, isTrigger: boolean) => void
  onViewDocumentation: (type: string, docsLink: string) => void
  itemRef: (el: HTMLDivElement | null) => void
}

const ToolbarItem = memo(function ToolbarItem({
  item,
  isTrigger,
  onDragStart,
  onClick,
  onAddToCanvas,
  onViewDocumentation,
  itemRef,
}: ToolbarItemProps) {
  const ItemIcon = item.icon
  const isTriggerCapable = isTrigger && item.config ? hasTriggerCapability(item.config) : false
  const docsLink = item.docsLink ?? item.config?.docsLink

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      const tileSlot = e.currentTarget.querySelector<HTMLElement>('[data-toolbar-item-icon]')
      const tile = tileSlot?.firstElementChild
      onDragStart(e, item.type, isTriggerCapable, {
        name: item.name,
        bgColor: item.bgColor ?? '#666666',
        iconContainer: tile instanceof HTMLElement ? tile : tileSlot,
        themeSource: e.currentTarget,
      })
    },
    [item.type, item.name, item.bgColor, isTriggerCapable, onDragStart]
  )

  const addBlockToPanel = useCallback(() => {
    onClick(item.type, isTriggerCapable)
  }, [item.type, isTriggerCapable, onClick])

  /** The context menu adds with the section's trigger flag. */
  const addToCanvas = useCallback(() => {
    onAddToCanvas(item.type, isTrigger)
  }, [item.type, isTrigger, onAddToCanvas])

  const viewDocumentation = useCallback(() => {
    if (docsLink) onViewDocumentation(item.type, docsLink)
  }, [item.type, docsLink, onViewDocumentation])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      onClick(item.type, isTriggerCapable)
    },
    [item.type, isTriggerCapable, onClick]
  )

  const row = (
    <ControlRow
      render={
        <div
          ref={itemRef}
          role='button'
          tabIndex={-1}
          draggable={!item.restricted}
          onDragStart={item.restricted ? undefined : handleDragStart}
          onKeyDown={handleKeyDown}
        />
      }
      accessibleLabel={
        item.restricted ? `View or request access to ${item.name}` : `Add ${item.name}`
      }
      onClick={addBlockToPanel}
      leading={
        <span className={styles.tile} data-toolbar-item-icon=''>
          <BlockTile blockType={item.type} icon={ItemIcon} bgColor={item.bgColor} />
        </span>
      }
      label={item.name}
      status={item.restricted ? <Icon name='lock' /> : undefined}
    />
  )

  if (item.restricted) return row

  return (
    <ContextActionMenu
      label={`Actions for ${item.name}`}
      actions={() => [
        { id: 'add-to-canvas', label: 'Add to canvas', icon: 'I074', onSelect: addToCanvas },
        ...(docsLink
          ? [
              {
                id: 'view-documentation',
                label: 'View documentation',
                icon: 'I082',
                onSelect: viewDocumentation,
              } satisfies MenuAction,
            ]
          : []),
      ]}
    >
      {row}
    </ContextActionMenu>
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
      return compareText(a.name, b.name)
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

  regularBlockItems.sort((a, b) => compareText(a.name, b.name))
  toolItems.sort((a, b) => compareText(a.name, b.name))

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

interface SectionInfoProps {
  /** What the section holds, shown on hover and focus and read as the button's name. */
  description: string
}

/** The section's explanation behind an info glyph, as the legacy section headers carried it. */
function SectionInfo({ description }: SectionInfoProps) {
  return <IconButton size='compact' icon='I047' label={description} tooltip />
}

interface ToolbarSectionProps {
  label: string
  tooltip: string
  sectionKey: ToolbarSectionKey
  items: BlockItem[]
  isTrigger: boolean
  expanded: boolean
  onToggle: (key: ToolbarSectionKey) => void
  getItemRef: (index: number) => (el: HTMLDivElement | null) => void
  onDragStart: ToolbarItemProps['onDragStart']
  onItemClick: ToolbarItemProps['onClick']
  onAddToCanvas: ToolbarItemProps['onAddToCanvas']
  onViewDocumentation: ToolbarItemProps['onViewDocumentation']
}

const ToolbarSection = memo(function ToolbarSection({
  label,
  tooltip,
  sectionKey,
  items,
  isTrigger,
  expanded,
  onToggle,
  getItemRef,
  onDragStart,
  onItemClick,
  onAddToCanvas,
  onViewDocumentation,
}: ToolbarSectionProps) {
  const toggle = useCallback(() => onToggle(sectionKey), [onToggle, sectionKey])

  if (items.length === 0) return null

  return (
    <Disclosure
      label={label}
      open={expanded}
      onOpenChange={toggle}
      actions={<SectionInfo description={tooltip} />}
    >
      {expanded && (
        <div className={styles.items}>
          {items.map((item, index) => (
            <ToolbarItem
              key={item.type}
              item={item}
              isTrigger={isTrigger}
              onDragStart={onDragStart}
              onClick={onItemClick}
              onAddToCanvas={onAddToCanvas}
              onViewDocumentation={onViewDocumentation}
              itemRef={getItemRef(index)}
            />
          ))}
        </div>
      )}
    </Disclosure>
  )
})

interface ToolbarProps {
  /** Whether the toolbar tab is currently active */
  isActive?: boolean
}

/**
 * Imperative handle exposed by the Toolbar component.
 */
export interface ToolbarRef {
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
    const router = useRouter()
    const hrefFor = usePlatformHref()
    const rootRef = useRef<HTMLDivElement>(null)
    const searchRef = useRef<HTMLDivElement>(null)
    const listEdges = useScrollEdges<HTMLDivElement>()
    const triggerItemRefs = useRef<Array<HTMLDivElement | null>>([])
    const blockItemRefs = useRef<Array<HTMLDivElement | null>>([])
    const customBlockItemRefs = useRef<Array<HTMLDivElement | null>>([])
    const toolItemRefs = useRef<Array<HTMLDivElement | null>>([])
    const restrictedItemRefs = useRef<Array<HTMLDivElement | null>>([])

    const triggerRefCallbacks = useRef<Record<number, (el: HTMLDivElement | null) => void>>({})
    const blockRefCallbacks = useRef<Record<number, (el: HTMLDivElement | null) => void>>({})
    const customBlockRefCallbacks = useRef<Record<number, (el: HTMLDivElement | null) => void>>({})
    const toolRefCallbacks = useRef<Record<number, (el: HTMLDivElement | null) => void>>({})
    const restrictedRefCallbacks = useRef<Record<number, (el: HTMLDivElement | null) => void>>({})

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

    const getCustomBlockRefCallback = useCallback((index: number) => {
      if (!customBlockRefCallbacks.current[index]) {
        customBlockRefCallbacks.current[index] = (el) => {
          customBlockItemRefs.current[index] = el
        }
      }
      return customBlockRefCallbacks.current[index]
    }, [])

    const getToolRefCallback = useCallback((index: number) => {
      if (!toolRefCallbacks.current[index]) {
        toolRefCallbacks.current[index] = (el) => {
          toolItemRefs.current[index] = el
        }
      }
      return toolRefCallbacks.current[index]
    }, [])

    const getRestrictedRefCallback = (index: number) => {
      if (!restrictedRefCallbacks.current[index]) {
        restrictedRefCallbacks.current[index] = (el) => {
          restrictedItemRefs.current[index] = el
        }
      }
      return restrictedRefCallbacks.current[index]
    }

    const { filterBlocks, isBlockRequestable } = usePermissionConfig()
    const [requestedBlockType, setRequestedBlockType] = useState<string | null>(null)
    const sandboxAllowedBlocks = useSandboxBlockConstraints()

    const expandedSections = useToolbarStore((state) => state.expandedSections)
    const setSectionExpanded = useToolbarStore((state) => state.setSectionExpanded)

    const [isSearchActive, setIsSearchActive] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    /** Leaving the tab clears the search, so the next visit opens on the full palette. */
    const [prevIsActive, setPrevIsActive] = useState(isActive)
    if (isActive !== prevIsActive) {
      setPrevIsActive(isActive)
      if (!isActive) {
        setIsSearchActive(false)
        setSearchQuery('')
      }
    }

    const { handleDragStart, handleItemClick } = useToolbarItemInteractions()

    const { workspaceId, workflowId: currentWorkflowId } = useWorkflowScope()
    const { data: customBlocksData } = useCustomBlocks(workspaceId)

    // Re-read the block lists whenever the overlay version bumps (custom-block
    // or block-visibility hydrate) — the module caches are keyed to it.
    const blockOverlayVersion = useCustomBlockOverlayVersion()
    const allTriggers = getTriggers(blockOverlayVersion)
    const allBlocks = getBlocks(blockOverlayVersion)
    const allTools = getTools(blockOverlayVersion)
    const requestedBlock = requestedBlockType
      ? (allTriggers.find((item) => item.type === requestedBlockType) ??
        allBlocks.find((item) => item.type === requestedBlockType) ??
        allTools.find((item) => item.type === requestedBlockType))
      : undefined

    if (requestedBlockType !== null && (!requestedBlock || !workspaceId)) {
      setRequestedBlockType(null)
    }

    // Published custom blocks are their own section. Exclude disabled blocks (still
    // resolvable so placed instances survive, but not offered for new placement) and
    // the block bound to the CURRENT workflow — adding a workflow's own block recurses.
    // A block without an image takes the default glyph, the same tile the canvas hydrates.
    const allCustomBlocks = useMemo(() => {
      if (!customBlocksData?.length) return []
      return customBlocksData
        .filter((cb) => cb.enabled && cb.workflowId !== currentWorkflowId)
        .map((cb) => {
          const { icon, bgColor } = getCustomBlockTile(cb.iconUrl)
          return {
            name: cb.name,
            type: cb.type,
            config: buildCustomBlockConfig(
              {
                type: cb.type,
                name: cb.name,
                description: cb.description,
                workflowId: cb.workflowId,
                exposedOutputs: cb.exposedOutputs,
              },
              cb.inputFields,
              { icon, bgColor }
            ),
            icon,
            bgColor,
          } satisfies BlockItem
        })
        .sort((a, b) => compareText(a.name, b.name))
    }, [customBlocksData, currentWorkflowId])

    const handleRequestItemClick = useCallback((type: string) => {
      setRequestedBlockType(type)
    }, [])

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

    const restrictedItems = useMemo((): RestrictedBlockItem[] => {
      const categories = [
        { section: 'triggers', items: sandboxAllowedBlocks === null ? allTriggers : [] },
        { section: 'blocks', items: allBlocks },
        { section: 'tools', items: allTools },
      ] as const
      return categories.flatMap(({ section, items }) =>
        items
          .filter(
            (item) =>
              !isCustomBlockType(item.type) &&
              isBlockRequestable(item.type) &&
              (sandboxAllowedBlocks === null || sandboxAllowedBlocks.includes(item.type))
          )
          .map((item) => ({ ...item, restricted: true, section }))
      )
    }, [allTriggers, allBlocks, allTools, isBlockRequestable, sandboxAllowedBlocks])

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

    const filteredCustomBlocks = useMemo(() => {
      if (!isSearching) return visibleCustomBlocks
      return visibleCustomBlocks.filter((block) =>
        block.name.toLowerCase().includes(normalizedQuery)
      )
    }, [visibleCustomBlocks, isSearching, normalizedQuery])

    const filteredTools = useMemo(() => {
      if (!isSearching) return visibleTools
      return visibleTools.filter((tool) => tool.name.toLowerCase().includes(normalizedQuery))
    }, [visibleTools, isSearching, normalizedQuery])

    const filteredRestrictedItems = useMemo(() => {
      if (!isSearching) return restrictedItems
      return restrictedItems.filter((item) => item.name.toLowerCase().includes(normalizedQuery))
    }, [restrictedItems, isSearching, normalizedQuery])

    /**
     * Trim ref arrays to current filtered length to prevent stale refs from
     * polluting keyboard navigation when items disappear (search, sandbox).
     */
    triggerItemRefs.current.length = filteredTriggers.length
    blockItemRefs.current.length = filteredBlocks.length
    customBlockItemRefs.current.length = filteredCustomBlocks.length
    toolItemRefs.current.length = filteredTools.length
    restrictedItemRefs.current.length = filteredRestrictedItems.length

    /**
     * Section expansion is derived during search (force-expand sections with
     * matches, hide sections with zero matches via items.length === 0). When
     * not searching, the persisted store state drives expansion.
     */
    const sectionExpanded: Record<ToolbarSectionKey, boolean> = {
      triggers: isSearching ? filteredTriggers.length > 0 : expandedSections.triggers,
      blocks: isSearching ? filteredBlocks.length > 0 : expandedSections.blocks,
      customBlocks: isSearching ? filteredCustomBlocks.length > 0 : expandedSections.customBlocks,
      tools: isSearching ? filteredTools.length > 0 : expandedSections.tools,
    }

    const handleSectionToggle = useCallback(
      (key: ToolbarSectionKey) => {
        if (isSearching) return
        setSectionExpanded(key, !expandedSections[key])
      },
      [isSearching, expandedSections, setSectionExpanded]
    )

    const focusSearch = useCallback(() => {
      setIsSearchActive(true)
      queueMicrotask(() => searchRef.current?.querySelector('input')?.focus())
    }, [])

    useImperativeHandle(ref, () => ({ focusSearch }), [focusSearch])

    /** The field is always shown, so focusing it is what turns search mode on. */
    const handleSearchFocus = () => {
      setIsSearchActive(true)
    }

    /**
     * Handle search input blur.
     *
     * If the search query is empty, deactivate search mode.
     * If there's a query, keep search mode active so ArrowUp/Down navigation continues
     * to work after focus moves into the section lists.
     */
    const handleSearchBlur = (event: React.FocusEvent<HTMLDivElement>) => {
      if (!(event.target instanceof HTMLInputElement)) return
      if (!searchQuery.trim() && !rootRef.current?.contains(event.relatedTarget)) {
        setIsSearchActive(false)
      }
    }

    const handleContextMenuAddToCanvas = useCallback(
      (type: string, isTrigger: boolean) => {
        handleItemClick(type, isTrigger)
      },
      [handleItemClick]
    )

    const handleViewDocumentation = useCallback((type: string, docsLink: string) => {
      window.open(docsLink, '_blank', 'noopener,noreferrer')
      captureClientEvent('docs_opened', {
        source: 'toolbar_context_menu',
        block_type: type,
      })
    }, [])

    /**
     * Keyboard navigation follows visible section order, ending with access requests.
     *
     * - Active only when the toolbar tab is active and search mode is on.
     * - Skips collapsed or empty sections so focus only lands on visible items.
     * - ArrowDown traverses search → triggers → blocks → custom blocks → tools → access required.
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
          key: ToolbarSectionKey | 'restricted'
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
            key: 'customBlocks',
            items: sectionExpanded.customBlocks
              ? customBlockItemRefs.current.filter((el): el is HTMLDivElement => el !== null)
              : [],
          },
          {
            key: 'tools',
            items: sectionExpanded.tools
              ? toolItemRefs.current.filter((el): el is HTMLDivElement => el !== null)
              : [],
          },
        ]
        allSections.push({
          key: 'restricted',
          items: restrictedItemRefs.current.filter((el): el is HTMLDivElement => el !== null),
        })
        const sections = allSections.filter((section) => section.items.length > 0)

        const searchInput = searchRef.current?.querySelector('input') ?? null
        let sectionIndex = -1
        let itemIndex = -1
        const isSearch = activeEl === searchInput

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
          if (searchInput) {
            event.preventDefault()
            event.stopPropagation()
            searchInput.focus()
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
      sectionExpanded.customBlocks,
      sectionExpanded.tools,
    ])

    return (
      <div
        ref={rootRef}
        data-toolbar-root
        data-search-active={isSearchActive ? 'true' : 'false'}
        className={styles.root}
      >
        <div className={styles.header}>
          <div
            ref={searchRef}
            className={styles.search}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
          >
            <SearchField
              variant='quiet'
              label='Search toolbar'
              placeholder='Search blocks…'
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
          </div>
        </div>

        {requestedBlock && workspaceId && (
          <RequestAccessModal
            key={`${workspaceId}:${requestedBlock.type}`}
            scope={{ kind: 'workspace', workspaceId }}
            target={{ kind: 'integration', id: requestedBlock.type }}
            label={requestedBlock.name}
            onViewRequest={(requestId) =>
              router.push(
                hrefFor(getMyAccessRequestHref({ kind: 'workspace', workspaceId }, requestId))
              )
            }
            onClose={() => setRequestedBlockType(null)}
          />
        )}

        <div ref={listEdges} className={styles.list}>
          <ToolbarSection
            label='Triggers'
            tooltip='Events that start a workflow'
            sectionKey='triggers'
            items={filteredTriggers}
            isTrigger={true}
            expanded={sectionExpanded.triggers}
            onToggle={handleSectionToggle}
            getItemRef={getTriggerRefCallback}
            onDragStart={handleDragStart}
            onItemClick={handleItemClick}
            onAddToCanvas={handleContextMenuAddToCanvas}
            onViewDocumentation={handleViewDocumentation}
          />
          <ToolbarSection
            label='Core Blocks'
            tooltip='Core building blocks for agent logic'
            sectionKey='blocks'
            items={filteredBlocks}
            isTrigger={false}
            expanded={sectionExpanded.blocks}
            onToggle={handleSectionToggle}
            getItemRef={getBlockRefCallback}
            onDragStart={handleDragStart}
            onItemClick={handleItemClick}
            onAddToCanvas={handleContextMenuAddToCanvas}
            onViewDocumentation={handleViewDocumentation}
          />
          {allCustomBlocks.length > 0 && (
            <ToolbarSection
              label='Custom Blocks'
              tooltip='Workflows published as reusable blocks across your organization'
              sectionKey='customBlocks'
              items={filteredCustomBlocks}
              isTrigger={false}
              expanded={sectionExpanded.customBlocks}
              onToggle={handleSectionToggle}
              getItemRef={getCustomBlockRefCallback}
              onDragStart={handleDragStart}
              onItemClick={handleItemClick}
              onAddToCanvas={handleContextMenuAddToCanvas}
              onViewDocumentation={handleViewDocumentation}
            />
          )}
          <ToolbarSection
            label='Integrations'
            tooltip='Connect agents to external services'
            sectionKey='tools'
            items={filteredTools}
            isTrigger={false}
            expanded={sectionExpanded.tools}
            onToggle={handleSectionToggle}
            getItemRef={getToolRefCallback}
            onDragStart={handleDragStart}
            onItemClick={handleItemClick}
            onAddToCanvas={handleContextMenuAddToCanvas}
            onViewDocumentation={handleViewDocumentation}
          />
          {filteredRestrictedItems.length > 0 && (
            <Disclosure
              label='Access required'
              initiallyOpen
              actions={
                <SectionInfo description='Ask your organization admin to enable these blocks for your permission group.' />
              }
            >
              <div className={styles.items}>
                {filteredRestrictedItems.map((item, index) => (
                  <ToolbarItem
                    key={`${item.section}-${item.type}`}
                    item={item}
                    isTrigger={item.section === 'triggers'}
                    onDragStart={handleDragStart}
                    onClick={handleRequestItemClick}
                    onAddToCanvas={handleContextMenuAddToCanvas}
                    onViewDocumentation={handleViewDocumentation}
                    itemRef={getRestrictedRefCallback(index)}
                  />
                ))}
              </div>
            </Disclosure>
          )}
        </div>
      </div>
    )
  })
)
