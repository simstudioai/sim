'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Maximize2, X, Zap } from 'lucide-react'
import { Badge, Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { getBlock } from '@/blocks'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * Expandable section for displaying large subblock values.
 * Supports inline expansion and fullscreen modal view.
 */
function ExpandableValue({ title, value }: { title: string; value: unknown }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const displayValue = formatSubBlockValue(value)
  const isLargeValue = displayValue.length > 100 || displayValue.includes('\n')

  if (!isLargeValue) {
    return (
      <div className='rounded-[4px] border border-[var(--border)] bg-[var(--surface-3)] p-[10px]'>
        <pre className='whitespace-pre-wrap break-words font-mono text-[12px] text-[var(--text-primary)]'>
          {displayValue}
        </pre>
      </div>
    )
  }

  return (
    <>
      <div>
        <div className='mb-[4px] flex items-center justify-end gap-[4px]'>
          <button
            onClick={() => setIsModalOpen(true)}
            className='rounded-[4px] p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]'
            title='Expand in modal'
            type='button'
          >
            <Maximize2 className='h-[12px] w-[12px]' />
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className='rounded-[4px] p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]'
            type='button'
          >
            {isExpanded ? (
              <ChevronUp className='h-[12px] w-[12px]' />
            ) : (
              <ChevronDown className='h-[12px] w-[12px]' />
            )}
          </button>
        </div>
        <div
          className={cn(
            'overflow-y-auto rounded-[4px] border border-[var(--border)] bg-[var(--surface-3)] p-[10px] font-mono text-[12px] transition-all duration-200',
            isExpanded ? 'max-h-64' : 'max-h-20'
          )}
        >
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

/**
 * Format a subblock value for display.
 * Handles various types including objects, arrays, booleans, etc.
 */
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
 * Get display label for a subblock type.
 */
function getSubBlockTypeLabel(type: string): string {
  const typeLabels: Record<string, string> = {
    'short-input': 'Text',
    'long-input': 'Text Area',
    dropdown: 'Select',
    combobox: 'Combobox',
    slider: 'Slider',
    table: 'Table',
    code: 'Code',
    switch: 'Toggle',
    'tool-input': 'Tool',
    'checkbox-list': 'Checkboxes',
    'grouped-checkbox-list': 'Grouped Checkboxes',
    'condition-input': 'Condition',
    'eval-input': 'Evaluation',
    'time-input': 'Time',
    'oauth-input': 'OAuth',
    'webhook-config': 'Webhook',
    'schedule-info': 'Schedule',
    'file-selector': 'File',
    'project-selector': 'Project',
    'channel-selector': 'Channel',
    'user-selector': 'User',
    'folder-selector': 'Folder',
    'knowledge-base-selector': 'Knowledge Base',
    'knowledge-tag-filters': 'Tag Filters',
    'document-selector': 'Document',
    'document-tag-entry': 'Document Tags',
    'mcp-server-selector': 'MCP Server',
    'mcp-tool-selector': 'MCP Tool',
    'mcp-dynamic-args': 'MCP Args',
    'input-format': 'Input Format',
    'response-format': 'Response Format',
    'trigger-save': 'Trigger',
    'file-upload': 'File Upload',
    'input-mapping': 'Input Mapping',
    'variables-input': 'Variables',
    'messages-input': 'Messages',
    'workflow-selector': 'Workflow',
    'workflow-input-mapper': 'Workflow Input',
    text: 'Text',
  }

  return typeLabels[type] || type
}

/**
 * Individual subblock row showing label, type, and value.
 */
function SubBlockRow({
  subBlockConfig,
  value,
}: {
  subBlockConfig: SubBlockConfig
  value: unknown
}) {
  const title = subBlockConfig.title || subBlockConfig.id
  const typeLabel = getSubBlockTypeLabel(subBlockConfig.type)
  const hasValue = value !== null && value !== undefined && value !== ''

  return (
    <div className='flex flex-col gap-[6px] border-[var(--border)] border-b py-[10px] last:border-b-0'>
      <div className='flex items-center justify-between gap-[8px]'>
        <span className='font-medium text-[13px] text-[var(--text-primary)]'>{title}</span>
        <Badge variant='gray-secondary' className='text-[10px]'>
          {typeLabel}
        </Badge>
      </div>
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
  /** The block state containing subblock values */
  block: BlockState
  /** Callback when closing the panel */
  onClose: () => void
}

/**
 * Pinned panel displaying all subblock values for a selected block.
 * Overlays the workflow preview canvas in the top-right corner.
 */
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

  // Get visible subblocks (filter out hidden ones)
  const visibleSubBlocks = blockConfig.subBlocks.filter(
    (subBlock) => !subBlock.hidden && !subBlock.hideFromPreview
  )

  // Get subblock values from block state
  const subBlockValues = block.subBlocks || {}

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
