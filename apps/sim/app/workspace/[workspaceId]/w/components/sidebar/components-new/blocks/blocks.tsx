'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { getBlocksForSidebar } from '@/lib/workflows/trigger-utils'
import { LoopTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/loop/loop-config'
import { ParallelTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-config'
import type { BlockConfig } from '@/blocks/types'
import { useSidebarStore } from '@/stores/sidebar/store'

interface BlocksProps {
  disabled?: boolean
}

interface BlockItem {
  name: string
  type: string
  isSpecial: boolean
  config?: BlockConfig
  icon?: any
  bgColor?: string
}

/**
 * Constants for blocks panel sizing
 */
const DEFAULT_HEIGHT = 200
const MIN_HEIGHT = 28
const HEADER_HEIGHT = 28

export function Blocks({ disabled = false }: BlocksProps) {
  const [isResizing, setIsResizing] = useState(false)
  const { blocksHeight, setBlocksHeight, setTriggersHeight } = useSidebarStore()
  const startYRef = useRef<number>(0)
  const startHeightRef = useRef<number>(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const blocks = useMemo(() => {
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

    // Return blocks first, then tools
    return [...regularBlockItems, ...toolItems]
  }, [])

  const handleDragStart = (e: React.DragEvent, item: BlockItem) => {
    if (disabled) {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: item.type,
        enableTriggerMode: false,
      })
    )
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleClick = (item: BlockItem) => {
    if (item.type === 'connectionBlock' || disabled) return

    const event = new CustomEvent('add-block-from-toolbar', {
      detail: {
        type: item.type,
        enableTriggerMode: false,
      },
    })
    window.dispatchEvent(event)
  }

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsResizing(true)
    startYRef.current = e.clientY
    const currentHeight = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--blocks-height')
    )
    startHeightRef.current = currentHeight
  }, [])

  const handleToggle = useCallback(() => {
    if (blocksHeight <= MIN_HEIGHT) {
      // Expanding: set to default height, and ensure triggers has enough space for both sections
      const currentTriggersHeight = Number.parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--triggers-height')
      )

      // Calculate what blocks height we want
      const desiredBlocksHeight = DEFAULT_HEIGHT

      // Calculate minimum triggers height needed to show blocks content
      const minRequiredTriggersHeight = desiredBlocksHeight + HEADER_HEIGHT

      // Calculate ideal triggers height to show both blocks and triggers content reasonably
      // This gives DEFAULT_HEIGHT visible space for triggers content above blocks
      const idealTriggersHeight = desiredBlocksHeight + HEADER_HEIGHT + DEFAULT_HEIGHT

      // If current triggers height is below ideal, expand triggers to show both sections properly
      if (currentTriggersHeight < idealTriggersHeight) {
        if (containerRef.current?.parentElement) {
          const parentHeight = containerRef.current.parentElement.getBoundingClientRect().height
          setTriggersHeight(Math.min(idealTriggersHeight, parentHeight))
        } else {
          setTriggersHeight(idealTriggersHeight)
        }
      }

      // Now expand blocks (store constraints will handle the sizing)
      setBlocksHeight(desiredBlocksHeight)
    } else {
      // Collapsing: simply collapse to minimum
      setBlocksHeight(MIN_HEIGHT)
    }
  }, [blocksHeight, setBlocksHeight, setTriggersHeight])

  /**
   * Setup resize event listeners and body styles when resizing
   * Event handlers are defined inline to avoid stale closure issues
   */
  useEffect(() => {
    if (!isResizing || !containerRef.current) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = startYRef.current - e.clientY
      let newHeight = startHeightRef.current + deltaY

      const parentContainer = containerRef.current?.parentElement
      if (parentContainer) {
        const parentHeight = parentContainer.getBoundingClientRect().height
        const currentTriggersHeight = Number.parseInt(
          getComputedStyle(document.documentElement).getPropertyValue('--triggers-height')
        )
        const currentBlocksHeight = Number.parseInt(
          getComputedStyle(document.documentElement).getPropertyValue('--blocks-height')
        )

        const maxAllowedHeight = currentTriggersHeight - HEADER_HEIGHT

        // Special case: if blocks is at max height and user is expanding blocks (deltaY > 0)
        // then expand both blocks and triggers together
        const isAtMaxHeight = Math.abs(currentBlocksHeight - maxAllowedHeight) <= 2
        const isExpandingBlocks = deltaY > 0

        if (isAtMaxHeight && isExpandingBlocks) {
          // Calculate how much more the user wants to expand
          const requestedIncrease = newHeight - currentBlocksHeight

          // Expand triggers by the same amount (respecting parent height limit)
          const newTriggersHeight = Math.min(
            currentTriggersHeight + requestedIncrease,
            parentHeight
          )
          setTriggersHeight(newTriggersHeight)

          // Blocks will expand proportionally through the store constraint
          setBlocksHeight(newHeight)
        } else {
          // Normal behavior: constrain blocks within current triggers space
          newHeight = Math.min(newHeight, maxAllowedHeight)
          newHeight = Math.max(newHeight, MIN_HEIGHT)
          setBlocksHeight(newHeight)
        }
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, setBlocksHeight, setTriggersHeight])

  return (
    <div
      ref={containerRef}
      className='blocks-container absolute right-0 bottom-0 left-0 z-20 flex flex-col border-[#2C2C2C] border-t bg-[#1E1E1E] dark:border-[#2C2C2C] dark:bg-[#1E1E1E]'
    >
      <div
        className='absolute top-[-4px] right-0 left-0 z-30 h-[8px] cursor-ns-resize'
        onMouseDown={handleMouseDown}
      />
      <div
        className='flex-shrink-0 cursor-pointer px-[14px] pt-[3px] pb-[5px]'
        onClick={handleToggle}
      >
        <div className='font-medium text-[#AEAEAE] text-small dark:text-[#AEAEAE]'>Blocks</div>
      </div>

      <div className='blocks-scrollable flex-1 overflow-y-auto overflow-x-hidden px-[8px]'>
        <div className='space-y-[4px] pb-[8px]'>
          {blocks.map((block) => {
            const Icon = block.icon
            return (
              <div
                key={block.type}
                draggable={!disabled}
                onDragStart={(e) => handleDragStart(e, block)}
                onClick={() => handleClick(block)}
                className={clsx(
                  'group flex h-[25px] items-center gap-[8px] rounded-[8px] px-[5px] text-[14px]',
                  disabled
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-pointer hover:bg-[#2C2C2C] active:cursor-grabbing dark:hover:bg-[#2C2C2C]'
                )}
              >
                <div
                  className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
                  style={{ backgroundColor: block.bgColor }}
                >
                  {Icon && (
                    <Icon
                      className={clsx(
                        'text-white transition-transform duration-200',
                        !disabled && 'group-hover:scale-110',
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
  )
}
