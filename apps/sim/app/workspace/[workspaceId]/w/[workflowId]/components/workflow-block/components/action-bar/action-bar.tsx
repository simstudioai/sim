import { memo, useCallback } from 'react'
import { ArrowLeftRight, ArrowUpDown, Circle, CircleOff, Copy, LogOut, Trash2 } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface ActionBarProps {
  blockId: string
  blockType: string
  disabled?: boolean
}

export const ActionBar = memo(
  function ActionBar({ blockId, blockType, disabled = false }: ActionBarProps) {
    const {
      collaborativeRemoveBlock,
      collaborativeToggleBlockEnabled,
      collaborativeDuplicateBlock,
      collaborativeToggleBlockHandles,
    } = useCollaborativeWorkflow()

    // Optimized: Single store subscription for all block data
    const { isEnabled, horizontalHandles, parentId, parentType } = useWorkflowStore(
      useCallback(
        (state) => {
          const block = state.blocks[blockId]
          const parentId = block?.data?.parentId
          return {
            isEnabled: block?.enabled ?? true,
            horizontalHandles: block?.horizontalHandles ?? false,
            parentId,
            parentType: parentId ? state.blocks[parentId]?.type : undefined,
          }
        },
        [blockId]
      )
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
        {/* <Tooltip.Root>
            <Tooltip.Trigger asChild>
          <Button
            className={cn(
              isEnabled
                ? 'bg-[var(--brand-primary-hover-hex)] hover:bg-[var(--brand-primary-hover-hex)]/90'
                : 'bg-gray-400 hover:bg-gray-400 cursor-not-allowed'
            )}
            size="sm"
            disabled={!isEnabled}
          >
            <Play fill="currentColor" className="!h-3.5 !w-3.5" />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side="right">Run Block</Tooltip.Content>
      </Tooltip.Root> */}

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
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
          </Tooltip.Trigger>
          <Tooltip.Content side='right'>
            {getTooltipMessage(isEnabled ? 'Disable Block' : 'Enable Block')}
          </Tooltip.Content>
        </Tooltip.Root>

        {!isStarterBlock && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
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
            </Tooltip.Trigger>
            <Tooltip.Content side='right'>{getTooltipMessage('Duplicate Block')}</Tooltip.Content>
          </Tooltip.Root>
        )}

        {/* Remove from subflow - only show when inside loop/parallel */}
        {!isStarterBlock && parentId && (parentType === 'loop' || parentType === 'parallel') && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => {
                  if (!disabled && userPermissions.canEdit) {
                    window.dispatchEvent(
                      new CustomEvent('remove-from-subflow', { detail: { blockId } })
                    )
                  }
                }}
                className={cn(
                  'text-gray-500',
                  (disabled || !userPermissions.canEdit) && 'cursor-not-allowed opacity-50'
                )}
                disabled={disabled || !userPermissions.canEdit}
              >
                <LogOut className='h-4 w-4' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='right'>
              {getTooltipMessage('Remove From Subflow')}
            </Tooltip.Content>
          </Tooltip.Root>
        )}

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
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
          </Tooltip.Trigger>
          <Tooltip.Content side='right'>
            {getTooltipMessage(horizontalHandles ? 'Vertical Ports' : 'Horizontal Ports')}
          </Tooltip.Content>
        </Tooltip.Root>

        {!isStarterBlock && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
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
            </Tooltip.Trigger>
            <Tooltip.Content side='right'>{getTooltipMessage('Delete Block')}</Tooltip.Content>
          </Tooltip.Root>
        )}
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Only re-render if props actually changed
    return (
      prevProps.blockId === nextProps.blockId &&
      prevProps.blockType === nextProps.blockType &&
      prevProps.disabled === nextProps.disabled
    )
  }
)
