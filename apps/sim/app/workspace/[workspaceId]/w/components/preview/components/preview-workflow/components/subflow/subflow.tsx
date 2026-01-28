'use client'

import { memo } from 'react'
import { RepeatIcon, SplitIcon } from 'lucide-react'
import { Handle, type NodeProps, Position } from 'reactflow'
import { Badge } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { HANDLE_POSITIONS } from '@/lib/workflows/blocks/block-dimensions'

/** Execution status for subflows in preview mode */
type ExecutionStatus = 'success' | 'error' | 'not-executed'

interface WorkflowPreviewSubflowData {
  name: string
  width?: number
  height?: number
  kind: 'loop' | 'parallel'
  /** Whether this subflow is enabled */
  enabled?: boolean
  /** Whether this subflow is selected in preview mode */
  isPreviewSelected?: boolean
  /** Execution status for highlighting the subflow container */
  executionStatus?: ExecutionStatus
  /** Skips expensive computations for thumbnails/template previews (unused in subflow, for consistency) */
  lightweight?: boolean
}

/**
 * Preview subflow component for workflow visualization.
 * Renders loop/parallel containers without hooks, store subscriptions,
 * or interactive features.
 */
function WorkflowPreviewSubflowInner({ data }: NodeProps<WorkflowPreviewSubflowData>) {
  const {
    name,
    width = 500,
    height = 300,
    kind,
    enabled = true,
    isPreviewSelected = false,
    executionStatus,
  } = data

  const isLoop = kind === 'loop'
  const BlockIcon = isLoop ? RepeatIcon : SplitIcon
  const blockIconBg = isLoop ? '#2FB3FF' : '#FEE12B'
  const blockName = name || (isLoop ? 'Loop' : 'Parallel')

  const startHandleId = isLoop ? 'loop-start-source' : 'parallel-start-source'
  const endHandleId = isLoop ? 'loop-end-source' : 'parallel-end-source'

  const leftHandleClass =
    '!z-[10] !border-none !bg-[var(--workflow-edge)] !h-5 !w-[7px] !rounded-l-[2px] !rounded-r-none'
  const rightHandleClass =
    '!z-[10] !border-none !bg-[var(--workflow-edge)] !h-5 !w-[7px] !rounded-r-[2px] !rounded-l-none'

  const hasError = executionStatus === 'error'
  const hasSuccess = executionStatus === 'success'

  return (
    <div
      className='relative select-none rounded-[8px] border border-[var(--border-1)]'
      style={{
        width,
        height,
      }}
    >
      {/* Selection ring overlay (takes priority over execution rings) */}
      {isPreviewSelected && (
        <div className='pointer-events-none absolute inset-0 z-40 rounded-[8px] ring-[1.75px] ring-[var(--brand-secondary)]' />
      )}
      {/* Success ring overlay (only shown if not selected) */}
      {!isPreviewSelected && hasSuccess && (
        <div className='pointer-events-none absolute inset-0 z-40 rounded-[8px] ring-[1.75px] ring-[var(--brand-tertiary-2)]' />
      )}
      {/* Error ring overlay (only shown if not selected) */}
      {!isPreviewSelected && hasError && (
        <div className='pointer-events-none absolute inset-0 z-40 rounded-[8px] ring-[1.75px] ring-[var(--text-error)]' />
      )}

      {/* Target handle on left (input to the subflow) */}
      <Handle
        type='target'
        position={Position.Left}
        id='target'
        className={leftHandleClass}
        style={{
          left: '-8px',
          top: `${HANDLE_POSITIONS.DEFAULT_Y_OFFSET}px`,
          transform: 'translateY(-50%)',
        }}
      />

      {/* Header - matches actual subflow header structure */}
      <div className='flex items-center justify-between rounded-t-[8px] border-[var(--border)] border-b bg-[var(--surface-2)] py-[8px] pr-[12px] pl-[8px]'>
        <div className='flex min-w-0 flex-1 items-center gap-[10px]'>
          <div
            className='flex h-[24px] w-[24px] flex-shrink-0 items-center justify-center rounded-[6px]'
            style={{ backgroundColor: enabled ? blockIconBg : 'var(--surface-4)' }}
          >
            <BlockIcon className='h-[16px] w-[16px] text-white' />
          </div>
          <span
            className={cn(
              'truncate font-medium text-[16px]',
              !enabled && 'text-[var(--text-muted)]'
            )}
            title={blockName}
          >
            {blockName}
          </span>
        </div>
        {!enabled && <Badge variant='gray-secondary'>disabled</Badge>}
      </div>

      {/* Content area - matches workflow structure */}
      <div
        className='h-[calc(100%-50px)] pt-[16px] pr-[80px] pb-[16px] pl-[16px]'
        style={{ position: 'relative' }}
      >
        {/* Subflow Start - connects to first block in subflow */}
        <div className='absolute top-[16px] left-[16px] flex items-center justify-center rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-2)] px-[12px] py-[6px]'>
          <span className='font-medium text-[14px] text-[var(--text-primary)]'>Start</span>
          <Handle
            type='source'
            position={Position.Right}
            id={startHandleId}
            className={rightHandleClass}
            style={{ right: '-8px', top: '50%', transform: 'translateY(-50%)' }}
          />
        </div>
      </div>

      {/* End source handle on right (output from the subflow) */}
      <Handle
        type='source'
        position={Position.Right}
        id={endHandleId}
        className={rightHandleClass}
        style={{
          right: '-8px',
          top: `${HANDLE_POSITIONS.DEFAULT_Y_OFFSET}px`,
          transform: 'translateY(-50%)',
        }}
      />
    </div>
  )
}

export const PreviewSubflow = memo(WorkflowPreviewSubflowInner)
