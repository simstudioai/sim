'use client'

import { ChevronDown, Clipboard, Download, Search } from 'lucide-react'
import { blockTypeToIconMap } from '@/components/ui/icon-mapping'
import { BLOCK_ICONS } from '@/components/workflow-preview/block-icons'

type ValueType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'

/** Dark-theme equivalents of the app's type badges (string=green, number=blue, …). */
const BADGE_COLORS: Record<ValueType, { bg: string; text: string }> = {
  string: { bg: 'var(--wp-badge-success-bg)', text: 'var(--wp-badge-success-text)' },
  number: { bg: 'var(--wp-badge-blue-bg)', text: 'var(--wp-badge-blue-text)' },
  boolean: { bg: 'var(--wp-badge-orange-bg)', text: 'var(--wp-badge-orange-text)' },
  array: { bg: 'var(--wp-badge-purple-bg)', text: 'var(--wp-badge-purple-text)' },
  object: { bg: 'var(--wp-badge-gray-bg)', text: 'var(--wp-badge-gray-text)' },
  null: { bg: 'var(--wp-badge-gray-bg)', text: 'var(--wp-badge-gray-text)' },
}

interface OutputNode {
  key: string
  type?: ValueType
  /** Primitive value shown beneath the key when expanded. */
  value?: string
  /** Nested fields for object/array nodes. */
  children?: OutputNode[]
  /** Collapse the node (chevron points right, nothing rendered beneath). */
  expanded?: boolean
  /** Emphasize this row as the one being read by the tag below. */
  highlight?: boolean
}

interface LogRow {
  name: string
  type?: string
  color?: string
  duration?: string
  selected?: boolean
}

interface OutputBundleProps {
  /** The block's name (unique within the workflow), e.g. "classify". */
  blockName: string
  blockType?: string
  blockColor?: string
  /** Duration shown on the selected log row. */
  duration?: string
  /** Override the Logs column; defaults to Start + this block (selected). */
  logs?: LogRow[]
  values: OutputNode[]
}

function resolveIcon(type: string) {
  return BLOCK_ICONS[type] ?? blockTypeToIconMap[type] ?? null
}

function TypeBadge({ type }: { type: ValueType }) {
  const c = BADGE_COLORS[type]
  return (
    <span
      className='rounded-[4px] px-[5px] py-px text-[10px] leading-[14px]'
      style={{ background: c.bg, color: c.text }}
    >
      {type}
    </span>
  )
}

function TreeNode({ node, depth = 0 }: { node: OutputNode; depth?: number }) {
  const type = node.type ?? 'string'
  const expanded = node.expanded ?? Boolean(node.children || node.value !== undefined)
  return (
    <div className='flex min-w-0 flex-col'>
      <div className='flex min-h-[26px] items-center gap-2 rounded-[6px] px-1'>
        <span
          className='text-[13px]'
          style={{ color: node.highlight ? 'var(--wp-highlight)' : 'var(--wp-text)' }}
        >
          {node.key}
        </span>
        <TypeBadge type={type} />
        <ChevronDown
          className='h-[7px] w-[9px] flex-shrink-0 text-[var(--wp-text-muted)]'
          style={expanded ? undefined : { transform: 'rotate(-90deg)' }}
        />
      </div>
      {expanded && (node.children || node.value !== undefined) && (
        <div className='mt-0.5 ml-[5px] flex min-w-0 flex-col gap-0.5 border-[var(--wp-divider)] border-l pl-[10px]'>
          {node.children
            ? node.children.map((child) => (
                <TreeNode key={child.key} node={child} depth={depth + 1} />
              ))
            : node.value !== undefined && (
                <div className='py-0.5 text-[13px] text-[var(--wp-text-2)]'>{node.value}</div>
              )}
        </div>
      )}
    </div>
  )
}

/**
 * A miniature of the app's run inspector — the Logs list beside the Output
 * panel's typed tree — teaching what a block's output is: named, typed values
 * remembered under the block's name, read with a `<blockName.key>` tag.
 */
export function OutputBundle({
  blockName,
  blockType = 'agent',
  blockColor = '#33C482',
  duration = '1.2s',
  logs,
  values,
}: OutputBundleProps) {
  const logRows: LogRow[] = logs ?? [
    { name: 'Start', type: 'start_trigger', color: '#2FB3FF', duration: '9ms' },
    { name: blockName, type: blockType, color: blockColor, duration, selected: true },
  ]

  return (
    <div className='wp-scope not-prose my-6 flex w-full max-w-[640px] flex-col gap-3'>
      <div className='flex overflow-hidden rounded-xl border border-[var(--wp-border)] bg-[var(--wp-panel)]'>
        <div className='flex w-[210px] flex-shrink-0 flex-col border-[var(--wp-border)] border-r px-2 py-2'>
          <div className='px-2 pb-2 text-[12px] text-[var(--wp-text-muted)]'>Logs</div>
          {logRows.map((row) => {
            const Icon = row.type ? resolveIcon(row.type) : null
            return (
              <div
                key={row.name}
                className='flex h-[30px] items-center gap-2 rounded-[6px] px-2'
                style={row.selected ? { background: 'var(--wp-active)' } : undefined}
              >
                <div
                  className='flex size-[18px] flex-shrink-0 items-center justify-center rounded-[5px]'
                  style={{ background: row.color ?? 'var(--wp-border-1)' }}
                >
                  {Icon && <Icon className='size-[10px] text-white' />}
                </div>
                <span className='truncate text-[13px] text-[var(--wp-text)]'>{row.name}</span>
                {row.duration && (
                  <span className='ml-auto text-[12px] text-[var(--wp-text-muted)]'>
                    {row.duration}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        <div className='flex min-w-0 flex-1 flex-col px-3 py-2'>
          <div className='flex items-center gap-3 pb-2'>
            <span className='text-[13px] text-[var(--wp-text)]'>Output</span>
            <span className='text-[13px] text-[var(--wp-text-muted)]'>Input</span>
            <span className='ml-auto flex items-center gap-2 text-[var(--wp-text-subtle)]'>
              <Search className='size-[12px]' />
              <Clipboard className='size-[12px]' />
              <Download className='size-[12px]' />
              <ChevronDown className='size-[12px]' />
            </span>
          </div>
          <div className='flex min-w-0 flex-col gap-0.5'>
            {values.map((node) => (
              <TreeNode key={node.key} node={node} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
