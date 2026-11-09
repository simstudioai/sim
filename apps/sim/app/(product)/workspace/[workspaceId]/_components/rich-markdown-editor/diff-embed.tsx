'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { Icon, type IconName } from '@sim/emcn/icon'
import { OverflowText } from '@sim/emcn/overflow-text'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { getErrorMessage } from '@sim/utils/errors'
import { diffWordsWithSpace } from 'diff'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import styles from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/diff-embed.module.css'
import { useWorkspaceFileRecord } from '@/platform/lib/data/files'
import {
  type DiffHunk,
  type DiffLine,
  type DiffSource,
  parseUnifiedDiff,
  sameSource,
  type UnifiedDiff,
  useDocumentQuery,
} from '@/platform/lib/data/files/markdown'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { formatInstantDate } from '@/platform/shared/time'

const CONTEXT_EDGE = 3
const COLLAPSE_AFTER = CONTEXT_EDGE * 2 + 2
const WORD_DIFF_MAX_CHARS = 1000

interface Segment {
  text: string
  changed: boolean
}

type VisibleItem = { line: DiffLine; key: number } | { collapsed: number; key: number }
type PairedRow = { old?: DiffLine; new?: DiffLine; key: number }
type PairedItem = PairedRow | { collapsed: number; key: number }

interface CardHeading {
  title: string
  meta: string
  icon: IconName
  href?: string
}

/** Pairs removed and added lines in each change block for bounded word-level highlights. */
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

function LineText({ line, segments }: { line: DiffLine; segments: Segment[] | undefined }) {
  const label = line.type === 'add' ? 'Added: ' : line.type === 'del' ? 'Removed: ' : null
  return (
    <>
      {label && <span className={styles.srOnly}>{label}</span>}
      {segments
        ? segments.map((segment, index) => (
            <span key={index} data-changed={(segment.changed && line.type) || undefined}>
              {segment.text}
            </span>
          ))
        : line.text || ' '}
    </>
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

function marker(line: DiffLine | undefined) {
  return line?.type === 'add' ? '+' : line?.type === 'del' ? '−' : ' '
}

interface CollapsedRunProps {
  count: number
  onExpand: () => void
  /** The comparison grid row it spans, beside two columns that fill every row. */
  row?: number
}

function CollapsedRun({ count, onExpand, row }: CollapsedRunProps) {
  return (
    <div className={styles.collapsed} data-row={row}>
      <Button variant='quiet' size='compact' onClick={onExpand}>
        {`Show ${count} unchanged ${count === 1 ? 'line' : 'lines'}`}
      </Button>
    </div>
  )
}

function HunkHeading({ hunk, row }: { hunk: DiffHunk; row?: number }) {
  return (
    <div className={styles.hunkHeading} data-type='T052' data-row={row}>
      {hunk.file && <span className={styles.hunkFile}>{hunk.file} </span>}
      {hunk.heading || (hunk.file ? '' : '⋯')}
    </div>
  )
}

interface HunkRowsProps {
  hunk: DiffHunk
  index: number
  numbered: boolean
}

function HunkRows({ hunk, index, numbered }: HunkRowsProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  const segments = wordSegments(hunk.lines)
  return (
    <>
      {(hunk.file || hunk.heading || index > 0) && <HunkHeading hunk={hunk} />}
      {visibleItems(hunk.lines, (start) => expanded.has(start)).map((item) =>
        'collapsed' in item ? (
          <CollapsedRun
            key={`c${item.key}`}
            count={item.collapsed}
            onExpand={() => setExpanded((current) => new Set(current).add(item.key))}
          />
        ) : (
          <div key={item.key} className={styles.row} data-change={item.line.type}>
            {numbered && (
              <span className={styles.gutter} aria-hidden='true'>
                {item.line.oldLine ?? ''}
              </span>
            )}
            {numbered && (
              <span className={styles.gutter} aria-hidden='true'>
                {item.line.newLine ?? ''}
              </span>
            )}
            <span className={styles.marker} aria-hidden='true'>
              {marker(item.line)}
            </span>
            <span className={styles.code}>
              <LineText line={item.line} segments={segments.get(item.line)} />
            </span>
          </div>
        )
      )}
    </>
  )
}

type ProseItem =
  | { kind: 'heading'; hunk: DiffHunk; key: string }
  | { kind: 'collapsed'; count: number; key: string }
  | { kind: 'row'; item: PairedRow; segments: Map<DiffLine, Segment[]>; key: string }

interface ProseColumnProps {
  items: ProseItem[]
  side: 'old' | 'new'
  wrapLines: boolean
}

/**
 * One document of a side-by-side comparison. Each scrolls sideways on its own, while its rows share
 * the comparison's grid rows, so a changed paragraph stays level with its counterpart.
 */
function ProseColumn({ items, side, wrapLines }: ProseColumnProps) {
  const scrollRef = useScrollEdges<HTMLDivElement>('horizontal')
  return (
    <div className={styles.proseColumn} data-side={side}>
      <div
        ref={scrollRef}
        role='region'
        aria-label={side === 'old' ? 'Before document' : 'After document'}
        tabIndex={wrapLines ? undefined : 0}
        className={styles.proseScroll}
      >
        <div className={styles.proseTrack}>
          {items.map((entry) => {
            const line = entry.kind === 'row' ? entry.item[side] : undefined
            if (entry.kind === 'row' && line)
              return (
                <div key={entry.key} className={styles.proseCell} data-change={line.type}>
                  <span className={styles.marker} aria-hidden='true'>
                    {marker(line)}
                  </span>
                  <p className={styles.proseText}>
                    <LineText line={line} segments={entry.segments.get(line)} />
                  </p>
                </div>
              )
            return entry.kind === 'row' ? (
              <div key={entry.key} className={styles.proseCell} data-empty='' aria-hidden='true' />
            ) : (
              <div key={entry.key} aria-hidden='true' />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ProseRows({ hunks, wrapLines }: { hunks: DiffHunk[]; wrapLines: boolean }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const gridRef = useRef<HTMLDivElement>(null)
  const items: ProseItem[] = []
  for (const [index, hunk] of hunks.entries()) {
    if (hunk.file || hunk.heading || index > 0)
      items.push({ kind: 'heading', hunk, key: `${index}:heading` })
    const segments = wordSegments(hunk.lines)
    const visible = visibleItems(hunk.lines, (start) => expanded.has(`${index}:c${start}`))
    for (const item of pairedItems(visible))
      items.push(
        'collapsed' in item
          ? { kind: 'collapsed', count: item.collapsed, key: `${index}:c${item.key}` }
          : { kind: 'row', item, segments, key: `${index}:${item.key}` }
      )
  }
  const rowCount = items.length

  /** Both columns span every row, so the row count and each full-width row's line are geometry. */
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    grid.style.gridTemplateRows = `repeat(${rowCount}, auto)`
    for (const element of grid.querySelectorAll<HTMLElement>(':scope > [data-row]'))
      element.style.gridRow = element.dataset.row ?? ''
  })

  if (rowCount === 0) return null
  return (
    <div ref={gridRef} className={styles.prose}>
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

/** An edit, line by line; one sideways scroll for the whole listing, with fades at hidden edges. */
function UnifiedRows({ hunks, numbered }: { hunks: DiffHunk[]; numbered: boolean }) {
  const scrollRef = useScrollEdges<HTMLDivElement>('horizontal')
  return (
    <div ref={scrollRef} className={styles.scroll}>
      <div className={styles.unified} data-numbered={numbered || undefined}>
        {hunks.map((hunk, index) => (
          <HunkRows key={index} hunk={hunk} index={index} numbered={numbered} />
        ))}
      </div>
    </div>
  )
}

function useDiffSource(workspaceId: string | null, source: DiffSource | null): CardHeading | null {
  const fileId = workspaceId && source?.kind === 'file' ? source.fileId : ''
  const knowledgeBaseId =
    workspaceId && source?.kind === 'knowledge' ? source.knowledgeBaseId : undefined
  const documentId = workspaceId && source?.kind === 'knowledge' ? source.documentId : undefined
  const fileRecord = useWorkspaceFileRecord(workspaceId ?? '', fileId)
  const documentRecord = useDocumentQuery(knowledgeBaseId, documentId)
  if (!workspaceId || !source) return null
  if (source.kind === 'file') {
    const updated = fileRecord.data?.updatedAt
    return {
      title: fileRecord.data?.name ?? 'File',
      meta: ['Workspace file', updated && `Updated ${formatInstantDate(updated)}`]
        .filter(Boolean)
        .join(' · '),
      icon: 'I015',
      href: `${workspacePath(workspaceId, 'files')}/${encodeURIComponent(source.fileId)}`,
    }
  }
  const uploaded = documentRecord.data?.uploadedAt
  return {
    title: documentRecord.data?.filename ?? 'Document',
    meta: ['Knowledge base', uploaded && `Updated ${formatInstantDate(uploaded)}`]
      .filter(Boolean)
      .join(' · '),
    icon: 'I004',
    href: `${workspacePath(workspaceId, 'knowledge')}/${encodeURIComponent(source.knowledgeBaseId)}/${encodeURIComponent(source.documentId)}`,
  }
}

function SourceHeading({ heading, side }: { heading: CardHeading; side?: 'Before' | 'After' }) {
  return (
    <div className={styles.source}>
      <Icon name={heading.icon} />
      <div className={styles.sourceText}>
        {side && heading.title !== side && (
          <span className={styles.secondary} data-type='T052'>
            {side}
          </span>
        )}
        <div className={styles.sourceTitle}>
          <span data-type='T060'>
            <OverflowText text={heading.title}>{heading.title}</OverflowText>
          </span>
          {heading.href && (
            <IconButton
              render={<Link href={heading.href} />}
              label={`Open ${heading.title}`}
              icon='I030'
              size='compact'
            />
          )}
        </div>
        {heading.meta && (
          <span className={styles.secondary} data-type='T052'>
            <OverflowText text={heading.meta}>{heading.meta}</OverflowText>
          </span>
        )}
      </div>
    </div>
  )
}

function ChangeCounts({ diff }: { diff: UnifiedDiff }) {
  let added = 0
  let removed = 0
  for (const hunk of diff.hunks)
    for (const line of hunk.lines) {
      if (line.type === 'add') added++
      else if (line.type === 'del') removed++
    }
  return (
    <div className={styles.counts} data-type='T005'>
      <span data-change='add' aria-label={`${added} added ${added === 1 ? 'line' : 'lines'}`}>
        +{added}
      </span>
      <span data-change='del' aria-label={`${removed} removed ${removed === 1 ? 'line' : 'lines'}`}>
        −{removed}
      </span>
    </div>
  )
}

function fallbackHeading(resolved: CardHeading | null, title: string): CardHeading {
  return resolved ?? { title, meta: '', icon: 'I015' }
}

function parse(
  source: string
): { diff: UnifiedDiff; error?: never } | { error: string; diff?: never } {
  try {
    return { diff: parseUnifiedDiff(source) }
  } catch (error) {
    return { error: getErrorMessage(error, 'Invalid diff') }
  }
}

interface DiffEmbedProps {
  /** The fence body: a unified diff, optionally naming its `sim:` sources in `---`/`+++`. */
  source: string
  wrapLines: boolean
}

/**
 * A ```diff fence: an edit renders line by line with word highlights and collapsible context; two
 * different documents render side by side. `sim:` sources name and link the files or knowledge
 * documents the diff quotes.
 */
export function DiffEmbed({ source, wrapLines }: DiffEmbedProps) {
  const params = useParams()
  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : null
  const parsed = parse(source)
  const diff = parsed.diff
  const comparison = Boolean(
    diff?.oldSource && diff.newSource && !sameSource(diff.oldSource, diff.newSource)
  )
  const oldSide = useDiffSource(workspaceId, diff?.oldSource ?? null)
  const newSide = useDiffSource(workspaceId, comparison ? (diff?.newSource ?? null) : null)
  if (!diff)
    return (
      <div className={styles.notice} role='alert' data-type='T052'>
        {parsed.error}
      </div>
    )
  const numbered = diff.hunks.some((hunk) =>
    hunk.lines.some((line) => line.oldLine !== undefined || line.newLine !== undefined)
  )
  return (
    <div className={styles.card} data-wrap={wrapLines || undefined}>
      {comparison ? (
        <div className={styles.compareHeader}>
          <header className={styles.header}>
            <SourceHeading heading={fallbackHeading(oldSide, 'Before')} side='Before' />
          </header>
          <header className={styles.header}>
            <SourceHeading heading={fallbackHeading(newSide, 'After')} side='After' />
          </header>
        </div>
      ) : (
        <header className={styles.header}>
          <SourceHeading heading={fallbackHeading(oldSide, diff.path ?? 'Diff')} />
          <ChangeCounts diff={diff} />
        </header>
      )}
      {comparison ? (
        <ProseRows hunks={diff.hunks} wrapLines={wrapLines} />
      ) : (
        <UnifiedRows hunks={diff.hunks} numbered={numbered} />
      )}
    </div>
  )
}
