import { memo, useCallback, useEffect, useState } from 'react'
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Duplicate,
  PlayOutline,
  Tooltip,
  Trash,
  toast,
} from '@sim/emcn'
import {
  DEFAULT_NOTE_COLOR,
  isNoteColor,
  NOTE_COLOR_OPTIONS,
  type NoteColor,
} from '@sim/workflow-renderer'
import { Ban, Circle, Lock, LogOut, Palette, Unlock } from '@sim/emcn/icons'
import { useShallow } from 'zustand/react/shallow'
import { ThinkingLoader } from '@/components/ui'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import {
  getRunFromBlockDependencyState,
  validateTriggerPaste,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useIsCurrentWorkflowExecuting, useLastExecutionSnapshot } from '@/stores/execution'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const DEFAULT_DUPLICATE_OFFSET = { x: 50, y: 50 }
const PROGRESS_ACTIONS_REVEAL_DELAY_MS = 120

const ACTION_BUTTON_STYLES = [
  'size-[24px] rounded-md p-0',
  'border-none bg-transparent text-[var(--text-icon)]',
  'hover-hover:bg-[var(--surface-5)] hover-hover:!text-[var(--text-primary)]',
  'dark:hover-hover:bg-[var(--surface-4)]',
  'transition-[background-color,color,opacity,transform] duration-150 active:scale-[0.96]',
].join(' ')

const ICON_SIZE = 'size-[14px]'
const PROGRESS_LEFT_CAP_PATH =
  'M23.75 0A8 8 0 0 0 17.6 2.88L3.41 19.9A2.5 2.5 0 0 0 5.34 24L40 24L40 0Z'
const PROGRESS_RIGHT_CAP_PATH =
  'M16.25 0A8 8 0 0 1 22.4 2.88L36.59 19.9A2.5 2.5 0 0 1 34.66 24L0 24L0 0Z'

type ActionId = 'run' | 'enabled' | 'lock' | 'duplicate' | 'remove' | 'delete' | 'color'

function IndeterminateBlockProgress() {
  return (
    <div
      className='relative h-[24px] w-full'
      role='status'
      aria-label='Block running'
      aria-live='off'
    >
      <div
        aria-hidden='true'
        className='absolute inset-0 flex text-[color-mix(in_srgb,var(--text-secondary)_90%,var(--text-primary))]'
      >
        <svg
          className='h-full w-[40px] flex-none fill-current'
          viewBox='0 0 40 24'
          shapeRendering='geometricPrecision'
        >
          <path d={PROGRESS_LEFT_CAP_PATH} />
        </svg>
        <div className='h-full min-w-0 flex-1 bg-current' />
        <svg
          className='h-full w-[40px] flex-none fill-current'
          viewBox='0 0 40 24'
          shapeRendering='geometricPrecision'
        >
          <path d={PROGRESS_RIGHT_CAP_PATH} />
        </svg>
      </div>
      <div
        aria-hidden='true'
        className='absolute inset-0 flex items-center justify-center text-[color-mix(in_srgb,var(--surface-2)_78%,var(--text-secondary))]'
      >
        <ThinkingLoader
          variant='relay'
          relayLayout='wide'
          size={24}
          tone='inherit'
          className='w-full'
        />
      </div>
    </div>
  )
}

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
  /** Whether the current workflow is executing. */
  isRunning?: boolean
  noteColor?: NoteColor
  onNoteColorChange?: (color: NoteColor) => void
  /** Keeps the note and its swell selected while the portalled color menu is open. */
  onNoteColorMenuOpen?: () => void
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
    isRunning = false,
    noteColor = DEFAULT_NOTE_COLOR,
    onNoteColorChange,
    onNoteColorMenuOpen,
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
    const [actionsSuppressed, setActionsSuppressed] = useState(isRunning)
    const shouldSuppressActions = isRunning || actionsSuppressed

    useEffect(() => {
      if (isRunning) {
        setActionsSuppressed(true)
        return
      }

      const timer = window.setTimeout(
        () => setActionsSuppressed(false),
        PROGRESS_ACTIONS_REVEAL_DELAY_MS
      )
      return () => window.clearTimeout(timer)
    }, [isRunning])

    const isExecuting = useIsCurrentWorkflowExecuting()
    const snapshot = useLastExecutionSnapshot(activeWorkflowId)
    const userPermissions = useUserPermissionsContext()
    const edges = useWorkflowStore((state) => state.edges)

    const isStartBlock = isInputDefinitionTrigger(blockType)
    const isResponseBlock = blockType === 'response'
    const isNoteBlock = blockType === 'note'
    const isInsideSubflow = parentId && (parentType === 'loop' || parentType === 'parallel')

    const { dependenciesSatisfied } = getRunFromBlockDependencyState(blockId, edges, snapshot)
    const canRunFromBlock =
      dependenciesSatisfied && !isNoteBlock && !isInsideSubflow && !isExecuting
    const isSwell = variant === 'swell'
    const firstActionId: ActionId = isNoteBlock ? 'color' : !isInsideSubflow ? 'run' : 'enabled'
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
     * triangle’s optical center sits left of its viewBox center; the Note
     * palette uses the same inset so its first-action padding matches.
     */
    const getActionButtonStyles = (actionId: ActionId) =>
      cn(
        actionButtonStyles,
        ((actionId === 'enabled' && !isEnabled) || (actionId === 'lock' && isLocked)) && [
          'bg-[var(--text-secondary)] text-[var(--text-inverse)]',
        ],
        isSwell &&
          actionId === firstActionId &&
          "!w-[40px] [clip-path:path('M23.75_0A8_8_0_0_0_17.6_2.88L3.41_19.9A2.5_2.5_0_0_0_5.34_24L36_24A4_4_0_0_0_40_20L40_4A4_4_0_0_0_36_0Z')] [&_svg]:translate-y-px",
        isSwell &&
          actionId === firstActionId &&
          (actionId === 'run' || actionId === 'color'
            ? '[&_svg]:translate-x-[8px]'
            : '[&_svg]:translate-x-[6px]'),
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
        <div className={cn(isSwell && 'relative h-full')}>
          {isSwell && isRunning && (
            <div className='pointer-events-none absolute inset-0 flex h-full items-center opacity-0 transition-opacity duration-100 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] group-data-[action-menu-ready]:opacity-100 motion-reduce:transition-none'>
              <IndeterminateBlockProgress />
            </div>
          )}
          <div
            className={cn(
              isSwell && 'h-full',
              isSwell && shouldSuppressActions && 'pointer-events-none invisible'
            )}
          >
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
                      if (disabled) return getTooltipMessage('Run')
                      if (isExecuting) return 'Running...'
                      if (!dependenciesSatisfied) return 'Run previous blocks first'
                      return 'Run'
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
                          <Ban className={ICON_SIZE} />
                        )}
                      </Button>
                    </span>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>
                    {isLocked || isParentLocked
                      ? 'Block is locked'
                      : !isEnabled && isParentDisabled
                        ? 'Parent container is disabled'
                        : getTooltipMessage(isEnabled ? 'Disable' : 'Enable')}
                  </Tooltip.Content>
                </Tooltip.Root>
              )}

              {isNoteBlock && (
                <DropdownMenu
                  onOpenChange={(open) => {
                    if (open) onNoteColorMenuOpen?.()
                  }}
                >
                  <Tooltip.Root preferAbove>
                    <Tooltip.Trigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='ghost'
                          className={getActionButtonStyles('color')}
                          disabled={disabled || isLocked || isParentLocked || !onNoteColorChange}
                          aria-label='Note color'
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Palette className={ICON_SIZE} />
                        </Button>
                      </DropdownMenuTrigger>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top'>Color</Tooltip.Content>
                  </Tooltip.Root>
                  <DropdownMenuContent
                    align='center'
                    side='top'
                    sideOffset={8}
                    className='w-fit min-w-0 rounded-full p-1'
                  >
                    <DropdownMenuRadioGroup
                      value={noteColor}
                      className='flex flex-col gap-0.5'
                      onValueChange={(value) => {
                        if (isNoteColor(value)) onNoteColorChange?.(value)
                      }}
                    >
                      {NOTE_COLOR_OPTIONS.map((option) => (
                        <DropdownMenuRadioItem
                          key={option.id}
                          value={option.id}
                          aria-label={option.label}
                          className='size-[28px] cursor-pointer justify-center rounded-full p-0 [&>span:first-child]:hidden'
                        >
                          <span
                            className={cn(
                              'size-[16px] rounded-full border border-black/15',
                              option.swatchClassName,
                              option.id === noteColor &&
                                'ring-2 ring-[var(--text-primary)] ring-offset-1 ring-offset-[var(--bg)]'
                            )}
                          />
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
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
                        {isLocked ? (
                          <Lock className={ICON_SIZE} />
                        ) : (
                          <Unlock className={ICON_SIZE} />
                        )}
                      </Button>
                    </span>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>
                    {isLocked && isParentLocked
                      ? 'Parent container is locked'
                      : isLocked
                        ? 'Unlock'
                        : 'Lock'}
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
                      : getTooltipMessage('Duplicate')}
                  </Tooltip.Content>
                </Tooltip.Root>
              )}

              {!isStartBlock &&
                parentId &&
                (parentType === 'loop' || parentType === 'parallel') && (
                  <Tooltip.Root preferAbove>
                    <Tooltip.Trigger asChild>
                      <span className='inline-flex'>
                        <Button
                          variant='ghost'
                          onClick={(e) => {
                            e.stopPropagation()
                            if (
                              !disabled &&
                              userPermissions.canEdit &&
                              !isLocked &&
                              !isParentLocked
                            ) {
                              window.dispatchEvent(
                                new CustomEvent('remove-from-subflow', {
                                  detail: { blockIds: [blockId] },
                                })
                              )
                            }
                          }}
                          className={getActionButtonStyles('remove')}
                          disabled={
                            disabled || !userPermissions.canEdit || isLocked || isParentLocked
                          }
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
                      <Trash className={ICON_SIZE} />
                    </Button>
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>
                  {isLocked || isParentLocked ? 'Block is locked' : getTooltipMessage('Delete')}
                </Tooltip.Content>
              </Tooltip.Root>
            </div>
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
      prevProps.variant === nextProps.variant &&
      prevProps.isRunning === nextProps.isRunning &&
      prevProps.noteColor === nextProps.noteColor &&
      prevProps.onNoteColorChange === nextProps.onNoteColorChange &&
      prevProps.onNoteColorMenuOpen === nextProps.onNoteColorMenuOpen
    )
  }
)
