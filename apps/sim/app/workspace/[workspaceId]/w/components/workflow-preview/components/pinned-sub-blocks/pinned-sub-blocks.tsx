'use client'

import { useState } from 'react'
import { Maximize2, X, Zap } from 'lucide-react'
import { Badge, Button } from '@/components/emcn'
import { getBlock } from '@/blocks'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type { BlockState } from '@/stores/workflows/workflow/types'

function ExpandableValue({ title, value }: { title: string; value: unknown }) {
  const [isModalOpen, setIsModalOpen] = useState(false)

  const displayValue = formatSubBlockValue(value)
  const isLargeValue = displayValue.length > 100 || displayValue.includes('\n')

  return (
    <>
      <div className='relative'>
        {isLargeValue && (
          <button
            onClick={() => setIsModalOpen(true)}
            className='absolute top-[6px] right-[6px] z-10 rounded-[4px] p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-4)] hover:text-[var(--text-primary)]'
            title='Expand in modal'
            type='button'
          >
            <Maximize2 className='h-[12px] w-[12px]' />
          </button>
        )}
        <div className='max-h-24 overflow-y-auto rounded-[4px] border border-[var(--border)] bg-[var(--surface-3)] p-[10px] font-mono text-[12px]'>
          <pre className='whitespace-pre-wrap break-words text-[var(--text-primary)]'>
            {displayValue}
          </pre>
        </div>
      </div>

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

function formatSubBlockValue(value: unknown): string {
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
 * Evaluate whether a subblock's condition is met based on current values.
 * Returns true if the subblock should be visible.
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

function SubBlockRow({
  subBlockConfig,
  value,
}: {
  subBlockConfig: SubBlockConfig
  value: unknown
}) {
  const title = subBlockConfig.title || subBlockConfig.id
  const hasValue = value !== null && value !== undefined && value !== ''

  return (
    <div className='flex flex-col gap-[6px] border-[var(--border)] border-b py-[10px] last:border-b-0'>
      <span className='font-medium text-[13px] text-[var(--text-primary)]'>{title}</span>
      {hasValue ? (
        <ExpandableValue title={title} value={value} />
      ) : (
        <div className='rounded-[4px] border border-[var(--border)] bg-[var(--surface-3)] p-[10px]'>
          <span className='text-[12px] text-[var(--text-tertiary)]'>No value configured</span>
        </div>
      )}
    </div>
  )
}

interface PinnedSubBlocksProps {
  block: BlockState
  onClose: () => void
}

export function PinnedSubBlocks({ block, onClose }: PinnedSubBlocksProps) {
  const blockConfig = getBlock(block.type) as BlockConfig | undefined

  if (!blockConfig) {
    return (
      <div className='absolute top-[16px] right-[16px] z-[100] max-h-[calc(100%-32px)] w-80 overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] shadow-lg'>
        <div className='flex items-center justify-between border-[var(--border)] border-b p-[12px]'>
          <div className='flex items-center gap-[8px]'>
            <Zap className='h-[16px] w-[16px] text-[var(--text-secondary)]' />
            <span className='font-medium text-[15px] text-[var(--text-primary)]'>
              {block.name || 'Unknown Block'}
            </span>
          </div>
          <Button variant='ghost' className='!p-[4px]' onClick={onClose}>
            <X className='h-[16px] w-[16px]' />
          </Button>
        </div>
        <div className='p-[12px]'>
          <p className='text-[13px] text-[var(--text-secondary)]'>Block configuration not found.</p>
        </div>
      </div>
    )
  }

  const subBlockValues = block.subBlocks || {}

  const visibleSubBlocks = blockConfig.subBlocks.filter((subBlock) => {
    if (subBlock.hidden || subBlock.hideFromPreview) return false

    if (subBlock.condition) {
      return evaluateCondition(subBlock.condition, subBlockValues)
    }

    return true
  })

  return (
    <div className='absolute top-[16px] right-[16px] z-[100] flex max-h-[calc(100%-32px)] w-80 flex-col overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] shadow-lg'>
      {/* Header */}
      <div className='flex flex-shrink-0 items-center justify-between border-[var(--border)] border-b p-[12px]'>
        <div className='flex min-w-0 items-center gap-[8px]'>
          <div
            className='h-[16px] w-[16px] flex-shrink-0 rounded-[4px]'
            style={{ backgroundColor: blockConfig.bgColor }}
          />
          <span className='min-w-0 truncate font-medium text-[15px] text-[var(--text-primary)]'>
            {block.name || blockConfig.name}
          </span>
        </div>
        <Button variant='ghost' className='!p-[4px] flex-shrink-0' onClick={onClose}>
          <X className='h-[16px] w-[16px]' />
        </Button>
      </div>

      {/* Block Type Badge */}
      <div className='flex flex-shrink-0 items-center gap-[8px] border-[var(--border)] border-b px-[12px] py-[8px]'>
        <Badge variant='gray-secondary'>{blockConfig.name}</Badge>
        {block.enabled === false && (
          <Badge variant='red' className='text-[10px]'>
            Disabled
          </Badge>
        )}
      </div>

      {/* Subblock Values */}
      <div className='flex-1 overflow-y-auto px-[12px]'>
        {visibleSubBlocks.length > 0 ? (
          visibleSubBlocks.map((subBlock, index) => {
            const valueObj = subBlockValues[subBlock.id]
            const value = valueObj?.value !== undefined ? valueObj.value : valueObj

            return (
              <SubBlockRow
                key={`${subBlock.id}-${index}`}
                subBlockConfig={subBlock}
                value={value}
              />
            )
          })
        ) : (
          <div className='py-[16px] text-center'>
            <p className='text-[13px] text-[var(--text-secondary)]'>
              No configurable fields for this block.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
