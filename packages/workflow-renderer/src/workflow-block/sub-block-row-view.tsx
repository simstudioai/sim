import type { ComponentType } from 'react'
import { cn } from '@sim/emcn'
import { OverflowSpan } from '../lib/overflow-span'
import type { CodePreview } from '../types'
import { InlineChip } from './inline-chip'

/**
 * Props for the pure subblock summary row. The container resolves the value —
 * including all selector-name hydration (credentials, knowledge bases, tables,
 * MCP servers/tools, sub-workflows, skills, …) — and passes only the final
 * strings, so this view carries no store, query, or registry coupling.
 */
export interface SubBlockRowViewProps {
  /** Subblock label, rendered capitalized on the left (row variant). */
  title: string
  /** Resolved display value on the right; `undefined` hides the value span. */
  displayValue?: string
  /** Render the value in a monospace font (e.g. filter expressions). */
  isMonospace?: boolean
  /** Rich preview for an inline code value; ordinary values keep the text tooltip. */
  codePreview?: CodePreview
  /**
   * Leading icon for the `meta` variant; without one the variant falls back
   * to the labeled `row` presentation.
   */
  icon?: ComponentType<{ className?: string }>
  /**
   * Presentation variant:
   * - `row` (default): label/value summary line (hover drawer, fallbacks)
   * - `meta`: icon + value line — the collapsed card's compact fact row
   * - `statement-primary`: strong inline fragment (the operation)
   * - `statement-muted`: muted inline fragment (the target / model)
   * - `inline-value`: small value chip embedded in a summary sentence
   * - `footer`: muted footer label (the error-port row)
   */
  variant?: 'row' | 'meta' | 'statement-primary' | 'statement-muted' | 'inline-value' | 'footer'
}

/**
 * Pure renderer for a collapsed block's subblock summary: a label/value row,
 * an icon fact row, an inline statement fragment, or the footer error label.
 *
 * The fixed `h-5` row height is part of the handle-position contract —
 * `HANDLE_POSITIONS.CONDITION_ROW_HEIGHT` in dimensions.ts assumes a 20px row
 * plus the container's 8px gap, so condition/router source handles align with
 * their rows.
 */
export function SubBlockRowView({
  title,
  displayValue,
  isMonospace,
  codePreview,
  icon: Icon,
  variant = 'row',
}: SubBlockRowViewProps) {
  if (variant === 'inline-value') {
    return (
      <InlineChip>
        <OverflowSpan
          value={displayValue ?? title}
          className={cn('min-w-0 truncate', isMonospace && 'font-mono')}
          codePreview={codePreview}
        />
      </InlineChip>
    )
  }

  if (variant === 'statement-primary' || variant === 'statement-muted') {
    return (
      <OverflowSpan
        value={displayValue ?? title}
        className={cn(
          'min-w-0 truncate text-sm',
          variant === 'statement-primary'
            ? 'font-medium text-[var(--text-primary)]'
            : 'text-[var(--text-muted)]'
        )}
      />
    )
  }

  if (variant === 'meta' && Icon) {
    return (
      <div className='flex min-w-0 items-center gap-2'>
        <Icon className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
        <OverflowSpan
          value={displayValue ?? '-'}
          className={cn(
            'min-w-0 flex-1 truncate text-left text-[var(--text-primary)] text-sm',
            isMonospace && 'font-mono'
          )}
        />
      </div>
    )
  }

  if (variant === 'footer') {
    return (
      <div className='flex items-center'>
        <OverflowSpan
          value={title}
          className='min-w-0 truncate text-[var(--text-muted)] text-sm capitalize'
        />
      </div>
    )
  }

  return (
    <div className='flex h-5 items-center gap-2'>
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
