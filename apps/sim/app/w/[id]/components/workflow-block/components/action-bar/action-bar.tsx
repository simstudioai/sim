import { ArrowLeftRight, ArrowUpDown, Circle, CircleOff, Copy, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface ActionBarProps {
  blockId: string
  blockType: string
  disabled?: boolean
}

export function ActionBar({ blockId, blockType, disabled = false }: ActionBarProps) {
  const removeBlock = useWorkflowStore((state) => state.removeBlock)
  const toggleBlockEnabled = useWorkflowStore((state) => state.toggleBlockEnabled)
  const toggleBlockHandles = useWorkflowStore((state) => state.toggleBlockHandles)
  const duplicateBlock = useWorkflowStore((state) => state.duplicateBlock)
  const isEnabled = useWorkflowStore((state) => state.blocks[blockId]?.enabled ?? true)
  const horizontalHandles = useWorkflowStore(
    (state) => state.blocks[blockId]?.horizontalHandles ?? false
  )

  const isStarterBlock = blockType === 'starter'

  return (
    <div
      className={cn(
        '-right-20 absolute top-0',
        'flex flex-col items-center gap-2 p-2',
        'rounded-md border border-gray-200 bg-background shadow-sm dark:border-gray-800',
        'opacity-0 transition-opacity duration-200 group-hover:opacity-100'
      )}
    >
      {/* <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(
              isEnabled
                ? 'bg-[#802FFF] hover:bg-[#802FFF]/90'
                : 'bg-gray-400 hover:bg-gray-400 cursor-not-allowed'
            )}
            size="sm"
            disabled={!isEnabled}
          >
            <Play fill="currentColor" className="!h-3.5 !w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Run Block</TooltipContent>
      </Tooltip> */}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => {
              if (!disabled) {
                toggleBlockEnabled(blockId)
              }
            }}
            className={cn('text-gray-500', disabled && 'cursor-not-allowed opacity-50')}
            disabled={disabled}
          >
            {isEnabled ? <Circle className='h-4 w-4' /> : <CircleOff className='h-4 w-4' />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side='right'>
          {disabled ? 'Read-only mode' : isEnabled ? 'Disable Block' : 'Enable Block'}
        </TooltipContent>
      </Tooltip>

      {!isStarterBlock && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                if (!disabled) {
                  duplicateBlock(blockId)
                }
              }}
              className={cn('text-gray-500', disabled && 'cursor-not-allowed opacity-50')}
              disabled={disabled}
            >
              <Copy className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='right'>
            {disabled ? 'Read-only mode' : 'Duplicate Block'}
          </TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => {
              if (!disabled) {
                toggleBlockHandles(blockId)
              }
            }}
            className={cn('text-gray-500', disabled && 'cursor-not-allowed opacity-50')}
            disabled={disabled}
          >
            {horizontalHandles ? (
              <ArrowLeftRight className='h-4 w-4' />
            ) : (
              <ArrowUpDown className='h-4 w-4' />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side='right'>
          {disabled ? 'Read-only mode' : horizontalHandles ? 'Vertical Ports' : 'Horizontal Ports'}
        </TooltipContent>
      </Tooltip>

      {!isStarterBlock && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                if (!disabled) {
                  removeBlock(blockId)
                }
              }}
              className={cn(
                'text-gray-500 hover:text-red-600',
                disabled && 'cursor-not-allowed opacity-50 hover:text-gray-500'
              )}
              disabled={disabled}
            >
              <Trash2 className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='right'>
            {disabled ? 'Read-only mode' : 'Delete Block'}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
