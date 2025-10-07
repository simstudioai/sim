'use client'

import { useCallback, useMemo, useRef } from 'react'
import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import { getBlocksForSidebar } from '@/lib/workflows/trigger-utils'
import { LoopTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/loop/loop-config'
import { ParallelTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-config'
import type { BlockConfig } from '@/blocks/types'
import { usePanelResize } from '../../hooks/use-panel-resize'

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
 * Blocks panel component displaying available block types.
 * Uses the panel resize hook for shared resize/toggle functionality.
 *
 * @param props - Component props
 * @returns Blocks panel with resizable functionality
 */
export function Blocks({ disabled = false }: BlocksProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Panel resize hook
  const { handleMouseDown, handleToggle, isCollapsed } = usePanelResize({
    panelType: 'blocks',
    containerRef,
  })

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

  /**
   * Handle drag start for block items
   *
   * @param e - React drag event
   * @param item - Block item configuration
   */
  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLElement>, item: BlockItem) => {
      if (disabled) {
        e.preventDefault()
        return
      }

      try {
        e.dataTransfer.setData(
          'application/json',
          JSON.stringify({
            type: item.type,
            enableTriggerMode: false,
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
   * Handle click on block item to add to canvas
   *
   * @param item - Block item configuration
   */
  const handleClick = useCallback(
    (item: BlockItem) => {
      if (item.type === 'connectionBlock' || disabled) return

      try {
        const event = new CustomEvent('add-block-from-toolbar', {
          detail: {
            type: item.type,
            enableTriggerMode: false,
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
      className='blocks-container absolute right-0 bottom-0 left-0 z-20 flex flex-col border-[#2C2C2C] border-t bg-[#1E1E1E] dark:border-[#2C2C2C] dark:bg-[#1E1E1E]'
    >
      <div
        className='absolute top-[-4px] right-0 left-0 z-30 h-[8px] cursor-ns-resize'
        onMouseDown={handleMouseDown}
      />
      <div
        className='flex flex-shrink-0 cursor-pointer items-center justify-between px-[10px] pt-[3px] pb-[5px]'
        onClick={handleToggle}
      >
        <div className='font-medium text-[#AEAEAE] text-small dark:text-[#AEAEAE]'>Blocks</div>
        <ChevronDown
          className={clsx(
            'h-[12px] w-[12px] text-[#787878] transition-all dark:text-[#787878]',
            !isCollapsed && 'rotate-180'
          )}
          aria-hidden='true'
        />
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
