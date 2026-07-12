import { cn } from '@sim/emcn'
import { OverflowSpan } from '../lib/overflow-span'

/**
 * Props for the pure subblock summary row. The container resolves the value —
 * including all selector-name hydration (credentials, knowledge bases, tables,
 * MCP servers/tools, sub-workflows, skills, …) — and passes only the final
 * strings, so this view carries no store, query, or registry coupling.
 */
export interface SubBlockRowViewProps {
  /** Subblock label, rendered capitalized on the left. */
  title: string
  /** Resolved display value on the right; `undefined` hides the value span. */
  displayValue?: string
  /** Render the value in a monospace font (e.g. filter expressions). */
  isMonospace?: boolean
}

/**
 * Pure renderer for a collapsed block's subblock summary row: a capitalized
 * title and its resolved display value.
 */
export function SubBlockRowView({ title, displayValue, isMonospace }: SubBlockRowViewProps) {
  return (
    <div className='flex items-center gap-2'>
      <OverflowSpan
        value={title}
        className='min-w-0 truncate text-[var(--text-tertiary)] text-sm capitalize'
      />
      {displayValue !== undefined && (
        <OverflowSpan
          value={displayValue}
          className={cn(
            'flex-1 truncate text-right text-[var(--text-primary)] text-sm',
            isMonospace && 'font-mono'
          )}
        />
      )}
    </div>
  )
}
