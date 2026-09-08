'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Check,
  cn,
  Duplicate,
  handleKeyboardActivation,
  PlayOutline,
  Switch,
  Tooltip,
  Trash,
} from '@sim/emcn'
import { Circle, Square, Unlock } from '@sim/emcn/icons'
import {
  BLOCK_DIMENSIONS,
  CanvasSentenceView,
  HANDLE_POSITIONS,
  InlineChip,
  SubBlockRowView,
  WorkflowBlockBorder,
  type WorkflowBorderPort,
  WorkflowTypeTag,
} from '@sim/workflow-renderer'
import { WORKFLOW_SOURCE_HANDLE_ID, WORKFLOW_TARGET_HANDLE_ID } from '@sim/workflow-types/workflow'
import {
  type BlockDef,
  blockHeight,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

interface StageBlockCardProps {
  block: BlockDef
  orientation?: 'horizontal' | 'vertical'
  selected?: boolean
  /** Keeps the production selection toolbar visible in a noninteractive graphic. */
  decorative?: boolean
  runStatus?: 'idle' | 'running' | 'complete'
  onSelect?: (blockId: string) => void
  onRunToggle?: (blockId: string) => void
  /** Reports when the initial silhouette and any selection toolbar are painted. */
  onReady?: (blockId: string) => void
}

const CONNECTION_TAB_LENGTH = 36
const BRANCH_TAB_LENGTH = 24
const ACTION_END_BUTTON_WIDTH = 40
const ACTION_MIDDLE_BUTTON_WIDTH = 24
const ACTION_BUTTON_GAP = 2
const ACTION_MENU_HORIZONTAL_PADDING = 6
const ACTION_MENU_RIGHT_INSET = 24
const ACTION_MENU_AMPLITUDE = 7

function getActionMenuWidth(block: BlockDef): number {
  const actionCount = block.isTrigger ? 4 : 5
  const middleActionCount = actionCount - 2
  return (
    ACTION_END_BUTTON_WIDTH * 2 +
    ACTION_MIDDLE_BUTTON_WIDTH * middleActionCount +
    ACTION_BUTTON_GAP * (actionCount - 1) +
    ACTION_MENU_HORIZONTAL_PADDING
  )
}

function getPorts(
  block: BlockDef,
  actionMenuWidth: number,
  orientation: 'horizontal' | 'vertical'
): WorkflowBorderPort[] {
  const ports: WorkflowBorderPort[] = []
  const horizontalTabLength =
    blockHeight(block) === BLOCK_DIMENSIONS.MIN_PAINTED_HEIGHT ? 10 : CONNECTION_TAB_LENGTH

  if (orientation === 'horizontal') {
    if (!block.isTrigger) {
      ports.push({
        id: WORKFLOW_TARGET_HANDLE_ID,
        side: 'left',
        position: 'center',
        plateau: horizontalTabLength,
      })
    }

    if (block.type === 'condition') {
      block.rows.forEach((row, index) => {
        ports.push({
          id: `condition-${row.title.toLowerCase()}`,
          side: 'right',
          position:
            HANDLE_POSITIONS.CONDITION_START_Y + index * HANDLE_POSITIONS.CONDITION_ROW_HEIGHT,
          plateau: BRANCH_TAB_LENGTH,
        })
      })
    } else if (!block.isTerminal) {
      ports.push({
        id: WORKFLOW_SOURCE_HANDLE_ID,
        side: 'right',
        position: 'center',
        plateau: horizontalTabLength,
      })
    }
  } else {
    if (!block.isTrigger) {
      ports.push({
        id: WORKFLOW_TARGET_HANDLE_ID,
        side: 'top',
        position: 'center',
        plateau: CONNECTION_TAB_LENGTH,
      })
    }

    if (!block.isTerminal) {
      ports.push({
        id: WORKFLOW_SOURCE_HANDLE_ID,
        side: 'bottom',
        position: 'center',
        plateau: CONNECTION_TAB_LENGTH,
      })
    }
  }

  if (actionMenuWidth > 0) {
    ports.push({
      id: 'action-menu',
      side: 'top',
      position: { fromEnd: ACTION_MENU_RIGHT_INSET + actionMenuWidth / 2 },
      plateau: actionMenuWidth,
      restAmplitude: ACTION_MENU_AMPLITUDE,
      hoverAmplitude: ACTION_MENU_AMPLITUDE,
      magnetizable: false,
    })
  }

  return ports
}

const ACTION_BUTTON_BASE_CLASSES =
  'size-[24px] rounded-md border-none bg-transparent p-0 text-[var(--text-icon)] transition-[background-color,color,opacity,transform] duration-150 active:scale-[0.96]'

function getActionButtonClassName(
  position: 'first' | 'middle' | 'last',
  selected: boolean
): string {
  return cn(
    ACTION_BUTTON_BASE_CLASSES,
    selected &&
      'text-[var(--surface-2)] hover-hover:bg-[var(--surface-2)] hover-hover:!text-[var(--text-primary)]',
    position === 'first' &&
      "!w-[40px] [clip-path:path('M23.75_0A8_8_0_0_0_17.6_2.88L3.41_19.9A2.5_2.5_0_0_0_5.34_24L36_24A4_4_0_0_0_40_20L40_4A4_4_0_0_0_36_0Z')] [&>svg]:translate-x-[8px] [&>svg]:translate-y-px",
    position === 'last' &&
      "!w-[40px] [clip-path:path('M16.25_0A8_8_0_0_1_22.4_2.88L36.59_19.9A2.5_2.5_0_0_1_34.66_24L4_24A4_4_0_0_1_0_20L0_4A4_4_0_0_1_4_0Z')] [&_svg]:-translate-x-[6px] [&_svg]:translate-y-px"
  )
}

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
      <Square
        aria-hidden='true'
        className='col-start-1 row-start-1 size-[11px] fill-current opacity-0 transition-opacity duration-100 group-hover/run:opacity-100 group-focus-visible/run:opacity-100 motion-reduce:transition-none'
        strokeWidth={0}
      />
    </span>
  )
}

/**
 * Read-only production workflow card for the landing preview. The shared
 * renderer owns the real rounded silhouette, type tag, compact rows, ports,
 * and pointer-following edge swell. React Flow handles and callbacks are
 * intentionally omitted: visitors can feel the hover treatment without
 * creating connections, nodes, or mutations in the public demo.
 *
 * In the homepage's interactive mode, selection opens one production-shaped
 * action swell with the production action set. Run/Stop remains usable while
 * duplicate, lock, enable/disable, and delete stay visible but disabled.
 */
export function StageBlockCard({
  block,
  orientation = 'vertical',
  selected = false,
  decorative = false,
  runStatus = 'idle',
  onSelect,
  onRunToggle,
  onReady,
}: StageBlockCardProps) {
  const borderHostRef = useRef<HTMLDivElement>(null)
  const readyReportedRef = useRef(false)
  const type = block.type ?? (block.isTrigger ? 'start_trigger' : 'starter')
  const running = runStatus === 'running'
  const complete = runStatus === 'complete'
  const showErrorRow = !block.isTrigger
  const hasContentBelowHeader = Boolean(block.sentence || block.rows.length > 0 || showErrorRow)
  const showActionMenu = Boolean((decorative || onRunToggle) && (selected || running))
  const actionMenuWidth = showActionMenu ? getActionMenuWidth(block) : 0
  const [actionMenuReady, setActionMenuReady] = useState(false)

  useEffect(() => {
    if (!showActionMenu) setActionMenuReady(false)
  }, [showActionMenu])

  useEffect(() => {
    const host = borderHostRef.current
    if (!onReady || !host || readyReportedRef.current || (showActionMenu && !actionMenuReady)) {
      return
    }

    const reportReady = () => {
      const silhouette = host.querySelector(':scope > svg > path[fill][stroke]')
      if (!silhouette?.getAttribute('d')) return false
      readyReportedRef.current = true
      onReady(block.id)
      return true
    }

    if (reportReady()) return

    /** The production renderer commits its measured SVG after its first layout pass. */
    const observer = new MutationObserver(() => {
      if (reportReady()) observer.disconnect()
    })
    observer.observe(host, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [actionMenuReady, block.id, onReady, showActionMenu])

  const ringStyles = selected
    ? 'ring-[1.5px] ring-[var(--text-secondary)]'
    : complete
      ? 'ring-[1.5px] ring-[var(--border-success)]'
      : ''

  return (
    <div
      className='group relative h-full w-[250px] select-none rounded-2xl'
      data-workflow-card
      inert={decorative}
      data-node-selected={selected ? '' : undefined}
      data-action-menu-ready={actionMenuReady ? '' : undefined}
      style={{ minHeight: BLOCK_DIMENSIONS.MIN_PAINTED_HEIGHT }}
    >
      {showActionMenu ? (
        <>
          <div
            aria-hidden='true'
            data-workflow-action-bar-bridge
            className='-top-[28px] pointer-events-auto absolute inset-x-0 z-10 h-[28px]'
          />
          <div
            className={cn(
              '-top-[28px] pointer-events-auto absolute right-[24px] z-40 flex h-[28px] items-center gap-[2px] overflow-hidden rounded-lg px-[0.2rem] py-0.5 opacity-0 transition-opacity duration-[30ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] group-data-[action-menu-ready]:opacity-100 group-data-[action-menu-ready]:duration-100',
              onReady && 'transition-none'
            )}
            style={{ width: actionMenuWidth }}
          >
            <Tooltip.Root preferAbove>
              <Tooltip.Trigger asChild>
                <Button
                  type='button'
                  variant='ghost'
                  size={null}
                  className={cn(
                    getActionButtonClassName('first', selected),
                    running &&
                      'group/run !bg-[var(--text-secondary)] !text-[var(--text-inverse)] hover-hover:!bg-[var(--white)] hover-hover:!text-[var(--surface-inverted)]'
                  )}
                  aria-label={running ? `Stop ${block.name}` : `Run ${block.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onRunToggle?.(block.id)
                  }}
                >
                  {running ? (
                    <RunningActionIcon />
                  ) : complete ? (
                    <Check className='size-[14px]' />
                  ) : (
                    <PlayOutline className='size-[14px]' />
                  )}
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>{running ? 'Stop' : 'Run'}</Tooltip.Content>
            </Tooltip.Root>
            {[
              { label: 'Disable', Icon: Circle },
              { label: 'Lock', Icon: Unlock },
              ...(!block.isTrigger ? [{ label: 'Duplicate', Icon: Duplicate }] : []),
              { label: 'Delete', Icon: Trash },
            ].map(({ label, Icon }) => (
              <Tooltip.Root key={label} preferAbove>
                <Tooltip.Trigger asChild>
                  <span className='inline-flex'>
                    <Button
                      type='button'
                      variant='ghost'
                      size={null}
                      disabled={!decorative}
                      aria-label={`${label} unavailable in preview`}
                      className={cn(
                        'pointer-events-none',
                        getActionButtonClassName(label === 'Delete' ? 'last' : 'middle', selected)
                      )}
                    >
                      <Icon className='size-[14px]' />
                    </Button>
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>{label} is unavailable in preview</Tooltip.Content>
              </Tooltip.Root>
            ))}
          </div>
        </>
      ) : null}

      <div
        ref={borderHostRef}
        role={onSelect ? 'button' : undefined}
        tabIndex={onSelect ? 0 : undefined}
        aria-pressed={onSelect ? selected : undefined}
        onClick={() => onSelect?.(block.id)}
        onKeyDown={(event) => {
          if (onSelect) handleKeyboardActivation(event, () => onSelect(block.id))
        }}
        className={cn(
          'relative h-full w-full rounded-2xl',
          onSelect && 'cursor-pointer focus-visible:outline-none'
        )}
      >
        <WorkflowBlockBorder
          nodeId={block.id}
          ports={getPorts(block, actionMenuWidth, orientation)}
          cursorSwellEnabled={!decorative}
          canStartConnection={!decorative && !block.isTerminal}
          canReceiveConnection={!decorative && !block.isTrigger}
          hasRing={selected || complete}
          ringStyles={ringStyles}
          isSelected={selected}
          initialHeight={blockHeight(block)}
          onActionMenuReadyChange={showActionMenu ? setActionMenuReady : undefined}
        />

        <div
          className={cn(
            'relative z-10 flex items-center justify-between px-2',
            hasContentBelowHeader ? 'h-[40px]' : 'h-[48px]'
          )}
        >
          <span className='min-w-0 flex-1 truncate text-[17px] text-[var(--text-primary)]'>
            {block.name}
          </span>
          <WorkflowTypeTag
            type={type}
            typeLabel={block.typeLabel ?? block.name}
            Icon={block.icon}
            iconBgColor={block.bgColor}
            isIntegration={block.isIntegration}
          />
        </div>

        {hasContentBelowHeader ? (
          <div className='relative z-10 flex flex-col gap-2 p-2'>
            {block.sentence ? (
              <CanvasSentenceView
                segments={block.sentence.segments}
                renderChip={(subBlockId) => {
                  const value = block.sentence?.values[subBlockId]
                  return value ? (
                    <InlineChip>
                      <span className='block max-w-[138px] truncate'>{value}</span>
                    </InlineChip>
                  ) : null
                }}
              />
            ) : (
              block.rows.map((row) => (
                <SubBlockRowView key={row.title} title={row.title} displayValue={row.value} />
              ))
            )}

            {showErrorRow ? (
              <div className='flex h-[24px] shrink-0 items-center justify-between rounded-[6px] bg-[var(--surface-5)] pr-1 pl-2 dark:bg-[var(--surface-4)]'>
                <span className='text-[var(--text-secondary)] text-caption'>On error</span>
                <Switch
                  checked={false}
                  aria-label='On error branch disabled in preview'
                  disabled
                  className='scale-[0.72]'
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
