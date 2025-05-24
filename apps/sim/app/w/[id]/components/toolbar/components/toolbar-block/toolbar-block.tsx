import { useCallback } from 'react'
import type { BlockConfig } from '@/blocks/types'

export type ToolbarBlockProps = {
  config: BlockConfig
}

export function ToolbarBlock({ config }: ToolbarBlockProps) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ type: config.type }))
    e.dataTransfer.effectAllowed = 'move'
  }

  // Handle click to add block
  const handleClick = useCallback(() => {
    if (config.type === 'connectionBlock') return

    // Dispatch a custom event to be caught by the workflow component
    const event = new CustomEvent('add-block-from-toolbar', {
      detail: {
        type: config.type,
      },
    })
    window.dispatchEvent(event)
  }, [config.type])

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      className='group flex cursor-pointer items-center gap-3 rounded-lg border bg-card p-3.5 shadow-sm transition-colors hover:bg-accent/50 active:cursor-grabbing'
    >
      <div
        className='relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg'
        style={{ backgroundColor: config.bgColor }}
      >
        <config.icon
          className={`text-white transition-transform duration-200 group-hover:scale-110 ${
            config.type === 'agent' ? 'h-[24px] w-[24px]' : 'h-[22px] w-[22px]'
          }`}
        />
      </div>
      <div className='mb-[-2px] flex flex-col gap-1'>
        <h3 className='font-medium leading-none'>{config.name}</h3>
        <p className='text-muted-foreground text-sm leading-snug'>{config.description}</p>
      </div>
    </div>
  )
}
