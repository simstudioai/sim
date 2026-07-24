import { memo, useCallback } from 'react'
import { Button, cn, Duplicate, PlayOutline, Tooltip, Trash2, toast } from '@sim/emcn'
import { Circle, CircleOff, Lock, LogOut, Unlock } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { validateTriggerPaste } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useExecutionStore, useIsCurrentWorkflowExecuting } from '@/stores/execution'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const DEFAULT_DUPLICATE_OFFSET = { x: 50, y: 50 }

const ACTION_BUTTON_STYLES = [
  'size-[24px] rounded-md p-0',
  'border-none bg-transparent text-[var(--text-icon)]',
  'hover-hover:bg-[var(--surface-5)] hover-hover:!text-[var(--text-primary)]',
  'dark:hover-hover:bg-[var(--surface-4)]',
  'transition-[background-color,color,opacity,transform] duration-150 active:scale-[0.96]',
].join(' ')

const ICON_SIZE = 'size-[14px]'

type ActionId = 'run' | 'enabled' | 'lock' | 'duplicate' | 'remove' | 'delete'

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
  /** Places the actions inside the workflow card's border swell. */
  variant?: 'floating' | 'swell'
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
    variant = 'floating',
  }: ActionBarProps) {
    const {
      collaborativeBatchAddBlocks,
      collaborativeBatchRemoveBlocks,
      collaborativeBatchToggleBlockEnabled,
      collaborativeBatchToggleLocked,
    } = useCollaborativeWorkflow()
    const { setPendingSelection } = useWorkflowRegistry()
    const { handleRunFromBlock } = useWorkflowExecution()

    const handleDuplicateBlock = useCallback(() => {
      const { copyBlocks, preparePasteData } = useWorkflowRegistry.getState()
      const existingBlocks = useWorkflowStore.getState().blocks
      copyBlocks([blockId])

      const pasteData = preparePasteData(DEFAULT_DUPLICATE_OFFSET)
      if (!pasteData) return

      const blocks = Object.values(pasteData.blocks)
      const validation = validateTriggerPaste(blocks, existingBlocks, 'duplicate')
      if (!validation.isValid) {
        toast.error(validation.message!)
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
    }, [blockId, collaborativeBatchAddBlocks, setPendingSelection])

    const { isEnabled, parentId, parentType, isLocked, isParentLocked, isParentDisabled } =
      useWorkflowStore(
        useShallow((state) => {
          const block = state.blocks[blockId]
          const parentId = block?.data?.parentId
          const parentBlock = parentId ? state.blocks[parentId] : undefined
          return {
            isEnabled: block?.enabled ?? true,
            parentId,
            parentType: parentBlock?.type,
            isLocked: block?.locked ?? false,
            isParentLocked: parentBlock?.locked ?? false,
            isParentDisabled: parentBlock ? !parentBlock.enabled : false,
          }
        })
      )

    const { activeWorkflowId } = useWorkflowRegistry()
    const isExecuting = useIsCurrentWorkflowExecuting()
    const getLastExecutionSnapshot = useExecutionStore((s) => s.getLastExecutionSnapshot)
    const userPermissions = useUserPermissionsContext()
    const edges = useWorkflowStore((state) => state.edges)

    const isStartBlock = isInputDefinitionTrigger(blockType)
    const isResponseBlock = blockType === 'response'
    const isNoteBlock = blockType === 'note'
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
    const isSwell = variant === 'swell'
    const firstActionId: ActionId =
      !isNoteBlock && !isInsideSubflow
        ? 'run'
        : !isNoteBlock
          ? 'enabled'
          : userPermissions.canAdmin
            ? 'lock'
            : !isStartBlock && !isResponseBlock
              ? 'duplicate'
              : 'delete'
    /*
     * Icon treatment follows the swell's own fill, published by the card view
     * as `data-node-selected`. Keying off React Flow's raw `selected` would
     * diverge: an executing block keeps the success ring, so the swell stays
     * gray (or retracts) while `selected` is still true.
     */
    const actionButtonStyles = cn(
      ACTION_BUTTON_STYLES,
      isSwell && [
        'group-data-[node-selected]:text-[var(--surface-2)]',
        'hover-hover:group-data-[node-selected]:bg-[var(--surface-2)]',
        'hover-hover:group-data-[node-selected]:!text-[var(--text-primary)]',
      ]
    )
    /*
     * End-button silhouettes: a straight diagonal edge running parallel to
     * the gray swell's taper above it (slope 20/24 ≈ 40° from vertical — the
     * falloff curve's central gradient), blended into the top edge with a
     * generous r8 arc and meeting the bottom edge with a pointier r2.5 arc;
     * the outer corners keep a modest r4. The right (delete) shape is the
     * exact mirror of the left (first action) shape. Width is 40px — outer
     * diagonal pushed out so the glyph has room before the cut; inner side
     * stays tight against neighboring actions. The row is right-[24px] to
     * match the swell anchor inset (right-aligned on the card). Glyphs shift
     * away from the outer cut (+6 / -6). Play gets an extra +2px because the
     * triangle’s optical center sits left of its viewBox center.
     */
    const getActionButtonStyles = (actionId: ActionId) =>
      cn(
        actionButtonStyles,
        isSwell &&
          actionId === firstActionId &&
          "!w-[40px] [clip-path:path('M23.75_0A8_8_0_0_0_17.6_2.88L3.41_19.9A2.5_2.5_0_0_0_5.34_24L36_24A4_4_0_0_0_40_20L40_4A4_4_0_0_0_36_0Z')] [&_svg]:translate-y-px",
        isSwell &&
          actionId === firstActionId &&
          (actionId === 'run' ? '[&_svg]:translate-x-[8px]' : '[&_svg]:translate-x-[6px]'),
        isSwell &&
          actionId === 'delete' &&
          "!w-[40px] [clip-path:path('M16.25_0A8_8_0_0_1_22.4_2.88L36.59_19.9A2.5_2.5_0_0_1_34.66_24L4_24A4_4_0_0_1_0_20L0_4A4_4_0_0_1_4_0Z')] [&_svg]:-translate-x-[6px] [&_svg]:translate-y-px",
        /* `!` is required: these buttons are also `disabled` when locked, and
           the emcn Button base carries `disabled:opacity-70`, which outranks a
           plain `opacity-35` on specificity. */
        actionId !== 'lock' && isLocked && '!opacity-35'
      )

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
        data-workflow-action-bar-swell={isSwell ? '' : undefined}
        className={cn(
          'absolute rounded-lg',
          isSwell
            ? [
                // Above RF handles (`z-30`) so icons stay clickable when a top edge crosses.
                '-top-[28px] right-[24px] z-[40] h-[28px] w-fit overflow-hidden px-[0.2rem] py-0.5',
                'pointer-events-auto',
              ]
            : [
                '-top-[40px] pointer-events-auto right-0 flex flex-row items-center gap-[2px] p-[3px]',
                'border-[1.5px] border-[var(--border-1)] bg-[var(--surface-2)]',
                'opacity-0 transition-opacity duration-[150ms] group-hover:opacity-100',
              ]
        )}
      >
        <div className={cn(isSwell && 'h-full')}>
          <div
            className={cn(
              'flex flex-row items-center gap-[2px]',
              isSwell && [
                'pointer-events-none opacity-0 transition-opacity duration-[30ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]',
                'group-data-[action-menu-ready]:pointer-events-auto group-data-[action-menu-ready]:opacity-100 group-data-[action-menu-ready]:duration-100',
              ]
            )}
          >
            {!isNoteBlock && !isInsideSubflow && (
              <Tooltip.Root preferAbove>
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
                      className={getActionButtonStyles('run')}
                      disabled={disabled || !canRunFromBlock || isLocked || isParentLocked}
                    >
                      <PlayOutline className={ICON_SIZE} />
                    </Button>
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>
                  {(() => {
                    if (isLocked || isParentLocked) return 'Block is locked'
                    if (disabled) return getTooltipMessage('Run from block')
                    if (isExecuting) return 'Running...'
                    if (!dependenciesSatisfied) return 'Run previous blocks first'
                    return 'Run from block'
                  })()}
                </Tooltip.Content>
              </Tooltip.Root>
            )}

            {!isNoteBlock && (
              <Tooltip.Root preferAbove>
                <Tooltip.Trigger asChild>
                  <span className='inline-flex'>
                    <Button
                      variant='ghost'
                      onClick={(e) => {
                        e.stopPropagation()
                        const cantEnable = !isEnabled && isParentDisabled
                        if (!disabled && !isLocked && !isParentLocked && !cantEnable) {
                          collaborativeBatchToggleBlockEnabled([blockId])
                        }
                      }}
                      className={getActionButtonStyles('enabled')}
                      disabled={
                        disabled || isLocked || isParentLocked || (!isEnabled && isParentDisabled)
                      }
                    >
                      {isEnabled ? (
                        <Circle className={ICON_SIZE} />
                      ) : (
                        <CircleOff className={ICON_SIZE} />
                      )}
                    </Button>
                  </span>
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
              <Tooltip.Root preferAbove>
                <Tooltip.Trigger asChild>
                  <span className='inline-flex'>
                    <Button
                      variant='ghost'
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!disabled && !(isLocked && isParentLocked)) {
                          collaborativeBatchToggleLocked([blockId])
                        }
                      }}
                      className={getActionButtonStyles('lock')}
                      disabled={disabled || (isLocked && isParentLocked)}
                    >
                      {isLocked ? <Unlock className={ICON_SIZE} /> : <Lock className={ICON_SIZE} />}
                    </Button>
                  </span>
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
              <Tooltip.Root preferAbove>
                <Tooltip.Trigger asChild>
                  <span className='inline-flex'>
                    <Button
                      variant='ghost'
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!disabled && !isLocked && !isParentLocked) {
                          handleDuplicateBlock()
                        }
                      }}
                      className={getActionButtonStyles('duplicate')}
                      disabled={disabled || isLocked || isParentLocked}
                    >
                      <Duplicate className={ICON_SIZE} />
                    </Button>
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>
                  {isLocked || isParentLocked
                    ? 'Block is locked'
                    : getTooltipMessage('Duplicate Block')}
                </Tooltip.Content>
              </Tooltip.Root>
            )}

            {!isStartBlock && parentId && (parentType === 'loop' || parentType === 'parallel') && (
              <Tooltip.Root preferAbove>
                <Tooltip.Trigger asChild>
                  <span className='inline-flex'>
                    <Button
                      variant='ghost'
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!disabled && userPermissions.canEdit && !isLocked && !isParentLocked) {
                          window.dispatchEvent(
                            new CustomEvent('remove-from-subflow', {
                              detail: { blockIds: [blockId] },
                            })
                          )
                        }
                      }}
                      className={getActionButtonStyles('remove')}
                      disabled={disabled || !userPermissions.canEdit || isLocked || isParentLocked}
                    >
                      <LogOut className={ICON_SIZE} />
                    </Button>
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>
                  {isLocked || isParentLocked
                    ? 'Block is locked'
                    : getTooltipMessage('Remove from Subflow')}
                </Tooltip.Content>
              </Tooltip.Root>
            )}

            <Tooltip.Root preferAbove>
              <Tooltip.Trigger asChild>
                <span className='inline-flex'>
                  <Button
                    variant='ghost'
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!disabled && !isLocked && !isParentLocked) {
                        collaborativeBatchRemoveBlocks([blockId])
                      }
                    }}
                    className={getActionButtonStyles('delete')}
                    disabled={disabled || isLocked || isParentLocked}
                  >
                    <Trash2 className={ICON_SIZE} />
                  </Button>
                </span>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>
                {isLocked || isParentLocked ? 'Block is locked' : getTooltipMessage('Delete Block')}
              </Tooltip.Content>
            </Tooltip.Root>
          </div>
        </div>
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
      prevProps.variant === nextProps.variant
    )
  }
)
