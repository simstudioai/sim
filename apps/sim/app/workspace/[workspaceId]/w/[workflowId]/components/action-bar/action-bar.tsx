import { memo, useCallback } from 'react'
import { ArrowLeftRight, ArrowUpDown, Circle, CircleOff, Lock, LogOut, Unlock } from 'lucide-react'
import { Button, Copy, PlayOutline, Tooltip, Trash2 } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { validateTriggerPaste } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useExecutionStore } from '@/stores/execution'
import { useNotificationStore } from '@/stores/notifications'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
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
      collaborativeBatchToggleLocked,
    } = useCollaborativeWorkflow()
    const { setPendingSelection } = useWorkflowRegistry()
    const { handleRunFromBlock } = useWorkflowExecution()

    const addNotification = useNotificationStore((s) => s.addNotification)

    const handleDuplicateBlock = useCallback(() => {
      const { copyBlocks, preparePasteData, activeWorkflowId } = useWorkflowRegistry.getState()
      const existingBlocks = useWorkflowStore.getState().blocks
      copyBlocks([blockId])

      const pasteData = preparePasteData(DEFAULT_DUPLICATE_OFFSET)
      if (!pasteData) return

      const blocks = Object.values(pasteData.blocks)
      const validation = validateTriggerPaste(blocks, existingBlocks, 'duplicate')
      if (!validation.isValid) {
        addNotification({
          level: 'error',
          message: validation.message!,
          workflowId: activeWorkflowId || undefined,
        })
        return
      }

      setPendingSelection(blocks.map((b) => b.id))
      collaborativeBatchAddBlocks(
        blocks,
        pasteData.edges,
        pasteData.loops,
        pasteData.parallels,
        pasteData.subBlockValues
      )
    }, [blockId, addNotification, collaborativeBatchAddBlocks, setPendingSelection])

    const {
      isEnabled,
      horizontalHandles,
      parentId,
      parentType,
      isLocked,
      isParentLocked,
      isParentDisabled,
    } = useWorkflowStore(
      useCallback(
        (state) => {
          const block = state.blocks[blockId]
          const parentId = block?.data?.parentId
          const parentBlock = parentId ? state.blocks[parentId] : undefined
          return {
            isEnabled: block?.enabled ?? true,
            horizontalHandles: block?.horizontalHandles ?? false,
            parentId,
            parentType: parentBlock?.type,
            isLocked: block?.locked ?? false,
            isParentLocked: parentBlock?.locked ?? false,
            isParentDisabled: parentBlock ? !parentBlock.enabled : false,
          }
        },
        [blockId]
      )
    )

    const { activeWorkflowId } = useWorkflowRegistry()
    const { isExecuting, getLastExecutionSnapshot } = useExecutionStore()
    const userPermissions = useUserPermissionsContext()
    const edges = useWorkflowStore((state) => state.edges)

    const isStartBlock = isInputDefinitionTrigger(blockType)
    const isResponseBlock = blockType === 'response'
    const isNoteBlock = blockType === 'note'
    const isSubflowBlock = blockType === 'loop' || blockType === 'parallel'
    const isInsideSubflow = parentId && (parentType === 'loop' || parentType === 'parallel')

    const snapshot = activeWorkflowId ? getLastExecutionSnapshot(activeWorkflowId) : null
    const incomingEdges = edges.filter((edge) => edge.target === blockId)
    const isTriggerBlock = incomingEdges.length === 0

    // Check if each source block is either executed OR is a trigger block (triggers don't need prior execution)
    const isSourceSatisfied = (sourceId: string) => {
      if (snapshot?.executedBlocks.includes(sourceId)) return true
      // Check if source is a trigger (has no incoming edges itself)
      const sourceIncomingEdges = edges.filter((edge) => edge.target === sourceId)
      return sourceIncomingEdges.length === 0
    }

    // Non-trigger blocks need a snapshot to exist (so upstream outputs are available)
    const dependenciesSatisfied =
      isTriggerBlock || (snapshot && incomingEdges.every((edge) => isSourceSatisfied(edge.source)))
    const canRunFromBlock =
      dependenciesSatisfied && !isNoteBlock && !isInsideSubflow && !isExecuting

    const handleRunFromBlockClick = useCallback(() => {
      if (!activeWorkflowId || !canRunFromBlock) return
      handleRunFromBlock(blockId, activeWorkflowId)
    }, [blockId, activeWorkflowId, canRunFromBlock, handleRunFromBlock])

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
        {!isNoteBlock && !isInsideSubflow && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span className='inline-flex'>
                <Button
                  variant='ghost'
                  onClick={(e) => {
                    e.stopPropagation()
                    if (canRunFromBlock && !disabled) {
                      handleRunFromBlockClick()
                    }
                  }}
                  className={ACTION_BUTTON_STYLES}
                  disabled={disabled || !canRunFromBlock}
                >
                  <PlayOutline className={ICON_SIZE} />
                </Button>
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {(() => {
                if (disabled) return getTooltipMessage('Run from block')
                if (isExecuting) return 'Execution in progress'
                if (!dependenciesSatisfied) return 'Run previous blocks first'
                return 'Run from block'
              })()}
            </Tooltip.Content>
          </Tooltip.Root>
        )}

        {!isNoteBlock && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={(e) => {
                  e.stopPropagation()
                  // Can't enable if parent is disabled (must enable parent first)
                  const cantEnable = !isEnabled && isParentDisabled
                  if (!disabled && !isLocked && !isParentLocked && !cantEnable) {
                    collaborativeBatchToggleBlockEnabled([blockId])
                  }
                }}
                className={ACTION_BUTTON_STYLES}
                disabled={
                  disabled || isLocked || isParentLocked || (!isEnabled && isParentDisabled)
                }
              >
                {isEnabled ? <Circle className={ICON_SIZE} /> : <CircleOff className={ICON_SIZE} />}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {isLocked || isParentLocked
                ? 'Block is locked'
                : !isEnabled && isParentDisabled
                  ? 'Parent container is disabled'
                  : getTooltipMessage(isEnabled ? 'Disable Block' : 'Enable Block')}
            </Tooltip.Content>
          </Tooltip.Root>
        )}

        {userPermissions.canAdmin && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={(e) => {
                  e.stopPropagation()
                  // Can't unlock a block if its parent container is locked
                  if (!disabled && !(isLocked && isParentLocked)) {
                    collaborativeBatchToggleLocked([blockId])
                  }
                }}
                className={ACTION_BUTTON_STYLES}
                disabled={disabled || (isLocked && isParentLocked)}
              >
                {isLocked ? <Unlock className={ICON_SIZE} /> : <Lock className={ICON_SIZE} />}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {isLocked && isParentLocked
                ? 'Parent container is locked'
                : isLocked
                  ? 'Unlock Block'
                  : 'Lock Block'}
            </Tooltip.Content>
          </Tooltip.Root>
        )}

        {!isStartBlock && !isResponseBlock && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={(e) => {
                  e.stopPropagation()
                  if (!disabled && !isLocked && !isParentLocked) {
                    handleDuplicateBlock()
                  }
                }}
                className={ACTION_BUTTON_STYLES}
                disabled={disabled || isLocked || isParentLocked}
              >
                <Copy className={ICON_SIZE} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {isLocked || isParentLocked
                ? 'Block is locked'
                : getTooltipMessage('Duplicate Block')}
            </Tooltip.Content>
          </Tooltip.Root>
        )}

        {!isNoteBlock && !isSubflowBlock && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={(e) => {
                  e.stopPropagation()
                  if (!disabled && !isLocked && !isParentLocked) {
                    collaborativeBatchToggleBlockHandles([blockId])
                  }
                }}
                className={ACTION_BUTTON_STYLES}
                disabled={disabled || isLocked || isParentLocked}
              >
                {horizontalHandles ? (
                  <ArrowLeftRight className={ICON_SIZE} />
                ) : (
                  <ArrowUpDown className={ICON_SIZE} />
                )}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {isLocked || isParentLocked
                ? 'Block is locked'
                : getTooltipMessage(horizontalHandles ? 'Vertical Ports' : 'Horizontal Ports')}
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
                  if (!disabled && userPermissions.canEdit && !isLocked && !isParentLocked) {
                    window.dispatchEvent(
                      new CustomEvent('remove-from-subflow', { detail: { blockIds: [blockId] } })
                    )
                  }
                }}
                className={ACTION_BUTTON_STYLES}
                disabled={disabled || !userPermissions.canEdit || isLocked || isParentLocked}
              >
                <LogOut className={ICON_SIZE} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {isLocked || isParentLocked
                ? 'Block is locked'
                : getTooltipMessage('Remove from Subflow')}
            </Tooltip.Content>
          </Tooltip.Root>
        )}

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              onClick={(e) => {
                e.stopPropagation()
                if (!disabled && !isLocked && !isParentLocked) {
                  collaborativeBatchRemoveBlocks([blockId])
                }
              }}
              className={ACTION_BUTTON_STYLES}
              disabled={disabled || isLocked || isParentLocked}
            >
              <Trash2 className={ICON_SIZE} />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>
            {isLocked || isParentLocked ? 'Block is locked' : getTooltipMessage('Delete Block')}
          </Tooltip.Content>
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
