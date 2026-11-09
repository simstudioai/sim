import type { ComponentType } from 'react'
import { cn } from '@sim/emcn/lib/cn'
import { InlineChip } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/inline-chip'
import { OverflowSpan } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/overflow-span'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/sub-block-row-view.module.css'
import type { CodePreview } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/types'

/**
 * Props for the pure subblock summary row. The container resolves the value —
 * including all selector-name hydration (credentials, knowledge bases, tables,
 * MCP servers/tools, sub-workflows, skills, …) — and passes only the final
 * strings, so this view carries no store, query, or registry coupling.
 */
interface SubBlockRowViewProps {
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
          className={cn(styles.inlineValue, isMonospace && styles.mono)}
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
          styles.statement,
          variant === 'statement-primary' ? styles.statementPrimary : styles.statementMuted
        )}
      />
    )
  }

  if (variant === 'meta' && Icon) {
    return (
      <div className={styles.metaRow}>
        <Icon className={styles.metaIcon} />
        <OverflowSpan
          value={displayValue ?? '-'}
          className={cn(styles.metaValue, isMonospace && styles.mono)}
        />
      </div>
    )
  }

  if (variant === 'footer') {
    return (
      <div className={styles.footerRow}>
        <OverflowSpan value={title} className={styles.footerText} />
      </div>
    )
  }

  return (
    <div className={styles.row}>
      <OverflowSpan value={title} className={styles.rowTitle} />
      {displayValue !== undefined && (
        <OverflowSpan
          value={displayValue}
          className={cn(styles.rowValue, isMonospace && styles.mono)}
        />
      )}
    </div>
  )
}
