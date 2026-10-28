'use client'

import { useMemo, useState } from 'react'
import { Button, Code, cn } from '@sim/emcn'
import { diffWordsWithSpace } from 'diff'
import {
  buildDiffRows,
  type DiffLine,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/text-diff-lines'

/** Folds beyond this many in one field get a single "expand all" control. */
const MANY_FOLDS = 3

const LINE_CLASS: Record<DiffLine['kind'], string> = {
  added: 'bg-[var(--badge-success-bg)] text-[var(--text-primary)]',
  removed: 'bg-[var(--badge-error-bg)] text-[var(--text-primary)]',
  context: 'text-[var(--text-secondary)]',
}

const GUTTER_CLASS: Record<DiffLine['kind'], string> = {
  added: 'text-[var(--badge-success-text)]',
  removed: 'text-[var(--text-error)]',
  context: 'text-[var(--text-muted)]',
}

const GUTTER_SIGN: Record<DiffLine['kind'], string> = {
  added: '+',
  removed: '−',
  context: ' ',
}

interface FoldRowProps {
  count: number
  /** What the hidden lines are: unchanged context, or the rest of a one-sided body */
  kind: 'unchanged' | 'more'
  onExpand: () => void
}

function FoldRow({ count, kind, onExpand }: FoldRowProps) {
  return (
    <Button
      type='button'
      variant='quiet'
      size='sm'
      onClick={onExpand}
      className='w-full justify-start gap-2 text-left'
    >
      <span aria-hidden='true' className='w-3 text-center'>
        …
      </span>
      <span>
        {count} {kind === 'unchanged' ? 'unchanged ' : 'more '}
        {count === 1 ? 'line' : 'lines'}
      </span>
    </Button>
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
  // Fold indexes belong to one pair of bodies; a new comparison starts folded again.
  const [foldsFor, setFoldsFor] = useState({ oldText, newText })
  if (foldsFor.oldText !== oldText || foldsFor.newText !== newText) {
    setFoldsFor({ oldText, newText })
    setExpanded(new Set())
    setExpandedAll(false)
  }
  const foldCount = rows.filter((row) => row.type === 'fold').length

  return (
    <Code.Container className='min-h-0'>
      {foldCount > MANY_FOLDS && (
        <Button
          type='button'
          variant='quiet'
          size='sm'
          onClick={() => {
            // One switch for every fold: collapsing must also close folds opened one by one.
            setExpanded(new Set())
            setExpandedAll((value) => !value)
          }}
          className='w-full justify-between text-left'
        >
          <span>
            {foldCount} changed {foldCount === 1 ? 'region' : 'regions'}
          </span>
          <span>{expandedAll ? 'Collapse unchanged' : 'Show all lines'}</span>
        </Button>
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
    </Code.Container>
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
                      ? 'rounded-xs bg-[var(--badge-success-bg)] underline'
                      : 'rounded-xs bg-[var(--badge-error-bg)] underline')
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
  // Whitespace counts, so a value that differs only by a space still shows where.
  const parts = useMemo(() => diffWordsWithSpace(oldText, newText), [oldText, newText])
  return (
    <span className='whitespace-pre-wrap break-words text-[var(--text-primary)] text-small'>
      {parts.map((part, index) => (
        <span
          key={index}
          className={cn(
            part.added && 'rounded-xs bg-[var(--badge-success-bg)] px-0.5',
            part.removed &&
              'rounded-xs bg-[var(--badge-error-bg)] px-0.5 text-[var(--text-tertiary)]'
          )}
        >
          {part.value}
        </span>
      ))}
    </span>
  )
}
