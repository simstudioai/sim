'use client'

import { useCallback } from 'react'
import { getBlock } from '@/blocks/registry'

interface ExerciseToolbarProps {
  /** Block type IDs available in this exercise */
  availableBlocks: string[]
}

/**
 * Constrained block palette for sandbox exercises.
 * Shows only the blocks listed in availableBlocks and supports drag-to-canvas.
 */
export function ExerciseToolbar({ availableBlocks }: ExerciseToolbarProps) {
  const handleDragStart = useCallback((e: React.DragEvent, blockType: string) => {
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({ type: blockType, enableTriggerMode: false })
    )
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const blocks = availableBlocks
    .map((type) => ({ type, config: getBlock(type) }))
    .filter(
      (b): b is { type: string; config: NonNullable<ReturnType<typeof getBlock>> } =>
        b.config !== undefined
    )

  if (blocks.length === 0) return null

  return (
    <div className='flex w-[72px] flex-shrink-0 flex-col items-center gap-2 border-[#2A2A2A] border-r bg-[#141414] py-3'>
      <span className='mb-1 font-[430] text-[#555] text-[9px] uppercase tracking-[0.12em]'>
        Blocks
      </span>
      {blocks.map(({ type, config }) => {
        const Icon = config.icon
        return (
          <div
            key={type}
            draggable
            onDragStart={(e) => handleDragStart(e, type)}
            className='flex cursor-grab flex-col items-center gap-1.5 rounded-[6px] p-2 transition-colors hover:bg-[#222] active:cursor-grabbing'
            title={config.name}
          >
            <div
              className='flex h-8 w-8 items-center justify-center rounded-[6px]'
              style={{ backgroundColor: config.bgColor ?? '#3972F6' }}
            >
              <Icon className='h-4 w-4 text-white' />
            </div>
            <span className='max-w-[60px] truncate text-center text-[#666] text-[9px]'>
              {config.name}
            </span>
          </div>
        )
      })}
    </div>
  )
}
