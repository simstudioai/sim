import type { ReactNode } from 'react'
import { Badge, cn, handleKeyboardActivation } from '@sim/emcn'
import { RepeatIcon, SplitIcon } from 'lucide-react'
import { Handle, Position } from 'reactflow'
import { HANDLE_POSITIONS } from '../dimensions'
import { tileIconColorClass } from '../lib/tile-icon-color'
import type { BlockRunStatus, DiffStatus } from '../types'

/** Data attached to loop/parallel container nodes. */
export interface SubflowNodeData {
  width?: number
  height?: number
  parentId?: string
  extent?: 'parent'
  isPreview?: boolean
  /** Whether this subflow is selected in preview mode. */
  isPreviewSelected?: boolean
  kind: 'loop' | 'parallel'
  name?: string
  /** Execution status passed by preview/snapshot views. */
  executionStatus?: 'success' | 'error' | 'not-executed'
  /** Whether the parent workflow is locked and should render read-only. */
  isWorkflowLocked?: boolean
}

/**
 * Props for the pure subflow (loop/parallel container) renderer.
 *
 * Geometry and presentation come from `data`; the state that the editor would
 * read from stores — enabled/locked flags, focus, execution and diff status,
 * nesting depth, and edit permission — is resolved by the container and passed
 * in. The editor-only action bar is injected via the `actionBar` slot so the
 * pure renderer carries no store, socket, or permission coupling.
 */
export interface SubflowNodeViewProps {
  id: string
  data: SubflowNodeData
  /** ReactFlow selection flag. */
  selected?: boolean
  isEnabled: boolean
  isLocked: boolean
  /** Whether this subflow is the focused block in the editor panel. */
  isFocused: boolean
  /** Resolved run-path outcome for the execution ring. */
  runPathStatus?: BlockRunStatus
  /** Diff state when comparing workflow versions. */
  diffStatus?: DiffStatus
  /** Depth in the parent container hierarchy (drives nesting styling). */
  nestingLevel: number
  canEditWorkflow: boolean
  /** Selects this subflow in the editor panel. */
  onSelect: () => void
  /** Editor-only action bar; omit in read-only / preview contexts. */
  actionBar?: ReactNode
}

const HANDLE_STYLE = {
  top: `${HANDLE_POSITIONS.DEFAULT_Y_OFFSET}px`,
  transform: 'translateY(-50%)',
} as const

/** Reusable handle classes, matching the workflow-block handle styling. */
const getHandleClasses = (position: 'left' | 'right') => {
  const baseClasses = '!z-[10] !cursor-crosshair !border-none !transition-[colors] !duration-150'
  const colorClasses = '!bg-[var(--workflow-edge)]'

  const positionClasses = {
    left: '!left-[-8px] !h-5 !w-[7px] !rounded-l-[2px] !rounded-r-none hover-hover:!left-[-11px] hover-hover:!w-[10px] hover-hover:!rounded-l-full',
    right:
      '!right-[-8px] !h-5 !w-[7px] !rounded-r-[2px] !rounded-l-none hover-hover:!right-[-11px] hover-hover:!w-[10px] hover-hover:!rounded-r-full',
  }

  return cn(baseClasses, colorClasses, positionClasses[position])
}

/**
 * Pure renderer for loop/parallel execution containers: a resizable container
 * with a header (icon, name, disabled/locked badges), a start pill with its
 * source handle, and the left/right connection handles.
 */
export function SubflowNodeView({
  id,
  data,
  selected,
  isEnabled,
  isLocked,
  isFocused,
  runPathStatus,
  diffStatus,
  nestingLevel,
  canEditWorkflow,
  onSelect,
  actionBar,
}: SubflowNodeViewProps) {
  const isPreview = data?.isPreview || false
  const isPreviewSelected = data?.isPreviewSelected || false
  const executionStatus = data.executionStatus

  const startHandleId = data.kind === 'loop' ? 'loop-start-source' : 'parallel-start-source'
  const endHandleId = data.kind === 'loop' ? 'loop-end-source' : 'parallel-end-source'
  const BlockIcon = data.kind === 'loop' ? RepeatIcon : SplitIcon
  const blockIconBg = data.kind === 'loop' ? '#2FB3FF' : '#FEE12B'
  const blockName = data.name || (data.kind === 'loop' ? 'Loop' : 'Parallel')

  const isSelected = !isPreview && selected
  const hasRing =
    isFocused ||
    isSelected ||
    isPreviewSelected ||
    diffStatus === 'new' ||
    diffStatus === 'edited' ||
    !!runPathStatus

  /**
   * Ring color priority: selection (blue) → diff (green/orange) → run-path
   * (green/red). Uses boxShadow (not outline) so child nodes rendered as
   * viewport-level siblings by ReactFlow don't clip the parent's ring.
   */
  const getRingColor = (): string | undefined => {
    if (!hasRing) return undefined
    if (isFocused || isSelected || isPreviewSelected) return 'var(--brand-secondary)'
    if (diffStatus === 'new') return 'var(--brand-accent)'
    if (diffStatus === 'edited') return 'var(--warning)'
    if (runPathStatus === 'success') {
      return executionStatus ? 'var(--brand-accent)' : 'var(--border-success)'
    }
    if (runPathStatus === 'error') return 'var(--text-error)'
    return undefined
  }
  const ringColor = getRingColor()

  return (
    <div className='group pointer-events-none relative'>
      <div
        className='relative select-none rounded-lg border border-[var(--border-1)] transition-block-bg'
        style={{
          width: data.width || 500,
          height: data.height || 300,
          overflow: 'visible',
          pointerEvents: 'none',
          ...(ringColor && {
            boxShadow: `0 0 0 1.75px ${ringColor}`,
          }),
        }}
        data-node-id={id}
        data-type='subflowNode'
        data-nesting-level={nestingLevel}
        data-subflow-selected={isFocused || isSelected || isPreviewSelected}
      >
        {!isPreview && actionBar}

        {/* Header Section */}
        <div
          role='button'
          tabIndex={0}
          aria-label={`Select ${blockName}`}
          onClick={onSelect}
          onKeyDown={(event) => handleKeyboardActivation(event, onSelect)}
          className='workflow-drag-handle flex cursor-grab items-center justify-between rounded-t-[8px] border-[var(--border)] border-b bg-[var(--surface-2)] py-2 pr-3 pl-2 [&:active]:cursor-grabbing'
          style={{ pointerEvents: 'auto' }}
        >
          <div className='flex min-w-0 flex-1 items-center gap-2.5'>
            <div
              className='flex size-[24px] flex-shrink-0 items-center justify-center rounded-md'
              style={{ backgroundColor: isEnabled ? blockIconBg : 'gray' }}
            >
              <BlockIcon
                className={cn(
                  'size-[16px]',
                  isEnabled ? tileIconColorClass(blockIconBg) : 'text-[var(--text-icon)]'
                )}
              />
            </div>
            <span
              className={cn(
                'truncate font-medium text-md',
                !isEnabled && 'text-[var(--text-muted)]'
              )}
              title={blockName}
            >
              {blockName}
            </span>
          </div>
          <div className='flex items-center gap-1'>
            {!isEnabled && <Badge variant='gray-secondary'>disabled</Badge>}
            {isLocked && <Badge variant='gray-secondary'>locked</Badge>}
          </div>
        </div>

        {/*
         * Subflow body background. Captures clicks to select the subflow in the
         * panel editor, matching the header click behavior. Child nodes and edges
         * are rendered as sibling divs at the viewport level by ReactFlow (not as
         * DOM children), so enabling pointer events here doesn't block them.
         */}
        <div
          role='button'
          tabIndex={isPreview ? -1 : 0}
          aria-label={`Select ${blockName}`}
          className='workflow-drag-handle absolute inset-0 top-[44px] cursor-grab rounded-b-[8px] [&:active]:cursor-grabbing'
          style={{ pointerEvents: isPreview ? 'none' : 'auto' }}
          onClick={onSelect}
          onKeyDown={(event) => handleKeyboardActivation(event, onSelect)}
        />

        {!isPreview && canEditWorkflow && (
          <div
            role='separator'
            aria-orientation='horizontal'
            className='absolute right-[8px] bottom-2 z-20 flex size-[32px] cursor-se-resize items-center justify-center text-muted-foreground'
            style={{ pointerEvents: 'auto' }}
          />
        )}

        <div
          className='relative h-[calc(100%-50px)] pt-4 pr-[80px] pb-4 pl-4'
          data-dragarea='true'
          style={{ pointerEvents: 'none' }}
        >
          {/* Subflow Start */}
          <div
            className='absolute top-4 left-[16px] flex items-center justify-center rounded-lg border border-[var(--border-1)] bg-[var(--surface-2)] px-3 py-1.5'
            style={{ pointerEvents: isPreview ? 'none' : 'auto' }}
            data-parent-id={id}
            data-node-role={`${data.kind}-start`}
            data-extent='parent'
          >
            <span className='font-medium text-[var(--text-primary)] text-sm'>Start</span>

            <Handle
              type='source'
              position={Position.Right}
              id={startHandleId}
              className={getHandleClasses('right')}
              style={{
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'auto',
              }}
              data-parent-id={id}
            />
          </div>
        </div>

        {/* Input handle on left middle */}
        <Handle
          type='target'
          position={Position.Left}
          className={getHandleClasses('left')}
          style={{
            ...HANDLE_STYLE,
            pointerEvents: 'auto',
          }}
        />

        {/* Output handle on right middle */}
        <Handle
          type='source'
          position={Position.Right}
          className={getHandleClasses('right')}
          style={{
            ...HANDLE_STYLE,
            pointerEvents: 'auto',
          }}
          id={endHandleId}
        />
      </div>
    </div>
  )
}
