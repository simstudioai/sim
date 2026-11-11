'use client'

import type { KeyboardEvent, ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { Icon } from '@sim/emcn/icon'
import { OverflowText } from '@sim/emcn/overflow-text'
import { Tooltip } from '@sim/emcn/tooltip'
import { PageOverflow } from '@sim/emcn-platform/page-column'
import styles from '@/app/(product)/_components/workspace/trace-tree/trace-tree.module.css'
import type { TraceSpan } from '@/platform/shared/workspace-records'

/** A step's timing paint, from its family or provider; a failure takes precedence. */
export type TracePaint =
  | 'neutral'
  | 'error'
  | 'handled'
  | 'agent'
  | 'loop'
  | 'iteration'
  | 'parallel'
  | 'workflow'
  | 'mcp'
  | 'slack'
  | 'anthropic'

/** A step's timing paint, from its recorded family and provider; failures take precedence. */
export function spanPaint(span: Pick<TraceSpan, 'status' | 'kind' | 'providerId'>): TracePaint {
  if (span.status === 'error') return 'error'
  if (span.status === 'handled') return 'handled'
  if (span.providerId === 'slack') return 'slack'
  if (span.providerId === 'anthropic') return 'anthropic'
  if (span.providerId === 'openai') return 'neutral'
  switch (span.kind) {
    case 'agent':
    case 'loop':
    case 'iteration':
    case 'parallel':
    case 'workflow':
    case 'mcp':
      return span.kind
    default:
      return 'neutral'
  }
}

/** One open row of a trace, in reading order. */
export interface TraceRow {
  id: string
  name: string
  depth: number
  /** The step's glyph or provider mark; an iteration carries none. */
  mark?: ReactNode
  duration: string
  /** Where the step ran on the run's one clock, in percent of the run. */
  bar: { start: number; width: number; paint: TracePaint }
  /** Names where the bar starts, for assistive technology. */
  startLabel: string
  /** Fuller timing shown when the name is hovered. */
  timing?: string
  failed?: boolean
  /** Whether the step's children show; absent for a step without children. */
  expanded?: boolean
}

interface TraceTreeProps {
  label: string
  rows: readonly TraceRow[]
  selectedId: string | null
  onSelect: (id: string) => void
  onToggle: (id: string, open: boolean) => void
}

/**
 * A run's steps as a tree on one clock, as Paper's TraceRow: a disclosure, the step's mark and name
 * one gap apart on every row, its duration and a bar placed where it ran. Each level indents by one
 * disclosure, and a hairline guide hangs under every open parent's disclosure through its last
 * descendant. Up and Down move between steps, Right expands, Left collapses or moves to the parent,
 * and selecting a step opens it in the consumer's inspector. Consumers flatten their own spans into
 * the open rows and keep the expanded state, so a trace can expand or collapse all at once.
 */
export function TraceTree({ label, rows, selectedId, onSelect, onToggle }: TraceTreeProps) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, row: TraceRow, index: number) {
    const list = event.currentTarget.closest('ol')
    const targets = [...(list?.querySelectorAll<HTMLButtonElement>('[data-trace-target]') ?? [])]
    const at = targets.indexOf(event.currentTarget)
    const move = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: targets.length - 1 }[event.key]
    if (move !== undefined && targets[move]) {
      event.preventDefault()
      targets[move].focus()
      return
    }
    if (event.key === 'ArrowRight' && row.expanded === false) {
      event.preventDefault()
      onToggle(row.id, true)
      return
    }
    if (event.key !== 'ArrowLeft') return
    if (row.expanded) {
      event.preventDefault()
      onToggle(row.id, false)
      return
    }
    for (let parent = index - 1; parent >= 0; parent -= 1) {
      if (rows[parent].depth < row.depth) {
        event.preventDefault()
        targets[parent]?.focus()
        return
      }
    }
  }

  return (
    <PageOverflow>
      <ol className={styles.tree} aria-label={label}>
        {rows.map((row, index) => {
          const name = <OverflowText text={row.name}>{row.name}</OverflowText>
          return (
            <li
              key={row.id}
              className={styles.row}
              data-trace-id={row.id}
              data-selected={row.id === selectedId || undefined}
            >
              {Array.from({ length: row.depth }, (_, level) => (
                <span key={level} className={styles.guide} aria-hidden='true' />
              ))}
              {row.expanded === undefined ? (
                <span className={styles.disclosure} aria-hidden='true' />
              ) : (
                <button
                  type='button'
                  className={styles.disclosure}
                  aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${row.name}`}
                  aria-expanded={row.expanded}
                  onClick={() => onToggle(row.id, !row.expanded)}
                >
                  <Icon name={row.expanded ? 'I051' : 'I090'} />
                </button>
              )}
              <button
                type='button'
                className={styles.target}
                data-trace-target=''
                aria-pressed={row.id === selectedId}
                onClick={() => onSelect(row.id)}
                onKeyDown={(event) => onKeyDown(event, row, index)}
              >
                <span className={styles.mark} aria-hidden='true'>
                  {row.mark}
                </span>
                <span
                  className={styles.name}
                  data-type='T060'
                  data-failed={row.failed || undefined}
                >
                  {row.timing ? <Tooltip label={row.timing}>{name}</Tooltip> : name}
                </span>
                <span className={styles.duration} data-type='T052'>
                  {row.duration}
                </span>
                <svg className={styles.timeline} role='img' aria-label={row.startLabel}>
                  <line className={styles.track} x1='0' x2='100%' y1='50%' y2='50%' />
                  <rect
                    className={styles.bar}
                    data-paint={row.bar.paint}
                    x={`${row.bar.start}%`}
                    y='0'
                    width={`${row.bar.width}%`}
                    height='100%'
                    rx='2'
                  />
                </svg>
              </button>
            </li>
          )
        })}
      </ol>
    </PageOverflow>
  )
}

interface TraceToolbarProps {
  /** A filter over the steps, first in the row. */
  search?: ReactNode
  /** The whole trace, as Copy trace puts it on the clipboard. */
  copyText: string
  onExpandAll: () => void
  onCollapseAll: () => void
}

/** The trace's own actions: copy it whole, and open or close every step at once. */
export function TraceToolbar({ search, copyText, onExpandAll, onCollapseAll }: TraceToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <span className={styles.toolbarSearch}>{search}</span>
      <CopyButton label='Copy raw trace' text={copyText} />
      <Button variant='quiet' size='compact' onClick={onExpandAll}>
        Expand all
      </Button>
      <Button variant='quiet' size='compact' onClick={onCollapseAll}>
        Collapse all
      </Button>
    </div>
  )
}
