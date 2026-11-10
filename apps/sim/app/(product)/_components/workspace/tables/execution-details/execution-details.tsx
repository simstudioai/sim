'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { SearchField } from '@sim/emcn/search-field'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { isRecordLike } from '@sim/utils/object'
import { workspacePath } from '@/lib/navigation/paths'
import {
  findLeafErrorSpan,
  RunCostList,
  RunFiles,
  RunStep,
  useRunTrace,
} from '@/app/(product)/_components/workspace/logs/run-details/run-details'
import { RunStatusText } from '@/app/(product)/_components/workspace/logs/run-status/run-status'
import {
  type MetadataField,
  MetadataFields,
} from '@/app/(product)/_components/workspace/metadata-fields/metadata-fields'
import { Payload } from '@/app/(product)/_components/workspace/span-inspector/span-inspector'
import styles from '@/app/(product)/_components/workspace/tables/execution-details/execution-details.module.css'
import {
  SidePanel,
  SidePanelNote,
  SidePanelSection,
} from '@/app/(product)/_components/workspace/tables/side-panel/side-panel'
import {
  TraceToolbar,
  TraceTree,
} from '@/app/(product)/_components/workspace/trace-tree/trace-tree'
import { formatDuration } from '@/app/(product)/_components/workspace/workspace-session/format'
import { useViewerTimeZone } from '@/app/(product)/_components/workspace/workspace-session/workspace-session'
import { resolveLogWorkflowId, useLiveRun } from '@/platform/lib/data/logs'
import {
  formatCreditCost,
  useTroubleshootRun,
  type WorkflowLogRow,
} from '@/platform/lib/data/tables'
import { formatTimestamp } from '@/platform/shared/time'
import type { RunDetail } from '@/platform/shared/workspace-records'

type LogTab = 'overview' | 'trace'

/** The legacy log's level for each raw status; anything settled without failing reads as Info. */
const LEVEL_LABEL: Record<string, string> = {
  running: 'Running',
  redacting: 'Redacting',
  pending: 'Pending',
  cancelling: 'Cancelling…',
  cancelled: 'Cancelled',
  failed: 'Failed',
}

interface RunTraceProps {
  run: RunDetail
  /** The run's recorded cost in dollars, so the trace and the overview never show different totals. */
  costDollars?: number
}

/**
 * The run's trace in the panel: a summary of status, duration, steps and cost with Jump to error,
 * a filter over step names, the tree on the run's clock, and the selected step beneath it. The first
 * failure is selected to begin with and scrolls into view when selected out of sight.
 */
function RunTrace({ run, costDollars }: RunTraceProps) {
  const [query, setQuery] = useState('')
  const trace = useRunTrace(run.trace, query)
  const treeElement = useRef<HTMLDivElement | null>(null)
  const tree = useScrollEdges<HTMLDivElement>('vertical', { viewport: treeElement })
  const selectedId = trace.selected?.id ?? null
  const firstErrorId = trace.firstErrorId
  const cost = formatCreditCost(costDollars, { emptyForZeroOrLess: true })

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
        <RunStatusText status={run.trace[0]?.status === 'error' ? 'failed' : 'completed'} />
        <span>{formatDuration(trace.totalMs)}</span>
        <span>
          {trace.spanCount} {trace.spanCount === 1 ? 'span' : 'spans'}
        </span>
        {cost && <span>{cost}</span>}
        {firstErrorId && (
          <span className={styles.traceHeaderAction}>
            <Button variant='quiet' size='compact' onClick={() => trace.select(firstErrorId)}>
              Jump to error
            </Button>
          </span>
        )}
      </div>
      <TraceToolbar
        search={
          <SearchField
            label='Filter spans'
            placeholder='Filter spans'
            variant='quiet'
            value={query}
            onValueChange={setQuery}
          />
        }
        copyText={JSON.stringify(run.trace, null, 2)}
        onExpandAll={trace.expandAll}
        onCollapseAll={trace.collapseAll}
      />
      {trace.rows.length === 0 ? (
        <SidePanelNote>No matching spans</SidePanelNote>
      ) : (
        <div ref={tree} className={styles.tree}>
          <TraceTree
            label='Trace spans'
            rows={trace.rows}
            selectedId={selectedId}
            onSelect={trace.select}
            onToggle={trace.toggle}
          />
        </div>
      )}
      {trace.selected ? (
        <RunStep key={trace.selected.id} span={trace.selected} />
      ) : (
        <p className={styles.note} data-type='T060'>
          Select a span to see details.
        </p>
      )}
    </div>
  )
}

interface ExecutionContentProps {
  log: WorkflowLogRow & { executionId: string }
  run: RunDetail
  workspaceId: string
  traceShown: boolean
}

/**
 * The run as the Logs adapter maps it, with what a table cell's run adds to the Logs page: the
 * legacy level, the workflow as a link, the failure with Troubleshoot in Chat, the workflow's input
 * and output on the overview, Open in Logs, and a trace tab with its summary and filter.
 */
function ExecutionContent({ log, run, workspaceId, traceShown }: ExecutionContentProps) {
  const timeZone = useViewerTimeZone()
  const troubleshoot = useTroubleshootRun()
  const [tab, setTab] = useState<LogTab>('overview')

  const executionId = log.executionId
  const isLikelyExecution = log.trigger !== 'mothership'
  const isWorkflowExecutionLog =
    (log.trigger === 'manual' && Boolean(log.duration)) || Boolean(log.executionData?.traceSpans)
  const showTraceTab = traceShown && isLikelyExecution
  const root = run.trace[0]
  const showRunPayloads = isWorkflowExecutionLog && traceShown

  const workflowId = resolveLogWorkflowId(log)
  const failed = log.status === 'failed'
  const finalOutput = log.executionData?.finalOutput
  const outputError =
    traceShown && isRecordLike(finalOutput) && typeof finalOutput.error === 'string'
      ? finalOutput.error
      : null
  const leafError = traceShown ? findLeafErrorSpan(root?.children ?? []) : undefined
  const errorMessage = failed
    ? (outputError ?? leafError?.notice?.message ?? 'This run failed.')
    : null

  const facts: MetadataField[] = [
    { id: 'level', label: 'Level', value: LEVEL_LABEL[log.status ?? ''] ?? 'Info' },
    {
      id: 'workflow',
      label: log.trigger === 'mothership' ? 'Job' : 'Workflow',
      value: run.workflow.name,
      href: workflowId
        ? `${workspacePath(workspaceId, 'workflows')}/${encodeURIComponent(workflowId)}`
        : undefined,
    },
    { id: 'trigger', label: 'Trigger', value: log.trigger ? run.trigger.label : 'None' },
    {
      id: 'timestamp',
      label: 'Timestamp',
      value: Number.isFinite(run.startedAt) ? formatTimestamp(run.startedAt, timeZone) : '—',
    },
    { id: 'duration', label: 'Duration', value: formatDuration(run.durationMs) },
    ...(run.version ? [{ id: 'version', label: 'Version', value: run.version }] : []),
    { id: 'run-id', label: 'Run ID', value: executionId, copyable: true },
  ]

  const overview = (
    <div className={styles.overview}>
      {errorMessage && (
        <InlineNotice
          intent='danger'
          title='Run failed'
          message={errorMessage}
          action={
            failed && isLikelyExecution && troubleshoot.available ? (
              <Button
                variant='quiet'
                size='compact'
                onClick={() =>
                  troubleshoot.troubleshoot({
                    workspaceId,
                    executionId,
                    workflowName: log.workflow?.name?.trim() || null,
                  })
                }
              >
                Troubleshoot in Chat
              </Button>
            ) : undefined
          }
        />
      )}
      <MetadataFields label='Run facts' fields={facts} />
      {showRunPayloads && root?.input && <Payload label='Workflow input' payload={root.input} />}
      {showRunPayloads && root?.output && <Payload label='Workflow output' payload={root.output} />}
      {run.files && (
        <SidePanelSection title={`Files (${run.files.length})`}>
          <RunFiles files={run.files} />
        </SidePanelSection>
      )}
      {run.cost && (
        <SidePanelSection title='Cost'>
          <RunCostList cost={run.cost} />
        </SidePanelSection>
      )}
    </div>
  )

  const trace = root?.children?.length ? (
    <RunTrace run={run} costDollars={log.cost?.total} />
  ) : (
    <SidePanelNote>No trace data available for this run</SidePanelNote>
  )

  return (
    <ContentTabs
      label='Log details'
      current={showTraceTab ? tab : 'overview'}
      onSelect={(id) => setTab(id === 'trace' ? 'trace' : 'overview')}
      actions={
        <IconButton
          label='Open in logs'
          icon='I037'
          tooltip
          onClick={() =>
            window.open(
              `${workspacePath(workspaceId, 'logs')}?executionId=${encodeURIComponent(executionId)}`,
              '_blank',
              'noopener,noreferrer'
            )
          }
        />
      }
      items={[
        { id: 'overview', label: 'Overview', content: overview },
        ...(showTraceTab ? [{ id: 'trace', label: 'Trace', content: trace }] : []),
      ]}
    />
  )
}

interface ExecutionDetailsPanelProps {
  workspaceId: string
  executionId: string
  onClose: () => void
}

/**
 * A workflow cell's run through the Logs page's adapter and run pieces: its facts, failure and
 * Troubleshoot in Chat, input and output, files and cost, and the trace with each step's data. A
 * run still going reads again as it does on Logs. The run's canvas snapshot stays on the Logs
 * page, which Open in Logs reaches. Escape closes it.
 */
export function ExecutionDetailsPanel({
  workspaceId,
  executionId,
  onClose,
}: ExecutionDetailsPanelProps) {
  const live = useLiveRun(workspaceId, executionId)

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <SidePanel title='Log details' onClose={onClose}>
      {live.read.status === 'error' ? (
        <FailureNotice
          message='The run could not be loaded.'
          retrying={live.read.retrying}
          onRetry={live.read.onRetry}
        />
      ) : live.read.status === 'ready' && live.log && live.run ? (
        <ExecutionContent
          key={executionId}
          log={live.log}
          run={live.run}
          workspaceId={workspaceId}
          traceShown={live.traced}
        />
      ) : null}
    </SidePanel>
  )
}
