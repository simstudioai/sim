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

const ACTION_BUTTON_STYLES = [
  'h-[23px] w-[23px] rounded-[8px] p-0',
  'border border-[var(--border)] bg-[var(--surface-5)]',
  'text-[var(--text-secondary)]',
  'hover:border-transparent hover:bg-[var(--brand-secondary)] hover:!text-[var(--text-inverse)]',
  'dark:border-transparent dark:bg-[var(--surface-7)] dark:hover:bg-[var(--brand-secondary)]',
].join(' ')

const ICON_SIZE = 'h-[11px] w-[11px]'

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

    const isStartBlock = blockType === 'starter' || blockType === 'start_trigger'
    const isResponseBlock = blockType === 'response'
    const isNoteBlock = blockType === 'note'
    const isSubflowBlock = blockType === 'loop' || blockType === 'parallel'

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
          'gap-[5px] rounded-[10px] p-[5px]',
          'border border-[var(--border)] bg-[var(--surface-2)]',
          'dark:border-transparent dark:bg-[var(--surface-4)]'
        )}
      >
        {!isNoteBlock && !isSubflowBlock && (
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
                className={ACTION_BUTTON_STYLES}
                disabled={disabled}
              >
                {isEnabled ? <Circle className={ICON_SIZE} /> : <CircleOff className={ICON_SIZE} />}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {getTooltipMessage(isEnabled ? 'Disable Block' : 'Enable Block')}
            </Tooltip.Content>
          </Tooltip.Root>
        )}

        {!isStartBlock && !isResponseBlock && !isSubflowBlock && (
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
                className={ACTION_BUTTON_STYLES}
                disabled={disabled}
              >
                <Copy className={ICON_SIZE} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>{getTooltipMessage('Duplicate Block')}</Tooltip.Content>
          </Tooltip.Root>
        )}

        {!isNoteBlock && !isSubflowBlock && (
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
                className={ACTION_BUTTON_STYLES}
                disabled={disabled}
              >
                {horizontalHandles ? (
                  <ArrowLeftRight className={ICON_SIZE} />
                ) : (
                  <ArrowUpDown className={ICON_SIZE} />
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
                className={ACTION_BUTTON_STYLES}
                disabled={disabled || !userPermissions.canEdit}
              >
                <LogOut className={ICON_SIZE} />
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
              className={ACTION_BUTTON_STYLES}
              disabled={disabled}
            >
              <Trash2 className={ICON_SIZE} />
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
