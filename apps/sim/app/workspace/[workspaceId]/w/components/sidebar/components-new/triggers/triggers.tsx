'use client'

import { useCallback, useMemo, useRef } from 'react'
import clsx from 'clsx'
import { getTriggersForSidebar, hasTriggerCapability } from '@/lib/workflows/trigger-utils'
import type { BlockConfig } from '@/blocks/types'
import { usePanelResize } from '../../hooks/use-panel-resize'

interface TriggersProps {
  disabled?: boolean
}

/**
 * Triggers panel component displaying available trigger blocks.
 * Uses the panel resize hook for shared resize/toggle functionality.
 *
 * @param props - Component props
 * @returns Triggers panel with resizable functionality
 */
export function Triggers({ disabled = false }: TriggersProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Panel resize hook
  const { handleMouseDown, handleToggle } = usePanelResize({
    panelType: 'triggers',
    containerRef,
  })

  const triggers = useMemo(() => {
    const allTriggers = getTriggersForSidebar()

    // Sort alphabetically
    return allTriggers.sort((a, b) => a.name.localeCompare(b.name))
  }, [])

  /**
   * Handle drag start for trigger blocks
   *
   * @param e - React drag event
   * @param config - Block configuration
   */
  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLElement>, config: BlockConfig) => {
      if (disabled) {
        e.preventDefault()
        return
      }

      try {
        e.dataTransfer.setData(
          'application/json',
          JSON.stringify({
            type: config.type,
            enableTriggerMode: hasTriggerCapability(config),
          })
        )
        e.dataTransfer.effectAllowed = 'move'
      } catch (error) {
        console.error('Failed to set drag data:', error)
      }
    },
    [disabled]
  )

  /**
   * Handle click on trigger block to add to canvas
   *
   * @param config - Block configuration
   */
  const handleClick = useCallback(
    (config: BlockConfig) => {
      if (config.type === 'connectionBlock' || disabled) return

      try {
        const event = new CustomEvent('add-block-from-toolbar', {
          detail: {
            type: config.type,
            enableTriggerMode: hasTriggerCapability(config),
          },
        })
        window.dispatchEvent(event)
      } catch (error) {
        console.error('Failed to dispatch add-block event:', error)
      }
    },
    [disabled]
  )

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
