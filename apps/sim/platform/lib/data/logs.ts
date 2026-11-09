'use client'

import { useEffect } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useQuery } from '@tanstack/react-query'
import type { inferParserType } from 'nuqs'
import { isApiClientError } from '@/lib/api/client/errors'
import type { LogTraceSpan, WorkflowLogDetail, WorkflowLogSummary } from '@/lib/api/contracts/logs'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  type LogFilters,
  useCancelExecution,
  useLogByExecutionId,
  useLogSnapshotUpdates,
  useLogsSnapshot,
  useNewLogCount,
  useRetryExecution,
} from '@/hooks/queries/logs'
import { getWorkflowListQueryOptions } from '@/hooks/queries/utils/workflow-list-query'
import { useWorkspaceUserPermissions } from '@/platform/lib/data/tables/permissions'
import type { runListParams } from '@/platform/lib/workspace-views'
import {
  queryRead,
  type RunDetail,
  type RunStatus,
  type RunSummary,
  type RunTrigger,
  type TracePayload,
  type TraceSpan,
} from '@/platform/shared/workspace-records'
import { CORE_TRIGGER_TYPES, type TimeRange } from '@/stores/logs/filters/types'

type RunListView = inferParserType<typeof runListParams>

const PAGE_SIZE = 50
/** How often an open run that is still going is read again, as legacy's details do. */
const ACTIVE_RUN_REFRESH_MS = 3_000

const TIME_RANGE: Record<RunListView['period'], TimeRange> = {
  all: 'All time',
  '1h': 'Past hour',
  '24h': 'Past 24 hours',
  '7d': 'Past 7 days',
  '30d': 'Past 30 days',
}

/** The logs API's `level` for each run status the list filters by. */
const LEVEL: Record<RunListView['status'], string> = {
  all: 'all',
  completed: 'info',
  failed: 'error',
  waiting: 'pending',
  running: 'running',
  cancelled: 'cancelled',
}

const SORT: Record<RunListView['sort'], Pick<LogFilters, 'sortBy' | 'sortOrder'>> = {
  newest: { sortBy: 'date', sortOrder: 'desc' },
  oldest: { sortBy: 'date', sortOrder: 'asc' },
  duration: { sortBy: 'duration', sortOrder: 'desc' },
  cu: { sortBy: 'cost', sortOrder: 'desc' },
}

const TRIGGER_LABEL: Record<(typeof CORE_TRIGGER_TYPES)[number], string> = {
  manual: 'Manual',
  api: 'API',
  schedule: 'Schedule',
  chat: 'Chat',
  webhook: 'Webhook',
  mcp: 'MCP',
  copilot: 'Copilot',
  mothership: 'Sim',
  workflow: 'Workflow',
  custom_block: 'Custom block',
  test: 'Test',
}

/** The Trigger filter's choices: the core trigger types the logs API filters by. */
export const RUN_TRIGGER_OPTIONS = CORE_TRIGGER_TYPES.map((type) => ({
  value: type,
  label: TRIGGER_LABEL[type],
}))

function runTrigger(trigger: string | null): RunTrigger {
  if (!trigger) return { label: 'Unknown' }
  const core = CORE_TRIGGER_TYPES.find((type) => type === trigger)
  if (core) return { label: TRIGGER_LABEL[core] }
  const words = trigger.replaceAll('_', ' ')
  return { label: words.charAt(0).toUpperCase() + words.slice(1), providerId: trigger }
}

/** A run's status in the list's terms; a paused run waits, a stop in progress still runs. */
function runStatus(status: string | null): RunStatus {
  switch (status) {
    case 'running':
    case 'redacting':
    case 'cancelling':
      return 'running'
    case 'pending':
      return 'waiting'
    case 'cancelled':
      return 'cancelled'
    case 'failed':
      return 'failed'
    default:
      return 'completed'
  }
}

/** The name a run is listed under, as legacy names it: a Sim job by its title, a deleted workflow as such. */
function workflowName(log: WorkflowLogSummary) {
  if (log.trigger === 'mothership') return log.jobTitle || 'Untitled Job'
  return log.workflow?.id || log.workflowId ? log.workflow?.name || 'Unknown' : 'Deleted Workflow'
}

function durationMs(duration: string | null) {
  if (duration === null) return null
  const value = Number.parseInt(duration.replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(value) ? value : null
}

function toRunSummary(log: WorkflowLogSummary & { executionId: string }): RunSummary {
  return {
    id: log.executionId,
    workflow: { id: log.workflowId ?? '', name: workflowName(log) },
    status: runStatus(log.status),
    trigger: runTrigger(log.trigger),
    startedAt: Date.parse(log.createdAt),
    durationMs: durationMs(log.duration),
    cu: log.cost ? dollarsToCredits(log.cost.total) : null,
  }
}

const WITHHELD: TracePayload = {
  format: 'withheld',
  reason: 'This content could not be shown safely, so the log does not include it.',
}

function payload(value: unknown, withheld: boolean): TracePayload | undefined {
  if (value === undefined) return withheld ? WITHHELD : undefined
  return typeof value === 'string'
    ? { format: 'text', content: value }
    : { format: 'json', content: JSON.stringify(value, null, 2) }
}

function spanKind(type: string): TraceSpan['kind'] {
  switch (type) {
    case 'agent':
    case 'model':
    case 'tool':
    case 'mcp':
    case 'loop':
    case 'parallel':
    case 'workflow':
      return type
    case 'loop-iteration':
      return 'iteration'
    case 'parallel-iteration':
      return 'branch'
    default:
      return 'block'
  }
}

function spanStatus(span: LogTraceSpan): TraceSpan['status'] {
  if (span.status === 'running' || span.status === 'pending') return 'running'
  if (span.status === 'error') return span.errorHandled ? 'handled' : 'error'
  return 'success'
}

function spanContext(span: LogTraceSpan): TraceSpan['context'] {
  const tokens = typeof span.tokens === 'number' ? { total: span.tokens } : span.tokens
  return [
    ...(span.type !== spanKind(span.type) ? [{ id: 'type', label: 'Type', value: span.type }] : []),
    ...(tokens?.input !== undefined
      ? [{ id: 'input-tokens', label: 'Input tokens', value: tokens.input.toLocaleString() }]
      : []),
    ...(tokens?.output !== undefined
      ? [{ id: 'output-tokens', label: 'Output tokens', value: tokens.output.toLocaleString() }]
      : []),
    ...(tokens?.total !== undefined
      ? [{ id: 'tokens', label: 'Total tokens', value: tokens.total.toLocaleString() }]
      : []),
    ...(span.cost?.total !== undefined
      ? [
          {
            id: 'usage',
            label: 'Compute Units',
            value: dollarsToCredits(span.cost.total).toLocaleString(),
          },
        ]
      : []),
  ]
}

function toTraceSpan(span: LogTraceSpan, origin: number): TraceSpan {
  const withheld = span.contentWithheld === true
  const start = span.startTime ? Date.parse(span.startTime) - origin : 0
  return {
    id: span.id,
    name: span.name,
    kind: spanKind(span.type),
    status: spanStatus(span),
    startMs: Math.max(0, span.relativeStartMs ?? start),
    durationMs: span.duration ?? span.durationMs ?? 0,
    context: spanContext(span),
    input: payload(span.input, withheld),
    output: payload(span.output, withheld),
    notice: span.errorMessage
      ? {
          tone: span.errorHandled ? 'warning' : 'danger',
          title: span.errorType ?? (span.errorHandled ? 'Handled error' : 'Error'),
          message: span.errorMessage,
        }
      : undefined,
    children: span.children?.map((child) => toTraceSpan(child, origin)),
  }
}

/**
 * A run's details: its facts and one trace rooted at the run itself, whose input and output are the
 * workflow's, with the recorded spans beneath it on the run's clock.
 */
function toRunDetail(log: WorkflowLogDetail & { executionId: string }): RunDetail {
  const summary = toRunSummary(log)
  const execution = log.executionData
  const spans = execution.traceSpans ?? []
  const total = execution.totalDuration ?? summary.durationMs ?? 0
  return {
    ...summary,
    version:
      log.deploymentVersionName ??
      (log.deploymentVersion === null ? undefined : `v${log.deploymentVersion}`),
    trace: [
      {
        id: `run:${log.executionId}`,
        name: summary.workflow.name,
        kind: 'workflow',
        status:
          summary.status === 'failed'
            ? 'error'
            : summary.status === 'running' || summary.status === 'waiting'
              ? 'running'
              : 'success',
        startMs: 0,
        durationMs: total,
        context: [],
        input: payload(execution.workflowInput, false),
        output: payload(execution.finalOutput, false),
        children: spans.map((span) => toTraceSpan(span, summary.startedAt)),
      },
    ],
  }
}

function listFilters(view: RunListView): LogFilters {
  return {
    timeRange: TIME_RANGE[view.period],
    level: LEVEL[view.status],
    workflowIds: view.workflow === 'all' ? [] : [view.workflow],
    folderIds: [],
    triggers: view.trigger === 'all' ? [] : [view.trigger],
    searchQuery: '',
    limit: PAGE_SIZE,
    ...SORT[view.sort],
  }
}

/**
 * The workspace's runs for a list view, paged by the server in the view's order. The list holds a
 * snapshot, as legacy's does, and reads it again on its own once new or changed runs match it, so
 * new runs join without a refresh control.
 */
export function useLiveRuns(workspaceId: string, view: RunListView) {
  const filters = listFilters(view)
  const snapshot = useLogsSnapshot(workspaceId, filters)
  const first = snapshot.isPlaceholderData ? undefined : snapshot.data?.pages[0]
  const newRuns = useNewLogCount(workspaceId, filters, first?.snapshotAt).data ?? 0
  const changedPage = snapshot.data?.pages.some((page) => page.snapshotChanged) === true
  const updated = useLogSnapshotUpdates(workspaceId, first, {
    enabled: newRuns === 0 && !changedPage,
  }).data
  const stale = newRuns > 0 || updated === true || changedPage
  const { refetch, isFetching } = snapshot
  useEffect(() => {
    if (stale && !isFetching) void refetch()
  }, [stale, isFetching, refetch])
  const workflows = useQuery(getWorkflowListQueryOptions(workspaceId)).data ?? []
  const read = queryRead(snapshot, 'Runs could not be loaded.')
  return {
    read,
    runs:
      snapshot.data?.pages.flatMap((page) =>
        page.logs.flatMap((log) =>
          log.executionId ? [toRunSummary({ ...log, executionId: log.executionId })] : []
        )
      ) ?? [],
    workflows: workflows
      .map((workflow) => ({ value: workflow.id, label: workflow.name }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    more: {
      hasMore: snapshot.hasNextPage,
      loading: snapshot.isFetchingNextPage,
      error: snapshot.isFetchNextPageError
        ? getErrorMessage(snapshot.error, 'More runs could not be loaded.')
        : undefined,
      onLoadMore: () => void snapshot.fetchNextPage(),
    },
  }
}

/** One run by its execution, read again every few seconds while it is still going. */
export function useLiveRun(workspaceId: string, executionId: string) {
  const query = useLogByExecutionId(workspaceId, executionId, {
    refetchInterval: (current) => {
      const status = current.state.data?.status
      return status === 'running' || status === 'pending' || status === 'redacting'
        ? ACTIVE_RUN_REFRESH_MS
        : false
    },
  })
  const log = query.data
  const read = queryRead(query, 'This run could not be loaded.')
  return {
    read,
    missing: isApiClientError(query.error) && query.error.status === 404,
    run: log && toRunDetail({ ...log, executionId }),
    /** The workflow the run belongs to, while it can still be opened and run again. */
    workflowId:
      log && log.trigger !== 'mothership' && !log.workflow?.archivedAt
        ? (log.workflow?.id ?? log.workflowId)
        : null,
  }
}

/**
 * Stop and Retry on a run, as legacy offers them: stopping waits until the run is confirmed
 * cancelled and needs edit access; retrying starts a new run from the same input.
 */
export function useRunCommands(workspaceId: string) {
  const { canEdit } = useWorkspaceUserPermissions(workspaceId)
  const cancel = useCancelExecution(workspaceId)
  const retry = useRetryExecution()
  return {
    canStop: canEdit,
    stopping: cancel.isPending,
    retrying: retry.isPending,
    stop: (workflowId: string, executionId: string) =>
      cancel.mutateAsync({ workflowId, executionId }),
    retry: (workflowId: string, executionId: string) =>
      retry.mutateAsync({ workflowId, executionId }),
  }
}
