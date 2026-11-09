'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { Icon, type IconName } from '@sim/emcn/icon'
import { FALLBACK_PROVIDER_MARK, providerMark } from '@sim/emcn/icon/provider-marks'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { SearchField } from '@sim/emcn/search-field'
import { formatDuration } from '@sim/utils/formatting'
import {
  type MetadataField,
  MetadataFields,
} from '@/app/(product)/workspace/[workspaceId]/_components/metadata-fields/metadata-fields'
import {
  type TracePaint,
  type TraceRow,
  TraceTree,
} from '@/app/(product)/workspace/[workspaceId]/_components/trace-tree/trace-tree'
import { useViewerTimeZone } from '@/app/(product)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import styles from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/execution-details/execution-details.module.css'
import { Payload } from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/execution-details/payload'
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
} from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/execution-details/trace'
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
function spanPaint(span: TraceSpan, failed: boolean): TracePaint {
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

/** A visible span as a row on the run's one clock, with its fuller timing on hover. */
function traceRow(
  entry: FlatSpanEntry,
  expanded: ReadonlySet<string>,
  runStartMs: number,
  runTotalMs: number
): TraceRow {
  const { span, depth, parentDuration } = entry
  const id = getSpanId(span)
  const duration = spanDuration(span)
  const failed = spanFailed(span, depth)
  const name = getDisplayName(span)
  const offsetMs = runStartMs > 0 ? Math.max(0, parseTime(span.startTime) - runStartMs) : 0
  const offsetPct = runTotalMs > 0 ? Math.min(100 - MIN_BAR_PCT, (offsetMs / runTotalMs) * 100) : 0
  const rawPct = runTotalMs > 0 ? (duration / runTotalMs) * 100 : 0
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
  return {
    id,
    name,
    depth,
    mark: isIterationType(span.type) ? undefined : <SpanMark span={span} />,
    duration: formatDuration(duration, { precision: 2 }) ?? '',
    bar: {
      start: offsetPct,
      width: Math.max(MIN_BAR_PCT, Math.min(100 - offsetPct, rawPct)),
      paint: spanPaint(span, failed),
    },
    startLabel: `Started at +${durationLabel(offsetMs)}`,
    timing,
    failed,
    expanded: getDisplayChildren(span).length > 0 ? expanded.has(id) : undefined,
  }
}

/** The facts the legacy span detail lists, in its order; per-span cost is never shown. */
function spanFacts(span: TraceSpan, duration: number): MetadataField[] {
  const facts: MetadataField[] = [
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
      <MetadataFields label={`${name} facts`} fields={spanFacts(span, duration)} />
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

  // The selected row comes into view, as when Jump to error selects a step out of sight.
  useEffect(() => {
    const list = treeElement.current
    if (!selectedId || !list) return
    list
      .querySelector<HTMLElement>(`[data-trace-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

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
        <div ref={tree} className={styles.tree}>
          <TraceTree
            label='Trace spans'
            rows={rows.map((entry) => traceRow(entry, expanded, runStartMs, totalDuration))}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggle={toggle}
          />
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
