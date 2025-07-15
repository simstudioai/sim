import { useCallback } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/w/components/providers/workspace-permissions-provider'
import { ParallelTool } from '../../../../../../[workflowId]/components/parallel-node/parallel-config'

type ParallelToolbarItemProps = {
  disabled?: boolean
}

// Custom component for the Parallel Tool
export default function ParallelToolbarItem({ disabled = false }: ParallelToolbarItemProps) {
  const userPermissions = useUserPermissionsContext()
  const handleDragStart = (e: React.DragEvent) => {
    if (disabled) {
      e.preventDefault()
      return
    }
    // Only send the essential data for the parallel node
    const simplifiedData = {
      type: 'parallel',
    }
    e.dataTransfer.setData('application/json', JSON.stringify(simplifiedData))
    e.dataTransfer.effectAllowed = 'move'
  }

  // Handle click to add parallel block
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return

      // Dispatch a custom event to be caught by the workflow component
      const event = new CustomEvent('add-block-from-toolbar', {
        detail: {
          type: 'parallel',
          clientX: e.clientX,
          clientY: e.clientY,
        },
        bubbles: true,
      })
      window.dispatchEvent(event)
    },
    [disabled]
  )

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
        style={{ backgroundColor: ParallelTool.bgColor }}
      >
        <ParallelTool.icon
          className={cn(
            'h-[14px] w-[14px] text-white transition-transform duration-200',
            !disabled && 'group-hover:scale-110'
          )}
        />
      </div>
      <span className='font-medium text-sm leading-none'>{ParallelTool.name}</span>
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
