'use client'

import { memo } from 'react'
import { RepeatIcon, SplitIcon } from 'lucide-react'
import { Handle, type NodeProps, Position } from 'reactflow'
import { HANDLE_POSITIONS } from '@/lib/workflows/blocks/block-dimensions'

interface WorkflowPreviewSubflowData {
  name: string
  width?: number
  height?: number
  kind: 'loop' | 'parallel'
}

/**
 * Lightweight subflow component for workflow previews.
 * Matches the styling of the actual SubflowNodeComponent but without
 * hooks, store subscriptions, or interactive features.
 * Used in template cards and other preview contexts for performance.
 */
function WorkflowPreviewSubflowInner({ data }: NodeProps<WorkflowPreviewSubflowData>) {
  const { name, width = 500, height = 300, kind } = data

  const isLoop = kind === 'loop'
  const BlockIcon = isLoop ? RepeatIcon : SplitIcon
  const blockIconBg = isLoop ? '#2FB3FF' : '#FEE12B'
  const blockName = name || (isLoop ? 'Loop' : 'Parallel')

  // Handle IDs matching the actual subflow component
  const startHandleId = isLoop ? 'loop-start-source' : 'parallel-start-source'
  const endHandleId = isLoop ? 'loop-end-source' : 'parallel-end-source'

  // Handle styles matching the workflow-block component
  const leftHandleClass =
    '!z-[10] !border-none !bg-[var(--workflow-edge)] !h-5 !w-[7px] !rounded-l-[2px] !rounded-r-none'
  const rightHandleClass =
    '!z-[10] !border-none !bg-[var(--workflow-edge)] !h-5 !w-[7px] !rounded-r-[2px] !rounded-l-none'

  return (
    <div
      className='relative select-none rounded-[8px] border border-[var(--border)]'
      style={{
        width,
        height,
      }}
    >
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

      {/* Header - matches actual subflow header */}
      <div className='flex items-center gap-[10px] rounded-t-[8px] border-[var(--border)] border-b bg-[var(--surface-2)] py-[8px] pr-[12px] pl-[8px]'>
        <div
          className='flex h-[24px] w-[24px] flex-shrink-0 items-center justify-center rounded-[6px]'
          style={{ backgroundColor: blockIconBg }}
        >
          <BlockIcon className='h-[16px] w-[16px] text-white' />
        </div>
        <span className='font-medium text-[16px]' title={blockName}>
          {blockName}
        </span>
      </div>

      {/* Start handle inside - connects to first block in subflow */}
      <div className='absolute top-[56px] left-[16px] flex items-center justify-center rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-2)] px-[12px] py-[6px]'>
        <span className='font-medium text-[14px] text-white'>Start</span>
        <Handle
          type='source'
          position={Position.Right}
          id={startHandleId}
          className={rightHandleClass}
          style={{ right: '-8px', top: '50%', transform: 'translateY(-50%)' }}
        />
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

export const WorkflowPreviewSubflow = memo(WorkflowPreviewSubflowInner)
