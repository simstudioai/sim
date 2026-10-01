'use client'

import { Fragment, useState } from 'react'
import { cn } from '@sim/emcn'
import { diffWordsWithSpace } from 'diff'
import type { DiffHunk, DiffLine } from '@/lib/diff/unified'

/** Unchanged lines kept visible on each side of a collapsed run. */
const CONTEXT_EDGE = 3
/** A run of unchanged lines collapses once it is longer than this. */
const COLLAPSE_AFTER = CONTEXT_EDGE * 2 + 2

const ADD_ROW = 'bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]'
const DEL_ROW = 'bg-[var(--badge-error-bg)] text-[var(--badge-error-text)]'
const CONTEXT_ROW = 'text-[var(--text-body)]'
const ADD_WORD = 'rounded-sm bg-[color-mix(in_srgb,var(--badge-success-text)_18%,transparent)]'
const DEL_WORD = 'rounded-sm bg-[color-mix(in_srgb,var(--badge-error-text)_18%,transparent)]'
const GUTTER = 'select-none pl-3 text-right text-[var(--text-muted)] tabular-nums'
const MARKER = 'select-none pl-3'
const TEXT = 'whitespace-pre py-0.5 pr-3 pl-1'

export type DiffViewMode = 'unified' | 'split'

interface Segment {
  text: string
  changed: boolean
}
interface DiffViewProps {
  hunks: DiffHunk[]
  mode: DiffViewMode
}
interface LineTextProps {
  line: DiffLine
  segments: Segment[] | undefined
}
interface CollapsedRunProps {
  count: number
  onExpand: () => void
}

/**
 * Pairs each run of removed lines with the added lines that follow it, so a reworded line shows
 * which words changed. Unpaired lines keep whole-line highlighting.
 */
function wordSegments(lines: DiffLine[]): Map<DiffLine, Segment[]> {
  const segments = new Map<DiffLine, Segment[]>()
  for (let index = 0; index < lines.length; ) {
    if (lines[index].type !== 'del') {
      index++
      continue
    }
    const dels: DiffLine[] = []
    while (lines[index]?.type === 'del') dels.push(lines[index++])
    const adds: DiffLine[] = []
    while (lines[index]?.type === 'add') adds.push(lines[index++])
    for (let pair = 0; pair < Math.min(dels.length, adds.length); pair++) {
      const parts = diffWordsWithSpace(dels[pair].text, adds[pair].text)
      segments.set(
        dels[pair],
        parts
          .filter((part) => !part.added)
          .map((part) => ({ text: part.value, changed: !!part.removed }))
      )
      segments.set(
        adds[pair],
        parts
          .filter((part) => !part.removed)
          .map((part) => ({ text: part.value, changed: !!part.added }))
      )
    }
  }
  return segments
}

function LineText({ line, segments }: LineTextProps) {
  if (!segments) return <>{line.text || ' '}</>
  const word = line.type === 'add' ? ADD_WORD : DEL_WORD
  return (
    <>
      {segments.map((segment, index) => (
        <span key={index} className={cn(segment.changed && word)}>
          {segment.text}
        </span>
      ))}
    </>
  )
}

function CollapsedRun({ count, onExpand }: CollapsedRunProps) {
  return (
    <button
      type='button'
      onClick={onExpand}
      className='sticky left-0 col-span-full w-full bg-[var(--surface-2)] py-1 text-center font-sans text-[var(--text-muted)] text-caption transition-colors hover:text-[var(--text-body)]'
    >
      ⋯ {count} unchanged {count === 1 ? 'line' : 'lines'}
    </button>
  )
}

/** Splits a hunk into visible lines and collapsed runs of unchanged lines. */
function visibleItems(lines: DiffLine[], expanded: boolean) {
  const items: Array<{ line: DiffLine } | { collapsed: number; key: number }> = []
  for (let index = 0; index < lines.length; ) {
    if (lines[index].type !== 'context') {
      items.push({ line: lines[index++] })
      continue
    }
    const start = index
    while (lines[index]?.type === 'context') index++
    const run = lines.slice(start, index)
    const leading = start === 0
    const trailing = index === lines.length
    const keepBefore = leading ? 0 : CONTEXT_EDGE
    const keepAfter = trailing ? 0 : CONTEXT_EDGE
    if (expanded || run.length <= COLLAPSE_AFTER || run.length <= keepBefore + keepAfter + 1) {
      for (const line of run) items.push({ line })
      continue
    }
    for (const line of run.slice(0, keepBefore)) items.push({ line })
    items.push({ collapsed: run.length - keepBefore - keepAfter, key: start })
    for (const line of run.slice(run.length - keepAfter)) items.push({ line })
  }
  return items
}

function rowClass(line: DiffLine | undefined) {
  return line?.type === 'add' ? ADD_ROW : line?.type === 'del' ? DEL_ROW : line && CONTEXT_ROW
}

function marker(line: DiffLine | undefined) {
  return line?.type === 'add' ? '+' : line?.type === 'del' ? '-' : ' '
}

/** Aligns removed and added runs side by side; unchanged lines fill both columns. */
function splitRows(items: ReturnType<typeof visibleItems>) {
  const rows: Array<{ left?: DiffLine; right?: DiffLine } | { collapsed: number; key: number }> = []
  for (let index = 0; index < items.length; ) {
    const item = items[index]
    if (!('line' in item)) {
      rows.push(item)
      index++
      continue
    }
    if (item.line.type === 'context') {
      rows.push({ left: item.line, right: item.line })
      index++
      continue
    }
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (index < items.length) {
      const next = items[index]
      if (!('line' in next) || next.line.type === 'context') break
      if (next.line.type === 'del' && adds.length === 0) dels.push(next.line)
      else if (next.line.type === 'add') adds.push(next.line)
      else break
      index++
    }
    for (let pair = 0; pair < Math.max(dels.length, adds.length); pair++)
      rows.push({ left: dels[pair], right: adds[pair] })
  }
  return rows
}

/**
 * A unified diff rendered with word-level highlights, collapsed unchanged runs, and line numbers
 * when the hunk headers carry them. Split mode aligns removals and additions side by side.
 */
export function DiffView({ hunks, mode }: DiffViewProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  const numbered = hunks.some((hunk) =>
    hunk.lines.some((line) => line.oldLine !== undefined || line.newLine !== undefined)
  )
  const columns =
    mode === 'split'
      ? numbered
        ? 'grid-cols-[auto_auto_1fr_auto_auto_1fr]'
        : 'grid-cols-[auto_1fr_auto_1fr]'
      : numbered
        ? 'grid-cols-[auto_auto_auto_1fr]'
        : 'grid-cols-[auto_1fr]'
  return (
    <div className='overflow-x-auto py-1'>
      <div className={cn('grid w-max min-w-full font-mono text-caption leading-[1.6]', columns)}>
        {hunks.map((hunk, hunkIndex) => {
          const segments = wordSegments(hunk.lines)
          const items = visibleItems(hunk.lines, expanded.has(hunkIndex))
          const expand = () => setExpanded((current) => new Set(current).add(hunkIndex))
          return (
            <Fragment key={hunkIndex}>
              {(hunk.heading || hunkIndex > 0) && (
                <div className='sticky left-0 col-span-full px-3 pt-2 pb-1 font-sans text-[var(--text-muted)] text-caption'>
                  {hunk.heading || '⋯'}
                </div>
              )}
              {mode === 'unified'
                ? items.map((item, index) =>
                    'line' in item ? (
                      <div
                        key={index}
                        className={cn('col-span-full grid grid-cols-subgrid', rowClass(item.line))}
                      >
                        {numbered && <span className={GUTTER}>{item.line.oldLine ?? ''}</span>}
                        {numbered && <span className={GUTTER}>{item.line.newLine ?? ''}</span>}
                        <span className={MARKER}>{marker(item.line)}</span>
                        <span className={TEXT}>
                          <LineText line={item.line} segments={segments.get(item.line)} />
                        </span>
                      </div>
                    ) : (
                      <CollapsedRun key={`c${item.key}`} count={item.collapsed} onExpand={expand} />
                    )
                  )
                : splitRows(items).map((row, index) =>
                    'collapsed' in row ? (
                      <CollapsedRun key={`c${row.key}`} count={row.collapsed} onExpand={expand} />
                    ) : (
                      <div key={index} className='col-span-full grid grid-cols-subgrid'>
                        {[row.left, row.right].map((line, side) => (
                          <Fragment key={side}>
                            {numbered && (
                              <span className={cn(rowClass(line), GUTTER)}>
                                {(side === 0 ? line?.oldLine : line?.newLine) ?? ''}
                              </span>
                            )}
                            <span className={cn(MARKER, rowClass(line))}>
                              {line ? marker(line) : ''}
                            </span>
                            <span
                              className={cn(
                                TEXT,
                                rowClass(line),
                                side === 0 && 'border-[var(--border)] border-r'
                              )}
                            >
                              {line && <LineText line={line} segments={segments.get(line)} />}
                            </span>
                          </Fragment>
                        ))}
                      </div>
                    )
                  )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
