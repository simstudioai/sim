'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Maximize2, X } from 'lucide-react'
import { ReactFlowProvider } from 'reactflow'
import { Badge, Button } from '@/components/emcn'
import { SubBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components'
import { getBlock } from '@/blocks'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * Evaluate whether a subblock's condition is met based on current values.
 */
function evaluateCondition(
  condition: SubBlockConfig['condition'],
  subBlockValues: Record<string, { value: unknown } | unknown>
): boolean {
  if (!condition) return true

  const actualCondition = typeof condition === 'function' ? condition() : condition

  const fieldValueObj = subBlockValues[actualCondition.field]
  const fieldValue =
    fieldValueObj && typeof fieldValueObj === 'object' && 'value' in fieldValueObj
      ? (fieldValueObj as { value: unknown }).value
      : fieldValueObj

  const conditionValues = Array.isArray(actualCondition.value)
    ? actualCondition.value
    : [actualCondition.value]

  let isMatch = conditionValues.some((v) => v === fieldValue)

  if (actualCondition.not) {
    isMatch = !isMatch
  }

  if (actualCondition.and && isMatch) {
    const andFieldValueObj = subBlockValues[actualCondition.and.field]
    const andFieldValue =
      andFieldValueObj && typeof andFieldValueObj === 'object' && 'value' in andFieldValueObj
        ? (andFieldValueObj as { value: unknown }).value
        : andFieldValueObj

    const andConditionValues = Array.isArray(actualCondition.and.value)
      ? actualCondition.and.value
      : [actualCondition.and.value]

    let andMatch = andConditionValues.some((v) => v === andFieldValue)

    if (actualCondition.and.not) {
      andMatch = !andMatch
    }

    isMatch = isMatch && andMatch
  }

  return isMatch
}

/**
 * Format a value for display
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—'
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/**
 * Collapsible section for execution data (input/output)
 * Starts collapsed, can be expanded inline or opened in modal
 */
function ExecutionDataSection({ title, data }: { title: string; data: unknown }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const displayValue = formatValue(data)

  return (
    <>
      <div className='overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)]'>
        {/* Header - always visible */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className='flex w-full items-center justify-between px-[10px] py-[8px] text-left transition-colors hover:bg-[var(--surface-3)]'
          type='button'
        >
          <span className='font-medium text-[12px] text-[var(--text-primary)]'>{title}</span>
          <div className='flex items-center gap-[4px]'>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsModalOpen(true)
              }}
              className='rounded-[4px] p-[3px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-4)] hover:text-[var(--text-primary)]'
              title='Expand in modal'
              type='button'
            >
              <Maximize2 className='h-[12px] w-[12px]' />
            </button>
            {isExpanded ? (
              <ChevronUp className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
            ) : (
              <ChevronDown className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
            )}
          </div>
        </button>

        {/* Content - shown when expanded */}
        {isExpanded && (
          <div className='border-[var(--border)] border-t'>
            <div className='max-h-[200px] overflow-y-auto bg-[var(--surface-3)] p-[10px]'>
              <pre className='whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--text-primary)]'>
                {displayValue}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Full-screen modal */}
      {isModalOpen && (
        <div className='fixed inset-0 z-[200] flex items-center justify-center bg-black/50'>
          <div className='mx-[16px] flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] shadow-lg'>
            <div className='flex items-center justify-between border-[var(--border)] border-b p-[16px]'>
              <h3 className='font-medium text-[15px] text-[var(--text-primary)]'>{title}</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className='rounded-[4px] p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]'
                type='button'
              >
                <X className='h-[16px] w-[16px]' />
              </button>
            </div>
            <div className='flex-1 overflow-auto p-[16px]'>
              <pre className='whitespace-pre-wrap break-words font-mono text-[13px] text-[var(--text-primary)]'>
                {displayValue}
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Icon component for rendering block icons
 */
function IconComponent({ icon: Icon, className }: { icon: any; className?: string }) {
  if (!Icon) return null
  return <Icon className={className} />
}

interface ExecutionData {
  input?: unknown
  output?: unknown
  status?: string
  durationMs?: number
}

interface PinnedSubBlocksProps {
  block: BlockState
  onClose: () => void
  executionData?: ExecutionData
}

/**
 * Readonly sidebar panel showing block configuration using SubBlock components.
 */
function PinnedSubBlocksContent({ block, onClose, executionData }: PinnedSubBlocksProps) {
  const blockConfig = getBlock(block.type) as BlockConfig | undefined
  const subBlockValues = block.subBlocks || {}

  if (!blockConfig) {
    return (
      <div className='flex h-full w-80 flex-col border-[var(--border)] border-l bg-[var(--surface-1)]'>
        <div className='flex items-center justify-between bg-[var(--surface-4)] px-[12px] py-[8px]'>
          <div className='flex items-center gap-[8px]'>
            <div className='flex h-[18px] w-[18px] items-center justify-center rounded-[4px] bg-[var(--surface-3)]' />
            <span className='font-medium text-[14px] text-[var(--text-primary)]'>
              {block.name || 'Unknown Block'}
            </span>
          </div>
          <Button variant='ghost' className='!p-[4px]' onClick={onClose}>
            <X className='h-[14px] w-[14px]' />
          </Button>
        </div>
        <div className='p-[12px]'>
          <p className='text-[13px] text-[var(--text-secondary)]'>Block configuration not found.</p>
        </div>
      </div>
    )
  }

  const visibleSubBlocks = blockConfig.subBlocks.filter((subBlock) => {
    if (subBlock.hidden || subBlock.hideFromPreview) return false
    if (subBlock.mode === 'trigger') return false
    if (subBlock.condition) {
      return evaluateCondition(subBlock.condition, subBlockValues)
    }
    return true
  })

  return (
    <div className='flex h-full w-80 flex-col border-[var(--border)] border-l bg-[var(--surface-1)]'>
      {/* Header - styled like editor */}
      <div className='flex flex-shrink-0 items-center justify-between bg-[var(--surface-4)] px-[12px] py-[8px]'>
        <div className='flex min-w-0 items-center gap-[8px]'>
          <div
            className='flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[4px]'
            style={{ backgroundColor: blockConfig.bgColor }}
          >
            <IconComponent
              icon={blockConfig.icon}
              className='h-[12px] w-[12px] text-[var(--white)]'
            />
          </div>
          <span className='min-w-0 truncate font-medium text-[14px] text-[var(--text-primary)]'>
            {block.name || blockConfig.name}
          </span>
          {block.enabled === false && (
            <Badge variant='red' className='text-[10px]'>
              Disabled
            </Badge>
          )}
        </div>
        <Button variant='ghost' className='!p-[4px] flex-shrink-0' onClick={onClose}>
          <X className='h-[14px] w-[14px]' />
        </Button>
      </div>

      {/* Scrollable content */}
      <div className='flex-1 overflow-y-auto'>
        {/* Execution Input/Output (if provided) */}
        {executionData &&
        (executionData.input !== undefined || executionData.output !== undefined) ? (
          <div className='space-y-[8px] border-[var(--border)] border-b px-[12px] py-[10px]'>
            {executionData.input !== undefined && (
              <ExecutionDataSection title='Input' data={executionData.input} />
            )}
            {executionData.output !== undefined && (
              <ExecutionDataSection title='Output' data={executionData.output} />
            )}
          </div>
        ) : null}

        {/* Subblock Values - Using SubBlock components in preview mode */}
        <div className='pointer-events-none px-[8px] py-[8px]'>
          {visibleSubBlocks.length > 0 ? (
            <div className='flex flex-col'>
              {visibleSubBlocks.map((subBlockConfig, index) => (
                <div key={subBlockConfig.id} className='subblock-row'>
                  <SubBlock
                    blockId={block.id}
                    config={subBlockConfig}
                    isPreview={true}
                    subBlockValues={subBlockValues}
                    disabled={true}
                  />
                  {index < visibleSubBlocks.length - 1 && (
                    <div className='subblock-divider px-[2px] pt-[16px] pb-[13px]'>
                      <div
                        className='h-[1.25px]'
                        style={{
                          backgroundImage:
                            'repeating-linear-gradient(to right, var(--border) 0px, var(--border) 6px, transparent 6px, transparent 12px)',
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className='py-[16px] text-center'>
              <p className='text-[13px] text-[var(--text-secondary)]'>
                No configurable fields for this block.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Pinned sub-blocks panel wrapped in ReactFlowProvider for hook compatibility.
 */
export function PinnedSubBlocks(props: PinnedSubBlocksProps) {
  return (
    <ReactFlowProvider>
      <PinnedSubBlocksContent {...props} />
    </ReactFlowProvider>
  )
}
