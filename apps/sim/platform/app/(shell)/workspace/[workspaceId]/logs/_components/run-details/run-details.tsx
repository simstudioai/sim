'use client'

import { useState } from 'react'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { PropertyList } from '@sim/emcn/property-list'
import { ControlBar } from '@/platform/app/(shell)/_components/control-bar/control-bar'
import {
  DetailHeading,
  DetailSection,
  DetailSplit,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/detail-split/detail-split'
import {
  formatComputeUnits,
  formatDuration,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/format'
import type {
  RunDetail,
  TraceSpan,
  WorkspaceRead,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { useViewerTimeZone } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/run-details/run-details.module.css'
import { RUN_STATUS_LABEL } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/run-status/run-status'
import { SpanInspector } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/span-inspector/span-inspector'
import { TraceTree } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/trace-tree/trace-tree'
import { formatTimestamp } from '@/platform/shared/time'

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
}

/** One run, named by its execution: its facts beside the trace and the selected step. */
export function RunDetails({ run, back, read }: RunDetailsProps) {
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
      label={`Run ${shortId} trace`}
      controls={
        <ControlBar
          leading={
            <span className={styles.identifier} data-type='T060'>
              {run.id}
            </span>
          }
        >
          <CopyButton label='Copy execution ID' text={run.id} />
        </ControlBar>
      }
      facts={
        <PropertyList
          title='Facts'
          titleHidden
          properties={[
            { id: 'workflow', label: 'Workflow', kind: 'text', value: run.workflow.name },
            { id: 'trigger', label: 'Trigger', kind: 'text', value: run.trigger.label },
            { id: 'version', label: 'Version', kind: 'text', value: run.version },
            {
              id: 'started',
              label: 'Started',
              kind: 'text',
              value: formatTimestamp(run.startedAt, timeZone),
            },
            {
              id: 'duration',
              label: 'Duration',
              kind: 'text',
              value: formatDuration(run.durationMs),
            },
            {
              id: 'usage',
              label: 'Usage',
              kind: 'text',
              value: run.cu === null ? 'Unknown' : `${usage} CU (Compute Units)`,
            },
            { id: 'status', label: 'Status', kind: 'text', value: RUN_STATUS_LABEL[run.status] },
          ]}
        />
      }
    >
      <DetailHeading title={`Run ${shortId}`} />
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
      {selected && <SpanInspector key={selected.id} span={selected} />}
    </DetailSplit>
  )
}
