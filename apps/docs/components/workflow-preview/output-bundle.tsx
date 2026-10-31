'use client'

import { ChevronRight, Download } from '@sim/emcn/icons'
import { cn } from '@/components/docs/classnames'
import { DocsButton } from '@/components/docs/primitives'
import { CopyButton } from '@/components/ui/copy-button'
import { DocsBlockTile } from '@/components/workflow-preview/docs-block-tile'
import { decodeOutputValues, type OutputNode } from '@/lib/content/output'

interface LogRow {
  name: string
  type?: string
  color?: string
  duration?: string
  selected?: boolean
}
export interface OutputBundleProps {
  blockName: string
  blockType?: string
  blockColor?: string
  duration?: string
  logs?: LogRow[]
  values: OutputNode[]
}
interface TreeNodeProps {
  node: OutputNode
}

function TreeNode({ node }: TreeNodeProps) {
  const hasValue = node.children !== undefined || node.type === 'null' || node.value !== undefined
  return (
    <details
      open={node.expanded ?? hasValue}
      className='min-w-0 py-1 [&[open]>summary>svg]:rotate-90'
    >
      <summary
        className={cn(
          'flex min-h-7 cursor-pointer list-none items-center gap-2 rounded-md px-1 text-docs-control hover:bg-[var(--docs-hover)] focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] [&::-webkit-details-marker]:hidden',
          node.highlight && 'text-[var(--docs-link)]'
        )}
      >
        <ChevronRight className='size-4 shrink-0 text-[var(--docs-muted)] transition-transform motion-reduce:transition-none' />
        <span className='break-all font-mono'>{node.key}</span>
        <span className='font-mono text-[var(--docs-muted)]'>{node.type ?? 'string'}</span>
      </summary>
      <div className='min-w-0 py-1 pl-6'>
        {node.children?.map((child) => (
          <TreeNode key={child.key} node={child} />
        ))}
        {node.value !== undefined && (
          <div className='whitespace-pre-wrap break-words text-docs-table'>{node.value}</div>
        )}
        {node.value === undefined && (node.type === 'null' || node.children?.length === 0) && (
          <div className='font-mono text-docs-table'>
            {node.type === 'null' ? 'null' : node.type === 'array' ? '[]' : '{}'}
          </div>
        )}
        {!hasValue && <span className='text-[var(--docs-muted)] text-docs-caption'>No value</span>}
      </div>
    </details>
  )
}

/** Interactive typed output fixture. Copy and download preserve every nested source value. */
export function OutputBundle({
  blockName,
  blockType = 'agent',
  blockColor = '#33C482',
  duration = '1.2s',
  logs,
  values,
}: OutputBundleProps) {
  const rows = logs ?? [
    { name: 'Start', type: 'start_trigger', color: '#2FB3FF', duration: '9ms' },
    { name: blockName, type: blockType, color: blockColor, duration, selected: true },
  ]
  const serialized = JSON.stringify(decodeOutputValues(values), null, 2)
  function download() {
    const url = URL.createObjectURL(new Blob([serialized], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${blockName.replace(/[^a-zA-Z0-9_-]/g, '-')}-output.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className='not-prose my-7 min-w-0 overflow-hidden rounded-lg border border-[var(--docs-border)] bg-[var(--docs-canvas)]'>
      <div className='flex min-w-0 flex-col sm:flex-row'>
        <div className='shrink-0 border-[var(--docs-border)] border-b p-2 sm:w-[178px] sm:border-r sm:border-b-0'>
          <div className='px-2 pb-2 text-[var(--docs-muted)] text-docs-caption'>Logs</div>
          <ul className='space-y-0.5'>
            {rows.map((row) => (
              <li
                key={row.name}
                className={cn(
                  'flex min-h-[30px] items-center gap-2 rounded-md px-2 text-docs-control',
                  row.selected && 'bg-[var(--docs-selected)]'
                )}
              >
                <DocsBlockTile type={row.type ?? ''} color={row.color ?? 'var(--docs-border)'} />
                <span className='min-w-0 flex-1 break-words'>{row.name}</span>
                <span className='shrink-0 text-[var(--docs-muted)] text-docs-caption'>
                  {row.duration}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className='min-w-0 flex-1 px-4 py-2'>
          <div className='flex min-h-8 items-center justify-between gap-2'>
            <span className='text-docs-control'>Output</span>
            <div className='flex items-center gap-1'>
              <CopyButton text={serialized} label='Copy full output' />
              <DocsButton
                iconOnly
                onClick={download}
                aria-label='Download full output'
                title='Download full output'
              >
                <Download className='size-4 text-[var(--docs-muted)]' />
              </DocsButton>
            </div>
          </div>
          {values.map((node) => (
            <TreeNode key={node.key} node={node} />
          ))}
        </div>
      </div>
    </div>
  )
}
