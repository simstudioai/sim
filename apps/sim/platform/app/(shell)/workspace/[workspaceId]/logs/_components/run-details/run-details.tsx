'use client'

import { type ReactNode, useState } from 'react'
import { DirectoryHeading } from '@/platform/app/(shell)/_components/resource-directory/resource-directory'
import {
  DetailSection,
  DetailSplit,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/detail-split/detail-split'
import {
  formatComputeUnits,
  formatDuration,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/format'
import type { WorkspaceRead } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { useViewerTimeZone } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import { MetadataFields } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/metadata-fields/metadata-fields'
import { RUN_STATUS_LABEL } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/run-status/run-status'
import { SpanInspector } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/span-inspector/span-inspector'
import { TraceTree } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/trace-tree/trace-tree'
import { formatTimestamp } from '@/platform/shared/time'
import type { RunDetail, TraceSpan } from '@/platform/shared/workspace-records'

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
  const selected = findSpan(run.trace, selectedId) ?? root
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
            trace={run.trace}
            totalMs={root.durationMs}
            selectedId={selected?.id ?? ''}
            onSelect={setSelectedId}
          />
        </DetailSection>
      )}
    </DetailSplit>
  )
}
