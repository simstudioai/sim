'use client'

import { type ReactNode, useState } from 'react'
import { Button } from '@sim/emcn/button'
import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import { Icon } from '@sim/emcn/icon'
import { FALLBACK_PROVIDER_MARK, providerMark } from '@sim/emcn/icon/provider-marks'
import { OverflowText } from '@sim/emcn/overflow-text'
import { PropertyList } from '@sim/emcn/property-list'
import { DirectoryHeading } from '@/app/(product)/_components/resource-directory/resource-directory'
import {
  DetailSection,
  DetailSplit,
} from '@/app/(product)/_components/workspace/detail-split/detail-split'
import styles from '@/app/(product)/_components/workspace/logs/run-details/run-details.module.css'
import { RUN_STATUS_LABEL } from '@/app/(product)/_components/workspace/logs/run-status/run-status'
import { MetadataFields } from '@/app/(product)/_components/workspace/metadata-fields/metadata-fields'
import { FindableSpanInspector } from '@/app/(product)/_components/workspace/span-inspector/span-inspector'
import {
  spanPaint,
  type TraceRow,
  TraceToolbar,
  TraceTree,
} from '@/app/(product)/_components/workspace/trace-tree/trace-tree'
import {
  formatComputeUnits,
  formatDuration,
} from '@/app/(product)/_components/workspace/workspace-session/format'
import type { WorkspaceRead } from '@/app/(product)/_components/workspace/workspace-session/model'
import { useViewerTimeZone } from '@/app/(product)/_components/workspace/workspace-session/workspace-session'
import { formatClockTime, formatTimestamp } from '@/platform/shared/time'
import type { RunCost, RunDetail, RunFile, TraceSpan } from '@/platform/shared/workspace-records'

const KIND_ICON: Record<TraceSpan['kind'], IconName> = {
  agent: 'I128',
  model: 'I128',
  tool: 'I127',
  mcp: 'I126',
  loop: 'I130',
  iteration: 'I130',
  parallel: 'I129',
  branch: 'I129',
  workflow: 'I118',
  block: 'I127',
}

const PROVIDER_ICON: Partial<Record<string, IconName>> = { slack: 'I123', openai: 'I124' }
/** Kinds whose own glyph reads before any provider's mark. */
const KIND_FIRST = new Set<TraceSpan['kind']>(['agent', 'loop', 'parallel', 'workflow', 'mcp'])

/** A step's mark: its kind's glyph, then its tool's, model's or block's provider, as legacy marks it. */
function spanMark(span: TraceSpan) {
  if (span.kind === 'iteration' || span.kind === 'branch') return undefined
  if (KIND_FIRST.has(span.kind) || !span.providerId) return <Icon name={KIND_ICON[span.kind]} />
  const providerIcon = PROVIDER_ICON[span.providerId]
  if (providerIcon) return <Icon name={providerIcon} />
  if (providerMark(span.providerId) !== FALLBACK_PROVIDER_MARK)
    return <Icon providerId={span.providerId} />
  return <Icon name={KIND_ICON[span.kind]} />
}

/** One decimal under 10%, whole percents above, as the legacy timing tooltip reads. */
function percentLabel(value: number) {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`
}

/** Whether a step failed: a recorded error on it or on any step beneath it. */
function failedInTree(span: TraceSpan): boolean {
  return span.status === 'error' || Boolean(span.children?.some(failedInTree))
}

/** The run's open steps in reading order, each placed on the run's one clock. */
function traceRows(
  spans: readonly TraceSpan[],
  collapsed: ReadonlySet<string>,
  totalMs: number,
  shown: ReadonlySet<string> | null,
  parent?: TraceSpan,
  depth = 0
): TraceRow[] {
  const clock = Math.max(1, totalMs)
  const share = (ms: number) => Math.max(0, Math.min(100, (100 * ms) / clock))
  return spans.flatMap((span) => {
    if (shown && !shown.has(span.id)) return []
    const expandable = Boolean(span.children?.length)
    const start = share(span.startMs)
    const ofTotal = share(span.durationMs)
    const ofParent =
      parent && parent.durationMs > 0 ? (100 * span.durationMs) / parent.durationMs : null
    const timing = [
      span.name,
      `${formatDuration(span.durationMs)}${span.startMs > 0 ? ` · +${formatDuration(span.startMs)}` : ''}`,
      ofTotal >= 0.1
        ? `${percentLabel(ofTotal)} of total${ofParent !== null && ofParent >= 0.1 ? ` · ${percentLabel(ofParent)} of parent` : ''}`
        : null,
    ]
      .filter(Boolean)
      .join(' · ')
    const row: TraceRow = {
      id: span.id,
      name: span.name,
      depth,
      mark: spanMark(span),
      duration: formatDuration(span.durationMs),
      bar: {
        start,
        width: Math.max(0.6, Math.min(100 - start, share(span.durationMs))),
        paint: spanPaint(span),
      },
      startLabel: `Started at ${formatDuration(span.startMs)}`,
      timing,
      failed: depth === 0 ? span.status === 'error' : failedInTree(span),
      expanded: expandable ? !collapsed.has(span.id) : undefined,
    }
    return [
      row,
      ...(span.children?.length && !collapsed.has(span.id)
        ? traceRows(span.children, collapsed, totalMs, shown, span, depth + 1)
        : []),
    ]
  })
}

/** Every step that has steps beneath it, so Collapse all closes each one. */
function parentIds(spans: readonly TraceSpan[]): string[] {
  return spans.flatMap((span) =>
    span.children?.length ? [span.id, ...parentIds(span.children)] : []
  )
}

function countSpans(spans: readonly TraceSpan[]): number {
  return spans.reduce((total, span) => total + 1 + countSpans(span.children ?? []), 0)
}

/** Where the run's last step ends on its clock, so every bar fits the run. */
function traceEnd(spans: readonly TraceSpan[]): number {
  return spans.reduce(
    (end, span) => Math.max(end, span.startMs + span.durationMs, traceEnd(span.children ?? [])),
    0
  )
}

function findSpan(spans: readonly TraceSpan[], id: string): TraceSpan | undefined {
  for (const span of spans) {
    if (span.id === id) return span
    const nested = span.children && findSpan(span.children, id)
    if (nested) return nested
  }
  return undefined
}

/** The deepest failed step: where the error came from, not a parent it propagated to. */
export function findLeafErrorSpan(spans: readonly TraceSpan[]): TraceSpan | undefined {
  for (const span of spans) {
    const children = span.children ?? []
    if (span.status === 'error') return findLeafErrorSpan(children) ?? span
    const nested = findLeafErrorSpan(children)
    if (nested) return nested
  }
  return undefined
}

/** Steps whose name matches the filter or that hold a match, so a match keeps its ancestors. */
function matchingIds(spans: readonly TraceSpan[], query: string, into = new Set<string>()) {
  for (const span of spans) {
    const before = into.size
    matchingIds(span.children ?? [], query, into)
    if (into.size > before || span.name.toLowerCase().includes(query)) into.add(span.id)
  }
  return into
}

/**
 * A run's trace as one tree on the run's clock: the open rows with their timing, the selected
 * step, and expand and collapse. The deepest failure is selected to begin with, and a selection the
 * refreshed trace no longer holds falls back to it. `query` keeps the steps whose names match it,
 * with their ancestors.
 */
export function useRunTrace(trace: readonly TraceSpan[], query = '') {
  const firstError = findLeafErrorSpan(trace)
  const initialId = firstError?.id ?? trace[0]?.id ?? ''
  const [selectedId, setSelectedId] = useState(initialId)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const totalMs = Math.max(trace[0]?.durationMs ?? 0, traceEnd(trace))
  const filter = query.trim().toLowerCase()
  return {
    rows: traceRows(trace, collapsed, totalMs, filter ? matchingIds(trace, filter) : null),
    selected: findSpan(trace, selectedId) ?? findSpan(trace, initialId),
    select: setSelectedId,
    firstErrorId: firstError?.id,
    spanCount: countSpans(trace),
    totalMs,
    toggle: (id: string, open: boolean) =>
      setCollapsed((current) => {
        const next = new Set(current)
        if (open) next.delete(id)
        else next.add(id)
        return next
      }),
    expandAll: () => setCollapsed(new Set()),
    collapseAll: () => setCollapsed(new Set(parentIds(trace))),
  }
}

/** The selected step in the shared inspector, with when it ran on the viewer's clock and its extra data. */
export function RunStep({ span }: { span: TraceSpan }) {
  const timeZone = useViewerTimeZone()
  const clock = [
    ...(span.startedAt
      ? [{ id: 'started', label: 'Started', value: formatClockTime(span.startedAt, timeZone) }]
      : []),
    ...(span.endedAt
      ? [{ id: 'ended', label: 'Ended', value: formatClockTime(span.endedAt, timeZone) }]
      : []),
  ]
  return (
    <FindableSpanInspector
      span={{ ...span, context: [...span.context, ...clock] }}
      extraPayloads={span.extras}
    />
  )
}

/** The files a run produced, each with its size, type and version, and a download. */
export function RunFiles({ files }: { files: readonly RunFile[] }) {
  return (
    <ul className={styles.files}>
      {files.map((file) => (
        <li key={file.id} className={styles.file}>
          <span className={styles.fileText}>
            <span className={styles.fileName} data-type='T060'>
              <OverflowText text={file.name}>{file.name}</OverflowText>
            </span>
            <span className={styles.fileDetail} data-type='T052'>
              {file.detail}
            </span>
          </span>
          <Button
            variant='quiet'
            size='compact'
            icon='I049'
            aria-label={`Download ${file.name}`}
            render={
              <a href={file.href} target='_blank' rel='noopener noreferrer'>
                Download
              </a>
            }
          >
            Download
          </Button>
        </li>
      ))}
    </ul>
  )
}

/** What a run cost, line by line from its usage ledger, with its total, tokens and the base charge. */
export function RunCostList({ cost }: { cost: RunCost }) {
  return (
    <>
      <PropertyList
        title='Cost'
        titleHidden
        properties={[
          ...cost.items.map((item) => ({
            id: `item-${item.id}`,
            label: item.label,
            kind: 'text' as const,
            value: item.value,
          })),
          { id: 'total', label: 'Total', kind: 'text' as const, value: cost.total },
          ...(cost.tokens
            ? [{ id: 'tokens', label: 'Tokens', kind: 'text' as const, value: cost.tokens }]
            : []),
        ]}
      />
      <p className={styles.note} data-type='T052'>
        {cost.note}
      </p>
    </>
  )
}

interface RunDetailsProps {
  /** How the page's read stands; ready when omitted. */
  read?: WorkspaceRead
  run: RunDetail
  back: { href: string; label: string }
  /** Commands on the run, such as Stop and Retry, at the end of Back's row. */
  actions?: ReactNode
}

/**
 * One run, named by its execution: its facts and trace, with the selected step's data beside them,
 * then the files it produced and what it cost.
 */
export function RunDetails({ run, back, read, actions }: RunDetailsProps) {
  const timeZone = useViewerTimeZone()
  const trace = useRunTrace(run.trace)
  const shortId = run.id.slice(0, 8)
  const usage = formatComputeUnits(run.cu)

  return (
    <DetailSplit
      read={read}
      back={back}
      actions={actions}
      label={`Run ${shortId} trace`}
      railKind='inspector'
      railLabel='Selected step'
      rail={trace.selected && <RunStep key={trace.selected.id} span={trace.selected} />}
    >
      <DirectoryHeading title={`Run ${shortId}`} />
      <MetadataFields
        label='Run facts'
        fields={[
          { id: 'status', label: 'Status', value: RUN_STATUS_LABEL[run.status] },
          { id: 'workflow', label: 'Workflow', value: run.workflow.name },
          { id: 'trigger', label: 'Trigger', value: run.trigger.label },
          { id: 'started', label: 'Started', value: formatTimestamp(run.startedAt, timeZone) },
          { id: 'duration', label: 'Duration', value: formatDuration(run.durationMs) },
          {
            id: 'usage',
            label: 'Usage',
            value: run.cu === null ? 'Unknown' : `${usage} Compute Units`,
          },
          ...(run.version ? [{ id: 'version', label: 'Version', value: run.version }] : []),
          { id: 'execution', label: 'Execution ID', value: run.id, copyable: true },
        ]}
      />
      {run.trace.length > 0 && (
        <DetailSection title='Trace'>
          <TraceToolbar
            copyText={JSON.stringify(run.trace, null, 2)}
            onExpandAll={trace.expandAll}
            onCollapseAll={trace.collapseAll}
          />
          <TraceTree
            label={`Run ${shortId} steps`}
            rows={trace.rows}
            selectedId={trace.selected?.id ?? null}
            onSelect={trace.select}
            onToggle={trace.toggle}
          />
        </DetailSection>
      )}
      {run.files && (
        <DetailSection title={`Files (${run.files.length})`}>
          <RunFiles files={run.files} />
        </DetailSection>
      )}
      {run.cost && (
        <DetailSection title='Cost'>
          <RunCostList cost={run.cost} />
        </DetailSection>
      )}
    </DetailSplit>
  )
}
