import { memo, useCallback } from 'react'
import { ArrowLeftRight, ArrowUpDown, Circle, CircleOff, LogOut } from 'lucide-react'
import { Button, Copy, Tooltip, Trash2 } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { getUniqueBlockName, prepareDuplicateBlockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const DEFAULT_DUPLICATE_OFFSET = { x: 50, y: 50 }

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
}

/**
 * ActionBar component displays action buttons for workflow blocks
 * Provides controls for enabling/disabling, duplicating, removing, and toggling block handles
 *
 * @component
 */
export const ActionBar = memo(
  function ActionBar({ blockId, blockType, disabled = false }: ActionBarProps) {
    const {
      collaborativeBatchAddBlocks,
      collaborativeBatchRemoveBlocks,
      collaborativeBatchToggleBlockEnabled,
      collaborativeBatchToggleBlockHandles,
    } = useCollaborativeWorkflow()
    const { activeWorkflowId } = useWorkflowRegistry()
    const blocks = useWorkflowStore((state) => state.blocks)
    const subBlockStore = useSubBlockStore()

    const handleDuplicateBlock = useCallback(() => {
      const sourceBlock = blocks[blockId]
      if (!sourceBlock) return

      const newId = crypto.randomUUID()
      const newName = getUniqueBlockName(sourceBlock.name, blocks)
      const subBlockValues = subBlockStore.workflowValues[activeWorkflowId || '']?.[blockId] || {}

      const { block, subBlockValues: filteredValues } = prepareDuplicateBlockState({
        sourceBlock,
        newId,
        newName,
        positionOffset: DEFAULT_DUPLICATE_OFFSET,
        subBlockValues,
      })

      collaborativeBatchAddBlocks([block], [], {}, {}, { [newId]: filteredValues })
    }, [
      blockId,
      blocks,
      activeWorkflowId,
      subBlockStore.workflowValues,
      collaborativeBatchAddBlocks,
    ])

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

    // Check for start_trigger (unified start block) - prevent duplication but allow deletion
    const isStartBlock = blockType === 'starter' || blockType === 'start_trigger'
    const isNoteBlock = blockType === 'note'

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

    return (
      <div
        className={cn(
          '-top-[46px] absolute right-0',
          'flex flex-row items-center',
          'opacity-0 transition-opacity duration-200 group-hover:opacity-100',
          'gap-[5px] rounded-[10px] bg-[var(--surface-4)] p-[5px]'
        )}
      >
        {!isNoteBlock && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={(e) => {
                  e.stopPropagation()
                  if (!disabled) {
                    collaborativeBatchToggleBlockEnabled([blockId])
                  }
                }}
                className='hover:!text-[var(--text-inverse)] h-[23px] w-[23px] rounded-[8px] bg-[var(--surface-7)] p-0 text-[var(--text-secondary)] hover:bg-[var(--brand-secondary)]'
                disabled={disabled}
              >
                {isEnabled ? (
                  <Circle className='h-[11px] w-[11px]' />
                ) : (
                  <CircleOff className='h-[11px] w-[11px]' />
                )}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {getTooltipMessage(isEnabled ? 'Disable Block' : 'Enable Block')}
            </Tooltip.Content>
          </Tooltip.Root>
        )}

        {!isStartBlock && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={(e) => {
                  e.stopPropagation()
                  if (!disabled) {
                    handleDuplicateBlock()
                  }
                }}
                className='hover:!text-[var(--text-inverse)] h-[23px] w-[23px] rounded-[8px] bg-[var(--surface-7)] p-0 text-[var(--text-secondary)] hover:bg-[var(--brand-secondary)]'
                disabled={disabled}
              >
                <Copy className='h-[11px] w-[11px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>{getTooltipMessage('Duplicate Block')}</Tooltip.Content>
          </Tooltip.Root>
        )}

        {!isNoteBlock && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={(e) => {
                  e.stopPropagation()
                  if (!disabled) {
                    collaborativeBatchToggleBlockHandles([blockId])
                  }
                }}
                className='hover:!text-[var(--text-inverse)] h-[23px] w-[23px] rounded-[8px] bg-[var(--surface-7)] p-0 text-[var(--text-secondary)] hover:bg-[var(--brand-secondary)]'
                disabled={disabled}
              >
                {horizontalHandles ? (
                  <ArrowLeftRight className='h-[11px] w-[11px]' />
                ) : (
                  <ArrowUpDown className='h-[11px] w-[11px]' />
                )}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {getTooltipMessage(horizontalHandles ? 'Vertical Ports' : 'Horizontal Ports')}
            </Tooltip.Content>
          </Tooltip.Root>
        )}

        {!isStartBlock && parentId && (parentType === 'loop' || parentType === 'parallel') && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={(e) => {
                  e.stopPropagation()
                  if (!disabled && userPermissions.canEdit) {
                    window.dispatchEvent(
                      new CustomEvent('remove-from-subflow', { detail: { blockIds: [blockId] } })
                    )
                  }
                }}
                className='hover:!text-[var(--text-inverse)] h-[23px] w-[23px] rounded-[8px] bg-[var(--surface-7)] p-0 text-[var(--text-secondary)] hover:bg-[var(--brand-secondary)]'
                disabled={disabled || !userPermissions.canEdit}
              >
                <LogOut className='h-[11px] w-[11px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>{getTooltipMessage('Remove from Subflow')}</Tooltip.Content>
          </Tooltip.Root>
        )}

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              onClick={(e) => {
                e.stopPropagation()
                if (!disabled) {
                  collaborativeBatchRemoveBlocks([blockId])
                }
              }}
              className='hover:!text-[var(--text-inverse)] h-[23px] w-[23px] rounded-[8px] bg-[var(--surface-7)] p-0 text-[var(--text-secondary)] hover:bg-[var(--brand-secondary)]'
              disabled={disabled}
            >
              <Trash2 className='h-[11px] w-[11px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>{getTooltipMessage('Delete Block')}</Tooltip.Content>
        </Tooltip.Root>
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
      prevProps.disabled === nextProps.disabled
    )
  }
)
