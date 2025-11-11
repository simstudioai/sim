import { memo, useCallback } from 'react'
import { ArrowLeftRight, ArrowUpDown, Circle, CircleOff, LogOut, Play } from 'lucide-react'
import { Button, Duplicate, Tooltip, Trash2 } from '@/components/emcn'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * Props for the ActionBar component
 */
interface ActionBarProps {
  /** Unique identifier for the block */
  blockId: string
  /** Type of the block */
  blockType: string
  /** Whether the action bar is disabled */
  disabled?: boolean
  /** Whether an execution is currently in progress */
  isExecuting?: boolean
  /** Handler to run the workflow starting from this block */
  onRunFromBlock?: (blockId: string) => Promise<any> | void
}

/**
 * ActionBar component displays action buttons for workflow blocks
 * Provides controls for enabling/disabling, duplicating, removing, and toggling block handles
 *
 * @component
 */
export const ActionBar = memo(
  function ActionBar({
    blockId,
    blockType,
    disabled = false,
    isExecuting = false,
    onRunFromBlock,
  }: ActionBarProps) {
    const {
      collaborativeRemoveBlock,
      collaborativeToggleBlockEnabled,
      collaborativeDuplicateBlock,
      collaborativeToggleBlockHandles,
    } = useCollaborativeWorkflow()

    /**
     * Optimized single store subscription for all block data
     */
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

    /**
     * Get appropriate tooltip message based on disabled state
     *
     * @param defaultMessage - The default message to show when not disabled
     * @returns The tooltip message
     */
    const getTooltipMessage = (defaultMessage: string) => {
      if (disabled) {
        return userPermissions.isOfflineMode ? 'Connection lost - please refresh' : 'Read-only mode'
      }
      return defaultMessage
    }

    const canRunFromBlock = !disabled && !isExecuting && Boolean(onRunFromBlock)

    return (
      <div
        className={cn(
          '-right-20 absolute top-0',
          'flex flex-col items-center',
          'opacity-0 transition-opacity duration-200 group-hover:opacity-100',
          'gap-[6px] rounded-[10px] bg-[#242424] p-[6px]'
        )}
      >
        {onRunFromBlock && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={() => {
                  if (canRunFromBlock) {
                    onRunFromBlock?.(blockId)
                  }
                }}
                className='h-[30px] w-[30px] rounded-[8px] bg-[#363636] p-0 text-[#868686] hover:bg-[#33B4FF] hover:text-[#1B1B1B] dark:text-[#868686] dark:hover:bg-[#33B4FF] dark:hover:text-[#1B1B1B]'
                disabled={!canRunFromBlock}
              >
                <Play className='h-[14px] w-[14px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='right'>{getTooltipMessage('Run From Here')}</Tooltip.Content>
          </Tooltip.Root>
        )}

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              onClick={() => {
                if (!disabled) {
                  collaborativeToggleBlockEnabled(blockId)
                }
              }}
              className='h-[30px] w-[30px] rounded-[8px] bg-[#363636] p-0 text-[#868686] hover:bg-[#33B4FF] hover:text-[#1B1B1B] dark:text-[#868686] dark:hover:bg-[#33B4FF] dark:hover:text-[#1B1B1B]'
              disabled={disabled}
            >
              {isEnabled ? (
                <Circle className='h-[14px] w-[14px]' />
              ) : (
                <CircleOff className='h-[14px] w-[14px]' />
              )}
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
                onClick={() => {
                  if (!disabled) {
                    collaborativeDuplicateBlock(blockId)
                  }
                }}
                className='h-[30px] w-[30px] rounded-[8px] bg-[#363636] p-0 text-[#868686] hover:bg-[#33B4FF] hover:text-[#1B1B1B] dark:text-[#868686] dark:hover:bg-[#33B4FF] dark:hover:text-[#1B1B1B]'
                disabled={disabled}
              >
                <Duplicate className='h-[14px] w-[14px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='right'>{getTooltipMessage('Duplicate Block')}</Tooltip.Content>
          </Tooltip.Root>
        )}

        {!isStarterBlock && parentId && (parentType === 'loop' || parentType === 'parallel') && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={() => {
                  if (!disabled && userPermissions.canEdit) {
                    window.dispatchEvent(
                      new CustomEvent('remove-from-subflow', { detail: { blockId } })
                    )
                  }
                }}
                className='h-[30px] w-[30px] rounded-[8px] bg-[#363636] p-0 text-[#868686] hover:bg-[#33B4FF] hover:text-[#1B1B1B] dark:text-[#868686] dark:hover:bg-[#33B4FF] dark:hover:text-[#1B1B1B]'
                disabled={disabled || !userPermissions.canEdit}
              >
                <LogOut className='h-[14px] w-[14px]' />
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
              onClick={() => {
                if (!disabled) {
                  collaborativeToggleBlockHandles(blockId)
                }
              }}
              className='h-[30px] w-[30px] rounded-[8px] bg-[#363636] p-0 text-[#868686] hover:bg-[#33B4FF] hover:text-[#1B1B1B] dark:text-[#868686] dark:hover:bg-[#33B4FF] dark:hover:text-[#1B1B1B]'
              disabled={disabled}
            >
              {horizontalHandles ? (
                <ArrowLeftRight className='h-[14px] w-[14px]' />
              ) : (
                <ArrowUpDown className='h-[14px] w-[14px]' />
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
                onClick={() => {
                  if (!disabled) {
                    collaborativeRemoveBlock(blockId)
                  }
                }}
                className='h-[30px] w-[30px] rounded-[8px] bg-[#363636] p-0 text-[#868686] hover:bg-[#33B4FF] hover:text-[#1B1B1B] dark:text-[#868686] dark:hover:bg-[#33B4FF] dark:hover:text-[#1B1B1B]'
                disabled={disabled}
              >
                <Trash2 className='h-[14px] w-[14px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='right'>{getTooltipMessage('Delete Block')}</Tooltip.Content>
          </Tooltip.Root>
        )}
      </div>
    )
  },
  /**
   * Custom comparison function for memo optimization
   * Only re-renders if props actually changed
   *
   * @param prevProps - Previous component props
   * @param nextProps - Next component props
   * @returns True if props are equal (should not re-render), false otherwise
   */
  (prevProps, nextProps) => {
    return (
      prevProps.blockId === nextProps.blockId &&
      prevProps.blockType === nextProps.blockType &&
      prevProps.disabled === nextProps.disabled &&
      prevProps.isExecuting === nextProps.isExecuting &&
      prevProps.onRunFromBlock === nextProps.onRunFromBlock
    )
  }
)
