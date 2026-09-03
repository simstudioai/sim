import { memo, useCallback } from 'react'
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
import { Ban, Circle, Lock, LogOut, Palette, Square, Unlock } from '@sim/emcn/icons'
import {
  DEFAULT_NOTE_COLOR,
  isNoteColor,
  NOTE_COLOR_OPTIONS,
  type NoteColor,
} from '@sim/workflow-renderer'
import { useShallow } from 'zustand/react/shallow'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import {
  getRunFromBlockDependencyState,
  validateTriggerPaste,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useLastExecutionSnapshot } from '@/stores/execution'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const DEFAULT_DUPLICATE_OFFSET = { x: 50, y: 50 }

const ACTION_BUTTON_STYLES = [
  'size-[24px] rounded-md p-0',
  'border-none bg-transparent text-[var(--text-icon)]',
  'hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-primary)]!',
  'dark:hover-hover:bg-[var(--surface-4)]',
  'transition-[background-color,color,opacity,transform] duration-150 active:scale-[0.96]',
].join(' ')

/**
 * The running hatch: the squares' own rhythm, sheared left, scrolling.
 *
 * Indeterminate, not a progress fill — it spans the whole run and the pattern
 * marches (`animate-running-hatch-scroll` shifts the background by exactly one
 * 26px period, which is what makes the loop seamless). A block gives no signal
 * of how far along it is, so a bar that filled was inventing one.
 *
 * Same geometry the slots used before — a 24px mark with the row's 2px gap after
 * it — so the marks land where the squares did. The scroll period below must
 * stay equal to that 26px pitch or the loop visibly jumps.
 *
 * Painted ONCE across the row, not per slot. Each button would start its own
 * gradient at its own origin, so the phase reset at every slot — and the end
 * slots are 40px against the others' 24px, so the resets were not even uniform.
 * One element spanning the row has one gradient and therefore one phase, which
 * is what lets the 24/2 rhythm hold all the way along.
 *
 * Stops are measured along the 75° axis rather than horizontally, so both carry
 * a `sin(75°)` factor: 24px of mark is 23.18px of stop, and the 26px pitch is
 * 25.11px of period. Writing 24/26 directly would render ~3.5% wide and drift
 * out of the squares' rhythm across the row.
 *
 * Each edge ramps over 0.75px rather than switching colour at a single offset,
 * which is why the stops come in pairs 0.375px either side of the mark's two
 * edges. A gradient is sampled once per pixel with no coverage term, so a hard
 * stop on a 15°-off-vertical edge can only ever land wholly on one side or the
 * other — the marks came out visibly stepped, which is the one thing a shape
 * this thin cannot hide. Ramping across roughly a device pixel gives the
 * rasterizer the intermediate values antialiasing would have produced, and
 * measured edge deviation drops from 0.28 device px (pure quantization) to 0.05.
 *
 * The period runs centre-of-mark to centre-of-mark (11.59 → 36.7) rather than
 * starting at an edge, because a repeating gradient truncates at its own wrap:
 * anchored at 0, the ramp leaving the mark would have run 24.735 → 25.485 and
 * been cut at 25.11, so that edge got half the feather and the gap came out
 * 1.93 → 1.75px. Both ramps have to sit strictly inside the period. The list
 * still tiles backwards from its first stop, so the marks land exactly where
 * anchoring at 0 put them — same 26px pitch, same phase against the squares.
 *
 * Widening the feather further would keep smoothing, but the gap is only 1.93px
 * of stop, so it comes straight out of the mark's dark core.
 *
 * `--surface-2` is the same fill the slots used; only where it is painted moved.
 */
const RUNNING_FILL =
  'bg-[repeating-linear-gradient(75deg,var(--surface-2)_11.59px_22.805px,transparent_23.555px_24.735px,var(--surface-2)_25.485px_36.7px)]'

/** Left edge of the fill: clears the run/stop button, which stays live mid-run. */
const RUNNING_FILL_INSET_SWELL = 'left-[42px]'
const RUNNING_FILL_INSET_PLAIN = 'left-[26px]'

/**
 * Trims the fill to the swell's tapered end.
 *
 * The row is a rectangle but the swell is not: its last slot cuts a diagonal
 * (`M16.25 0 … L36.59 19.9 …`) so the shape narrows toward the top. A rectangular
 * overlay therefore paints past the gray edge at the top while still sitting
 * inside it at the bottom — the fill visibly ran off the block. The per-slot
 * version never did, because each button's own clip contained it.
 *
 * Same taper, read off that path. Its straight run — (22.4, 2.88) to
 * (36.59, 19.9) in the slot's own 40×24 box — has a slope of 20/24, so across
 * the full row it moves from 20px in at the top to flush at the bottom. The
 * overlay spans the row, so those are its two numbers; they are the slot's own
 * edge continued, which is what puts the hatch's end exactly where a hovered
 * slot's fill ends. Changing the end silhouette means changing them with it.
 */
const RUNNING_FILL_END_TAPER = '[clip-path:polygon(0_0,calc(100%_-_20px)_0,100%_100%,0_100%)]'

const ICON_SIZE = 'size-[14px]'

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
    <span
      className='relative grid size-[14px] translate-x-[8px] translate-y-px place-items-center'
      role='status'
    >
      <span className='sr-only'>Block running</span>
      <span
        aria-hidden='true'
        className='col-start-1 row-start-1 opacity-100 transition-opacity duration-100 group-hover/run:opacity-0 group-focus-visible/run:opacity-0 motion-safe:animate-spin motion-reduce:transition-none'
      >
        <svg className='size-[14px]' viewBox='0 0 24 24' fill='none'>
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
      <span
        aria-hidden='true'
        className='col-start-1 row-start-1 opacity-0 transition-opacity duration-100 group-hover/run:opacity-100 group-focus-visible/run:opacity-100 motion-reduce:transition-none'
      >
        <Square className='size-[11px] fill-current' strokeWidth={0} />
      </span>
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
  /** Places the actions inside the workflow card's border swell. */
  variant?: 'floating' | 'swell'
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

    const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
    const snapshot = useLastExecutionSnapshot(activeWorkflowId)
    const userPermissions = useUserPermissionsContext()
    const edges = useWorkflowStore((state) => state.edges)

    const isStartBlock = isInputDefinitionTrigger(blockType)
    const isResponseBlock = blockType === 'response'
    const isNoteBlock = blockType === 'note'
    const isInsideSubflow = parentId && (parentType === 'loop' || parentType === 'parallel')

    const { dependenciesSatisfied } = getRunFromBlockDependencyState(blockId, edges, snapshot)
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
    const isSwell = variant === 'swell'
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
        'hover-hover:group-data-[node-selected]:text-[var(--text-primary)]!',
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
      const isRunningSweepSlot = isSweeping && runningSweepIndex >= 0

      return cn(
        actionButtonStyles,
        !isWorkflowRunning &&
          ((actionId === 'enabled' && !isEnabled) || (actionId === 'lock' && isLocked)) && [
            'bg-[var(--text-secondary)] text-[var(--text-inverse)]',
          ],
        actionId === 'run' &&
          isRunning && [
            'bg-[var(--text-secondary)]! text-[var(--text-inverse)]!',
            'hover-hover:bg-[var(--white)]! hover-hover:text-[var(--surface-inverted)]!',
            'dark:hover-hover:bg-[var(--surface-4)]! dark:hover-hover:text-[var(--text-primary)]!',
            'focus-visible:bg-[var(--white)]! focus-visible:text-[var(--surface-inverted)]!',
            'dark:focus-visible:bg-[var(--surface-4)]! dark:focus-visible:text-[var(--text-primary)]!',
          ],
        isSwell &&
          actionId === firstActionId &&
          "w-[40px]! [clip-path:path('M23.75_0A8_8_0_0_0_17.6_2.88L3.41_19.9A2.5_2.5_0_0_0_5.34_24L36_24A4_4_0_0_0_40_20L40_4A4_4_0_0_0_36_0Z')] [&>svg]:translate-y-px",
        isSwell &&
          actionId === firstActionId &&
          (actionId === 'run' || actionId === 'color'
            ? '[&>svg]:translate-x-[8px]'
            : '[&>svg]:translate-x-[6px]'),
        isSwell &&
          actionId === 'delete' &&
          "w-[40px]! [clip-path:path('M16.25_0A8_8_0_0_1_22.4_2.88L36.59_19.9A2.5_2.5_0_0_1_34.66_24L4_24A4_4_0_0_1_0_20L0_4A4_4_0_0_1_4_0Z')] [&_svg]:-translate-x-[6px] [&_svg]:translate-y-px",
        /*
         * A bystander card's actions dim mid-run because they are not available
         * — but `run` is Stop while the workflow runs, and `canStopWorkflow` is
         * true on every card, running or not. Dimming it styled a live control
         * as a dead one: it recovered full opacity only once the pointer was
         * already on it, so it read as unclickable right up until you clicked.
         * It keeps the ordinary resting and hover chrome instead.
         */
        isWorkflowRunning &&
          !isRunning &&
          actionId !== 'run' && [
            'bg-transparent! opacity-25!',
            'hover-hover:bg-transparent! dark:hover-hover:bg-transparent!',
          ],
        /* The hatch is painted across the row, not per slot — a slot only clears
           itself out of its way. */
        isRunningSweepSlot && [
          'opacity-100! [&_svg]:opacity-0!',
          'bg-transparent! hover-hover:bg-transparent!',
        ],
        /* `!` is required: these buttons are also `disabled` when locked, and
           the emcn Button base carries `disabled:opacity-70`, which outranks a
           plain `opacity-35` on specificity. */
        !isWorkflowRunning && actionId !== 'lock' && isLocked && 'opacity-35!'
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
        <div
          className={cn(
            'relative flex flex-row items-center gap-[2px]',
            isSwell && [
              'pointer-events-none h-full opacity-0 transition-opacity [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]',
              'group-data-[action-menu-ready]:pointer-events-auto group-data-[action-menu-ready]:opacity-100 group-data-[action-menu-ready]:duration-100',
            ]
          )}
        >
          {/*
            Painted behind the row rather than into each slot, so the hatch has a
            single phase across the whole span. The run/stop button keeps an
            opaque fill while running, which masks the hatch behind it; every
            other slot is transparent mid-run, so it shows through.
          */}
          {isSweeping && (
            <span
              aria-hidden='true'
              className={cn(
                /* Spans the row, so the hatch occupies exactly the box a slot's
                   hover fill does — same height, and the same padding in from
                   the swell on every side, since the row already sits inside
                   the container's own inset. */
                'pointer-events-none absolute inset-y-0 right-0 overflow-hidden',
                isSwell ? RUNNING_FILL_INSET_SWELL : RUNNING_FILL_INSET_PLAIN,
                isSwell && RUNNING_FILL_END_TAPER
              )}
            >
              <span
                className={cn(
                  /* One period wider than the wrapper, so translating a full
                     period never exposes an edge at either end. */
                  'block h-full w-[calc(100%_+_26px)] will-change-transform',
                  'animate-running-hatch-scroll motion-reduce:animate-none',
                  RUNNING_FILL
                )}
              />
            </span>
          )}
          {!isNoteBlock && (!isInsideSubflow || isWorkflowRunning) && (
            <Tooltip.Root preferAbove>
              <Tooltip.Trigger asChild>
                <span className='inline-flex'>
                  <Button
                    variant='ghost'
                    aria-label={isWorkflowRunning ? 'Stop workflow' : 'Run block'}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (canStopWorkflow) {
                        handleCancelExecution()
                        return
                      }
                      if (canRunBlock) handleRunFromBlockClick()
                    }}
                    className={cn(getActionButtonStyles('run'), isWorkflowRunning && 'group/run')}
                    disabled={!canStopWorkflow && !canRunBlock}
                  >
                    {isWorkflowRunning ? (
                      isRunning ? (
                        <RunningActionIcon />
                      ) : (
                        <Square
                          className='size-[11px] fill-current'
                          aria-hidden='true'
                          strokeWidth={0}
                        />
                      )
                    ) : (
                      <PlayOutline className={ICON_SIZE} />
                    )}
                  </Button>
                </span>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>
                {(() => {
                  if (isWorkflowRunning) return getTooltipMessage('Stop')
                  if (isLocked || isParentLocked) return 'Block is locked'
                  if (disabled) return getTooltipMessage('Run')
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
                      isWorkflowRunning ||
                      disabled ||
                      isLocked ||
                      isParentLocked ||
                      (!isEnabled && isParentDisabled)
                    }
                  >
                    {isEnabled ? <Circle className={ICON_SIZE} /> : <Ban className={ICON_SIZE} />}
                  </Button>
                </span>
              </Tooltip.Trigger>
              {!isWorkflowRunning && (
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
                {!isWorkflowRunning && <Tooltip.Content side='top'>Color</Tooltip.Content>}
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
                    disabled={isWorkflowRunning || disabled || (isLocked && isParentLocked)}
                  >
                    {isLocked ? <Lock className={ICON_SIZE} /> : <Unlock className={ICON_SIZE} />}
                  </Button>
                </span>
              </Tooltip.Trigger>
              {!isWorkflowRunning && (
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
                    disabled={isWorkflowRunning || disabled || isLocked || isParentLocked}
                  >
                    <Duplicate className={ICON_SIZE} />
                  </Button>
                </span>
              </Tooltip.Trigger>
              {!isWorkflowRunning && (
                <Tooltip.Content side='top'>
                  {isLocked || isParentLocked ? 'Block is locked' : getTooltipMessage('Duplicate')}
                </Tooltip.Content>
              )}
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
              {!isWorkflowRunning && (
                <Tooltip.Content side='top'>
                  {isLocked || isParentLocked
                    ? 'Block is locked'
                    : getTooltipMessage('Remove from Subflow')}
                </Tooltip.Content>
              )}
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
                  disabled={isWorkflowRunning || disabled || isLocked || isParentLocked}
                >
                  <Trash className={ICON_SIZE} />
                </Button>
              </span>
            </Tooltip.Trigger>
            {!isWorkflowRunning && (
              <Tooltip.Content side='top'>
                {isLocked || isParentLocked ? 'Block is locked' : getTooltipMessage('Delete')}
              </Tooltip.Content>
            )}
          </Tooltip.Root>
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
      prevProps.isWorkflowRunning === nextProps.isWorkflowRunning &&
      prevProps.noteColor === nextProps.noteColor &&
      prevProps.onNoteColorChange === nextProps.onNoteColorChange &&
      prevProps.onNoteColorMenuOpen === nextProps.onNoteColorMenuOpen
    )
  }
)
