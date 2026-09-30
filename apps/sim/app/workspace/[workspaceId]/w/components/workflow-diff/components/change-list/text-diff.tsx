'use client'

import { useMemo, useState } from 'react'
import { cn } from '@sim/emcn'
import { diffWordsWithSpace } from 'diff'
import {
  buildDiffRows,
  type DiffLine,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/text-diff-lines'

/** Folds beyond this many in one field get a single "expand all" control. */
const MANY_FOLDS = 3

const LINE_CLASS: Record<DiffLine['kind'], string> = {
  added: 'bg-[color-mix(in_srgb,var(--brand-accent)_12%,transparent)] text-[var(--text-primary)]',
  removed: 'bg-[color-mix(in_srgb,var(--text-error)_10%,transparent)] text-[var(--text-primary)]',
  context: 'text-[var(--text-secondary)]',
}

const GUTTER_CLASS: Record<DiffLine['kind'], string> = {
  added: 'text-[var(--brand-accent)]',
  removed: 'text-[var(--text-error)]',
  context: 'text-[var(--text-muted)]',
}

const GUTTER_SIGN: Record<DiffLine['kind'], string> = {
  added: '+',
  removed: '−',
  context: ' ',
}

const FOLD_BUTTON_CLASS =
  'flex w-full items-center gap-2 bg-[var(--surface-3)] px-2 py-0.5 text-left text-[var(--text-tertiary)] text-caption transition-colors hover-hover:bg-[var(--surface-4)] hover-hover:text-[var(--text-secondary)] focus-visible:bg-[var(--surface-4)] focus-visible:outline-none'

interface FoldRowProps {
  count: number
  /** What the hidden lines are: unchanged context, or the rest of a one-sided body */
  kind: 'unchanged' | 'more'
  onExpand: () => void
}

function FoldRow({ count, kind, onExpand }: FoldRowProps) {
  return (
    <button type='button' onClick={onExpand} className={FOLD_BUTTON_CLASS}>
      <span aria-hidden='true' className='w-3 text-center'>
        …
      </span>
      <span>
        {count} {kind === 'unchanged' ? 'unchanged ' : 'more '}
        {count === 1 ? 'line' : 'lines'}
      </span>
    </button>
  )
}

interface TextDiffProps {
  oldText: string
  newText: string
}

/**
 * A unified line diff with a sign gutter. Unchanged runs fold to a count and
 * expand on click, so a long prompt shows only the hunks that moved.
 */
export function TextDiff({ oldText, newText }: TextDiffProps) {
  const rows = useMemo(() => buildDiffRows(oldText, newText), [oldText, newText])
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [expandedAll, setExpandedAll] = useState(false)
  /* Fold indexes belong to one pair of bodies; a new comparison starts folded again. */
  const [foldsFor, setFoldsFor] = useState(rows)
  if (foldsFor !== rows) {
    setFoldsFor(rows)
    setExpanded(new Set())
    setExpandedAll(false)
  }
  const foldCount = rows.filter((row) => row.type === 'fold').length

  return (
    <div className='overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--surface-1)] font-mono text-caption leading-[18px]'>
      {foldCount > MANY_FOLDS && (
        <button
          type='button'
          onClick={() => {
            /* One switch for every fold: collapsing must also close folds opened one by one. */
            setExpanded(new Set())
            setExpandedAll((value) => !value)
          }}
          className='flex w-full items-center justify-between border-[var(--border)] border-b bg-[var(--surface-2)] px-2 py-0.5 text-left font-sans text-[var(--text-tertiary)] text-caption transition-colors hover-hover:text-[var(--text-secondary)] focus-visible:bg-[var(--surface-4)] focus-visible:outline-none'
        >
          <span>
            {foldCount} changed {foldCount === 1 ? 'region' : 'regions'}
          </span>
          <span>{expandedAll ? 'Collapse unchanged' : 'Show all lines'}</span>
        </button>
      )}
      {rows.map((row, index) => {
        if (row.type === 'oversized') {
          return (
            <div
              key={index}
              className='px-2 py-1 font-sans text-[var(--text-tertiary)] text-caption'
            >
              Too long to compare line by line: {row.oldLines} lines before, {row.newLines} lines
              after.
            </div>
          )
        }
        if (row.type === 'fold' || row.type === 'tail') {
          if (!expandedAll && !expanded.has(index)) {
            return (
              <FoldRow
                key={index}
                count={row.lines.length}
                kind={row.type === 'fold' ? 'unchanged' : 'more'}
                onExpand={() => setExpanded((prev) => new Set(prev).add(index))}
              />
            )
          }
          return row.lines.map((line, lineIndex) => (
            <DiffLineRow key={`${index}-${lineIndex}`} line={line} />
          ))
        }
        return <DiffLineRow key={index} line={row.line} />
      })}
    </div>
  )
}

interface DiffLineRowProps {
  line: DiffLine
}

function DiffLineRow({ line }: DiffLineRowProps) {
  return (
    <div className={cn('flex gap-2 px-2', LINE_CLASS[line.kind])}>
      <span className={cn('w-3 shrink-0 select-none text-center', GUTTER_CLASS[line.kind])}>
        {GUTTER_SIGN[line.kind]}
      </span>
      <span className='min-w-0 flex-1 whitespace-pre-wrap break-words'>
        {line.parts
          ? line.parts.map((part, index) => (
              <span
                key={index}
                className={cn(
                  part.changed &&
                    (line.kind === 'added'
                      ? 'rounded-xs bg-[color-mix(in_srgb,var(--brand-accent)_28%,transparent)]'
                      : 'rounded-xs bg-[color-mix(in_srgb,var(--text-error)_26%,transparent)]')
                )}
              >
                {part.value}
              </span>
            ))
          : line.text || ' '}
      </span>
    </div>
  )
}

interface InlineDiffProps {
  oldText: string
  newText: string
}

/**
 * Word-level diff on one line, for short values where a before and after row
 * would waste the space: removed words sit muted on a red tint, added words
 * on a green tint.
 */
export function InlineDiff({ oldText, newText }: InlineDiffProps) {
  /* Whitespace counts, so a value that differs only by a space still shows where. */
  const parts = useMemo(() => diffWordsWithSpace(oldText, newText), [oldText, newText])
  return (
    <span className='whitespace-pre-wrap break-words text-[var(--text-primary)] text-small'>
      {parts.map((part, index) => (
        <span
          key={index}
          className={cn(
            part.added &&
              'rounded-xs bg-[color-mix(in_srgb,var(--brand-accent)_16%,transparent)] px-0.5',
            part.removed &&
              'rounded-xs bg-[color-mix(in_srgb,var(--text-error)_12%,transparent)] px-0.5 text-[var(--text-tertiary)]'
          )}
        >
          {part.value}
        </span>
      ))}
    </span>
  )
}
