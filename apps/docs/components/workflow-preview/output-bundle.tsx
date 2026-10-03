'use client'

import { ChipTag } from '@sim/emcn'
import { ChevronDown, Clipboard, Download, Search } from '@sim/emcn/icons'
import { DocsBlockTile } from '@/components/workflow-preview/docs-block-tile'
import { cn } from '@/lib/utils'

type ValueType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'

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

function TreeNode({ node, depth = 0 }: { node: OutputNode; depth?: number }) {
  const type = node.type ?? 'string'
  const expanded = node.expanded ?? Boolean(node.children || node.value !== undefined)
  return (
    <div className='flex min-w-0 flex-col'>
      <div className='flex min-h-[26px] items-center gap-2 rounded-[6px] px-1'>
        <span
          className={cn(
            'text-[var(--text-primary)] text-small',
            node.highlight && 'underline decoration-[var(--brand-secondary)] underline-offset-4'
          )}
        >
          {node.key}
        </span>
        <ChipTag>{type}</ChipTag>
        <ChevronDown
          className='size-[14px] flex-shrink-0 text-[var(--text-muted)]'
          style={expanded ? undefined : { transform: 'rotate(-90deg)' }}
        />
      </div>
      {expanded && (node.children || node.value !== undefined) && (
        <div className='mt-0.5 ml-[5px] flex min-w-0 flex-col gap-0.5 border-[var(--border)] border-l pl-[10px]'>
          {node.children
            ? node.children.map((child) => (
                <TreeNode key={child.key} node={child} depth={depth + 1} />
              ))
            : node.value !== undefined && (
                <div className='py-0.5 text-[var(--text-secondary)] text-small'>{node.value}</div>
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
    <div className='not-prose my-6 flex w-full max-w-[640px] flex-col gap-3'>
      <div className='flex overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-1)]'>
        <div className='flex w-[210px] flex-shrink-0 flex-col border-[var(--border)] border-r px-2 py-2'>
          <div className='px-2 pb-2 text-[var(--text-muted)] text-caption'>Logs</div>
          {logRows.map((row) => {
            return (
              <div
                key={row.name}
                className='flex h-[30px] items-center gap-2 rounded-[6px] px-2'
                style={row.selected ? { background: 'var(--surface-active)' } : undefined}
              >
                <DocsBlockTile type={row.type ?? ''} color={row.color ?? 'var(--border)'} />
                <span className='truncate text-[var(--text-primary)] text-small'>{row.name}</span>
                {row.duration && (
                  <span className='ml-auto text-[var(--text-muted)] text-caption'>
                    {row.duration}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        <div className='flex min-w-0 flex-1 flex-col px-3 py-2'>
          <div className='flex items-center gap-3 pb-2'>
            <span className='text-[var(--text-primary)] text-small'>Output</span>
            <span className='text-[var(--text-muted)] text-small'>Input</span>
            <span className='ml-auto flex items-center gap-2 text-[var(--text-subtle)]'>
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
