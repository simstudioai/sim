import { useCallback } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { BlockConfig } from '@/blocks/types'

export type ToolbarBlockProps = {
  config: BlockConfig
  disabled?: boolean
}

export function ToolbarBlock({ config, disabled = false }: ToolbarBlockProps) {
  const handleDragStart = (e: React.DragEvent) => {
    if (disabled) {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData('application/json', JSON.stringify({ type: config.type }))
    e.dataTransfer.effectAllowed = 'move'
  }

  // Handle click to add block
  const handleClick = useCallback(() => {
    if (config.type === 'connectionBlock' || disabled) return

    // Dispatch a custom event to be caught by the workflow component
    const event = new CustomEvent('add-block-from-toolbar', {
      detail: {
        type: config.type,
      },
    })
    window.dispatchEvent(event)
  }, [config.type, disabled])

  const blockContent = (
    <div
      draggable={!disabled}
      onDragStart={handleDragStart}
      onClick={handleClick}
      className={cn(
        'group flex items-center gap-3 rounded-lg border bg-card p-3.5 shadow-sm transition-colors',
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'cursor-pointer hover:bg-accent/50 active:cursor-grabbing'
      )}
    >
      <div
        className='relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg'
        style={{ backgroundColor: config.bgColor }}
      >
        <config.icon
          className={cn(
            'text-white transition-transform duration-200',
            !disabled && 'group-hover:scale-110',
            config.type === 'agent' ? 'h-[24px] w-[24px]' : 'h-[22px] w-[22px]'
          )}
        />
      </div>
      <div className='mb-[-2px] flex flex-col gap-1'>
        <h3 className='font-medium leading-none'>{config.name}</h3>
        <p className='text-muted-foreground text-sm leading-snug'>{config.description}</p>
      </div>
    </div>
  )

  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{blockContent}</TooltipTrigger>
        <TooltipContent>Edit permissions required to add blocks</TooltipContent>
      </Tooltip>
    )
  }

  return blockContent
}
