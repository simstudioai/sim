import { ArrowLeftRight, ArrowUpDown, Circle, CircleOff, Copy, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface ActionBarProps {
  blockId: string
  blockType: string
  disabled?: boolean
}

export function ActionBar({ blockId, blockType, disabled = false }: ActionBarProps) {
  const {
    collaborativeRemoveBlock,
    collaborativeToggleBlockEnabled,
    collaborativeDuplicateBlock,
    collaborativeToggleBlockHandles,
  } = useCollaborativeWorkflow()
  const isEnabled = useWorkflowStore((state) => state.blocks[blockId]?.enabled ?? true)
  const horizontalHandles = useWorkflowStore(
    (state) => state.blocks[blockId]?.horizontalHandles ?? false
  )
  const userPermissions = useUserPermissionsContext()

  const isStarterBlock = blockType === 'starter'

  const getTooltipMessage = (defaultMessage: string) => {
    if (disabled) {
      return userPermissions.isOfflineMode ? 'Connection lost - please refresh' : 'Read-only mode'
    }
    return defaultMessage
  }

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
                collaborativeToggleBlockEnabled(blockId)
              }
            }}
            className={cn('text-gray-500', disabled && 'cursor-not-allowed opacity-50')}
            disabled={disabled}
          >
            {isEnabled ? <Circle className='h-4 w-4' /> : <CircleOff className='h-4 w-4' />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side='right'>
          {getTooltipMessage(isEnabled ? 'Disable Block' : 'Enable Block')}
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
                  collaborativeDuplicateBlock(blockId)
                }
              }}
              className={cn('text-gray-500', disabled && 'cursor-not-allowed opacity-50')}
              disabled={disabled}
            >
              <Copy className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='right'>{getTooltipMessage('Duplicate Block')}</TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => {
              if (!disabled) {
                collaborativeToggleBlockHandles(blockId)
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
          {getTooltipMessage(horizontalHandles ? 'Vertical Ports' : 'Horizontal Ports')}
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
                  collaborativeRemoveBlock(blockId)
                }
              }}
              className={cn(
                'text-gray-500 hover:text-red-600',
                disabled && 'cursor-not-allowed opacity-50'
              )}
              disabled={disabled}
            >
              <Trash2 className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='right'>{getTooltipMessage('Delete Block')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
