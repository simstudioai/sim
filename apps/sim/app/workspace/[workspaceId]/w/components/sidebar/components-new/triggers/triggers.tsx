'use client'

import { useMemo, useRef } from 'react'
import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/emcn/components/button'
import { getTriggersForSidebar, hasTriggerCapability } from '@/lib/workflows/trigger-utils'
import { usePanelResize } from '../../hooks/use-panel-resize'
import { useSidebarItemInteractions } from '../../hooks/use-sidebar-item-interactions'

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
  const { handleMouseDown, handleToggle, isCollapsed } = usePanelResize({
    panelType: 'triggers',
    containerRef,
  })

  // Sidebar item interactions hook
  const { handleDragStart, handleItemClick } = useSidebarItemInteractions({ disabled })

  const triggers = useMemo(() => {
    const allTriggers = getTriggersForSidebar()

    // Sort alphabetically
    return allTriggers.sort((a, b) => a.name.localeCompare(b.name))
  }, [])

  return (
    <div
      ref={containerRef}
      className='triggers-container absolute right-0 bottom-0 left-0 z-10 flex flex-col border-[#2C2C2C] border-t bg-[#1E1E1E] dark:border-[#2C2C2C] dark:bg-[#1E1E1E]'
    >
      <div
        className='absolute top-[-4px] right-0 left-0 z-20 h-[8px] cursor-ns-resize'
        onMouseDown={handleMouseDown}
      />
      <Button
        variant='ghost'
        className='hover:!text-[#787878] dark:hover:!text-[#787878] flex w-full flex-shrink-0 cursor-pointer items-center justify-between rounded-[0px] p-0 px-[10px] pt-[3px] pb-[5px]'
        onClick={handleToggle}
      >
        <div className='font-medium text-[#AEAEAE] text-small dark:text-[#AEAEAE]'>Triggers</div>
        <ChevronDown
          className={clsx('h-[12px] w-[12px]', !isCollapsed && 'rotate-180 transition-all')}
          aria-hidden='true'
        />
      </Button>

      <div className='triggers-scrollable flex-1 overflow-y-auto overflow-x-hidden px-[8px]'>
        <div className='space-y-[4px] pb-[8px]'>
          {triggers.map((trigger) => {
            const Icon = trigger.icon
            return (
              <div
                key={trigger.type}
                draggable={!disabled}
                onDragStart={(e) => handleDragStart(e, trigger.type, hasTriggerCapability(trigger))}
                onClick={() => handleItemClick(trigger.type, hasTriggerCapability(trigger))}
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
