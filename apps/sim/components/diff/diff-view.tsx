'use client'

import { Fragment, type ReactNode, useState } from 'react'
import { Chip, cn, scrollFadeAttributes, scrollFadeXClass, useScrollEdges } from '@sim/emcn'
import { ChevronsUpDown } from '@sim/emcn/icons'
import { diffWordsWithSpace } from 'diff'
import type { DiffHunk, DiffLine } from '@/lib/diff/unified'

const CONTEXT_EDGE = 3
const COLLAPSE_AFTER = CONTEXT_EDGE * 2 + 2
const WORD_DIFF_MAX_CHARS = 1000
const INLINE_MARKDOWN = /(\*\*[^*]+\*\*|`[^`]+`)/

const ADD_ROW =
  'relative bg-[color-mix(in_srgb,var(--badge-success-bg)_18%,transparent)] before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-[var(--badge-success-text)]'
const DEL_ROW =
  'relative bg-[color-mix(in_srgb,var(--badge-error-bg)_18%,transparent)] before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-[var(--badge-error-text)]'
const ADD_WORD = 'rounded-sm bg-[color-mix(in_srgb,var(--badge-success-bg)_70%,transparent)]'
const DEL_WORD = 'rounded-sm bg-[color-mix(in_srgb,var(--badge-error-bg)_70%,transparent)]'
const GUTTER =
  'select-none py-0.5 pr-2 pl-2 text-right text-[var(--text-muted)] text-caption tabular-nums'
const MARKER = 'select-none py-0.5 text-center text-caption'

interface Segment {
  text: string
  changed: boolean
}

type VisibleItem = { line: DiffLine; key: number } | { collapsed: number; key: number }
type PairedRow = { old?: DiffLine; new?: DiffLine; key: number }
type PairedItem = PairedRow | { collapsed: number; key: number }

interface DiffViewProps {
  hunks: DiffHunk[]
  wrapLines?: boolean
  prose?: boolean
}

interface LineTextProps {
  line: DiffLine
  segments: Segment[] | undefined
  prose: boolean
}

interface HighlightedTextProps {
  text: string
  offset: number
  segments: Segment[] | undefined
  type: DiffLine['type']
}

interface CollapsedRunProps {
  count: number
  onExpand: () => void
}

interface DiffCellProps extends Omit<LineTextProps, 'prose'> {
  side: 'old' | 'new'
  wrapLines: boolean
}
interface UnifiedRowProps extends Omit<LineTextProps, 'prose'> {
  numbered: boolean
  wrapLines: boolean
}
interface ProseRowProps {
  item: PairedRow
  segments: Map<DiffLine, Segment[]>
  wrapLines: boolean
}
interface HunkRowsProps {
  hunk: DiffHunk
  index: number
  numbered: boolean
  wrapLines: boolean
  prose: boolean
}

/** Pairs adjacent removed and added runs for bounded word-level highlighting. */
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

function HighlightedText({ text, offset, segments, type }: HighlightedTextProps) {
  if (!segments) return <>{text || ' '}</>
  let position = 0
  const children: ReactNode[] = []
  for (const [index, segment] of segments.entries()) {
    const start = Math.max(offset, position)
    const end = Math.min(offset + text.length, position + segment.text.length)
    if (end > start) {
      children.push(
        <span key={index} className={cn(segment.changed && (type === 'add' ? ADD_WORD : DEL_WORD))}>
          {text.slice(start - offset, end - offset)}
        </span>
      )
    }
    position += segment.text.length
  }
  return <>{children}</>
}

function LineText({ line, segments, prose }: LineTextProps) {
  const changeLabel = line.type === 'add' ? 'Added: ' : line.type === 'del' ? 'Removed: ' : null
  if (!prose)
    return (
      <>
        <span className='sr-only'>{changeLabel}</span>
        <HighlightedText text={line.text} offset={0} segments={segments} type={line.type} />
      </>
    )
  const prefix = /^#{1,6}\s+/.exec(line.text)?.[0] ?? ''
  const text = line.text.slice(prefix.length)
  let offset = prefix.length
  return (
    <p className={cn(prefix && 'font-medium text-[var(--text-primary)]')}>
      <span className='sr-only'>{changeLabel}</span>
      {text.split(INLINE_MARKDOWN).map((part, index) => {
        const bold = part.startsWith('**') && part.endsWith('**') && part.length > 4
        const code = part.startsWith('`') && part.endsWith('`') && part.length > 2
        const inset = bold ? 2 : code ? 1 : 0
        const content = (
          <HighlightedText
            key={index}
            text={inset ? part.slice(inset, -inset) : part}
            offset={offset + inset}
            segments={segments}
            type={line.type}
          />
        )
        offset += part.length
        return bold ? (
          <strong key={index} className='font-medium'>
            {content}
          </strong>
        ) : code ? (
          <code
            key={index}
            className='rounded-sm bg-[var(--surface-5)] px-1 font-mono text-caption dark:bg-[var(--surface-4)]'
          >
            {content}
          </code>
        ) : (
          <Fragment key={index}>{content}</Fragment>
        )
      })}
    </p>
  )
}

function CollapsedRun({ count, onExpand }: CollapsedRunProps) {
  return (
    <div className='sticky left-0 col-span-full border-[var(--border)] border-y bg-[var(--surface-3)] px-3 py-1'>
      <Chip onClick={onExpand} leftIcon={ChevronsUpDown}>
        Show {count} unchanged {count === 1 ? 'line' : 'lines'}
      </Chip>
    </div>
  )
}

function visibleItems(lines: DiffLine[], isExpanded: (start: number) => boolean): VisibleItem[] {
  const items: VisibleItem[] = []
  for (let index = 0; index < lines.length; ) {
    if (lines[index].type !== 'context') {
      items.push({ line: lines[index], key: index++ })
      continue
    }
    const start = index
    while (lines[index]?.type === 'context') index++
    const keepBefore = start === 0 ? 0 : CONTEXT_EDGE
    const keepAfter = index === lines.length ? 0 : CONTEXT_EDGE
    if (isExpanded(start) || index - start <= COLLAPSE_AFTER) {
      for (let cursor = start; cursor < index; cursor++)
        items.push({ line: lines[cursor], key: cursor })
      continue
    }
    for (let cursor = start; cursor < start + keepBefore; cursor++)
      items.push({ line: lines[cursor], key: cursor })
    items.push({ collapsed: index - start - keepBefore - keepAfter, key: start })
    for (let cursor = index - keepAfter; cursor < index; cursor++)
      items.push({ line: lines[cursor], key: cursor })
  }
  return items
}

function pairedItems(items: VisibleItem[]): PairedItem[] {
  const paired: PairedItem[] = []
  for (let index = 0; index < items.length; ) {
    const item = items[index]
    if ('collapsed' in item) {
      paired.push(item)
      index++
      continue
    }
    if (item.line.type === 'context') {
      paired.push({ old: item.line, new: item.line, key: item.key })
      index++
      continue
    }
    const removed: DiffLine[] = []
    const added: DiffLine[] = []
    const key = item.key
    while (index < items.length) {
      const next = items[index]
      if (!('line' in next) || next.line.type !== 'del') break
      removed.push(next.line)
      index++
    }
    while (index < items.length) {
      const next = items[index]
      if (!('line' in next) || next.line.type !== 'add') break
      added.push(next.line)
      index++
    }
    for (let pair = 0; pair < Math.max(removed.length, added.length); pair++) {
      paired.push({ old: removed[pair], new: added[pair], key: key + pair })
    }
  }
  return paired
}

function rowClass(line: DiffLine | undefined) {
  return line?.type === 'add' ? ADD_ROW : line?.type === 'del' ? DEL_ROW : undefined
}

function markerClass(line: DiffLine | undefined) {
  return line?.type === 'add'
    ? 'text-[var(--badge-success-text)]'
    : line?.type === 'del'
      ? 'text-[var(--badge-error-text)]'
      : undefined
}

function marker(line: DiffLine | undefined) {
  return line?.type === 'add' ? '+' : line?.type === 'del' ? '−' : ' '
}

function DiffCell({ line, segments, side, wrapLines }: DiffCellProps) {
  return (
    <div
      className={cn(
        'grid min-w-0 grid-cols-[24px_minmax(0,1fr)] px-3 py-2',
        side === 'new' && 'border-[var(--border)] border-l',
        rowClass(line)
      )}
    >
      <span className={cn(MARKER, markerClass(line))} aria-hidden>
        {marker(line)}
      </span>
      <div
        className={cn(
          'min-w-0 py-0.5 pr-1 pl-1',
          wrapLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
        )}
      >
        <LineText line={line} segments={segments} prose />
      </div>
    </div>
  )
}

function UnifiedRow({ line, segments, numbered, wrapLines }: UnifiedRowProps) {
  return (
    <div className={cn('col-span-full grid grid-cols-subgrid', rowClass(line))}>
      {numbered && (
        <span className={GUTTER} aria-hidden>
          {line.oldLine ?? ''}
        </span>
      )}
      {numbered && (
        <span className={GUTTER} aria-hidden>
          {line.newLine ?? ''}
        </span>
      )}
      <span className={cn(MARKER, markerClass(line))} aria-hidden>
        {marker(line)}
      </span>
      <span
        className={cn(
          'min-w-0 py-0.5 pr-4 pl-1',
          wrapLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
        )}
      >
        <LineText line={line} segments={segments} prose={false} />
      </span>
    </div>
  )
}

function ProseRow({ item, segments, wrapLines }: ProseRowProps) {
  return (
    <div className='col-span-full grid grid-cols-subgrid'>
      {(['old', 'new'] as const).map((side) => {
        const line = item[side]
        return line ? (
          <DiffCell
            key={side}
            line={line}
            segments={segments.get(line)}
            side={side}
            wrapLines={wrapLines}
          />
        ) : (
          <div
            key={side}
            aria-hidden
            className={cn(
              'bg-[var(--surface-3)]',
              side === 'new' && 'border-[var(--border)] border-l'
            )}
          />
        )
      })}
    </div>
  )
}

function HunkRows({ hunk, index, numbered, wrapLines, prose }: HunkRowsProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  const segments = wordSegments(hunk.lines)
  const visible = visibleItems(hunk.lines, (start) => expanded.has(start))
  const items = prose ? pairedItems(visible) : visible
  return (
    <>
      {(hunk.file || hunk.heading || index > 0) && (
        <div className='sticky left-0 col-span-full border-[var(--border)] border-y bg-[var(--surface-3)] px-4 py-2 font-season text-[var(--text-muted)] text-caption'>
          {hunk.file && <span className='text-[var(--text-body)]'>{hunk.file} </span>}
          {hunk.heading || (hunk.file ? '' : '⋯')}
        </div>
      )}
      {items.map((item) =>
        'collapsed' in item ? (
          <CollapsedRun
            key={`c${item.key}`}
            count={item.collapsed}
            onExpand={() => setExpanded((current) => new Set(current).add(item.key))}
          />
        ) : 'line' in item ? (
          <UnifiedRow
            key={item.key}
            line={item.line}
            segments={segments.get(item.line)}
            numbered={numbered}
            wrapLines={wrapLines}
          />
        ) : (
          <ProseRow key={item.key} item={item} segments={segments} wrapLines={wrapLines} />
        )
      )}
    </>
  )
}

/** Unified file edits and aligned prose comparisons share highlights and collapsible context. */
export function DiffView({ hunks, wrapLines = true, prose = false }: DiffViewProps) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const scrollEdges = useScrollEdges(scrollElement, { axis: 'x' })
  const numbered =
    !prose &&
    hunks.some((hunk) =>
      hunk.lines.some((line) => line.oldLine !== undefined || line.newLine !== undefined)
    )
  const columns = prose
    ? 'grid-cols-2'
    : numbered
      ? 'grid-cols-[minmax(3.5ch,auto)_minmax(3.5ch,auto)_24px_minmax(0,1fr)]'
      : 'grid-cols-[24px_minmax(0,1fr)]'
  return (
    <div
      ref={setScrollElement}
      className={cn(scrollFadeXClass, 'overflow-x-auto')}
      {...scrollFadeAttributes(scrollEdges)}
    >
      <div
        className={cn(
          'grid py-1 font-mono text-[var(--text-body)] text-small leading-[22px]',
          columns,
          wrapLines ? 'w-full' : 'w-max min-w-full',
          prose && 'font-season leading-relaxed'
        )}
      >
        {hunks.map((hunk, index) => (
          <HunkRows
            key={index}
            hunk={hunk}
            index={index}
            numbered={numbered}
            wrapLines={wrapLines}
            prose={prose}
          />
        ))}
      </div>
    </div>
  )
}
