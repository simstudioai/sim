import { useCallback } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/w/components/providers/workspace-permissions-provider'
import type { BlockConfig } from '@/blocks/types'

export type ToolbarBlockProps = {
  config: BlockConfig
  disabled?: boolean
}

export function ToolbarBlock({ config, disabled = false }: ToolbarBlockProps) {
  const userPermissions = useUserPermissionsContext()

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
        'group flex items-center gap-3 rounded-lg p-2 transition-colors',
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'cursor-pointer hover:bg-accent/50 active:cursor-grabbing'
      )}
    >
      <div
        className='relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md'
        style={{ backgroundColor: config.bgColor }}
      >
        <config.icon
          className={cn(
            'text-white transition-transform duration-200',
            !disabled && 'group-hover:scale-110',
            'h-[14px] w-[14px]'
          )}
        />
      </div>
      <span className='font-medium text-sm leading-none'>{config.name}</span>
    </div>
  )

  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{blockContent}</TooltipTrigger>
        <TooltipContent>
          {userPermissions.isOfflineMode
            ? 'Connection lost - please refresh'
            : 'Edit permissions required to add blocks'}
        </TooltipContent>
      </Tooltip>
    )
  }

  return blockContent
}
