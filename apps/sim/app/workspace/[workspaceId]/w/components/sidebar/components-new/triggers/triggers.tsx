'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { getTriggersForSidebar, hasTriggerCapability } from '@/lib/workflows/trigger-utils'
import type { BlockConfig } from '@/blocks/types'
import { useSidebarStore } from '@/stores/sidebar/store'

interface TriggersProps {
  disabled?: boolean
}

/**
 * Constants for triggers panel sizing
 */
const DEFAULT_HEIGHT = 200
const MIN_HEIGHT = 28
const HEADER_HEIGHT = 28

export function Triggers({ disabled = false }: TriggersProps) {
  const [isResizing, setIsResizing] = useState(false)
  const { triggersHeight, setTriggersHeight, setBlocksHeight } = useSidebarStore()
  const startYRef = useRef<number>(0)
  const startHeightRef = useRef<number>(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const triggers = useMemo(() => {
    const allTriggers = getTriggersForSidebar()

    // Sort alphabetically
    return allTriggers.sort((a, b) => a.name.localeCompare(b.name))
  }, [])

  const handleDragStart = (e: React.DragEvent, config: BlockConfig) => {
    if (disabled) {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: config.type,
        enableTriggerMode: hasTriggerCapability(config),
      })
    )
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleClick = (config: BlockConfig) => {
    if (config.type === 'connectionBlock' || disabled) return

    const event = new CustomEvent('add-block-from-toolbar', {
      detail: {
        type: config.type,
        enableTriggerMode: hasTriggerCapability(config),
      },
    })
    window.dispatchEvent(event)
  }

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsResizing(true)
    startYRef.current = e.clientY
    const currentHeight = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--triggers-height')
    )
    startHeightRef.current = currentHeight
  }, [])

  const handleToggle = useCallback(() => {
    const currentBlocksHeight = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--blocks-height')
    )

    // Calculate the minimum allowed height for triggers based on current blocks height
    const minAllowedHeight = currentBlocksHeight + HEADER_HEIGHT

    // Check if triggers is at its minimum (collapsed/stacked) - either MIN_HEIGHT or at blocks constraint
    const isCollapsed =
      Math.abs(triggersHeight - minAllowedHeight) <= 2 || triggersHeight <= MIN_HEIGHT

    if (isCollapsed) {
      // Expanding: show DEFAULT_HEIGHT of visible triggers content above blocks
      // Total height = blocks height + header + visible triggers area
      const targetHeight = minAllowedHeight + DEFAULT_HEIGHT

      if (containerRef.current?.parentElement) {
        const parentHeight = containerRef.current.parentElement.getBoundingClientRect().height
        setTriggersHeight(Math.min(targetHeight, parentHeight))
      } else {
        setTriggersHeight(targetHeight)
      }
    } else {
      // Collapsing: collapse to minimum while respecting blocks constraint
      if (currentBlocksHeight <= MIN_HEIGHT) {
        // Blocks is collapsed, so we can fully collapse triggers
        setTriggersHeight(MIN_HEIGHT)
      } else {
        // Blocks is expanded, so collapse triggers to just accommodate blocks
        setTriggersHeight(minAllowedHeight)
      }
    }
  }, [triggersHeight, setTriggersHeight])

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
        const currentBlocksHeight = Number.parseInt(
          getComputedStyle(document.documentElement).getPropertyValue('--blocks-height')
        )
        const currentTriggersHeight = Number.parseInt(
          getComputedStyle(document.documentElement).getPropertyValue('--triggers-height')
        )

        const minAllowedHeight = currentBlocksHeight + HEADER_HEIGHT
        const isShrinkingTriggers = deltaY < 0

        // Special case: if triggers is fully collapsed (at MIN_HEIGHT) and user is shrinking triggers
        // then shrink blocks together (similar to blocks expanding triggers when at max)
        const isFullyCollapsed = Math.abs(currentTriggersHeight - minAllowedHeight) <= 2

        if (isFullyCollapsed && isShrinkingTriggers && currentBlocksHeight > MIN_HEIGHT) {
          // Calculate the reduction amount
          const requestedReduction = currentTriggersHeight - newHeight

          // Shrink blocks by the same amount (but not below MIN_HEIGHT)
          const newBlocksHeight = Math.max(currentBlocksHeight - requestedReduction, MIN_HEIGHT)
          setBlocksHeight(newBlocksHeight)

          // Now set triggers height with updated blocks constraint
          const updatedMinAllowedHeight = newBlocksHeight + HEADER_HEIGHT
          newHeight = Math.min(newHeight, parentHeight)
          newHeight = Math.max(newHeight, updatedMinAllowedHeight, MIN_HEIGHT)
        } else {
          // Normal behavior: constrain triggers based on current blocks height
          newHeight = Math.min(newHeight, parentHeight)
          newHeight = Math.max(newHeight, minAllowedHeight, MIN_HEIGHT)
        }
      }

      setTriggersHeight(newHeight)
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
  }, [isResizing, setTriggersHeight, setBlocksHeight])

  return (
    <div
      ref={containerRef}
      className='triggers-container absolute right-0 bottom-0 left-0 z-10 flex flex-col border-[#2C2C2C] border-t bg-[#1E1E1E] dark:border-[#2C2C2C] dark:bg-[#1E1E1E]'
    >
      <div
        className='absolute top-[-4px] right-0 left-0 z-20 h-[8px] cursor-ns-resize'
        onMouseDown={handleMouseDown}
      />
      <div
        className='flex-shrink-0 cursor-pointer px-[14px] pt-[3px] pb-[5px]'
        onClick={handleToggle}
      >
        <div className='font-medium text-[#AEAEAE] text-small dark:text-[#AEAEAE]'>Triggers</div>
      </div>

      <div className='triggers-scrollable flex-1 overflow-y-auto overflow-x-hidden px-[8px]'>
        <div className='space-y-[4px] pb-[8px]'>
          {triggers.map((trigger) => {
            const Icon = trigger.icon
            return (
              <div
                key={trigger.type}
                draggable={!disabled}
                onDragStart={(e) => handleDragStart(e, trigger)}
                onClick={() => handleClick(trigger)}
                className={clsx(
                  'group flex h-[25px] items-center gap-[8px] rounded-[8px] px-[5px] text-[14px]',
                  disabled
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-pointer hover:bg-[#2C2C2C] active:cursor-grabbing dark:hover:bg-[#2C2C2C]'
                )}
              >
                <div
                  className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
                  style={{ backgroundColor: trigger.bgColor }}
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
                  {trigger.name}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
