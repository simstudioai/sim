import { type ComponentType, memo, useCallback, useState } from 'react'
import {
  Button,
  Chip,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Duplicate,
  PlayOutline,
  Tooltip,
  Trash,
  toast,
} from '@sim/emcn'
import {
  Ban,
  BookOpen,
  Circle,
  Lock,
  LogOut,
  MoreHorizontal,
  Palette,
  Square,
  Unlock,
} from '@sim/emcn/icons'
import {
  DEFAULT_NOTE_COLOR,
  isNoteColor,
  NOTE_COLOR_OPTIONS,
  type NoteColor,
} from '@sim/workflow-renderer'
import { useShallow } from 'zustand/react/shallow'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useRunningActionSweep } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/use-running-action-sweep'
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

const INLINE_ACTION_BUTTON_STYLES = [
  'size-[28px] shrink-0 justify-start overflow-hidden rounded-md bg-transparent px-1.5 py-0 text-[var(--text-icon)]',
  'group-hover/inline-action:w-[var(--inline-action-width)] group-hover/inline-action:bg-[var(--surface-5)] group-hover/inline-action:text-[var(--text-primary)]',
  'group-focus-within/inline-action:w-[var(--inline-action-width)] group-focus-within/inline-action:bg-[var(--surface-5)] group-focus-within/inline-action:text-[var(--text-primary)]',
  'transition-[width,background-color,color,transform] duration-150 [transition-timing-function:cubic-bezier(0.2,0,0,1)] active:scale-[0.96] motion-reduce:transition-none',
].join(' ')

const ICON_SIZE = 'size-[14px]'
const INLINE_ICON_SIZE = 'size-[16px] shrink-0'

type ActionId = 'run' | 'enabled' | 'lock' | 'duplicate' | 'remove' | 'delete' | 'color'

const INLINE_ACTION_WIDTH_STYLES: Record<ActionId, string> = {
  run: '[--inline-action-width:90px]',
  enabled: '[--inline-action-width:86px]',
  lock: '[--inline-action-width:82px]',
  duplicate: '[--inline-action-width:100px]',
  remove: '[--inline-action-width:104px]',
  delete: '[--inline-action-width:78px]',
  color: '[--inline-action-width:72px]',
}

function InlineActionLabel({
  children,
  persistent = false,
}: {
  children: string
  persistent?: boolean
}) {
  return (
    <span
      className={cn(
        'ml-1.5 shrink-0 whitespace-nowrap font-medium text-small leading-none',
        !persistent &&
          '-translate-x-1 opacity-0 transition-[opacity,transform] duration-100 [transition-timing-function:cubic-bezier(0.2,0,0,1)] group-focus-within/inline-action:translate-x-0 group-focus-within/inline-action:opacity-100 group-hover/inline-action:translate-x-0 group-hover/inline-action:opacity-100 motion-reduce:transition-none'
      )}
    >
      {children}
    </span>
  )
}

function RunningActionIcon({ inline = false }: { inline?: boolean }) {
  return (
    <span
      className={cn(
        'relative grid place-items-center',
        inline ? 'size-[16px]' : 'size-[14px] translate-x-[8px] translate-y-px'
      )}
      aria-hidden='true'
    >
      <span className='col-start-1 row-start-1 opacity-100 transition-opacity duration-100 group-hover/run:opacity-0 group-focus-visible/run:opacity-0 motion-safe:animate-spin motion-reduce:transition-none'>
        <svg className={inline ? 'size-[16px]' : 'size-[14px]'} viewBox='0 0 24 24' fill='none'>
          <circle cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='2' opacity='0.25' />
          <circle
            cx='12'
            cy='12'
            r='10'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeDasharray='18 45'
          />
        </svg>
      </span>
      <span className='col-start-1 row-start-1 opacity-0 transition-opacity duration-100 group-hover/run:opacity-100 group-focus-visible/run:opacity-100 motion-reduce:transition-none'>
        <Square className='size-[11px] fill-current' strokeWidth={0} />
      </span>
    </span>
  )
}

interface InlineBlockStatusProps {
  icon: ComponentType<{ className?: string }>
  label: string
  disabled: boolean
  onClick: () => void
}

function InlineBlockStatus({ icon: Icon, label, disabled, onClick }: InlineBlockStatusProps) {
  return (
    <Tooltip.Root preferAbove>
      <Tooltip.Trigger asChild>
        <span className='inline-flex'>
          <Chip
            variant='border'
            leftIcon={Icon}
            aria-label={label}
            className='size-[30px] justify-center p-0'
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation()
              onClick()
            }}
          />
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content side='top'>{label}</Tooltip.Content>
    </Tooltip.Root>
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
  variant?: 'floating' | 'swell' | 'inline'
  /** Limits an inline action bar to the block run control or overflow menu. */
  inlineActions?: 'all' | 'run' | 'menu'
  /** Whether this block is currently executing. */
  isRunning?: boolean
  /** Whether any block in the current workflow is executing. */
  isWorkflowRunning?: boolean
  noteColor?: NoteColor
  onNoteColorChange?: (color: NoteColor) => void
  /** Keeps the note and its swell selected while the portalled color menu is open. */
  onNoteColorMenuOpen?: () => void
  /** Opens documentation for the selected block from the inline editor menu. */
  onOpenDocs?: () => void
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
    inlineActions = 'all',
    isRunning = false,
    isWorkflowRunning = false,
    noteColor = DEFAULT_NOTE_COLOR,
    onNoteColorChange,
    onNoteColorMenuOpen,
    onOpenDocs,
  }: ActionBarProps) {
    const {
      collaborativeBatchAddBlocks,
      collaborativeBatchRemoveBlocks,
      collaborativeBatchToggleBlockEnabled,
      collaborativeBatchToggleLocked,
    } = useCollaborativeWorkflow()
    const { setPendingSelection } = useWorkflowRegistry()
    const { handleCancelExecution, handleRunFromBlock } = useWorkflowExecution()
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
    const cantEnable = !isEnabled && isParentDisabled
    const isEffectivelyLocked = isLocked || isParentLocked
    const isEffectivelyDisabled = !isEnabled || isParentDisabled

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
    const isInline = variant === 'inline'
    const isPersistentInlineRun = isInline && inlineActions === 'run'
    const isCompactDisabledInlineRun =
      isPersistentInlineRun && !isWorkflowRunning && (isEffectivelyLocked || isEffectivelyDisabled)
    const firstActionId: ActionId = isNoteBlock
      ? 'color'
      : !isInsideSubflow || isWorkflowRunning
        ? 'run'
        : 'enabled'
    const runningSweepActionIds: ActionId[] = [
      ...(!isNoteBlock ? (['enabled'] as const) : []),
      ...(userPermissions.canAdmin ? (['lock'] as const) : []),
      ...(!isStartBlock && !isResponseBlock ? (['duplicate'] as const) : []),
      ...(!isInline && !isStartBlock && isInsideSubflow ? (['remove'] as const) : []),
      'delete',
    ]
    const runningSweepFilledCount = useRunningActionSweep(isRunning, runningSweepActionIds.length)
    const [isInlineMenuOpen, setIsInlineMenuOpen] = useState(false)
    /**
     * Icon treatment follows the swell's own fill, published by the card view
     * as `data-node-selected`. Keying off React Flow's raw `selected` would
     * diverge: an executing block keeps the success ring, so the swell stays
     * gray (or retracts) while `selected` is still true.
     */
    const actionButtonStyles = cn(
      isInline ? INLINE_ACTION_BUTTON_STYLES : ACTION_BUTTON_STYLES,
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
    const getActionButtonStyles = (actionId: ActionId) => {
      const runningSweepIndex = runningSweepActionIds.indexOf(actionId)
      const isRunningSweepSlot = isRunning && runningSweepIndex >= 0
      const isRunningSweepFilled = isRunningSweepSlot && runningSweepIndex < runningSweepFilledCount

      return cn(
        actionButtonStyles,
        isInline && !isPersistentInlineRun && INLINE_ACTION_WIDTH_STYLES[actionId],
        isInline &&
          !isPersistentInlineRun &&
          actionId === 'run' && [
            'border border-transparent',
            'group-hover/inline-action:border-[var(--border)] group-hover/inline-action:!bg-transparent',
            'group-focus-within/inline-action:border-[var(--border)] group-focus-within/inline-action:!bg-transparent',
          ],
        !isWorkflowRunning &&
          ((actionId === 'enabled' && !isEnabled) || (actionId === 'lock' && isLocked)) && [
            'bg-[var(--text-secondary)] text-[var(--text-inverse)]',
          ],
        actionId === 'run' &&
          isRunning && [
            '!bg-[var(--text-secondary)] !text-[var(--text-inverse)]',
            'dark:!bg-[var(--surface-4)] dark:!text-[var(--text-primary)]',
            'hover-hover:!bg-[var(--white)] hover-hover:!text-[var(--surface-inverted)]',
            'dark:hover-hover:!bg-[var(--white)] dark:hover-hover:!text-[var(--surface-inverted)]',
            'focus-visible:!bg-[var(--white)] focus-visible:!text-[var(--surface-inverted)]',
            'dark:focus-visible:!bg-[var(--white)] dark:focus-visible:!text-[var(--surface-inverted)]',
          ],
        isSwell &&
          actionId === firstActionId &&
          "!w-[40px] [clip-path:path('M23.75_0A8_8_0_0_0_17.6_2.88L3.41_19.9A2.5_2.5_0_0_0_5.34_24L36_24A4_4_0_0_0_40_20L40_4A4_4_0_0_0_36_0Z')] [&>svg]:translate-y-px",
        isSwell &&
          actionId === firstActionId &&
          (actionId === 'run' || actionId === 'color'
            ? '[&>svg]:translate-x-[8px]'
            : '[&>svg]:translate-x-[6px]'),
        isSwell &&
          actionId === 'delete' &&
          "!w-[40px] [clip-path:path('M16.25_0A8_8_0_0_1_22.4_2.88L36.59_19.9A2.5_2.5_0_0_1_34.66_24L4_24A4_4_0_0_1_0_20L0_4A4_4_0_0_1_4_0Z')] [&_svg]:-translate-x-[6px] [&_svg]:translate-y-px",
        isWorkflowRunning &&
          !isRunning && [
            '!bg-transparent !opacity-25',
            actionId === 'run'
              ? [
                  'hover-hover:!bg-[var(--surface-2)] hover-hover:!text-[var(--text-primary)] hover-hover:!opacity-100',
                  'focus-visible:!bg-[var(--surface-2)] focus-visible:!text-[var(--text-primary)] focus-visible:!opacity-100',
                ]
              : 'hover-hover:!bg-transparent dark:hover-hover:!bg-transparent',
          ],
        isRunningSweepSlot && [
          '!opacity-100 [&_svg]:!opacity-0',
          isRunningSweepFilled
            ? '!bg-[var(--surface-2)] hover-hover:!bg-[var(--surface-2)]'
            : '!bg-transparent hover-hover:!bg-transparent',
          'motion-reduce:!bg-[var(--surface-2)] motion-reduce:transition-none',
        ],
        /* `!` is required: these buttons are also `disabled` when locked, and
           the emcn Button base carries `disabled:opacity-70`, which outranks a
           plain `opacity-35` on specificity. */
        !isWorkflowRunning && actionId !== 'lock' && isLocked && '!opacity-35'
      )
    }

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
          'rounded-lg',
          isSwell
            ? [
                'absolute',
                // Above RF handles (`z-30`) so icons stay clickable when a top edge crosses.
                '-top-[28px] right-[24px] z-[40] h-[28px] w-fit overflow-hidden px-[0.2rem] py-0.5',
                'pointer-events-auto',
              ]
            : isInline
              ? 'relative w-fit'
              : [
                  'absolute',
                  '-top-[40px] pointer-events-auto right-0 flex flex-row items-center gap-[2px] p-[3px]',
                  'border-[1.5px] border-[var(--border-1)] bg-[var(--surface-2)]',
                  'opacity-0 transition-opacity duration-[150ms] group-hover:opacity-100',
                ]
        )}
      >
        <div
          className={cn(
            'flex flex-row items-center',
            isInline ? 'gap-1' : 'gap-[2px]',
            isSwell && [
              'pointer-events-none h-full opacity-0 transition-opacity duration-[30ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]',
              'group-data-[action-menu-ready]:pointer-events-auto group-data-[action-menu-ready]:opacity-100 group-data-[action-menu-ready]:duration-100',
            ]
          )}
        >
          {isPersistentInlineRun && isEffectivelyDisabled && (
            <InlineBlockStatus
              icon={Ban}
              label={isParentDisabled ? 'Parent container is disabled' : 'Enable block'}
              disabled={
                isWorkflowRunning || disabled || isLocked || isParentLocked || isParentDisabled
              }
              onClick={() => collaborativeBatchToggleBlockEnabled([blockId])}
            />
          )}
          {isPersistentInlineRun && isEffectivelyLocked && (
            <InlineBlockStatus
              icon={Lock}
              label={
                isParentLocked
                  ? 'Parent container is locked'
                  : userPermissions.canAdmin
                    ? 'Unlock block'
                    : 'Block is locked'
              }
              disabled={
                isWorkflowRunning || disabled || isParentLocked || !userPermissions.canAdmin
              }
              onClick={() => collaborativeBatchToggleLocked([blockId])}
            />
          )}
          {!isNoteBlock &&
            (!isInsideSubflow || isWorkflowRunning) &&
            (!isInline || inlineActions !== 'menu') && (
              <Tooltip.Root preferAbove>
                <Tooltip.Trigger asChild>
                  <span className={cn('inline-flex', isInline && 'group/inline-action')}>
                    {isPersistentInlineRun ? (
                      <Chip
                        variant='border'
                        leftIcon={isWorkflowRunning ? undefined : PlayOutline}
                        leftAdornment={
                          isWorkflowRunning ? (
                            isRunning ? (
                              <RunningActionIcon inline />
                            ) : (
                              <Square
                                className='size-[14px] shrink-0 fill-current'
                                aria-hidden='true'
                                strokeWidth={0}
                              />
                            )
                          ) : undefined
                        }
                        aria-label={isWorkflowRunning ? 'Stop workflow' : 'Run block'}
                        className={cn(
                          isCompactDisabledInlineRun && 'size-[30px] justify-center p-0'
                        )}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (isWorkflowRunning) {
                            handleCancelExecution()
                            return
                          }
                          if (canRunFromBlock && !disabled) {
                            handleRunFromBlockClick()
                          }
                        }}
                        disabled={
                          !isWorkflowRunning &&
                          (disabled ||
                            !canRunFromBlock ||
                            isEffectivelyLocked ||
                            isEffectivelyDisabled)
                        }
                      >
                        {isWorkflowRunning
                          ? 'Stop'
                          : isCompactDisabledInlineRun
                            ? null
                            : 'Run block'}
                      </Chip>
                    ) : (
                      <Button
                        variant='ghost'
                        aria-label={isWorkflowRunning ? 'Stop workflow' : 'Run block'}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (isWorkflowRunning) {
                            handleCancelExecution()
                            return
                          }
                          if (canRunFromBlock && !disabled) {
                            handleRunFromBlockClick()
                          }
                        }}
                        className={cn(
                          getActionButtonStyles('run'),
                          isWorkflowRunning && 'group/run'
                        )}
                        disabled={
                          !isWorkflowRunning &&
                          (disabled ||
                            !canRunFromBlock ||
                            isEffectivelyLocked ||
                            isEffectivelyDisabled)
                        }
                      >
                        {isWorkflowRunning ? (
                          isRunning ? (
                            <RunningActionIcon inline={isInline} />
                          ) : (
                            <Square
                              className={cn(
                                'shrink-0 fill-current',
                                isInline ? 'size-[14px]' : 'size-[11px]'
                              )}
                              aria-hidden='true'
                              strokeWidth={0}
                            />
                          )
                        ) : (
                          <PlayOutline className={isInline ? INLINE_ICON_SIZE : ICON_SIZE} />
                        )}
                        {isInline && (
                          <InlineActionLabel>
                            {isWorkflowRunning ? 'Stop' : 'Run block'}
                          </InlineActionLabel>
                        )}
                      </Button>
                    )}
                  </span>
                </Tooltip.Trigger>
                {(!isInline || isCompactDisabledInlineRun) && (
                  <Tooltip.Content side='top'>
                    {(() => {
                      if (isWorkflowRunning) return 'Stop'
                      if (isEffectivelyLocked) return 'Block is locked'
                      if (isEffectivelyDisabled) return 'Block is disabled'
                      if (disabled) return getTooltipMessage('Run')
                      if (isExecuting) return 'Running...'
                      if (!dependenciesSatisfied) return 'Run previous blocks first'
                      return 'Run'
                    })()}
                  </Tooltip.Content>
                )}
              </Tooltip.Root>
            )}

          {!isNoteBlock && !isInline && (
            <Tooltip.Root preferAbove>
              <Tooltip.Trigger asChild>
                <span className={cn('inline-flex', isInline && 'group/inline-action')}>
                  <Button
                    variant='ghost'
                    aria-label={isEnabled ? 'Disable block' : 'Enable block'}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!disabled && !isLocked && !isParentLocked && !cantEnable) {
                        collaborativeBatchToggleBlockEnabled([blockId])
                      }
                    }}
                    className={getActionButtonStyles('enabled')}
                    disabled={
                      isWorkflowRunning ||
                      disabled ||
                      isLocked ||
                      isParentLocked ||
                      (!isEnabled && isParentDisabled)
                    }
                  >
                    {isEnabled ? (
                      <Circle className={isInline ? INLINE_ICON_SIZE : ICON_SIZE} />
                    ) : (
                      <Ban className={isInline ? INLINE_ICON_SIZE : ICON_SIZE} />
                    )}
                    {isInline && (
                      <InlineActionLabel>{isEnabled ? 'Disable' : 'Enable'}</InlineActionLabel>
                    )}
                  </Button>
                </span>
              </Tooltip.Trigger>
              {!isInline && (
                <Tooltip.Content side='top'>
                  {isLocked || isParentLocked
                    ? 'Block is locked'
                    : !isEnabled && isParentDisabled
                      ? 'Parent container is disabled'
                      : getTooltipMessage(isEnabled ? 'Disable' : 'Enable')}
                </Tooltip.Content>
              )}
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
                      disabled={
                        isWorkflowRunning ||
                        disabled ||
                        isLocked ||
                        isParentLocked ||
                        !onNoteColorChange
                      }
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

          {userPermissions.canAdmin && !isInline && (
            <Tooltip.Root preferAbove>
              <Tooltip.Trigger asChild>
                <span className={cn('inline-flex', isInline && 'group/inline-action')}>
                  <Button
                    variant='ghost'
                    aria-label={isLocked ? 'Unlock block' : 'Lock block'}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!disabled && !(isLocked && isParentLocked)) {
                        collaborativeBatchToggleLocked([blockId])
                      }
                    }}
                    className={getActionButtonStyles('lock')}
                    disabled={isWorkflowRunning || disabled || (isLocked && isParentLocked)}
                  >
                    {isLocked ? (
                      <Lock className={isInline ? INLINE_ICON_SIZE : ICON_SIZE} />
                    ) : (
                      <Unlock className={isInline ? INLINE_ICON_SIZE : ICON_SIZE} />
                    )}
                    {isInline && (
                      <InlineActionLabel>{isLocked ? 'Unlock' : 'Lock'}</InlineActionLabel>
                    )}
                  </Button>
                </span>
              </Tooltip.Trigger>
              {!isInline && (
                <Tooltip.Content side='top'>
                  {isLocked && isParentLocked
                    ? 'Parent container is locked'
                    : isLocked
                      ? 'Unlock'
                      : 'Lock'}
                </Tooltip.Content>
              )}
            </Tooltip.Root>
          )}

          {!isStartBlock && !isResponseBlock && !isInline && (
            <Tooltip.Root preferAbove>
              <Tooltip.Trigger asChild>
                <span className={cn('inline-flex', isInline && 'group/inline-action')}>
                  <Button
                    variant='ghost'
                    aria-label='Duplicate block'
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!disabled && !isLocked && !isParentLocked) {
                        handleDuplicateBlock()
                      }
                    }}
                    className={getActionButtonStyles('duplicate')}
                    disabled={isWorkflowRunning || disabled || isLocked || isParentLocked}
                  >
                    <Duplicate className={isInline ? INLINE_ICON_SIZE : ICON_SIZE} />
                    {isInline && <InlineActionLabel>Duplicate</InlineActionLabel>}
                  </Button>
                </span>
              </Tooltip.Trigger>
              {!isInline && (
                <Tooltip.Content side='top'>
                  {isLocked || isParentLocked ? 'Block is locked' : getTooltipMessage('Duplicate')}
                </Tooltip.Content>
              )}
            </Tooltip.Root>
          )}

          {!isInline &&
            !isStartBlock &&
            parentId &&
            (parentType === 'loop' || parentType === 'parallel') && (
              <Tooltip.Root preferAbove>
                <Tooltip.Trigger asChild>
                  <span className='inline-flex'>
                    <Button
                      variant='ghost'
                      aria-label='Remove block from subflow'
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
                      disabled={
                        isWorkflowRunning ||
                        disabled ||
                        !userPermissions.canEdit ||
                        isLocked ||
                        isParentLocked
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

          {isInline && inlineActions !== 'run' && (
            <DropdownMenu onOpenChange={setIsInlineMenuOpen}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Chip
                      leftIcon={MoreHorizontal}
                      className='size-[30px] justify-center p-0'
                      aria-label='Block actions'
                    />
                  </DropdownMenuTrigger>
                </Tooltip.Trigger>
                {!isInlineMenuOpen && <Tooltip.Content side='top'>Block actions</Tooltip.Content>}
              </Tooltip.Root>
              <DropdownMenuContent align='end' side='bottom'>
                <DropdownMenuItem
                  onSelect={() => collaborativeBatchToggleBlockEnabled([blockId])}
                  disabled={
                    isWorkflowRunning || disabled || isLocked || isParentLocked || cantEnable
                  }
                >
                  {isEnabled ? <Circle /> : <Ban />}
                  {isEnabled ? 'Disable' : 'Enable'}
                </DropdownMenuItem>
                {userPermissions.canAdmin && (
                  <DropdownMenuItem
                    onSelect={() => collaborativeBatchToggleLocked([blockId])}
                    disabled={isWorkflowRunning || disabled || (isLocked && isParentLocked)}
                  >
                    {isLocked ? <Unlock /> : <Lock />}
                    {isLocked ? 'Unlock' : 'Lock'}
                  </DropdownMenuItem>
                )}
                {!isStartBlock && !isResponseBlock && (
                  <DropdownMenuItem
                    onSelect={handleDuplicateBlock}
                    disabled={isWorkflowRunning || disabled || isLocked || isParentLocked}
                  >
                    <Duplicate />
                    Duplicate
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => collaborativeBatchRemoveBlocks([blockId])}
                  disabled={isWorkflowRunning || disabled || isLocked || isParentLocked}
                >
                  <Trash />
                  Delete
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onOpenDocs} disabled={!onOpenDocs}>
                  <BookOpen />
                  Docs
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {!isInline && (
            <Tooltip.Root preferAbove>
              <Tooltip.Trigger asChild>
                <span className='inline-flex'>
                  <Button
                    variant='ghost'
                    aria-label='Delete block'
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!disabled && !isLocked && !isParentLocked) {
                        collaborativeBatchRemoveBlocks([blockId])
                      }
                    }}
                    className={getActionButtonStyles('delete')}
                    disabled={isWorkflowRunning || disabled || isLocked || isParentLocked}
                  >
                    <Trash className={ICON_SIZE} />
                  </Button>
                </span>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>
                {isLocked || isParentLocked ? 'Block is locked' : getTooltipMessage('Delete')}
              </Tooltip.Content>
            </Tooltip.Root>
          )}
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
      prevProps.inlineActions === nextProps.inlineActions &&
      prevProps.isRunning === nextProps.isRunning &&
      prevProps.isWorkflowRunning === nextProps.isWorkflowRunning &&
      prevProps.noteColor === nextProps.noteColor &&
      prevProps.onNoteColorChange === nextProps.onNoteColorChange &&
      prevProps.onNoteColorMenuOpen === nextProps.onNoteColorMenuOpen &&
      prevProps.onOpenDocs === nextProps.onOpenDocs
    )
  }
)
