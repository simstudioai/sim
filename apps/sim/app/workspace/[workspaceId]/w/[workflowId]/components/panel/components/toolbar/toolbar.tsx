'use client'

import {
  forwardRef,
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
} from '@/lib/workflows/trigger-utils'
import { LoopTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/loop/loop-config'
import { ParallelTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-config'
import type { BlockConfig } from '@/blocks/types'
import { useToolbarStore } from '@/stores/panel/toolbar/store'
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
 * Gets triggers data, computing it once and caching for subsequent calls.
 * Non-integration triggers (Start, Schedule, Webhook) are prioritized first,
 * followed by all other triggers sorted alphabetically.
 */
function getTriggers() {
  if (cachedTriggers === null) {
    const allTriggers = getTriggersForSidebar()
    const priorityOrder = ['Start', 'Schedule', 'Webhook']

    cachedTriggers = allTriggers.sort((a, b) => {
      const aIndex = priorityOrder.indexOf(a.name)
      const bIndex = priorityOrder.indexOf(b.name)
      const aHasPriority = aIndex !== -1
      const bHasPriority = bIndex !== -1

      if (aHasPriority && bHasPriority) return aIndex - bIndex
      if (aHasPriority) return -1
      if (bHasPriority) return 1
      return a.name.localeCompare(b.name)
    })
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

export const Toolbar = forwardRef<ToolbarRef, ToolbarProps>(function Toolbar(
  { isActive = true }: ToolbarProps,
  ref
) {
  const rootRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggersContentRef = useRef<HTMLDivElement>(null)
  const triggersHeaderRef = useRef<HTMLDivElement>(null)
  const blocksHeaderRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const triggerItemRefs = useRef<Array<HTMLDivElement | null>>([])
  const blockItemRefs = useRef<Array<HTMLDivElement | null>>([])

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
   * Expose imperative handle for focusing the search input.
   */
  useImperativeHandle(
    ref,
    () => ({
      focusSearch: () => {
        setIsSearchActive(true)
        // Use microtask to ensure input is present before focusing
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
   * We intentionally keep search mode active after blur so that ArrowUp/Down
   * navigation continues to work after the first move from the search input
   * into the triggers/blocks list (e.g. when initiated via Mod+F).
   */
  const handleSearchBlur = () => {
    // No-op by design
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
          // Let ArrowUp behave normally when nothing in the toolbar is focused
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
        className='flex flex-shrink-0 cursor-pointer items-center justify-between rounded-[4px] bg-[#2A2A2A] px-[12px] py-[8px] dark:bg-[#2A2A2A]'
        onClick={handleSearchClick}
      >
        <h2 className='font-medium text-[14px] text-[var(--white)] dark:text-[var(--white)]'>
          Toolbar
        </h2>
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
              className='w-full border-none bg-transparent pr-[2px] text-right font-medium text-[13px] text-[var(--text-primary)] placeholder:text-[#737373] focus:outline-none dark:text-[var(--text-primary)]'
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
            className='px-[10px] pt-[5px] pb-[5px] font-medium text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'
          >
            Triggers
          </div>
          <div className='flex-1 overflow-y-auto overflow-x-hidden px-[6px]'>
            <div ref={triggersContentRef} className='space-y-[4px] pb-[8px]'>
              {filteredTriggers.map((trigger, index) => {
                const Icon = trigger.icon
                const isTriggerCapable = hasTriggerCapability(trigger)
                return (
                  <div
                    ref={(el) => {
                      triggerItemRefs.current[index] = el
                    }}
                    key={trigger.type}
                    tabIndex={-1}
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
                      'cursor-pointer hover:bg-[var(--border)] active:cursor-grabbing dark:hover:bg-[var(--border)]',
                      'focus-visible:bg-[var(--border)] focus-visible:outline-none dark:focus-visible:bg-[var(--border)]'
                    )}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        event.stopPropagation()
                        handleItemClick(trigger.type, isTriggerCapable)
                      }
                    }}
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
                        'text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)] dark:text-[var(--text-tertiary)] dark:group-hover:text-[var(--text-primary)]',
                        'group-focus-visible:text-[var(--text-primary)] dark:group-focus-visible:text-[var(--text-primary)]'
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
        <div className='relative flex-shrink-0 border-[var(--border)] border-t dark:border-[var(--border)]'>
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
            className='cursor-pointer px-[10px] pt-[5px] pb-[5px] font-medium text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'
          >
            Blocks
          </div>
          <div className='flex-1 overflow-y-auto overflow-x-hidden px-[6px]'>
            <div className='space-y-[4px] pb-[8px]'>
              {filteredBlocks.map((block, index) => {
                const Icon = block.icon
                return (
                  <div
                    ref={(el) => {
                      blockItemRefs.current[index] = el
                    }}
                    key={block.type}
                    tabIndex={-1}
                    draggable
                    onDragStart={(e) => {
                      // Mark subflow drag explicitly so canvas can reliably detect and suppress highlight
                      if (block.type === 'loop' || block.type === 'parallel') {
                        document.body.classList.add('sim-drag-subflow')
                      }
                      const iconElement = e.currentTarget.querySelector('.toolbar-item-icon')
                      handleDragStart(e, block.type, false, {
                        name: block.name,
                        bgColor: block.bgColor ?? '#666666',
                        iconElement: iconElement as HTMLElement | null,
                      })
                    }}
                    onDragEnd={() => {
                      // Always clear the flag at the end of a toolbar drag
                      document.body.classList.remove('sim-drag-subflow')
                    }}
                    onClick={() => handleItemClick(block.type, false)}
                    className={clsx(
                      'group flex h-[25px] items-center gap-[8px] rounded-[8px] px-[5.5px] text-[14px]',
                      'cursor-pointer hover:bg-[var(--border)] active:cursor-grabbing dark:hover:bg-[var(--border)]',
                      'focus-visible:bg-[var(--border)] focus-visible:outline-none dark:focus-visible:bg-[var(--border)]'
                    )}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        event.stopPropagation()
                        handleItemClick(block.type, false)
                      }
                    }}
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
                        'text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)] dark:text-[var(--text-tertiary)] dark:group-hover:text-[var(--text-primary)]',
                        'group-focus-visible:text-[var(--text-primary)] dark:group-focus-visible:text-[var(--text-primary)]'
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
})
