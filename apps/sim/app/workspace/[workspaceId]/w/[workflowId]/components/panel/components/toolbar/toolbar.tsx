'use client'

import {
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
import { Search } from 'lucide-react'
import { Button } from '@/components/emcn'
import {
  getBlocksForSidebar,
  getTriggersForSidebar,
  hasTriggerCapability,
} from '@/lib/workflows/triggers/trigger-utils'
import { ToolbarItemContextMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/toolbar/components'
import {
  calculateTriggerHeights,
  useToolbarItemInteractions,
  useToolbarResize,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/toolbar/hooks'
import { LoopTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/loop/loop-config'
import { ParallelTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-config'
import type { BlockConfig } from '@/blocks/types'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useToolbarStore } from '@/stores/panel'

interface BlockItem {
  name: string
  type: string
  isSpecial: boolean
  config?: BlockConfig
  icon?: any
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
      if (!isTrigger && (item.type === 'loop' || item.type === 'parallel')) {
        document.body.classList.add('sim-drag-subflow')
      }
      const iconElement = e.currentTarget.querySelector('.toolbar-item-icon')
      onDragStart(e, item.type, isTriggerCapable, {
        name: item.name,
        bgColor: item.bgColor ?? '#666666',
        iconElement: iconElement as HTMLElement | null,
      })
    },
    [item.type, item.name, item.bgColor, isTriggerCapable, onDragStart, isTrigger]
  )

  const handleDragEnd = useCallback(() => {
    if (!isTrigger) {
      document.body.classList.remove('sim-drag-subflow')
    }
  }, [isTrigger])

  const handleClick = useCallback(() => {
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
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        onClick(item.type, isTriggerCapable)
      }
    },
    [item.type, isTriggerCapable, onClick]
  )

  return (
    <div
      ref={itemRef}
      tabIndex={-1}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className={clsx(
        'group flex h-[28px] items-center gap-[8px] rounded-[8px] px-[6px] text-[14px]',
        'cursor-pointer hover:bg-[var(--surface-6)] active:cursor-grabbing dark:hover:bg-[var(--surface-5)]',
        'focus-visible:bg-[var(--surface-6)] focus-visible:outline-none dark:focus-visible:bg-[var(--surface-5)]'
      )}
      onKeyDown={handleKeyDown}
    >
      <div
        className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
        style={{ background: item.bgColor }}
      >
        {Icon && (
          <Icon
            className={clsx(
              'toolbar-item-icon text-white transition-transform duration-200',
              'group-hover:scale-110',
              '!h-[10px] !w-[10px]'
            )}
          />
        )}
      </div>
      <span
        className={clsx(
          'truncate font-medium',
          'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]',
          'group-focus-visible:text-[var(--text-primary)]'
        )}
      >
        {item.name}
      </span>
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
      isSpecial: false,
    }))
  }
  return cachedTriggers
}

/**
 * Cached blocks data - lazy initialized on first access (client-side only)
 */
let cachedBlocks: BlockItem[] | null = null

/**
 * Gets blocks data, computing it once and caching for subsequent calls
 */
function getBlocks() {
  if (cachedBlocks === null) {
    const allBlocks = getBlocksForSidebar()

    // Separate blocks by category
    const regularBlockConfigs = allBlocks.filter((block) => block.category === 'blocks')
    const toolConfigs = allBlocks.filter((block) => block.category === 'tools')

    // Create regular block items
    const regularBlockItems: BlockItem[] = regularBlockConfigs.map((block) => ({
      name: block.name,
      type: block.type,
      config: block,
      icon: block.icon,
      bgColor: block.bgColor,
      isSpecial: false,
    }))

    // Add Loop and Parallel to blocks
    regularBlockItems.push({
      name: LoopTool.name,
      type: LoopTool.type,
      icon: LoopTool.icon,
      bgColor: LoopTool.bgColor,
      docsLink: LoopTool.docsLink,
      isSpecial: true,
    })

    regularBlockItems.push({
      name: ParallelTool.name,
      type: ParallelTool.type,
      icon: ParallelTool.icon,
      bgColor: ParallelTool.bgColor,
      docsLink: ParallelTool.docsLink,
      isSpecial: true,
    })

    // Create tool items
    const toolItems: BlockItem[] = toolConfigs.map((block) => ({
      name: block.name,
      type: block.type,
      config: block,
      icon: block.icon,
      bgColor: block.bgColor,
      isSpecial: false,
    }))

    // Sort each group alphabetically
    regularBlockItems.sort((a, b) => a.name.localeCompare(b.name))
    toolItems.sort((a, b) => a.name.localeCompare(b.name))

    // Cache blocks first, then tools
    cachedBlocks = [...regularBlockItems, ...toolItems]
  }
  return cachedBlocks
}

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
 * Toolbar component displaying triggers and blocks in a resizable split view.
 * Top half shows triggers, bottom half shows blocks, with a resizable divider between them.
 *
 * @param props - Component props
 * @param props.isActive - Whether the toolbar tab is currently active
 * @returns Toolbar view with triggers and blocks
 */
/**
 * Threshold for determining if triggers are at minimum height (in pixels)
 * Triggers slightly above header height are considered at minimum
 */
const TRIGGERS_MIN_THRESHOLD = 50

export const Toolbar = memo(
  forwardRef<ToolbarRef, ToolbarProps>(function Toolbar({ isActive = true }: ToolbarProps, ref) {
    const rootRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const triggersContentRef = useRef<HTMLDivElement>(null)
    const triggersHeaderRef = useRef<HTMLDivElement>(null)
    const blocksHeaderRef = useRef<HTMLDivElement>(null)
    const searchInputRef = useRef<HTMLInputElement>(null)
    const triggerItemRefs = useRef<Array<HTMLDivElement | null>>([])
    const blockItemRefs = useRef<Array<HTMLDivElement | null>>([])

    const triggerRefCallbacks = useRef<Record<number, (el: HTMLDivElement | null) => void>>({})
    const blockRefCallbacks = useRef<Record<number, (el: HTMLDivElement | null) => void>>({})

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

    // Search state
    const [isSearchActive, setIsSearchActive] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')

    // Toggle animation state
    const [isToggling, setIsToggling] = useState(false)

    // Context menu state
    const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
    const contextMenuRef = useRef<HTMLDivElement>(null)
    const [activeItemInfo, setActiveItemInfo] = useState<{
      type: string
      isTrigger: boolean
      docsLink?: string
    } | null>(null)

    const toolbarTriggersHeight = useToolbarStore((state) => state.toolbarTriggersHeight)
    const setToolbarTriggersHeight = useToolbarStore((state) => state.setToolbarTriggersHeight)
    const preSearchHeight = useToolbarStore((state) => state.preSearchHeight)
    const setPreSearchHeight = useToolbarStore((state) => state.setPreSearchHeight)

    const toolbarInteractionsConfig = useMemo(() => ({ disabled: false }), [])
    const { handleDragStart, handleItemClick } =
      useToolbarItemInteractions(toolbarInteractionsConfig)

    const { handleMouseDown, isResizing } = useToolbarResize({
      containerRef,
      triggersContentRef,
      triggersHeaderRef,
    })

    const { filterBlocks } = usePermissionConfig()

    const allTriggers = getTriggers()
    const allBlocks = getBlocks()

    const blocks = useMemo(() => filterBlocks(allBlocks), [filterBlocks, allBlocks])
    const triggers = useMemo(() => filterBlocks(allTriggers), [filterBlocks, allTriggers])

    const isTriggersAtMinimum = toolbarTriggersHeight <= TRIGGERS_MIN_THRESHOLD

    /**
     * Clear search when tab becomes inactive
     */
    useEffect(() => {
      if (!isActive) {
        setIsSearchActive(false)
        setSearchQuery('')
      }
    }, [isActive])

    /**
     * Filter items based on search query
     */
    const filteredTriggers = useMemo(() => {
      if (!searchQuery.trim()) return triggers
      const query = searchQuery.toLowerCase()
      return triggers.filter((trigger) => trigger.name.toLowerCase().includes(query))
    }, [triggers, searchQuery])

    const filteredBlocks = useMemo(() => {
      if (!searchQuery.trim()) return blocks
      const query = searchQuery.toLowerCase()
      return blocks.filter((block) => block.name.toLowerCase().includes(query))
    }, [blocks, searchQuery])

    /**
     * Track pre-search height in a ref to avoid cascading re-renders.
     * The store's preSearchHeight is still used for persistence, but we use
     * this ref to prevent the effect from re-running when we update it.
     */
    const preSearchHeightRef = useRef(preSearchHeight)
    preSearchHeightRef.current = preSearchHeight

    /**
     * Adjust heights based on search results
     * - If no triggers found, collapse triggers to minimum (expand blocks)
     * - If no blocks found, expand triggers to maximum (collapse blocks)
     * - If triggers are found, dynamically resize to show all filtered triggers without scrolling
     */
    useEffect(() => {
      const hasSearchQuery = searchQuery.trim().length > 0
      const triggersCount = filteredTriggers.length
      const blocksCount = filteredBlocks.length

      if (hasSearchQuery && preSearchHeightRef.current === null) {
        setPreSearchHeight(toolbarTriggersHeight)
        return
      }

      if (!hasSearchQuery && preSearchHeightRef.current !== null) {
        const heightToRestore = preSearchHeightRef.current
        setPreSearchHeight(null)
        setToolbarTriggersHeight(heightToRestore)
        return
      }

      if (hasSearchQuery) {
        const { minHeight, maxHeight, optimalHeight } = calculateTriggerHeights(
          containerRef,
          triggersContentRef,
          triggersHeaderRef
        )

        if (triggersCount === 0 && blocksCount > 0) {
          setToolbarTriggersHeight(minHeight)
        } else if (blocksCount === 0 && triggersCount > 0) {
          setToolbarTriggersHeight(maxHeight)
        } else if (triggersCount > 0) {
          setToolbarTriggersHeight(optimalHeight)
        }
      }
    }, [
      searchQuery,
      filteredTriggers.length,
      filteredBlocks.length,
      toolbarTriggersHeight,
      setToolbarTriggersHeight,
      setPreSearchHeight,
    ])

    /**
     * Handle search icon click to activate search mode
     */
    const handleSearchClick = () => {
      setIsSearchActive(true)
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 0)
    }

    /**
     * Expose imperative handle for focusing the search input.
     */
    useImperativeHandle(
      ref,
      () => ({
        focusSearch: () => {
          setIsSearchActive(true)
          setTimeout(() => {
            searchInputRef.current?.focus()
          }, 0)
        },
      }),
      []
    )

    /**
     * Handle search input blur.
     *
     * If the search query is empty, deactivate search mode to show the search icon again.
     * If there's a query, keep search mode active so ArrowUp/Down navigation continues
     * to work after focus moves into the triggers/blocks list (e.g. when initiated via Mod+F).
     */
    const handleSearchBlur = () => {
      if (!searchQuery.trim()) {
        setIsSearchActive(false)
      }
    }

    /**
     * Handle blocks header click - toggle between min and max.
     * If triggers are greater than minimum, collapse to minimum (just header).
     * If triggers are at minimum, expand to maximum (full content height).
     */
    const handleBlocksHeaderClick = useCallback(() => {
      setIsToggling(true)

      const { minHeight, maxHeight } = calculateTriggerHeights(
        containerRef,
        triggersContentRef,
        triggersHeaderRef
      )

      // Toggle between min and max
      setToolbarTriggersHeight(isTriggersAtMinimum ? maxHeight : minHeight)
    }, [isTriggersAtMinimum, setToolbarTriggersHeight])

    /**
     * Handle transition end - reset toggling state
     */
    const handleTransitionEnd = useCallback(() => {
      setIsToggling(false)
    }, [])

    /**
     * Handle context menu for toolbar items
     */
    const handleItemContextMenu = useCallback(
      (e: React.MouseEvent, type: string, isTrigger: boolean, docsLink?: string) => {
        e.preventDefault()
        e.stopPropagation()
        setContextMenuPosition({ x: e.clientX, y: e.clientY })
        setActiveItemInfo({ type, isTrigger, docsLink })
        setIsContextMenuOpen(true)
      },
      []
    )

    /**
     * Close context menu and clear active item state
     */
    const closeContextMenu = useCallback(() => {
      setIsContextMenuOpen(false)
      setActiveItemInfo(null)
    }, [])

    /**
     * Handle add to canvas from context menu
     */
    const handleContextMenuAddToCanvas = useCallback(() => {
      if (activeItemInfo) {
        handleItemClick(activeItemInfo.type, activeItemInfo.isTrigger)
      }
    }, [activeItemInfo, handleItemClick])

    /**
     * Handle view documentation from context menu
     */
    const handleViewDocumentation = useCallback(() => {
      if (activeItemInfo?.docsLink) {
        window.open(activeItemInfo.docsLink, '_blank', 'noopener,noreferrer')
      }
    }, [activeItemInfo])

    /**
     * Handle clicks outside the context menu to close it
     */
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
     * Handle keyboard navigation with ArrowUp / ArrowDown when the toolbar tab
     * is active and search is open (e.g. after Mod+F). Navigation order:
     * - From search input or no current focus: first trigger, then subsequent triggers
     * - After the last trigger: first block
     * - Within blocks: linear navigation
     * - ArrowUp from first trigger: moves focus back to search input
     *
     * This is designed to work seamlessly when the toolbar is opened via the
     * Mod+F shortcut, and to take precedence over other global ArrowUp/Down
     * handlers (e.g. terminal navigation) while the toolbar tab is active.
     */
    useEffect(() => {
      if (!isActive || !isSearchActive) {
        return
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
          return
        }

        const activeEl = document.activeElement as HTMLElement | null

        // Only handle navigation when focus is currently inside the toolbar UI
        const toolbarRoot = rootRef.current
        if (!toolbarRoot || !activeEl || !toolbarRoot.contains(activeEl)) {
          return
        }

        const triggers = triggerItemRefs.current.filter((el): el is HTMLDivElement => el !== null)
        const blocks = blockItemRefs.current.filter((el): el is HTMLDivElement => el !== null)

        type Region = 'search' | 'trigger' | 'block' | 'none'
        let region: Region = 'none'
        let index = -1

        if (activeEl && searchInputRef.current && activeEl === searchInputRef.current) {
          region = 'search'
        } else if (activeEl) {
          const triggerIndex = triggers.findIndex((el) => el === activeEl || el.contains(activeEl))
          if (triggerIndex !== -1) {
            region = 'trigger'
            index = triggerIndex
          } else {
            const blockIndex = blocks.findIndex((el) => el === activeEl || el.contains(activeEl))
            if (blockIndex !== -1) {
              region = 'block'
              index = blockIndex
            }
          }
        }

        const focusTrigger = (i: number) => {
          const el = triggers[i]
          if (el) {
            event.preventDefault()
            event.stopPropagation()
            el.focus()
          }
        }

        const focusBlock = (i: number) => {
          const el = blocks[i]
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
          if (region === 'none' || region === 'search') {
            if (triggers.length > 0) {
              focusTrigger(0)
              return
            }
            if (blocks.length > 0) {
              focusBlock(0)
            }
            return
          }

          if (region === 'trigger') {
            if (index < triggers.length - 1) {
              focusTrigger(index + 1)
              return
            }
            if (index === triggers.length - 1 && blocks.length > 0) {
              focusBlock(0)
            }
            return
          }

          if (region === 'block') {
            if (index < blocks.length - 1) {
              focusBlock(index + 1)
            }
            return
          }
        } else if (event.key === 'ArrowUp') {
          if (region === 'block') {
            if (index > 0) {
              focusBlock(index - 1)
              return
            }
            if (index === 0 && triggers.length > 0) {
              focusTrigger(triggers.length - 1)
            }
            return
          }

          if (region === 'trigger') {
            if (index > 0) {
              focusTrigger(index - 1)
              return
            }
            if (index === 0) {
              focusSearchInput()
            }
            return
          }

          if (region === 'none' || region === 'search') {
            return
          }
        }
      }

      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isActive, isSearchActive])

    return (
      <div
        ref={rootRef}
        data-toolbar-root
        data-search-active={isSearchActive ? 'true' : 'false'}
        className='flex h-full flex-col'
      >
        {/* Header */}
        <div
          className='mx-[-1px] flex flex-shrink-0 cursor-pointer items-center justify-between rounded-[4px] border border-[var(--border)] bg-[var(--surface-4)] px-[12px] py-[6px]'
          onClick={handleSearchClick}
        >
          <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>Toolbar</h2>
          <div className='flex shrink-0 items-center gap-[8px]'>
            {!isSearchActive ? (
              <Button
                variant='ghost'
                className='p-0'
                aria-label='Search toolbar'
                onClick={handleSearchClick}
              >
                <Search className='h-[14px] w-[14px]' />
              </Button>
            ) : (
              <input
                ref={searchInputRef}
                type='text'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onBlur={handleSearchBlur}
                className='w-full border-none bg-transparent pr-[2px] text-right font-medium text-[13px] text-[var(--text-primary)] placeholder:text-[#737373] focus:outline-none'
              />
            )}
          </div>
        </div>

        <div ref={containerRef} className='flex flex-1 flex-col overflow-hidden pt-[0px]'>
          {/* Triggers Section */}
          <div
            className={clsx(
              'triggers-section flex flex-col overflow-hidden',
              isToggling && !isResizing && 'transition-100ms transition-[height]'
            )}
            style={{ height: 'var(--toolbar-triggers-height)' }}
            onTransitionEnd={handleTransitionEnd}
          >
            <div
              ref={triggersHeaderRef}
              className='px-[10px] pt-[5px] pb-[5px] font-medium text-[13px] text-[var(--text-primary)]'
            >
              Triggers
            </div>
            <div className='flex-1 overflow-y-auto overflow-x-hidden px-[6px]'>
              <div ref={triggersContentRef} className='space-y-[2px] pb-[8px]'>
                {filteredTriggers.map((trigger, index) => (
                  <ToolbarItem
                    key={trigger.type}
                    item={trigger}
                    isTrigger={true}
                    onDragStart={handleDragStart}
                    onClick={handleItemClick}
                    onContextMenu={handleItemContextMenu}
                    itemRef={getTriggerRefCallback(index)}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Resize Handle */}
          <div className='relative flex-shrink-0 border-[var(--border)] border-t'>
            <div
              className='absolute top-[-4px] right-0 left-0 z-30 h-[8px] cursor-ns-resize'
              onMouseDown={handleMouseDown}
            />
          </div>

          {/* Blocks Section */}
          <div className='blocks-section flex flex-1 flex-col overflow-hidden'>
            <div
              ref={blocksHeaderRef}
              onClick={handleBlocksHeaderClick}
              className='cursor-pointer px-[10px] pt-[5px] pb-[5px] font-medium text-[13px] text-[var(--text-primary)]'
            >
              Blocks
            </div>
            <div className='flex-1 overflow-y-auto overflow-x-hidden px-[6px]'>
              <div className='space-y-[2px] pb-[8px]'>
                {filteredBlocks.map((block, index) => (
                  <ToolbarItem
                    key={block.type}
                    item={block}
                    isTrigger={false}
                    onDragStart={handleDragStart}
                    onClick={handleItemClick}
                    onContextMenu={handleItemContextMenu}
                    itemRef={getBlockRefCallback(index)}
                  />
                ))}
              </div>
            </div>
          </div>
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
