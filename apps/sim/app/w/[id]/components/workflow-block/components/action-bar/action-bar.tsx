import { ArrowLeftRight, ArrowUpDown, Circle, CircleOff, Copy, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface ActionBarProps {
  blockId: string
  blockType: string
}

export function ActionBar({ blockId, blockType }: ActionBarProps) {
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
            onClick={() => toggleBlockEnabled(blockId)}
            className='text-gray-500'
          >
            {isEnabled ? <Circle className='h-4 w-4' /> : <CircleOff className='h-4 w-4' />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side='right'>{isEnabled ? 'Disable Block' : 'Enable Block'}</TooltipContent>
      </Tooltip>

      {!isStarterBlock && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => duplicateBlock(blockId)}
              className='text-gray-500'
            >
              <Copy className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='right'>Duplicate Block</TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => toggleBlockHandles(blockId)}
            className='text-gray-500'
          >
            {horizontalHandles ? (
              <ArrowLeftRight className='h-4 w-4' />
            ) : (
              <ArrowUpDown className='h-4 w-4' />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side='right'>
          {horizontalHandles ? 'Vertical Ports' : 'Horizontal Ports'}
        </TooltipContent>
      </Tooltip>

      {!isStarterBlock && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => removeBlock(blockId)}
              className='text-gray-500 hover:text-red-600'
            >
              <Trash2 className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='right'>Delete Block</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
