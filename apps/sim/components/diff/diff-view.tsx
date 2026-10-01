'use client'

import { Fragment, useState } from 'react'
import { cn } from '@sim/emcn'
import { diffWordsWithSpace } from 'diff'
import type { DiffHunk, DiffLine } from '@/lib/diff/unified'

/** Unchanged lines kept visible on each side of a collapsed run. */
const CONTEXT_EDGE = 3
/** A run of unchanged lines collapses once it is longer than this. */
const COLLAPSE_AFTER = CONTEXT_EDGE * 2 + 2
/** Word-level comparison is skipped past this many characters, so huge lines stay cheap. */
const WORD_DIFF_MAX_CHARS = 1000

const ADD_ROW =
  'bg-[color-mix(in_srgb,var(--badge-success-bg)_35%,transparent)] text-[var(--text-primary)]'
const DEL_ROW =
  'bg-[color-mix(in_srgb,var(--badge-error-bg)_35%,transparent)] text-[var(--text-primary)]'
const CONTEXT_ROW = 'text-[var(--text-body)]'
const ADD_WORD = 'rounded-sm bg-[color-mix(in_srgb,var(--badge-success-bg)_90%,transparent)]'
const DEL_WORD = 'rounded-sm bg-[color-mix(in_srgb,var(--badge-error-bg)_90%,transparent)]'
const GUTTER = 'select-none pl-3 text-right text-[var(--text-muted)] tabular-nums'
const MARKER = 'select-none pl-3'
const TEXT = 'whitespace-pre py-0.5 pr-3 pl-1'

interface Segment {
  text: string
  changed: boolean
}
interface DiffViewProps {
  hunks: DiffHunk[]
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
      if (dels[pair].text.length + adds[pair].text.length > WORD_DIFF_MAX_CHARS) continue
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
function visibleItems(lines: DiffLine[], isExpanded: (start: number) => boolean) {
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
    if (
      isExpanded(start) ||
      run.length <= COLLAPSE_AFTER ||
      run.length <= keepBefore + keepAfter + 1
    ) {
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

function markerClass(line: DiffLine | undefined) {
  return line?.type === 'add'
    ? 'text-[var(--badge-success-text)]'
    : line?.type === 'del'
      ? 'text-[var(--badge-error-text)]'
      : undefined
}

function marker(line: DiffLine | undefined) {
  return line?.type === 'add' ? '+' : line?.type === 'del' ? '-' : ' '
}

/**
 * A unified diff rendered with word-level highlights, collapsed unchanged runs, and line numbers
 * when the hunk headers carry them.
 */
export function DiffView({ hunks }: DiffViewProps) {
  /** Expanded runs, keyed `hunk:start` so each collapsed run opens on its own. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const numbered = hunks.some((hunk) =>
    hunk.lines.some((line) => line.oldLine !== undefined || line.newLine !== undefined)
  )
  const columns = numbered ? 'grid-cols-[auto_auto_auto_1fr]' : 'grid-cols-[auto_1fr]'
  return (
    <div className='overflow-x-auto py-1'>
      <div className={cn('grid w-max min-w-full font-mono text-caption leading-[1.6]', columns)}>
        {hunks.map((hunk, hunkIndex) => {
          const segments = wordSegments(hunk.lines)
          const items = visibleItems(hunk.lines, (start) => expanded.has(`${hunkIndex}:${start}`))
          return (
            <Fragment key={hunkIndex}>
              {(hunk.file || hunk.heading || hunkIndex > 0) && (
                <div className='sticky left-0 col-span-full px-3 pt-2 pb-1 font-sans text-[var(--text-muted)] text-caption'>
                  {hunk.file && <span className='text-[var(--text-body)]'>{hunk.file} </span>}
                  {hunk.heading || (hunk.file ? '' : '⋯')}
                </div>
              )}
              {items.map((item, index) =>
                'line' in item ? (
                  <div
                    key={index}
                    className={cn('col-span-full grid grid-cols-subgrid', rowClass(item.line))}
                  >
                    {numbered && <span className={GUTTER}>{item.line.oldLine ?? ''}</span>}
                    {numbered && <span className={GUTTER}>{item.line.newLine ?? ''}</span>}
                    <span className={cn(MARKER, markerClass(item.line))}>{marker(item.line)}</span>
                    <span className={TEXT}>
                      <LineText line={item.line} segments={segments.get(item.line)} />
                    </span>
                  </div>
                ) : (
                  <CollapsedRun
                    key={`c${item.key}`}
                    count={item.collapsed}
                    onExpand={() =>
                      setExpanded((current) => new Set(current).add(`${hunkIndex}:${item.key}`))
                    }
                  />
                )
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
