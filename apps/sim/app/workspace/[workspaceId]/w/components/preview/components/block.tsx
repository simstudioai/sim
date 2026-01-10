'use client'

import { memo, useMemo } from 'react'
import { Handle, type NodeProps, Position } from 'reactflow'
import { HANDLE_POSITIONS } from '@/lib/workflows/blocks/block-dimensions'
import { getBlock } from '@/blocks'

/** Execution status for blocks in preview mode */
type ExecutionStatus = 'success' | 'error' | 'not-executed'

interface WorkflowPreviewBlockData {
  type: string
  name: string
  isTrigger?: boolean
  horizontalHandles?: boolean
  enabled?: boolean
  /** Whether this block is selected in preview mode */
  isPreviewSelected?: boolean
  /** Execution status for highlighting error/success states */
  executionStatus?: ExecutionStatus
}

/**
 * Lightweight block component for workflow previews.
 * Renders block header, dummy subblocks skeleton, and handles.
 * Respects horizontalHandles and enabled state from workflow.
 * No heavy hooks, store subscriptions, or interactive features.
 * Used in template cards and other preview contexts for performance.
 */
function WorkflowPreviewBlockInner({ data }: NodeProps<WorkflowPreviewBlockData>) {
  const {
    type,
    name,
    isTrigger = false,
    horizontalHandles = false,
    enabled = true,
    isPreviewSelected = false,
    executionStatus,
  } = data

  const blockConfig = getBlock(type)

  const visibleSubBlocks = useMemo(() => {
    if (!blockConfig?.subBlocks) return []

    return blockConfig.subBlocks.filter((subBlock) => {
      if (subBlock.hidden) return false
      if (subBlock.hideFromPreview) return false
      if (subBlock.mode === 'trigger') return false
      if (subBlock.mode === 'advanced') return false
      return true
    })
  }, [blockConfig?.subBlocks])

  if (!blockConfig) {
    return null
  }

  const IconComponent = blockConfig.icon
  const isStarterOrTrigger = blockConfig.category === 'triggers' || type === 'starter' || isTrigger

  const hasSubBlocks = visibleSubBlocks.length > 0
  const showErrorRow = !isStarterOrTrigger

  const horizontalHandleClass = '!border-none !bg-[var(--surface-7)] !h-5 !w-[7px] !rounded-[2px]'
  const verticalHandleClass = '!border-none !bg-[var(--surface-7)] !h-[7px] !w-5 !rounded-[2px]'

  const hasError = executionStatus === 'error'
  const hasSuccess = executionStatus === 'success'

  return (
    <div className='relative w-[250px] select-none rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'>
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

      {/* Target handle - not shown for triggers/starters */}
      {!isStarterOrTrigger && (
        <Handle
          type='target'
          position={horizontalHandles ? Position.Left : Position.Top}
          id='target'
          className={horizontalHandles ? horizontalHandleClass : verticalHandleClass}
          style={
            horizontalHandles
              ? { left: '-7px', top: `${HANDLE_POSITIONS.DEFAULT_Y_OFFSET}px` }
              : { top: '-7px', left: '50%', transform: 'translateX(-50%)' }
          }
        />
      )}

      {/* Header */}
      <div
        className={`flex items-center gap-[10px] p-[8px] ${hasSubBlocks || showErrorRow ? 'border-[var(--divider)] border-b' : ''}`}
      >
        <div
          className='flex h-[24px] w-[24px] flex-shrink-0 items-center justify-center rounded-[6px]'
          style={{ background: enabled ? blockConfig.bgColor : 'gray' }}
        >
          <IconComponent className='h-[16px] w-[16px] text-white' />
        </div>
        <span
          className={`truncate font-medium text-[16px] ${!enabled ? 'text-[#808080]' : ''}`}
          title={name}
        >
          {name}
        </span>
      </div>

      {/* Subblocks skeleton */}
      {(hasSubBlocks || showErrorRow) && (
        <div className='flex flex-col gap-[8px] p-[8px]'>
          {visibleSubBlocks.slice(0, 4).map((subBlock) => (
            <div key={subBlock.id} className='flex items-center gap-[8px]'>
              <span className='min-w-0 truncate text-[14px] text-[var(--text-tertiary)] capitalize'>
                {subBlock.title ?? subBlock.id}
              </span>
              <span className='flex-1 truncate text-right text-[14px] text-[var(--white)]'>-</span>
            </div>
          ))}
          {visibleSubBlocks.length > 4 && (
            <div className='flex items-center gap-[8px]'>
              <span className='text-[14px] text-[var(--text-tertiary)]'>
                +{visibleSubBlocks.length - 4} more
              </span>
            </div>
          )}
          {showErrorRow && (
            <div className='flex items-center gap-[8px]'>
              <span className='min-w-0 truncate text-[14px] text-[var(--text-tertiary)] capitalize'>
                error
              </span>
            </div>
          )}
        </div>
      )}

      {/* Source handle */}
      <Handle
        type='source'
        position={horizontalHandles ? Position.Right : Position.Bottom}
        id='source'
        className={horizontalHandles ? horizontalHandleClass : verticalHandleClass}
        style={
          horizontalHandles
            ? { right: '-7px', top: `${HANDLE_POSITIONS.DEFAULT_Y_OFFSET}px` }
            : { bottom: '-7px', left: '50%', transform: 'translateX(-50%)' }
        }
      />
    </div>
  )
}

function shouldSkipPreviewBlockRender(
  prevProps: NodeProps<WorkflowPreviewBlockData>,
  nextProps: NodeProps<WorkflowPreviewBlockData>
): boolean {
  return (
    prevProps.id === nextProps.id &&
    prevProps.data.type === nextProps.data.type &&
    prevProps.data.name === nextProps.data.name &&
    prevProps.data.isTrigger === nextProps.data.isTrigger &&
    prevProps.data.horizontalHandles === nextProps.data.horizontalHandles &&
    prevProps.data.enabled === nextProps.data.enabled &&
    prevProps.data.isPreviewSelected === nextProps.data.isPreviewSelected &&
    prevProps.data.executionStatus === nextProps.data.executionStatus
  )
}

export const WorkflowPreviewBlock = memo(WorkflowPreviewBlockInner, shouldSkipPreviewBlockRender)
