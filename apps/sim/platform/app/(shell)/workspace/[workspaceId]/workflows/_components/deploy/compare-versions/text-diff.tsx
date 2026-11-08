'use client'

import { useMemo, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { diffWordsWithSpace } from 'diff'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/compare-versions/compare-versions.module.css'
import { buildDiffRows, type DiffLine } from '@/platform/lib/data/workflow-deploy'

/** Past this many folds in one field, a single control expands or collapses them all. */
const MANY_FOLDS = 3

const GUTTER_SIGN: Record<DiffLine['kind'], string> = { added: '+', removed: '−', context: ' ' }

interface TextDiffProps {
  oldText: string
  newText: string
}

/**
 * A unified line diff with a sign gutter. Unchanged runs fold to a count and expand on click, so a
 * long prompt shows only the hunks that moved.
 */
export function TextDiff({ oldText, newText }: TextDiffProps) {
  const rows = useMemo(() => buildDiffRows(oldText, newText), [oldText, newText])
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
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
    <div className={styles.code} data-type='T014'>
      {foldCount > MANY_FOLDS && (
        <div className={styles.foldAll}>
          <span data-type='T052'>
            {foldCount} changed {foldCount === 1 ? 'region' : 'regions'}
          </span>
          <Button
            variant='quiet'
            size='compact'
            onClick={() => {
              // One switch for every fold: collapsing also closes folds opened one by one.
              setExpanded(new Set())
              setExpandedAll((value) => !value)
            }}
          >
            {expandedAll ? 'Collapse unchanged' : 'Show all lines'}
          </Button>
        </div>
      )}
      {rows.map((row, index) => {
        if (row.type === 'oversized')
          return (
            <div key={index} className={styles.oversized} data-type='T052'>
              Too long to compare line by line: {row.oldLines} lines before, {row.newLines} lines
              after.
            </div>
          )
        if (row.type === 'fold' || row.type === 'tail') {
          if (!expandedAll && !expanded.has(index)) {
            const count = row.lines.length
            return (
              <button
                key={index}
                type='button'
                className={styles.fold}
                data-type='T052'
                onClick={() => setExpanded((current) => new Set(current).add(index))}
              >
                <span aria-hidden='true' className={styles.sign}>
                  …
                </span>
                {count} {row.type === 'fold' ? 'unchanged' : 'more'}{' '}
                {count === 1 ? 'line' : 'lines'}
              </button>
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

function DiffLineRow({ line }: { line: DiffLine }) {
  return (
    <div className={styles.line} data-kind={line.kind}>
      <span className={styles.sign} aria-hidden='true'>
        {GUTTER_SIGN[line.kind]}
      </span>
      <span data-visually-hidden=''>
        {line.kind === 'added' ? 'Added: ' : line.kind === 'removed' ? 'Removed: ' : ''}
      </span>
      <span className={styles.lineText}>
        {line.parts
          ? line.parts.map((part, index) => (
              <span key={index} data-changed={part.changed || undefined}>
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
 * A word diff on one line, for short values where a before and an after row would waste space:
 * removed words muted on red, added words on green.
 */
export function InlineDiff({ oldText, newText }: InlineDiffProps) {
  // Whitespace counts, so a value that differs only by a space still shows where.
  const parts = useMemo(() => diffWordsWithSpace(oldText, newText), [oldText, newText])
  return (
    <span className={styles.inlineDiff} data-type='T060'>
      {parts.map((part, index) => (
        <span key={index} data-kind={part.added ? 'added' : part.removed ? 'removed' : undefined}>
          {part.value}
        </span>
      ))}
    </span>
  )
}
