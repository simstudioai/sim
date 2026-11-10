'use client'

import {
  type ButtonHTMLAttributes,
  cloneElement,
  isValidElement,
  type KeyboardEvent,
  memo,
  type ReactElement,
  useCallback,
  useRef,
  useState,
} from 'react'
import { cn } from '@sim/emcn/lib/cn'
import { AnchoredPopover } from '@sim/emcn/menu/anchored-popover'
import { Tooltip } from '@sim/emcn/tooltip'
import { useShallow } from 'zustand/react/shallow'
import { toast } from '@/lib/toast/sink'
import styles from '@/app/(product)/_components/workspace/workflows/canvas/action-bar/action-bar.module.css'
import {
  Ban,
  Circle,
  DEFAULT_NOTE_COLOR,
  Duplicate,
  isInputDefinitionTrigger,
  isNoteColor,
  Lock,
  LogOut,
  NOTE_COLOR_OPTIONS,
  type NoteColor,
  Palette,
  PlayOutline,
  Square,
  selectRunFromBlockDependenciesSatisfied,
  Trash,
  Unlock,
  useCollaborativeWorkflow,
  useLastExecutionSnapshot,
  useUserPermissionsContext,
  useWorkflowExecution,
  useWorkflowRegistry,
  useWorkflowStore,
  validateTriggerPaste,
} from '@/platform/lib/data/workflows'

const DEFAULT_DUPLICATE_OFFSET = { x: 50, y: 50 }

type ActionId = 'run' | 'enabled' | 'lock' | 'duplicate' | 'remove' | 'delete' | 'color'

/**
 * Spinner that swaps to a stop glyph on hover.
 *
 * Carries the run's status announcement: the glyph itself is decorative, but
 * the block going from idle to running is only otherwise conveyed by the
 * button's `aria-label` flip, which a screen reader reads on focus rather than
 * when the state changes.
 */
function RunningActionIcon() {
  return (
    <span className={styles.runningIcon} role='status'>
      <span className={styles.srOnly}>Block running</span>
      <span aria-hidden='true' className={styles.spinner}>
        <svg className={styles.icon} viewBox='0 0 24 24' fill='none' aria-hidden='true'>
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
      <span aria-hidden='true' className={styles.stopGlyph}>
        <Square className={styles.stopIcon} strokeWidth={0} />
      </span>
    </span>
  )
}

interface NoteColorMenuProps {
  className: string
  disabled: boolean
  tooltipEnabled: boolean
  noteColor: NoteColor
  onNoteColorChange?: (color: NoteColor) => void
  onNoteColorMenuOpen?: () => void
}

/**
 * The note palette: the swell's color button (canvas look) opening an EMCN popover of swatches. The
 * popup is chrome, so it takes the Platform's popover and roles instead of the legacy dropdown.
 */
function NoteColorMenu({
  className,
  disabled,
  tooltipEnabled,
  noteColor,
  onNoteColorChange,
  onNoteColorMenuOpen,
}: NoteColorMenuProps) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const swatchesRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) onNoteColorMenuOpen?.()
  }

  /* Arrow keys move between swatches, as the legacy radio group's menu did. */
  const handleSwatchKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const options = Array.from(
      swatchesRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []
    )
    const current = options.findIndex((option) => option === document.activeElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    const next = options[(current + step + options.length) % options.length]
    if (!next) return
    event.preventDefault()
    next.focus()
  }

  const renderTrigger = (button: ReactElement) => (
    <Tooltip label='Color' enabled={tooltipEnabled}>
      {isValidElement<ButtonHTMLAttributes<HTMLButtonElement>>(button)
        ? cloneElement(button, {
            className,
            disabled,
            onClick: (event) => event.stopPropagation(),
            children: <Palette className={styles.icon} />,
          })
        : button}
    </Tooltip>
  )

  return (
    <span ref={anchorRef} className={styles.menuAnchor}>
      <AnchoredPopover
        label='Note color'
        presentation='menu'
        anchor={anchorRef}
        open={open}
        onOpenChange={handleOpenChange}
        trigger={renderTrigger}
      >
        <div
          ref={swatchesRef}
          role='radiogroup'
          aria-label='Note color'
          className={styles.swatches}
          onKeyDown={handleSwatchKeyDown}
        >
          {NOTE_COLOR_OPTIONS.map((option) => (
            <button
              key={option.id}
              type='button'
              role='radio'
              aria-checked={option.id === noteColor}
              aria-label={option.label}
              className={styles.swatchOption}
              onClick={(event) => {
                event.stopPropagation()
                if (isNoteColor(option.id)) onNoteColorChange?.(option.id)
                setOpen(false)
              }}
            >
              <span
                className={styles.swatch}
                data-selected={option.id === noteColor ? '' : undefined}
                style={{ backgroundColor: option.fill }}
              />
            </button>
          ))}
        </div>
      </AnchoredPopover>
    </span>
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
  /** Whether this block is currently executing. */
  isRunning?: boolean
  /** Whether any block in the current workflow is executing. */
  isWorkflowRunning?: boolean
  noteColor?: NoteColor
  onNoteColorChange?: (color: NoteColor) => void
  /** Keeps the note and its swell selected while the portalled color menu is open. */
  onNoteColorMenuOpen?: () => void
}

/**
 * The legacy editor's hover action bar for blocks, subflows and notes: run/stop, enable, lock,
 * duplicate, remove from subflow, delete and the note color, drawn in the card's border swell with
 * the legacy pixels. Tooltips and the color popup are EMCN chrome.
 */
export const ActionBar = memo(
  function ActionBar({
    blockId,
    blockType,
    disabled = false,
    isRunning = false,
    isWorkflowRunning = false,
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
    const setPendingSelection = useWorkflowRegistry((state) => state.setPendingSelection)
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
        toast.error(validation.message ?? '')
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

    const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
    const snapshot = useLastExecutionSnapshot(activeWorkflowId)
    const userPermissions = useUserPermissionsContext()
    const dependenciesSatisfied = useWorkflowStore((state) =>
      selectRunFromBlockDependenciesSatisfied(blockId, state.edges, snapshot)
    )

    const isStartBlock = isInputDefinitionTrigger(blockType)
    const isResponseBlock = blockType === 'response'
    const isNoteBlock = blockType === 'note'
    const isInsideSubflow = parentId && (parentType === 'loop' || parentType === 'parallel')

    const canRunFromBlock =
      dependenciesSatisfied && !isNoteBlock && !isInsideSubflow && !isWorkflowRunning
    /*
     * One rule per action, shared by the button's `disabled` and its handler —
     * previously the handler cancelled unconditionally while `disabled` only
     * applied to Run, so a locked or read-only workflow still offered a Stop
     * the server answers with 403. Cancelling is gated on `disabled` alone:
     * that is `!canEditWorkflow`, which mirrors the route's `write` check,
     * while a per-block lock has no bearing on stopping the whole run.
     */
    const canStopWorkflow = isWorkflowRunning && !disabled
    const canRunBlock =
      !isWorkflowRunning && canRunFromBlock && !disabled && !isLocked && !isParentLocked
    const firstActionId: ActionId = isNoteBlock
      ? 'color'
      : !isInsideSubflow || isWorkflowRunning
        ? 'run'
        : 'enabled'
    /* The slots the hatch runs across — they blank their icons so it reads
       uninterrupted. Not memoised: only `indexOf` is read, never the array's
       identity, so a memo here would allocate a deps array to save an
       allocation of the same size. */
    const runningSweepActionIds: ActionId[] = [
      ...(!isNoteBlock ? (['enabled'] as const) : []),
      ...(userPermissions.canAdmin ? (['lock'] as const) : []),
      ...(!isStartBlock && !isResponseBlock ? (['duplicate'] as const) : []),
      ...(!isStartBlock && isInsideSubflow ? (['remove'] as const) : []),
      'delete',
    ]
    /*
     * Gated on the workflow as well as the block. `isRunning` comes from
     * `activeBlockIds`, which carries no `isExecuting` guard of its own — so a
     * run that exited without clearing it would otherwise leave this card's
     * icons at `opacity-0` with a 160ms interval ticking forever. Every run
     * path sets both, so this changes nothing that is reachable today.
     */
    const isSweeping = isWorkflowRunning && isRunning
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
     * triangle's optical center sits left of its viewBox center; the Note
     * palette uses the same inset so its first-action padding matches.
     *
     * Icon treatment follows the swell's own fill, published by the card view
     * as `data-node-selected`. Keying off React Flow's raw `selected` would
     * diverge: an executing block keeps the success ring, so the swell stays
     * gray (or retracts) while `selected` is still true.
     */
    const getActionButtonStyles = (actionId: ActionId) => {
      const runningSweepIndex = runningSweepActionIds.indexOf(actionId)
      const isRunningSweepSlot = isSweeping && runningSweepIndex >= 0

      return cn(
        styles.button,
        styles.swellButton,
        !isWorkflowRunning &&
          ((actionId === 'enabled' && !isEnabled) || (actionId === 'lock' && isLocked)) &&
          styles.toggled,
        actionId === 'run' && isRunning && styles.running,
        actionId === firstActionId && styles.first,
        actionId === firstActionId &&
          (actionId === 'run' || actionId === 'color' ? styles.firstWide : styles.firstNarrow),
        actionId === 'delete' && styles.last,
        /*
         * A bystander card's actions dim mid-run because they are not available
         * — but `run` is Stop while the workflow runs, and `canStopWorkflow` is
         * true on every card, running or not. Dimming it styled a live control
         * as a dead one: it recovered full opacity only once the pointer was
         * already on it, so it read as unclickable right up until you clicked.
         * It keeps the ordinary resting and hover chrome instead.
         */
        isWorkflowRunning && !isRunning && actionId !== 'run' && styles.dimmed,
        /* The hatch is painted across the row, not per slot — a slot only clears
           itself out of its way. */
        isRunningSweepSlot && styles.sweepSlot,
        /* Important in CSS: these buttons are also `disabled` when locked, and
           the disabled opacity would otherwise outrank it. */
        !isWorkflowRunning && actionId !== 'lock' && isLocked && styles.lockedDim
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

    const runTooltip = (() => {
      if (isWorkflowRunning) return getTooltipMessage('Stop')
      if (isLocked || isParentLocked) return 'Block is locked'
      if (disabled) return getTooltipMessage('Run')
      if (!dependenciesSatisfied) return 'Run previous blocks first'
      return 'Run'
    })()

    return (
      <div data-workflow-action-bar-swell='' className={cn(styles.bar, styles.swell)}>
        <div className={cn(styles.row, styles.rowSwell)}>
          {/*
            Painted behind the row rather than into each slot, so the hatch has a
            single phase across the whole span. The run/stop button keeps an
            opaque fill while running, which masks the hatch behind it; every
            other slot is transparent mid-run, so it shows through.
          */}
          {isSweeping && (
            <span aria-hidden='true' className={cn(styles.hatch, styles.hatchSwell)}>
              <span className={styles.hatchFill} />
            </span>
          )}
          {!isNoteBlock && (!isInsideSubflow || isWorkflowRunning) && (
            <Tooltip label={runTooltip}>
              <button
                type='button'
                aria-label={isWorkflowRunning ? 'Stop workflow' : 'Run block'}
                onClick={(e) => {
                  e.stopPropagation()
                  if (canStopWorkflow) {
                    handleCancelExecution()
                    return
                  }
                  if (canRunBlock) handleRunFromBlockClick()
                }}
                className={getActionButtonStyles('run')}
                data-run-group={isWorkflowRunning ? '' : undefined}
                disabled={!canStopWorkflow && !canRunBlock}
              >
                {isWorkflowRunning ? (
                  isRunning ? (
                    <RunningActionIcon />
                  ) : (
                    <Square className={styles.stopIcon} aria-hidden='true' strokeWidth={0} />
                  )
                ) : (
                  <PlayOutline className={styles.icon} />
                )}
              </button>
            </Tooltip>
          )}

          {!isNoteBlock && (
            <Tooltip
              label={
                isLocked || isParentLocked
                  ? 'Block is locked'
                  : !isEnabled && isParentDisabled
                    ? 'Parent container is disabled'
                    : getTooltipMessage(isEnabled ? 'Disable' : 'Enable')
              }
              enabled={!isWorkflowRunning}
            >
              <button
                type='button'
                aria-label={isEnabled ? 'Disable' : 'Enable'}
                onClick={(e) => {
                  e.stopPropagation()
                  const cantEnable = !isEnabled && isParentDisabled
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
                {isEnabled ? <Circle className={styles.icon} /> : <Ban className={styles.icon} />}
              </button>
            </Tooltip>
          )}

          {isNoteBlock && (
            <NoteColorMenu
              className={getActionButtonStyles('color')}
              disabled={
                isWorkflowRunning || disabled || isLocked || isParentLocked || !onNoteColorChange
              }
              tooltipEnabled={!isWorkflowRunning}
              noteColor={noteColor}
              onNoteColorChange={onNoteColorChange}
              onNoteColorMenuOpen={onNoteColorMenuOpen}
            />
          )}

          {userPermissions.canAdmin && (
            <Tooltip
              label={
                isLocked && isParentLocked
                  ? 'Parent container is locked'
                  : isLocked
                    ? 'Unlock'
                    : 'Lock'
              }
              enabled={!isWorkflowRunning}
            >
              <button
                type='button'
                aria-label={isLocked ? 'Unlock' : 'Lock'}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!disabled && !(isLocked && isParentLocked)) {
                    collaborativeBatchToggleLocked([blockId])
                  }
                }}
                className={getActionButtonStyles('lock')}
                disabled={isWorkflowRunning || disabled || (isLocked && isParentLocked)}
              >
                {isLocked ? <Lock className={styles.icon} /> : <Unlock className={styles.icon} />}
              </button>
            </Tooltip>
          )}

          {!isStartBlock && !isResponseBlock && (
            <Tooltip
              label={
                isLocked || isParentLocked ? 'Block is locked' : getTooltipMessage('Duplicate')
              }
              enabled={!isWorkflowRunning}
            >
              <button
                type='button'
                aria-label='Duplicate'
                onClick={(e) => {
                  e.stopPropagation()
                  if (!disabled && !isLocked && !isParentLocked) {
                    handleDuplicateBlock()
                  }
                }}
                className={getActionButtonStyles('duplicate')}
                disabled={isWorkflowRunning || disabled || isLocked || isParentLocked}
              >
                <Duplicate className={styles.icon} />
              </button>
            </Tooltip>
          )}

          {!isStartBlock && parentId && (parentType === 'loop' || parentType === 'parallel') && (
            <Tooltip
              label={
                isLocked || isParentLocked
                  ? 'Block is locked'
                  : getTooltipMessage('Remove from Subflow')
              }
              enabled={!isWorkflowRunning}
            >
              <button
                type='button'
                aria-label='Remove from Subflow'
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
                <LogOut className={styles.icon} />
              </button>
            </Tooltip>
          )}

          <Tooltip
            label={isLocked || isParentLocked ? 'Block is locked' : getTooltipMessage('Delete')}
            enabled={!isWorkflowRunning}
          >
            <button
              type='button'
              aria-label='Delete'
              onClick={(e) => {
                e.stopPropagation()
                if (!disabled && !isLocked && !isParentLocked) {
                  collaborativeBatchRemoveBlocks([blockId])
                }
              }}
              className={getActionButtonStyles('delete')}
              disabled={isWorkflowRunning || disabled || isLocked || isParentLocked}
            >
              <Trash className={styles.icon} />
            </button>
          </Tooltip>
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
      prevProps.isRunning === nextProps.isRunning &&
      prevProps.isWorkflowRunning === nextProps.isWorkflowRunning &&
      prevProps.noteColor === nextProps.noteColor &&
      prevProps.onNoteColorChange === nextProps.onNoteColorChange &&
      prevProps.onNoteColorMenuOpen === nextProps.onNoteColorMenuOpen
    )
  }
)
