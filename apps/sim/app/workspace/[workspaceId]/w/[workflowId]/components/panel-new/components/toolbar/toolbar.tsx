'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Search } from 'lucide-react'
import { Button } from '@/components/emcn'
import {
  getBlocksForSidebar,
  getTriggersForSidebar,
  hasTriggerCapability,
} from '@/lib/workflows/trigger-utils'
import { LoopTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/loop/loop-config'
import { ParallelTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-config'
import type { BlockConfig } from '@/blocks/types'
import { useToolbarStore } from '@/stores/panel-new/toolbar/store'
import { calculateTriggerHeights, useToolbarItemInteractions, useToolbarResize } from './hooks'

interface BlockItem {
  name: string
  type: string
  isSpecial: boolean
  config?: BlockConfig
  icon?: any
  bgColor?: string
}

/**
 * Cached triggers data - lazy initialized on first access (client-side only)
 */
let cachedTriggers: ReturnType<typeof getTriggersForSidebar> | null = null

/**
 * Gets triggers data, computing it once and caching for subsequent calls
 */
function getTriggers() {
  if (cachedTriggers === null) {
    const allTriggers = getTriggersForSidebar()
    cachedTriggers = allTriggers.sort((a, b) => a.name.localeCompare(b.name))
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
      isSpecial: true,
    })

    regularBlockItems.push({
      name: ParallelTool.name,
      type: ParallelTool.type,
      icon: ParallelTool.icon,
      bgColor: ParallelTool.bgColor,
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

export function Toolbar({ isActive = true }: ToolbarProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const triggersContentRef = useRef<HTMLDivElement>(null)
  const triggersHeaderRef = useRef<HTMLDivElement>(null)
  const blocksHeaderRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Search state
  const [isSearchActive, setIsSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Toggle animation state
  const [isToggling, setIsToggling] = useState(false)

  // Toolbar store
  const { toolbarTriggersHeight, setToolbarTriggersHeight, preSearchHeight, setPreSearchHeight } =
    useToolbarStore()

  // Toolbar item interactions hook
  const { handleDragStart, handleItemClick } = useToolbarItemInteractions({ disabled: false })

  // Toolbar resize hook
  const { handleMouseDown, isResizing } = useToolbarResize({
    containerRef,
    triggersContentRef,
    triggersHeaderRef,
  })

  // Get static data (computed once and cached)
  const triggers = getTriggers()
  const blocks = getBlocks()

  // Determine if triggers are at minimum height (blocks are fully expanded)
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
   * Adjust heights based on search results
   * - If no triggers found, collapse triggers to minimum (expand blocks)
   * - If no blocks found, expand triggers to maximum (collapse blocks)
   * - If triggers are found, dynamically resize to show all filtered triggers without scrolling
   */
  useEffect(() => {
    const hasSearchQuery = searchQuery.trim().length > 0
    const triggersCount = filteredTriggers.length
    const blocksCount = filteredBlocks.length

    // Save pre-search height when search starts
    if (hasSearchQuery && preSearchHeight === null) {
      setPreSearchHeight(toolbarTriggersHeight)
    }

    // Restore pre-search height when search is cleared
    if (!hasSearchQuery && preSearchHeight !== null) {
      setToolbarTriggersHeight(preSearchHeight)
      setPreSearchHeight(null)
      return
    }

    // Adjust heights based on search results
    if (hasSearchQuery) {
      const { minHeight, maxHeight, optimalHeight } = calculateTriggerHeights(
        containerRef,
        triggersContentRef,
        triggersHeaderRef
      )

      if (triggersCount === 0 && blocksCount > 0) {
        // No triggers found - collapse triggers to minimum (expand blocks)
        setToolbarTriggersHeight(minHeight)
      } else if (blocksCount === 0 && triggersCount > 0) {
        // No blocks found - expand triggers to maximum (collapse blocks)
        setToolbarTriggersHeight(maxHeight)
      } else if (triggersCount > 0) {
        // Triggers are present - use optimal height to show all filtered triggers
        setToolbarTriggersHeight(optimalHeight)
      }
    }
  }, [
    searchQuery,
    filteredTriggers.length,
    filteredBlocks.length,
    preSearchHeight,
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
   * Handle search input blur - deactivate search mode if empty
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

  return (
    <div className='flex h-full flex-col'>
      {/* Header */}
      <div
        className='flex flex-shrink-0 cursor-pointer items-center justify-between rounded-[4px] bg-[#2A2A2A] px-[12px] py-[8px] dark:bg-[#2A2A2A]'
        onClick={handleSearchClick}
      >
        <h2 className='font-medium text-[#FFFFFF] text-[14px] dark:text-[#FFFFFF]'>Toolbar</h2>
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
              className='w-full border-none bg-transparent pr-[2px] text-right font-medium text-[#E6E6E6] text-[13px] placeholder:text-[#737373] focus:outline-none dark:text-[#E6E6E6]'
            />
          )}
        </div>
      </div>

      <div ref={containerRef} className='flex flex-1 flex-col overflow-hidden pt-[0px]'>
        {/* Triggers Section */}
        <div
          className={clsx(
            'triggers-section flex flex-col overflow-hidden',
            isToggling && !isResizing && 'transition-[height]'
          )}
          style={{ height: 'var(--toolbar-triggers-height)' }}
          onTransitionEnd={handleTransitionEnd}
        >
          <div
            ref={triggersHeaderRef}
            className='px-[10px] pt-[5px] pb-[5px] font-medium text-[#E6E6E6] text-[13px] dark:text-[#E6E6E6]'
          >
            Triggers
          </div>
          <div className='flex-1 overflow-y-auto overflow-x-hidden px-[6px]'>
            <div ref={triggersContentRef} className='space-y-[4px] pb-[8px]'>
              {filteredTriggers.map((trigger) => {
                const Icon = trigger.icon
                const isTriggerCapable = hasTriggerCapability(trigger)
                return (
                  <div
                    key={trigger.type}
                    draggable
                    onDragStart={(e) => {
                      const iconElement = e.currentTarget.querySelector('.toolbar-item-icon')
                      handleDragStart(e, trigger.type, isTriggerCapable, {
                        name: trigger.name,
                        bgColor: trigger.bgColor,
                        iconElement: iconElement as HTMLElement | null,
                      })
                    }}
                    onClick={() => handleItemClick(trigger.type, isTriggerCapable)}
                    className={clsx(
                      'group flex h-[25px] items-center gap-[8px] rounded-[8px] px-[5px] text-[14px]',
                      'cursor-pointer hover:bg-[#2C2C2C] active:cursor-grabbing dark:hover:bg-[#2C2C2C]'
                    )}
                  >
                    <div
                      className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
                      style={{ backgroundColor: trigger.bgColor }}
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
                        'text-[#AEAEAE] group-hover:text-[#E6E6E6] dark:text-[#AEAEAE] dark:group-hover:text-[#E6E6E6]'
                      )}
                    >
                      {trigger.name}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Resize Handle */}
        <div className='relative flex-shrink-0 border-[#2C2C2C] border-t dark:border-[#2C2C2C]'>
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
            className='cursor-pointer px-[10px] pt-[5px] pb-[5px] font-medium text-[#E6E6E6] text-[13px] dark:text-[#E6E6E6]'
          >
            Blocks
          </div>
          <div className='flex-1 overflow-y-auto overflow-x-hidden px-[6px]'>
            <div className='space-y-[4px] pb-[8px]'>
              {filteredBlocks.map((block) => {
                const Icon = block.icon
                return (
                  <div
                    key={block.type}
                    draggable
                    onDragStart={(e) => {
                      const iconElement = e.currentTarget.querySelector('.toolbar-item-icon')
                      handleDragStart(e, block.type, false, {
                        name: block.name,
                        bgColor: block.bgColor ?? '#666666',
                        iconElement: iconElement as HTMLElement | null,
                      })
                    }}
                    onClick={() => handleItemClick(block.type, false)}
                    className={clsx(
                      'group flex h-[25px] items-center gap-[8px] rounded-[8px] px-[5.5px] text-[14px]',
                      'cursor-pointer hover:bg-[#2C2C2C] active:cursor-grabbing dark:hover:bg-[#2C2C2C]'
                    )}
                  >
                    <div
                      className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
                      style={{ backgroundColor: block.bgColor }}
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
                        'text-[#AEAEAE] group-hover:text-[#E6E6E6] dark:text-[#AEAEAE] dark:group-hover:text-[#E6E6E6]'
                      )}
                    >
                      {block.name}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
