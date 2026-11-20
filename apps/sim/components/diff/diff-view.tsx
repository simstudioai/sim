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
const MARKER = 'select-none py-0.5 text-center text-caption'

interface Segment {
  text: string
  changed: boolean
}

type VisibleItem = { line: DiffLine; key: number } | { collapsed: number; key: number }
type PairedRow = { old?: DiffLine; new?: DiffLine; key: number }
type PairedItem = PairedRow | { collapsed: number; key: number }
type ProseItem =
  | { kind: 'heading'; hunk: DiffHunk; key: string }
  | { kind: 'collapsed'; count: number; key: string }
  | { kind: 'row'; item: PairedRow; segments: Map<DiffLine, Segment[]>; key: string }

interface DiffViewProps {
  hunks: DiffHunk[]
  wrapLines?: boolean
}

interface LineTextProps {
  line: DiffLine
  segments: Segment[] | undefined
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
  row?: number
}

interface DiffCellProps extends LineTextProps {
  wrapLines: boolean
}
interface ProseColumnProps {
  items: ProseItem[]
  side: 'old' | 'new'
  wrapLines: boolean
}
interface ProseRowsProps {
  hunks: DiffHunk[]
  wrapLines: boolean
}
interface HunkHeadingProps {
  hunk: DiffHunk
  row?: number
}

/** Pairs removed and added lines within each change block for bounded word-level highlighting. */
function wordSegments(lines: DiffLine[]): Map<DiffLine, Segment[]> {
  const segments = new Map<DiffLine, Segment[]>()
  for (let index = 0; index < lines.length; ) {
    if (lines[index].type === 'context') {
      index++
      continue
    }
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (index < lines.length && lines[index].type !== 'context') {
      const line = lines[index++]
      if (line.type === 'del') dels.push(line)
      else adds.push(line)
    }
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

function LineText({ line, segments }: LineTextProps) {
  const changeLabel = line.type === 'add' ? 'Added: ' : line.type === 'del' ? 'Removed: ' : null
  const prefix = /^#{1,6}\s+/.exec(line.text)?.[0] ?? ''
  const text = line.text.slice(prefix.length)
  let offset = prefix.length
  return (
    <p className={cn(prefix && 'font-medium text-[var(--text-primary)]')}>
      <span className='sr-only'>{changeLabel}</span>
      {prefix && (
        <span className='font-mono text-[var(--text-muted)] text-caption'>
          <HighlightedText text={prefix} offset={0} segments={segments} type={line.type} />
        </span>
      )}
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

function CollapsedRun({ count, onExpand, row }: CollapsedRunProps) {
  return (
    <div
      className='sticky left-0 col-span-full border-[var(--border)] border-y bg-[var(--surface-3)] px-3 py-1'
      style={row ? { gridRow: row } : undefined}
    >
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
      if (!('line' in next) || next.line.type === 'context') break
      if (next.line.type === 'del') removed.push(next.line)
      else added.push(next.line)
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

function DiffCell({ line, segments, wrapLines }: DiffCellProps) {
  return (
    <div className={cn('grid min-w-0 grid-cols-[24px_minmax(0,1fr)] px-3 py-2', rowClass(line))}>
      <span className={cn(MARKER, markerClass(line))} aria-hidden>
        {marker(line)}
      </span>
      <div
        className={cn(
          'min-w-0 py-0.5 pr-1 pl-1',
          wrapLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
        )}
      >
        <LineText line={line} segments={segments} />
      </div>
    </div>
  )
}

function ProseColumn({ items, side, wrapLines }: ProseColumnProps) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const scrollEdges = useScrollEdges(scrollElement, { axis: 'x' })
  return (
    <div
      className={cn(
        'row-span-full grid min-w-0 grid-rows-subgrid',
        side === 'old' ? 'col-start-1' : 'col-start-2 border-[var(--border)] border-l'
      )}
    >
      <div
        ref={setScrollElement}
        role='region'
        aria-label={side === 'old' ? 'Before document' : 'After document'}
        tabIndex={wrapLines ? undefined : 0}
        className={cn(
          scrollFadeXClass,
          'row-span-full grid min-w-0 grid-rows-subgrid overflow-x-auto'
        )}
        {...scrollFadeAttributes(scrollEdges)}
      >
        <div
          className={cn(
            'row-span-full grid grid-rows-subgrid',
            wrapLines ? 'w-full min-w-0' : 'w-max min-w-full'
          )}
        >
          {items.map((entry) => {
            const line = entry.kind === 'row' ? entry.item[side] : undefined
            return line && entry.kind === 'row' ? (
              <DiffCell
                key={entry.key}
                line={line}
                segments={entry.segments.get(line)}
                wrapLines={wrapLines}
              />
            ) : (
              <div
                key={entry.key}
                aria-hidden
                className={cn(entry.kind === 'row' && 'bg-[var(--surface-3)]')}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function HunkHeading({ hunk, row }: HunkHeadingProps) {
  return (
    <div
      className='sticky left-0 col-span-full border-[var(--border)] border-y bg-[var(--surface-3)] px-4 py-2 font-season text-[var(--text-muted)] text-caption'
      style={row ? { gridRow: row } : undefined}
    >
      {hunk.file && <span className='text-[var(--text-body)]'>{hunk.file} </span>}
      {hunk.heading || (hunk.file ? '' : '⋯')}
    </div>
  )
}

function ProseRows({ hunks, wrapLines }: ProseRowsProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const items: ProseItem[] = []
  for (const [index, hunk] of hunks.entries()) {
    if (hunk.file || hunk.heading || index > 0)
      items.push({ kind: 'heading', hunk, key: `${index}:heading` })
    const segments = wordSegments(hunk.lines)
    const visible = visibleItems(hunk.lines, (start) => expanded.has(`${index}:c${start}`))
    for (const item of pairedItems(visible)) {
      items.push(
        'collapsed' in item
          ? { kind: 'collapsed', count: item.collapsed, key: `${index}:c${item.key}` }
          : { kind: 'row', item, segments, key: `${index}:${item.key}` }
      )
    }
  }
  if (items.length === 0) return null
  return (
    <div
      className='grid w-full grid-cols-2 py-1 font-season text-[var(--text-body)] text-small leading-relaxed'
      style={{ gridTemplateRows: `repeat(${items.length}, auto)` }}
    >
      <ProseColumn items={items} side='old' wrapLines={wrapLines} />
      <ProseColumn items={items} side='new' wrapLines={wrapLines} />
      {items.map((entry, index) =>
        entry.kind === 'heading' ? (
          <HunkHeading key={entry.key} hunk={entry.hunk} row={index + 1} />
        ) : entry.kind === 'collapsed' ? (
          <CollapsedRun
            key={entry.key}
            count={entry.count}
            row={index + 1}
            onExpand={() => setExpanded((current) => new Set(current).add(entry.key))}
          />
        ) : null
      )}
    </div>
  )
}

/** Two documents side by side, aligned row for row, with word highlights and collapsible context. */
export function DiffView({ hunks, wrapLines = true }: DiffViewProps) {
  return <ProseRows hunks={hunks} wrapLines={wrapLines} />
}
