'use client'

import { type ReactNode, useState } from 'react'
import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import { Icon } from '@sim/emcn/icon'
import { DirectoryHeading } from '@/platform/app/(shell)/_components/resource-directory/resource-directory'
import {
  DetailSection,
  DetailSplit,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/detail-split/detail-split'
import { MetadataFields } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/metadata-fields/metadata-fields'
import {
  type TracePaint,
  type TraceRow,
  TraceTree,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/trace-tree/trace-tree'
import {
  formatComputeUnits,
  formatDuration,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/format'
import type { WorkspaceRead } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { useViewerTimeZone } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import { RUN_STATUS_LABEL } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/run-status/run-status'
import { SpanInspector } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/span-inspector/span-inspector'
import { formatTimestamp } from '@/platform/shared/time'
import type { RunDetail, TraceSpan } from '@/platform/shared/workspace-records'

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
/** Providers whose own mark the shared icon catalog carries. */
const PROVIDER_MARKS = new Set(['salesforce', 'notion', 'github', 'linear', 'jira', 'hubspot'])

/** A span's timing paint, from its recorded family and provider; failures take precedence. */
function spanPaint(span: TraceSpan): TracePaint {
  if (span.status === 'error') return 'error'
  if (span.status === 'handled') return 'handled'
  if (span.providerId === 'slack') return 'slack'
  if (span.providerId === 'anthropic') return 'anthropic'
  if (span.providerId === 'openai') return 'neutral'
  switch (span.kind) {
    case 'agent':
    case 'loop':
    case 'iteration':
    case 'parallel':
    case 'workflow':
    case 'mcp':
      return span.kind
    default:
      return 'neutral'
  }
}

function spanMark(span: TraceSpan) {
  const providerIcon = span.providerId ? PROVIDER_ICON[span.providerId] : undefined
  if (providerIcon) return <Icon name={providerIcon} />
  if (span.providerId && PROVIDER_MARKS.has(span.providerId))
    return <Icon providerId={span.providerId} />
  return <Icon name={KIND_ICON[span.kind]} />
}

/** The run's open steps in reading order, each placed on the root's one clock. */
function traceRows(
  spans: readonly TraceSpan[],
  collapsed: ReadonlySet<string>,
  totalMs: number,
  depth = 0
): TraceRow[] {
  const clock = Math.max(1, totalMs)
  const share = (ms: number) => Math.max(0, Math.min(100, (100 * ms) / clock))
  return spans.flatMap((span) => {
    const expandable = Boolean(span.children?.length)
    const start = share(span.startMs)
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
      expanded: expandable ? !collapsed.has(span.id) : undefined,
    }
    return [
      row,
      ...(span.children?.length && !collapsed.has(span.id)
        ? traceRows(span.children, collapsed, totalMs, depth + 1)
        : []),
    ]
  })
}

function findSpan(spans: readonly TraceSpan[], id: string): TraceSpan | undefined {
  for (const span of spans) {
    if (span.id === id) return span
    const nested = span.children && findSpan(span.children, id)
    if (nested) return nested
  }
  return undefined
}

interface RunDetailsProps {
  /** How the page's read stands; ready when omitted. */
  read?: WorkspaceRead
  run: RunDetail
  back: { href: string; label: string }
  /** Commands on the run, such as Stop and Retry, at the end of Back's row. */
  actions?: ReactNode
}

/** One run, named by its execution: its facts and trace, with the selected step's data beside them. */
export function RunDetails({ run, back, read, actions }: RunDetailsProps) {
  const timeZone = useViewerTimeZone()
  const root = run.trace[0]
  const [selectedId, setSelectedId] = useState(root?.id ?? '')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const selected = findSpan(run.trace, selectedId) ?? root
  const shortId = run.id.slice(0, 8)
  const usage = formatComputeUnits(run.cu)

  function toggle(id: string, open: boolean) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (open) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <DetailSplit
      read={read}
      back={back}
      actions={actions}
      label={`Run ${shortId} trace`}
      railKind='inspector'
      railLabel='Selected step'
      rail={selected && <SpanInspector key={selected.id} span={selected} />}
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
          { id: 'execution', label: 'Execution ID', value: run.id },
        ]}
      />
      {root && (
        <DetailSection title='Trace'>
          <TraceTree
            label={`Run ${shortId} steps`}
            rows={traceRows(run.trace, collapsed, root.durationMs)}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            onToggle={toggle}
          />
        </DetailSection>
      )}
    </DetailSplit>
  )
}
