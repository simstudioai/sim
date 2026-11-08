'use client'

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { Icon, type IconName } from '@sim/emcn/icon'
import { FALLBACK_PROVIDER_MARK, providerMark } from '@sim/emcn/icon/provider-marks'
import { OverflowText } from '@sim/emcn/overflow-text'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { SearchField } from '@sim/emcn/search-field'
import { Tooltip } from '@sim/emcn/tooltip'
import { formatDuration } from '@sim/utils/formatting'
import { useViewerTimeZone } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/execution-details/execution-details.module.css'
import {
  type Fact,
  Facts,
} from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/execution-details/facts'
import { Payload } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/execution-details/payload'
import {
  collectAllIds,
  collectMatchingIds,
  type FlatSpanEntry,
  findLeafErrorSpan,
  findSpan,
  flattenVisible,
  formatTokenCount,
  formatTps,
  formatTtft,
  getDisplayChildren,
  getDisplayName,
  getSpanId,
  isIterationType,
  mcpToolName,
  normalizeAndSort,
  parseTime,
  spanDuration,
  spanFailed,
  spanMatchesQuery,
} from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/execution-details/trace'
import { formatCreditCost, normalizeToolId, type TraceSpan } from '@/platform/lib/data/tables'
import { isCustomBlockType } from '@/platform/lib/data/workflows'
import { formatClockTime } from '@/platform/shared/time'

/** Why a custom block's steps are absent; a joined child run is its own evidence. */
const CHILD_TRACE_ACCESS_LABEL: Record<string, string> = {
  missing: 'Not available',
  truncated: 'Not expanded (nesting limit)',
  disabled: 'Not traced',
}

const MIN_BAR_PCT = 0.5

const KIND_GLYPHS: Partial<Record<string, IconName>> = {
  agent: 'I128',
  loop: 'I130',
  mcp: 'I126',
  model: 'I128',
  parallel: 'I129',
  workflow: 'I118',
}
/** Model providers whose mark the interface glyphs carry. */
const MODEL_PROVIDER_GLYPHS: Partial<Record<string, IconName>> = { openai: 'I124' }

/** A provider mark, when the shared catalog has one for this id. */
function catalogMark(providerId: string | undefined): string | null {
  return providerId && providerMark(providerId) !== FALLBACK_PROVIDER_MARK ? providerId : null
}

/** A span's mark: its tool's provider, its model's provider, its block's kind or provider. */
function SpanMark({ span }: { span: TraceSpan }) {
  const type = span.type?.toLowerCase() ?? ''
  if (type === 'tool') {
    if (mcpToolName(span.name)) return <Icon name='I126' />
    const provider = catalogMark(normalizeToolId(span.name).split('_')[0])
    return provider ? <Icon providerId={provider} /> : <Icon name='I127' />
  }
  if (type === 'model' && span.provider) {
    const glyph = MODEL_PROVIDER_GLYPHS[span.provider]
    if (glyph) return <Icon name={glyph} />
    const provider = catalogMark(span.provider)
    if (provider) return <Icon providerId={provider} />
  }
  const glyph = KIND_GLYPHS[type]
  if (glyph) return <Icon name={glyph} />
  const provider = catalogMark(type)
  return provider ? <Icon providerId={provider} /> : <Icon name='I127' />
}

/** The timing paint of a span's bar; a failure takes precedence. */
function spanPaint(span: TraceSpan, failed: boolean): string {
  if (failed) return 'error'
  const type = span.type?.toLowerCase() ?? ''
  if (type === 'agent' || type === 'model') return 'agent'
  if (type === 'loop' || type === 'loop-iteration') return 'loop'
  if (type === 'parallel' || type === 'parallel-iteration') return 'parallel'
  if (type === 'workflow') return 'workflow'
  return 'neutral'
}

function durationLabel(ms: number): string {
  return formatDuration(ms, { precision: 2 }) || '—'
}

/** One decimal under 10%, whole percents above, as the legacy timing tooltip reads. */
function percentLabel(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`
}

interface TraceRowProps {
  entry: FlatSpanEntry
  selected: boolean
  expanded: boolean
  expandable: boolean
  matchQuery: string
  runStartMs: number
  runTotalMs: number
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, entry: FlatSpanEntry) => void
}

function TraceRow({
  entry,
  selected,
  expanded,
  expandable,
  matchQuery,
  runStartMs,
  runTotalMs,
  onSelect,
  onToggle,
  onKeyDown,
}: TraceRowProps) {
  const { span, depth, parentDuration } = entry
  const id = getSpanId(span)
  const duration = spanDuration(span)
  const failed = spanFailed(span, depth)
  const name = getDisplayName(span)
  const offsetMs = runStartMs > 0 ? Math.max(0, parseTime(span.startTime) - runStartMs) : 0
  const offsetPct = runTotalMs > 0 ? Math.min(100 - MIN_BAR_PCT, (offsetMs / runTotalMs) * 100) : 0
  const rawPct = runTotalMs > 0 ? (duration / runTotalMs) * 100 : 0
  const widthPct = Math.max(MIN_BAR_PCT, Math.min(100 - offsetPct, rawPct))
  const ofTotal = runTotalMs > 0 ? (duration / runTotalMs) * 100 : null
  const ofParent = parentDuration && parentDuration > 0 ? (duration / parentDuration) * 100 : null
  const timing = [
    name,
    `${durationLabel(duration)}${offsetMs > 0 ? ` · +${durationLabel(offsetMs)}` : ''}`,
    ofTotal !== null && ofTotal >= 0.1
      ? `${percentLabel(ofTotal)} of total${ofParent !== null && ofParent >= 0.1 ? ` · ${percentLabel(ofParent)} of parent` : ''}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div
      className={styles.spanRow}
      role='treeitem'
      tabIndex={selected ? 0 : -1}
      aria-selected={selected}
      aria-expanded={expandable ? expanded : undefined}
      aria-level={depth + 1}
      data-span-id={id}
      data-selected={selected || undefined}
      onClick={() => onSelect(id)}
      onKeyDown={(event) => onKeyDown(event, entry)}
    >
      <span className={styles.spanLine}>
        {Array.from({ length: depth }, (_, level) => (
          <span key={level} className={styles.spanGuide} aria-hidden='true' />
        ))}
        {expandable ? (
          <button
            type='button'
            className={styles.spanDisclosure}
            tabIndex={-1}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            onClick={(event) => {
              event.stopPropagation()
              onToggle(id)
            }}
          >
            <Icon name={expanded ? 'I051' : 'I090'} />
          </button>
        ) : (
          <span className={styles.spanDisclosure} aria-hidden='true' />
        )}
        {!isIterationType(span.type) && (
          <span className={styles.spanMark} aria-hidden='true'>
            <SpanMark span={span} />
          </span>
        )}
        <Tooltip label={timing}>
          <span
            className={styles.spanName}
            data-type='T060'
            data-failed={failed || undefined}
            data-match={(Boolean(matchQuery) && spanMatchesQuery(span, matchQuery)) || undefined}
          >
            <OverflowText text={name}>{name}</OverflowText>
          </span>
        </Tooltip>
        <span className={styles.spanDuration} data-type='T052'>
          {formatDuration(duration, { precision: 2 })}
        </span>
      </span>
      <svg
        className={styles.spanTimeline}
        role='img'
        aria-label={`Started at +${durationLabel(offsetMs)}`}
      >
        <line className={styles.track} x1='0' x2='100%' y1='50%' y2='50%' />
        <rect
          className={styles.spanBar}
          data-paint={spanPaint(span, failed)}
          x={`${offsetPct}%`}
          y='0'
          width={`${widthPct}%`}
          height='100%'
          rx='2'
        />
      </svg>
    </div>
  )
}

/** The facts the legacy span detail lists, in its order; per-span cost is never shown. */
function spanFacts(span: TraceSpan, duration: number): Fact[] {
  const facts: Fact[] = [
    { id: 'type', label: 'Type', value: isCustomBlockType(span.type) ? 'custom block' : span.type },
  ]
  const childRunState = span.childTraceAccess ?? (span.childTraceDisabled ? 'disabled' : undefined)
  const childRun = childRunState ? CHILD_TRACE_ACCESS_LABEL[childRunState] : undefined
  if (childRun) facts.push({ id: 'child-run', label: 'Child run', value: childRun })
  facts.push({ id: 'duration', label: 'Duration', value: durationLabel(duration) })
  if (span.tries !== undefined)
    facts.push({ id: 'tries', label: 'Tries', value: String(span.tries) })
  if (span.provider) facts.push({ id: 'provider', label: 'Provider', value: span.provider })
  if (span.model) facts.push({ id: 'model', label: 'Model', value: span.model })
  for (const [index, failedModel] of (span.modelFallbacks ?? []).entries()) {
    facts.push({ id: `failed-model-${index}`, label: 'Failed model', value: failedModel })
  }
  if (span.finishReason)
    facts.push({ id: 'finish-reason', label: 'Finish reason', value: span.finishReason })
  const ttft = formatTtft(span.ttft)
  if (ttft) facts.push({ id: 'ttft', label: 'TTFT', value: ttft })
  const throughput =
    span.type?.toLowerCase() === 'model' ? formatTps(span.tokens?.output, duration) : undefined
  if (throughput) facts.push({ id: 'throughput', label: 'Throughput', value: throughput })
  const tokenFacts: Array<[string, string, number | undefined]> = [
    ['input-tokens', 'Input tokens', span.tokens?.input],
    ['output-tokens', 'Output tokens', span.tokens?.output],
    ['total-tokens', 'Total tokens', span.tokens?.total],
    ['cache-read', 'Cache read', span.tokens?.cacheRead],
    ['cache-write', 'Cache write', span.tokens?.cacheWrite],
    ['reasoning-tokens', 'Reasoning tokens', span.tokens?.reasoning],
  ]
  for (const [id, label, count] of tokenFacts) {
    const value = formatTokenCount(count)
    if (value) facts.push({ id, label, value })
  }
  if (span.errorType) facts.push({ id: 'error-type', label: 'Error type', value: span.errorType })
  if (span.iterationIndex !== undefined)
    facts.push({ id: 'iteration', label: 'Iteration', value: String(span.iterationIndex + 1) })
  return facts
}

/** The selected step: what it was, how it went, and what it read and wrote. */
function SpanInspector({ span }: { span: TraceSpan }) {
  const timeZone = useViewerTimeZone()
  const duration = spanDuration(span)
  const failed = spanFailed(span, 0)
  const directError = span.status === 'error'
  const startedAt = parseTime(span.startTime)
  const endedAt = parseTime(span.endTime)
  const name = getDisplayName(span)
  return (
    <section className={styles.inspector} aria-label={`${name} step`}>
      <header className={styles.inspectorHeader}>
        {!isIterationType(span.type) && (
          <span className={styles.spanMark} aria-hidden='true'>
            <SpanMark span={span} />
          </span>
        )}
        <span className={styles.inspectorTitle}>
          <h3 className={styles.inspectorName} data-type='T059' data-failed={failed || undefined}>
            {name}
          </h3>
          <span className={styles.inspectorMeta} data-type='T052'>
            <span className={styles.runStatus} data-status={failed ? 'error' : 'success'}>
              {failed ? 'Error' : 'Success'}
            </span>
            <span>{durationLabel(duration)}</span>
            {startedAt > 0 && <span>{formatClockTime(startedAt, timeZone)}</span>}
          </span>
        </span>
      </header>
      <Facts label={`${name} facts`} facts={spanFacts(span, duration)} />
      {span.input != null && <Payload label='Input' data={span.input} />}
      {span.output != null && (
        <Payload label={directError ? 'Error' : 'Output'} data={span.output} />
      )}
      {span.thinking && <Payload label='Thinking' data={span.thinking} />}
      {span.modelToolCalls && span.modelToolCalls.length > 0 && (
        <Payload label='Tool calls' data={span.modelToolCalls} />
      )}
      {span.errorMessage && <Payload label='Error message' data={span.errorMessage} />}
      {startedAt > 0 && endedAt > 0 && (
        <p className={styles.inspectorTimes} data-type='T052'>
          <span>Started {formatClockTime(startedAt, timeZone)}</span>
          <span>Ended {formatClockTime(endedAt, timeZone)}</span>
        </p>
      )}
    </section>
  )
}

interface TraceViewProps {
  traceSpans: TraceSpan[]
  /**
   * The run's recorded cost in dollars, so the trace and the overview never show different totals.
   * The root span's own cost stands in only when it is absent.
   */
  runCostDollars?: number
}

/**
 * The run's spans as a tree on one clock, each with its timing bar, and the selected span's details
 * beneath it. The first failure is selected to begin with. In the tree, Up and Down move the
 * selection, Right expands, and Left collapses or moves to the parent.
 */
export function TraceView({ traceSpans, runCostDollars }: TraceViewProps) {
  const treeElement = useRef<HTMLDivElement | null>(null)
  const tree = useScrollEdges<HTMLDivElement>('vertical', { viewport: treeElement })
  const { spans, allIds, totalDuration, runStartMs, firstRootId, firstErrorId } = useMemo(() => {
    const sorted = normalizeAndSort(traceSpans)
    let earliest = Number.POSITIVE_INFINITY
    let latest = 0
    const walkTimeBounds = (list: TraceSpan[]) => {
      for (const span of list) {
        const start = parseTime(span.startTime)
        const end = parseTime(span.endTime)
        if (start < earliest) earliest = start
        if (end > latest) latest = end
        if (span.children?.length) walkTimeBounds(span.children)
      }
    }
    walkTimeBounds(sorted)
    const runStart = earliest !== Number.POSITIVE_INFINITY ? earliest : 0
    const firstError = findLeafErrorSpan(sorted)
    return {
      spans: sorted,
      allIds: collectAllIds(sorted),
      totalDuration: latest > runStart ? latest - runStart : 0,
      runStartMs: runStart,
      firstRootId: sorted.length > 0 ? getSpanId(sorted[0]) : null,
      firstErrorId: firstError ? getSpanId(firstError) : null,
    }
  }, [traceSpans])

  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(allIds))
  const [selectedId, setSelectedId] = useState<string | null>(firstErrorId ?? firstRootId)
  // A refreshed trace (a run that was still going) opens fully again at its first failure.
  const [shownIds, setShownIds] = useState(allIds)
  if (shownIds !== allIds) {
    setShownIds(allIds)
    setExpanded(new Set(allIds))
    setSelectedId(firstErrorId ?? firstRootId)
  }

  const matchingIds = useMemo(
    () => (query ? collectMatchingIds(spans, query) : null),
    [spans, query]
  )
  const rows = useMemo(() => {
    const visible = flattenVisible(spans, expanded)
    return matchingIds ? visible.filter((entry) => matchingIds.has(getSpanId(entry.span))) : visible
  }, [spans, expanded, matchingIds])
  const selectedSpan = useMemo(() => findSpan(spans, selectedId), [spans, selectedId])

  const runFailed = spans.some((span) => spanFailed(span, 0))
  const rootCost = formatCreditCost(runCostDollars ?? spans[0]?.cost?.total, {
    emptyForZeroOrLess: true,
  })

  function toggle(id: string, open?: boolean) {
    setExpanded((current) => {
      const next = new Set(current)
      if (open ?? !next.has(id)) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // The selected row comes into view, and keeps keyboard focus while the reader moves through the tree.
  useEffect(() => {
    const list = treeElement.current
    if (!selectedId || !list) return
    const row = list.querySelector<HTMLElement>(`[data-span-id="${CSS.escape(selectedId)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
    if (row && list.contains(document.activeElement)) row.focus()
  }, [selectedId])

  function onRowKeyDown(event: KeyboardEvent<HTMLDivElement>, entry: FlatSpanEntry) {
    const id = getSpanId(entry.span)
    const index = rows.findIndex((row) => getSpanId(row.span) === id)
    const expandable = getDisplayChildren(entry.span).length > 0
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setSelectedId(id)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = rows[Math.min(rows.length - 1, index + 1)]
      if (next) setSelectedId(getSpanId(next.span))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const previous = rows[Math.max(0, index - 1)]
      if (previous) setSelectedId(getSpanId(previous.span))
    } else if (event.key === 'ArrowLeft') {
      if (expandable && expanded.has(id)) {
        event.preventDefault()
        toggle(id, false)
      } else if (entry.parentIds.length > 0) {
        event.preventDefault()
        setSelectedId(entry.parentIds[entry.parentIds.length - 1])
      }
    } else if (event.key === 'ArrowRight' && expandable && !expanded.has(id)) {
      event.preventDefault()
      toggle(id, true)
    }
  }

  return (
    <div className={styles.trace}>
      <div className={styles.traceHeader} data-type='T052'>
        <span className={styles.runStatus} data-status={runFailed ? 'error' : 'success'}>
          {runFailed ? 'Error' : 'Success'}
        </span>
        <span>{durationLabel(totalDuration)}</span>
        <span>
          {allIds.length} {allIds.length === 1 ? 'span' : 'spans'}
        </span>
        {rootCost && <span>{rootCost}</span>}
        {firstErrorId && (
          <span className={styles.traceHeaderAction}>
            <Button variant='quiet' size='compact' onClick={() => setSelectedId(firstErrorId)}>
              Jump to error
            </Button>
          </span>
        )}
      </div>
      <div className={styles.traceToolbar}>
        <span className={styles.traceSearch}>
          <SearchField
            label='Filter spans'
            placeholder='Filter spans'
            variant='quiet'
            value={query}
            onValueChange={setQuery}
          />
        </span>
        <CopyButton label='Copy raw trace' text={JSON.stringify(traceSpans, null, 2)} />
        <Button variant='quiet' size='compact' onClick={() => setExpanded(new Set(allIds))}>
          Expand all
        </Button>
        <Button variant='quiet' size='compact' onClick={() => setExpanded(new Set())}>
          Collapse all
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className={styles.note} data-type='T060'>
          No matching spans
        </p>
      ) : (
        <div ref={tree} className={styles.tree} role='tree' aria-label='Trace spans'>
          {rows.map((entry) => {
            const id = getSpanId(entry.span)
            return (
              <TraceRow
                key={id}
                entry={entry}
                selected={id === selectedId}
                expanded={expanded.has(id)}
                expandable={getDisplayChildren(entry.span).length > 0}
                matchQuery={query}
                runStartMs={runStartMs}
                runTotalMs={totalDuration}
                onSelect={setSelectedId}
                onToggle={toggle}
                onKeyDown={onRowKeyDown}
              />
            )
          })}
        </div>
      )}
      {selectedSpan ? (
        <SpanInspector key={getSpanId(selectedSpan)} span={selectedSpan} />
      ) : (
        <p className={styles.note} data-type='T060'>
          Select a span to see details.
        </p>
      )}
    </div>
  )
}
