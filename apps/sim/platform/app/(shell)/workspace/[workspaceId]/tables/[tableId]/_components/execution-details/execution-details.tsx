'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { OverflowText } from '@sim/emcn/overflow-text'
import { PropertyList } from '@sim/emcn/property-list'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { formatDuration } from '@sim/utils/formatting'
import { isRecordLike } from '@sim/utils/object'
import { toast } from '@/lib/toast/sink'
import {
  type MetadataField,
  MetadataFields,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/metadata-fields/metadata-fields'
import { useViewerTimeZone } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/execution-details/execution-details.module.css'
import { Payload } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/execution-details/payload'
import { findLeafErrorSpan } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/execution-details/trace'
import { TraceView } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/execution-details/trace-view'
import {
  SidePanel,
  SidePanelNote,
  SidePanelSection,
} from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/side-panel/side-panel'
import { platformUrl } from '@/platform/lib/data/base-path'
import { useOrganization } from '@/platform/lib/data/organization'
import { legacyRoutes } from '@/platform/lib/data/organization-model'
import {
  apportionCredits,
  BASE_EXECUTION_CHARGE,
  dollarsToCredits,
  filterHiddenOutputKeys,
  formatCreditCost,
  type TraceSpan,
  useLogByExecutionId,
  useTraceVisibility,
  useTroubleshootRun,
  type WorkflowLogRow,
} from '@/platform/lib/data/tables'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { formatTimestamp } from '@/platform/shared/time'

type LogTab = 'overview' | 'trace'
type LogFile = NonNullable<WorkflowLogRow['files']>[number]

/** The legacy log's level for each raw status; anything settled without failing reads as Info. */
const LEVEL_LABEL: Record<string, string> = {
  running: 'Running',
  redacting: 'Redacting',
  pending: 'Pending',
  cancelling: 'Cancelling...',
  cancelled: 'Cancelled',
  failed: 'Error',
}

/** The core triggers' labels, as the logs filter names them; an integration reads as its provider. */
const TRIGGER_LABEL: Record<string, string> = {
  manual: 'Manual',
  api: 'API',
  schedule: 'Schedule',
  chat: 'Chat',
  webhook: 'Webhook',
  mcp: 'MCP',
  copilot: 'Sim agent',
  mothership: 'Sim agent',
  workflow: 'Workflow',
  custom_block: 'Custom block',
  test: 'Test',
}

const DELETED_WORKFLOW_LABEL = 'Deleted Workflow'

function triggerLabel(trigger: string): string {
  return (
    TRIGGER_LABEL[trigger] ??
    trigger
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  )
}

/** The workflow a log can open: none for a Sim agent job or an archived workflow. */
function openableWorkflowId(log: WorkflowLogRow): string | null {
  if (log.trigger === 'mothership' || log.workflow?.archivedAt) return null
  return log.workflow?.id || log.workflowId || null
}

function workflowLabel(log: WorkflowLogRow): string {
  if (log.trigger === 'mothership') return log.jobTitle || 'Untitled Job'
  return log.workflow?.id || log.workflowId
    ? log.workflow?.name || 'Unknown'
    : DELETED_WORKFLOW_LABEL
}

/** A trace as the log carries it, checked as far as the trace view reads it. */
function isTraceSpanList(value: unknown): value is TraceSpan[] {
  return (
    Array.isArray(value) &&
    value.every(
      (span) => isRecordLike(span) && typeof span.name === 'string' && typeof span.type === 'string'
    )
  )
}

/**
 * An apportioned credit figure; `dollars` tells a real zero ("0 credits") from a charge that rounds
 * below one credit ("<1 credit").
 */
function creditLabel(credits: number, dollars: number): string {
  if (credits <= 0) return dollars > 0 ? '<1 credit' : '0 credits'
  return `${credits.toLocaleString('en-US')} ${credits === 1 ? 'credit' : 'credits'}`
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const sizes = ['B', 'KB', 'MB', 'GB']
  const index = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${Number.parseFloat((bytes / 1024 ** index).toFixed(1))} ${sizes[index]}`
}

/** An execution file through the app's file route, or a link-only file at its own URL. */
function openFile(file: LogFile) {
  if (file.key.startsWith('url/')) {
    if (file.url) window.open(file.url, '_blank')
    else toast.error(`${file.name} has no download link`)
    return
  }
  window.open(`/api/files/serve/${encodeURIComponent(file.key)}?context=execution`, '_blank')
}

interface CostBreakdown {
  rows: Array<{ key: string; label: string; credits: number; dollars: number }>
  totalCredits: number
  totalDollars: number
  tokens: { input: number; output: number }
}

/**
 * The run's cost from its usage ledger: line items apportioned once at the total so they always add
 * up. A run from before the ledger shows its total alone.
 */
function costBreakdown(log: WorkflowLogRow): CostBreakdown | null {
  const ledger = log.costLedger
  if (ledger && ledger.items.length > 0) {
    const credits = apportionCredits(
      ledger.items.map((item, index) => ({ key: String(index), dollars: item.cost }))
    )
    return {
      rows: ledger.items.map((item, index) => ({
        key: String(index),
        label:
          item.category === 'fixed' && item.description === 'execution_fee'
            ? 'Base Run'
            : item.description,
        credits: credits[String(index)] ?? 0,
        dollars: item.cost,
      })),
      totalCredits: dollarsToCredits(ledger.total),
      totalDollars: ledger.total,
      tokens: {
        input: ledger.items.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0),
        output: ledger.items.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0),
      },
    }
  }
  const total = log.cost?.total
  if (total == null) return null
  return {
    rows: [],
    totalCredits: dollarsToCredits(total),
    totalDollars: total,
    tokens: { input: 0, output: 0 },
  }
}

interface ExecutionContentProps {
  log: WorkflowLogRow
  workspaceId: string
  traceShown: boolean
}

function ExecutionContent({ log, workspaceId, traceShown }: ExecutionContentProps) {
  const timeZone = useViewerTimeZone()
  const organization = useOrganization()
  const troubleshoot = useTroubleshootRun()
  const [tab, setTab] = useState<LogTab>('overview')

  const executionId = log.executionId
  const isLikelyExecution = Boolean(executionId) && log.trigger !== 'mothership'
  const loggedSpans: unknown = log.executionData?.traceSpans
  const traceSpans = isTraceSpanList(loggedSpans) ? loggedSpans : undefined
  const isWorkflowExecutionLog =
    (log.trigger === 'manual' && Boolean(log.duration)) || Boolean(log.executionData?.traceSpans)
  const showTraceTab = traceShown && isLikelyExecution

  const workflowOutput = useMemo(() => {
    const finalOutput = log.executionData?.finalOutput
    if (!finalOutput) return null
    return filterHiddenOutputKeys(finalOutput) ?? null
  }, [log.executionData])
  const workflowInput = useMemo(() => {
    const raw = log.executionData?.workflowInput
    if (raw === undefined || raw === null) return null
    return isRecordLike(raw) ? raw : { input: raw }
  }, [log.executionData])
  const cost = useMemo(() => costBreakdown(log), [log])

  const workflowId = openableWorkflowId(log)
  const startedAt = Date.parse(log.createdAt)
  const failed = log.status === 'failed'
  const outputError =
    traceShown && isRecordLike(workflowOutput) && typeof workflowOutput.error === 'string'
      ? workflowOutput.error
      : null
  const leafError = traceShown && traceSpans ? findLeafErrorSpan(traceSpans) : null
  const errorMessage = failed
    ? (outputError ?? leafError?.errorMessage ?? 'This run failed.')
    : null

  const facts: MetadataField[] = [
    { id: 'level', label: 'Level', value: LEVEL_LABEL[log.status ?? ''] ?? 'Info' },
    {
      id: 'workflow',
      label: log.trigger === 'mothership' ? 'Job' : 'Workflow',
      value: workflowLabel(log),
      href: workflowId
        ? platformUrl(
            `${workspacePath(workspaceId, 'workflows')}/${encodeURIComponent(workflowId)}`
          )
        : undefined,
    },
    { id: 'trigger', label: 'Trigger', value: log.trigger ? triggerLabel(log.trigger) : 'None' },
    {
      id: 'timestamp',
      label: 'Timestamp',
      value: Number.isFinite(startedAt) ? formatTimestamp(startedAt, timeZone) : '—',
    },
    {
      id: 'duration',
      label: 'Duration',
      value: formatDuration(log.duration, { precision: 2 }) || '—',
    },
    ...(log.deploymentVersion
      ? [
          {
            id: 'version',
            label: 'Version',
            value: log.deploymentVersionName || `v${log.deploymentVersion}`,
          },
        ]
      : []),
    ...(executionId ? [{ id: 'run-id', label: 'Run ID', value: executionId, copyable: true }] : []),
  ]

  const overview = (
    <div className={styles.overview}>
      {errorMessage && (
        <InlineNotice
          intent='danger'
          title='Run failed'
          message={errorMessage}
          action={
            failed && isLikelyExecution && troubleshoot.available && executionId ? (
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
      {isWorkflowExecutionLog && workflowInput && traceShown && (
        <Payload label='Workflow input' data={workflowInput} />
      )}
      {isWorkflowExecutionLog && workflowOutput != null && traceShown && (
        <Payload label='Workflow output' data={workflowOutput} />
      )}
      {log.files && log.files.length > 0 && (
        <SidePanelSection title={`Files (${log.files.length})`}>
          <ul className={styles.files}>
            {log.files.map((file, index) => (
              <li key={file.id || `file-${index}`} className={styles.file}>
                <span className={styles.fileText}>
                  <span className={styles.fileName} data-type='T060'>
                    <OverflowText text={file.name}>{file.name}</OverflowText>
                  </span>
                  <span className={styles.fileDetail} data-type='T052'>
                    {formatFileSize(file.size)} · {file.type}
                    {file.version === undefined ? '' : ` · v${file.version}`}
                  </span>
                </span>
                <Button
                  variant='quiet'
                  size='compact'
                  icon='I049'
                  aria-label={`Download ${file.name}`}
                  onClick={() => openFile(file)}
                >
                  Download
                </Button>
              </li>
            ))}
          </ul>
        </SidePanelSection>
      )}
      {isWorkflowExecutionLog && log.cost && cost && (
        <SidePanelSection title='Cost'>
          <PropertyList
            title='Cost'
            titleHidden
            properties={[
              ...cost.rows.map((row) => ({
                id: `item-${row.key}`,
                label: row.label,
                kind: 'text' as const,
                value: creditLabel(row.credits, row.dollars),
              })),
              {
                id: 'total',
                label: 'Total',
                kind: 'text',
                value: creditLabel(cost.totalCredits, cost.totalDollars),
              },
              ...(cost.tokens.input > 0 || cost.tokens.output > 0
                ? [
                    {
                      id: 'tokens',
                      label: 'Tokens',
                      kind: 'text' as const,
                      value: `${cost.tokens.input} in · ${cost.tokens.output} out`,
                    },
                  ]
                : []),
            ]}
          />
          <p className={styles.note} data-type='T052'>
            Total includes a {formatCreditCost(BASE_EXECUTION_CHARGE) ?? '—'} base charge plus model
            and tool usage.
          </p>
        </SidePanelSection>
      )}
    </div>
  )

  const trace = traceSpans?.length ? (
    <TraceView traceSpans={traceSpans} runCostDollars={log.cost?.total} />
  ) : log.executionData ? (
    <SidePanelNote>No trace data available for this run</SidePanelNote>
  ) : null

  return (
    <ContentTabs
      label='Log details'
      current={showTraceTab ? tab : 'overview'}
      onSelect={(id) => setTab(id === 'trace' ? 'trace' : 'overview')}
      actions={
        executionId ? (
          <IconButton
            label='Open in Logs'
            icon='I037'
            tooltip
            onClick={() =>
              window.open(
                `${legacyRoutes(organization).workspace(workspaceId)}/logs?executionId=${encodeURIComponent(executionId)}`,
                '_blank',
                'noopener,noreferrer'
              )
            }
          />
        ) : undefined
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
 * A workflow cell's run, as the legacy log details show it: its facts, failure and Troubleshoot in
 * Chat, input and output, files and cost, and the trace with each step's data. The run's canvas
 * snapshot stays on the Logs page, which Open in Logs reaches. Escape closes it.
 */
export function ExecutionDetailsPanel({
  workspaceId,
  executionId,
  onClose,
}: ExecutionDetailsPanelProps) {
  const log = useLogByExecutionId(workspaceId, executionId)
  const traceVisibility = useTraceVisibility(workspaceId)

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <SidePanel title='Log details' onClose={onClose}>
      {log.isError ? (
        <FailureNotice
          message='The run could not be loaded.'
          retrying={log.isFetching}
          onRetry={() => void log.refetch()}
        />
      ) : log.data && traceVisibility !== 'pending' ? (
        <ExecutionContent
          key={executionId}
          log={log.data}
          workspaceId={workspaceId}
          traceShown={traceVisibility === 'shown'}
        />
      ) : null}
    </SidePanel>
  )
}
