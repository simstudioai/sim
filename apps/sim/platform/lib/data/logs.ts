'use client'

import { useEffect, useMemo, useRef } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { inferParserType } from 'nuqs'
import { isApiClientError } from '@/lib/api/client/errors'
import {
  type DashboardStatsResponse,
  type LogTraceSpan,
  traceSpansSchema,
  type WorkflowLogDetail,
  type WorkflowLogSummary,
} from '@/lib/api/contracts/logs'
import { BASE_EXECUTION_CHARGE } from '@/lib/billing/constants'
import {
  apportionCredits,
  dollarsToCredits,
  formatCreditCost,
} from '@/lib/billing/credits/conversion'
import { filterHiddenOutputKeys } from '@/lib/logs/execution/trace-spans/trace-spans'
import { getEndDateFromTimeRange, getStartDateFromTimeRange } from '@/lib/logs/time-range'
import { isCustomBlockType } from '@/blocks/custom/build-config'
import { useFolderMap } from '@/hooks/queries/folders'
import {
  type LogFilters,
  mergeNewLogsIntoSnapshot,
  trimLogsSnapshotToFirstPage,
  useCancelExecution,
  useDashboardStats,
  useExecutionSnapshot,
  useLogByExecutionId,
  useLogDetail,
  useLogSnapshotUpdates,
  useLogsSnapshot,
  useNewLogCount,
  useRetryExecution,
} from '@/hooks/queries/logs'
import { getWorkflowListQueryOptions } from '@/hooks/queries/utils/workflow-list-query'
import { useTraceVisibility, useTroubleshootRun } from '@/platform/lib/data/tables/execution'
import { useWorkspaceUserPermissions } from '@/platform/lib/data/tables/permissions'
import type { runListParams } from '@/platform/lib/workspace-views'
import { LOCALE } from '@/platform/shared/time'
import { CORE_TRIGGER_LABELS, triggerLabel } from '@/platform/shared/trigger-labels'
import {
  queryRead,
  type RunCost,
  type RunDetail,
  type RunFile,
  type RunStatus,
  type RunSummary,
  type RunTrigger,
  type TracePayload,
  type TraceSpan,
} from '@/platform/shared/workspace-records'
import { CORE_TRIGGER_TYPES, type TimeRange } from '@/stores/logs/filters/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { normalizeToolId } from '@/tools/normalize'

type RunListView = inferParserType<typeof runListParams>

const PAGE_SIZE = 50
/** How often an open run that is still going is read again, as legacy's details do. */
const ACTIVE_RUN_REFRESH_MS = 3_000
/** How often the runs dashboard reads its counts again, as legacy's does. */
const DASHBOARD_REFRESH_MS = 10_000

const TIME_RANGE: Record<RunListView['period'], TimeRange> = {
  all: 'All time',
  '30m': 'Past 30 minutes',
  '1h': 'Past hour',
  '6h': 'Past 6 hours',
  '12h': 'Past 12 hours',
  '24h': 'Past 24 hours',
  '3d': 'Past 3 days',
  '7d': 'Past 7 days',
  '14d': 'Past 14 days',
  '30d': 'Past 30 days',
  custom: 'Custom range',
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

const TRIGGER_LABEL: Record<(typeof CORE_TRIGGER_TYPES)[number], string> = CORE_TRIGGER_LABELS

/** The Trigger filter's core choices; the server adds the integrations the workflow registry knows. */
export const RUN_TRIGGER_OPTIONS = CORE_TRIGGER_TYPES.map((type) => ({
  value: type,
  label: TRIGGER_LABEL[type],
}))

function runTrigger(trigger: string | null): RunTrigger {
  if (!trigger) return { label: 'Unknown' }
  const core = CORE_TRIGGER_TYPES.find((type) => type === trigger)
  if (core) return { label: TRIGGER_LABEL[core] }
  return { label: triggerLabel(trigger), providerId: trigger }
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

/**
 * The workflow a log can open and run again, or null when there is nowhere to go: a Sim agent job
 * has no workflow of its own, a deleted workflow leaves both id fields empty, and an archived one
 * keeps its id but can no longer be opened. The run list and the execution details panel both read
 * it, so a row never says "Deleted Workflow" while still linking somewhere.
 */
export function resolveLogWorkflowId(log: {
  trigger?: string | null
  workflowId?: string | null
  workflow?: { id?: string; archivedAt?: string | null } | null
}): string | null {
  if (log.trigger === 'mothership' || log.workflow?.archivedAt) return null
  return log.workflow?.id || log.workflowId || null
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

/**
 * What a run's commands may do, as legacy's row menu decides: retry a failed run of a workflow,
 * stop one still going, and open the workflow while it exists.
 */
export interface RunCommandsTarget {
  executionId: string
  /** The workflow the run belongs to, for Stop and Retry; absent for a Sim job or a deleted workflow. */
  workflowId: string | null
  /** The workflow the run can open, which an archived workflow cannot. */
  openWorkflowId: string | null
  retryable: boolean
  stoppable: boolean
  stopping: boolean
  /** A workflow run has a frozen snapshot; a Sim job does not. */
  snapshot: boolean
}

function commandsTarget(log: WorkflowLogSummary & { executionId: string }): RunCommandsTarget {
  const workflowId = log.workflow?.id || log.workflowId || null
  return {
    executionId: log.executionId,
    workflowId,
    openWorkflowId: resolveLogWorkflowId(log),
    retryable: log.status === 'failed' && workflowId !== null && log.trigger !== 'mothership',
    stoppable:
      (log.status === 'running' || log.status === 'pending' || log.status === 'cancelling') &&
      workflowId !== null,
    stopping: log.status === 'cancelling',
    snapshot: log.trigger !== 'mothership',
  }
}

const WITHHELD: TracePayload = {
  format: 'withheld',
  reason: 'This content could not be shown safely, so the log does not include it.',
}

/** A step's or run's data as the inspector shows it; withheld when projection omitted it. */
function tracePayload(value: unknown, withheld = false): TracePayload | undefined {
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

/** Why a custom block's steps are absent; a joined child run is its own evidence. */
const CHILD_TRACE_ACCESS_LABEL: Record<string, string> = {
  missing: 'Not available',
  truncated: 'Not expanded (nesting limit)',
  disabled: 'Not traced',
}

/**
 * What a recorded span carries beyond the logs contract's typed fields: a model turn's provider,
 * timing, thinking and requested tool calls, a block's retries and fallbacks, and a custom block's
 * child-run state. Each is read only when it has the recorded shape.
 */
function recordedDetail(span: LogTraceSpan) {
  const fields: Record<string, unknown> = { ...span }
  const text = (key: string) => (typeof fields[key] === 'string' ? fields[key] : undefined)
  const count = (key: string, from: Record<string, unknown> = fields) => {
    const value = from[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }
  const tokens: Record<string, unknown> =
    typeof span.tokens === 'object' && span.tokens !== null ? { ...span.tokens } : {}
  const fallbacks = fields.modelFallbacks
  return {
    provider: text('provider'),
    model: text('model'),
    finishReason: text('finishReason'),
    thinking: text('thinking'),
    childTraceAccess: text('childTraceAccess'),
    childTraceDisabled: fields.childTraceDisabled === true,
    ttft: count('ttft'),
    tries: count('tries'),
    iterationIndex: count('iterationIndex'),
    modelFallbacks: Array.isArray(fallbacks)
      ? fallbacks.filter((model): model is string => typeof model === 'string')
      : [],
    modelToolCalls: Array.isArray(fields.modelToolCalls) ? fields.modelToolCalls : [],
    tokens: {
      input: typeof span.tokens === 'number' ? undefined : count('input', tokens),
      output: count('output', tokens),
      total: typeof span.tokens === 'number' ? span.tokens : count('total', tokens),
      cacheRead: count('cacheRead', tokens),
      cacheWrite: count('cacheWrite', tokens),
      reasoning: count('reasoning', tokens),
    },
  }
}

/**
 * The bare tool name of an MCP tool id, `mcp-{serverId}-{toolName}`, or null for another id. Kept
 * here, as the legacy trace keeps it, since the MCP utilities reach server code.
 */
function mcpToolName(toolId: string): string | null {
  if (!toolId.startsWith('mcp-')) return null
  const parts = toolId.split('-')
  if (parts.length < 3) return null
  const name = parts.slice(2).join('-')
  return name.length > 0 ? name : null
}

function spanTime(value: string | undefined) {
  const ms = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(ms) && ms > 0 ? ms : undefined
}

function spanDurationMs(span: LogTraceSpan) {
  const recorded = span.duration ?? span.durationMs
  if (recorded) return recorded
  const start = spanTime(span.startTime)
  const end = spanTime(span.endTime)
  return start !== undefined && end !== undefined ? Math.max(0, end - start) : 0
}

function formatCount(value: number | undefined) {
  return value !== undefined && value > 0 ? value.toLocaleString(LOCALE) : undefined
}

function formatTtft(ms: number | undefined) {
  if (ms === undefined || ms < 0) return undefined
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`
}

function formatThroughput(outputTokens: number | undefined, durationMs: number) {
  if (!outputTokens || outputTokens <= 0 || durationMs <= 0) return undefined
  const perSecond = Math.round(outputTokens / (durationMs / 1000))
  return perSecond > 0 ? `${perSecond.toLocaleString(LOCALE)} tok/s` : undefined
}

/**
 * The facts the legacy span detail lists, in its order, beyond the step type, status and duration
 * the inspector leads with, then the step's Compute Units.
 */
function spanContext(span: LogTraceSpan, durationMs: number): TraceSpan['context'] {
  const detail = recordedDetail(span)
  const facts: { id: string; label: string; value: string | undefined }[] = [
    {
      id: 'type',
      label: 'Type',
      value:
        span.type === spanKind(span.type)
          ? undefined
          : isCustomBlockType(span.type)
            ? 'custom block'
            : span.type,
    },
    {
      id: 'child-run',
      label: 'Child run',
      value:
        CHILD_TRACE_ACCESS_LABEL[
          detail.childTraceAccess ?? (detail.childTraceDisabled ? 'disabled' : '')
        ],
    },
    { id: 'tries', label: 'Tries', value: detail.tries?.toString() },
    { id: 'provider', label: 'Provider', value: detail.provider },
    { id: 'model', label: 'Model', value: detail.model },
    ...detail.modelFallbacks.map((model, index) => ({
      id: `failed-model-${index}`,
      label: 'Failed model',
      value: model,
    })),
    { id: 'finish-reason', label: 'Finish reason', value: detail.finishReason },
    { id: 'ttft', label: 'TTFT', value: formatTtft(detail.ttft) },
    {
      id: 'throughput',
      label: 'Throughput',
      value: span.type === 'model' ? formatThroughput(detail.tokens.output, durationMs) : undefined,
    },
    { id: 'input-tokens', label: 'Input tokens', value: formatCount(detail.tokens.input) },
    { id: 'output-tokens', label: 'Output tokens', value: formatCount(detail.tokens.output) },
    { id: 'tokens', label: 'Total tokens', value: formatCount(detail.tokens.total) },
    { id: 'cache-read', label: 'Cache read', value: formatCount(detail.tokens.cacheRead) },
    { id: 'cache-write', label: 'Cache write', value: formatCount(detail.tokens.cacheWrite) },
    {
      id: 'reasoning-tokens',
      label: 'Reasoning tokens',
      value: formatCount(detail.tokens.reasoning),
    },
    {
      id: 'iteration',
      label: 'Iteration',
      value: detail.iterationIndex === undefined ? undefined : String(detail.iterationIndex + 1),
    },
    {
      id: 'usage',
      label: 'Compute Units',
      value:
        span.cost?.total === undefined
          ? undefined
          : dollarsToCredits(span.cost.total).toLocaleString(LOCALE),
    },
  ]
  return facts.flatMap(({ id, label, value }) => (value ? [{ id, label, value }] : []))
}

/**
 * A span's children as the trace shows them, in start order: a legacy span's tool calls become
 * tool steps, and an agent that called no tool hides its model segments.
 */
function displayChildren(span: LogTraceSpan, id: string): LogTraceSpan[] {
  const children: LogTraceSpan[] = span.children?.length
    ? [...span.children]
    : (span.toolCalls ?? []).map((call, index) => ({
        id: `${id}-tool-${index}`,
        name: call.name ?? 'Tool call',
        type: 'tool',
        duration: call.duration ?? 0,
        startTime: call.startTime ?? span.startTime,
        endTime: call.endTime ?? span.endTime,
        status: call.error ? 'error' : 'success',
        input: call.input,
        output: call.error ? { error: call.error, ...toRecord(call.output) } : call.output,
      }))
  children.sort((left, right) => (spanTime(left.startTime) ?? 0) - (spanTime(right.startTime) ?? 0))
  const calledTool = children.some((child) => child.type === 'tool')
  return span.type === 'agent' && !calledTool
    ? children.filter((child) => child.type !== 'model')
    : children
}

/** A logged span as the Platform's trace reads it, timed from `origin`. */
function toTraceSpan(span: LogTraceSpan, origin: number): TraceSpan {
  const withheld = span.contentWithheld === true
  const id = span.id || `span-${span.name}-${span.startTime ?? ''}`
  const startedAt = spanTime(span.startTime)
  const endedAt = spanTime(span.endTime)
  const durationMs = spanDurationMs(span)
  const detail = recordedDetail(span)
  const mcpName = span.type === 'tool' ? mcpToolName(span.name) : null
  const kind = mcpName ? 'mcp' : spanKind(span.type)
  const providerId =
    span.type === 'tool'
      ? mcpName
        ? undefined
        : normalizeToolId(span.name).split('_')[0]
      : span.type === 'model'
        ? detail.provider
        : kind === 'block'
          ? span.type
          : undefined
  const thinking = detail.thinking ? tracePayload(detail.thinking) : undefined
  const toolCalls = detail.modelToolCalls.length ? tracePayload(detail.modelToolCalls) : undefined
  const children = displayChildren(span, id)
  const extras = [
    ...(thinking ? [{ id: 'thinking', label: 'Thinking', payload: thinking }] : []),
    ...(toolCalls ? [{ id: 'tool-calls', label: 'Tool calls', payload: toolCalls }] : []),
  ]
  return {
    id,
    name: span.type === 'tool' ? (mcpName ?? normalizeToolId(span.name)) : span.name,
    kind,
    ...(providerId ? { providerId } : {}),
    status: spanStatus(span),
    startMs: Math.max(0, span.relativeStartMs ?? (startedAt ?? origin) - origin),
    durationMs,
    context: spanContext(span, durationMs),
    input: tracePayload(span.input, withheld),
    output: tracePayload(span.output, withheld),
    ...(extras.length ? { extras } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    notice: span.errorMessage
      ? {
          tone: span.errorHandled ? 'warning' : 'danger',
          title: span.errorType ?? (span.errorHandled ? 'Handled error' : 'Error'),
          message: span.errorMessage,
        }
      : undefined,
    children: children.length ? children.map((child) => toTraceSpan(child, origin)) : undefined,
  }
}

function formatFileSize(bytes: number) {
  if (bytes === 0) return '0 B'
  const sizes = ['B', 'KB', 'MB', 'GB']
  const index = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${Number.parseFloat((bytes / 1024 ** index).toFixed(1))} ${sizes[index]}`
}

/** The files a run produced: an execution file through the app's file route, a link-only file at its URL. */
function runFiles(files: WorkflowLogDetail['files']): RunFile[] | undefined {
  if (!files?.length) return undefined
  return files.map((file, index) => ({
    id: file.id || `file-${index}`,
    name: file.name,
    detail: [
      formatFileSize(file.size),
      file.type,
      ...(file.version === undefined ? [] : [`v${file.version}`]),
    ].join(' · '),
    href: file.key.startsWith('url/')
      ? file.url
      : `/api/files/serve/${encodeURIComponent(file.key)}?context=execution`,
  }))
}

/**
 * An apportioned credit figure; `dollars` tells a real zero ("0 credits") from a charge that rounds
 * below one credit ("<1 credit").
 */
function creditLabel(credits: number, dollars: number) {
  if (credits <= 0) return dollars > 0 ? '<1 credit' : '0 credits'
  return `${credits.toLocaleString('en-US')} ${credits === 1 ? 'credit' : 'credits'}`
}

/**
 * The run's cost from its usage ledger: line items apportioned once at the total so they always add
 * up, as legacy's details itemize it. A run from before the ledger shows its total alone.
 */
function runCost(log: WorkflowLogDetail): RunCost | undefined {
  const note = `Total includes a ${formatCreditCost(BASE_EXECUTION_CHARGE)} base charge plus model and tool usage.`
  const ledger = log.costLedger
  if (ledger && ledger.items.length > 0) {
    const credits = apportionCredits(
      ledger.items.map((item, index) => ({ key: String(index), dollars: item.cost }))
    )
    const input = ledger.items.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0)
    const output = ledger.items.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0)
    return {
      items: ledger.items.map((item, index) => ({
        id: String(index),
        label:
          item.category === 'fixed' && item.description === 'execution_fee'
            ? 'Base run'
            : item.description,
        value: creditLabel(credits[String(index)] ?? 0, item.cost),
      })),
      total: creditLabel(dollarsToCredits(ledger.total), ledger.total),
      tokens: input > 0 || output > 0 ? `${input} in · ${output} out` : undefined,
      note,
    }
  }
  const total = log.cost?.total
  if (total === undefined) return undefined
  return { items: [], total: creditLabel(dollarsToCredits(total), total), note }
}

/**
 * A run's details: its facts, files and cost, and one trace rooted at the run itself, whose input
 * and output are the workflow's, with the recorded spans beneath it on the run's clock. A viewer
 * whose permission group hides traces sees no trace, input or output, as in legacy.
 */
function toRunDetail(log: WorkflowLogDetail & { executionId: string }, traced: boolean): RunDetail {
  const summary = toRunSummary(log)
  const execution = log.executionData
  const spans = execution.traceSpans ?? []
  const total = execution.totalDuration ?? summary.durationMs ?? 0
  const executed = (log.trigger === 'manual' && Boolean(log.duration)) || spans.length > 0
  return {
    ...summary,
    version:
      log.deploymentVersionName ??
      (log.deploymentVersion === null ? undefined : `v${log.deploymentVersion}`),
    files: runFiles(log.files),
    cost: executed && log.cost ? runCost(log) : undefined,
    trace: traced
      ? [
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
            input: tracePayload(execution.workflowInput),
            output: tracePayload(filterHiddenOutputKeys(execution.finalOutput)),
            startedAt: summary.startedAt,
            children: [...spans]
              .sort(
                (left, right) => (spanTime(left.startTime) ?? 0) - (spanTime(right.startTime) ?? 0)
              )
              .map((span) => toTraceSpan(span, summary.startedAt)),
          },
        ]
      : [],
  }
}

/** The view's period as the logs API reads it: a preset's label, or a custom range's local bounds. */
function periodFilters(view: RunListView): Pick<LogFilters, 'timeRange' | 'startDate' | 'endDate'> {
  if (view.period !== 'custom') return { timeRange: TIME_RANGE[view.period] }
  return {
    timeRange: TIME_RANGE.custom,
    startDate: view.start ?? undefined,
    endDate: view.end ?? undefined,
  }
}

function viewFilters(view: RunListView): Omit<LogFilters, 'limit' | 'sortBy' | 'sortOrder'> {
  return {
    ...periodFilters(view),
    level: LEVEL[view.status],
    workflowIds: view.workflow,
    folderIds: view.folder,
    triggers: view.trigger,
    searchQuery: '',
  }
}

function listFilters(view: RunListView): LogFilters {
  return { ...viewFilters(view), limit: PAGE_SIZE, ...SORT[view.sort] }
}

/**
 * Where legacy's Export downloads the view's runs as CSV: the same filters the list reads, through
 * the logs export route.
 */
export function runExportHref(workspaceId: string, view: RunListView) {
  const filters = viewFilters(view)
  const params = new URLSearchParams({ workspaceId })
  if (filters.level !== 'all') params.set('level', filters.level)
  if (filters.triggers.length > 0) params.set('triggers', filters.triggers.join(','))
  if (filters.workflowIds.length > 0) params.set('workflowIds', filters.workflowIds.join(','))
  if (filters.folderIds.length > 0) params.set('folderIds', filters.folderIds.join(','))
  const start = getStartDateFromTimeRange(filters.timeRange, filters.startDate)
  if (start) params.set('startDate', start.toISOString())
  const end = getEndDateFromTimeRange(filters.timeRange, filters.endDate)
  if (end) params.set('endDate', end.toISOString())
  return `/api/logs/export?${params}`
}

/** The Workflow and Folder filters' choices: the workspace's workflows and workflow folders. */
export function useRunFilterOptions(workspaceId: string) {
  const workflows = useQuery(getWorkflowListQueryOptions(workspaceId)).data ?? []
  const folders = useFolderMap(workspaceId).data ?? {}
  const byLabel = (left: { label: string }, right: { label: string }) =>
    left.label.localeCompare(right.label)
  return {
    workflows: workflows
      .map((workflow) => ({ value: workflow.id, label: workflow.name }))
      .sort(byLabel),
    folders: Object.values(folders)
      .filter((folder) => folder.workspaceId === workspaceId)
      .map((folder) => ({ value: folder.id, label: folder.name }))
      .sort(byLabel),
  }
}

/**
 * The workspace's runs for a list view, paged by the server in the view's order. The list holds a
 * snapshot, as legacy's does, and reads its first page again on its own once new or changed runs
 * match it, so new runs join without a refresh control. How it reads again keeps the reader's
 * place: with every row in view on the first page, the list drops to that page and later pages load
 * again as the reader nears the end; deeper in a newest-first list, runs that only started since
 * join the head and the later pages stay; otherwise every page held is read again. The list reports
 * the last row in view through `onRowsInView`. The dashboard view reads none of it.
 */
export function useLiveRuns(workspaceId: string, view: RunListView) {
  const queryClient = useQueryClient()
  const enabled = view.view === 'runs'
  const filters = useMemo(() => listFilters(view), [view])
  const snapshot = useLogsSnapshot(workspaceId, filters, { enabled })
  const first = snapshot.isPlaceholderData ? undefined : snapshot.data?.pages[0]
  const newRuns = useNewLogCount(workspaceId, filters, first?.snapshotAt, { enabled }).data ?? 0
  const changedPage = snapshot.data?.pages.some((page) => page.snapshotChanged) === true
  const updated = useLogSnapshotUpdates(workspaceId, first, {
    enabled: enabled && newRuns === 0 && !changedPage,
  }).data
  const stale = newRuns > 0 || updated === true || changedPage
  const onlyNewRuns = newRuns > 0 && updated !== true && !changedPage
  const { refetch, isFetching } = snapshot
  const lastRowInView = useRef(0)
  const merging = useRef(false)
  useEffect(() => {
    if (!enabled || !stale || isFetching || merging.current) return
    const firstPageRuns = first?.logs.filter((log) => log.executionId).length ?? 0
    if (lastRowInView.current < firstPageRuns) {
      trimLogsSnapshotToFirstPage(queryClient, workspaceId, filters)
      void refetch()
      return
    }
    if (!onlyNewRuns) {
      void refetch()
      return
    }
    merging.current = true
    void mergeNewLogsIntoSnapshot(queryClient, workspaceId, filters)
      .catch(() => false)
      .then((merged) => {
        merging.current = false
        if (!merged) void refetch()
      })
  }, [enabled, stale, onlyNewRuns, isFetching, first, refetch, queryClient, workspaceId, filters])
  const read = queryRead(snapshot, 'Runs could not be loaded.')
  const pages = snapshot.data?.pages
  const { runs, commands } = useMemo(() => {
    const logs =
      pages?.flatMap((page) =>
        page.logs.flatMap((log) =>
          log.executionId ? [{ ...log, executionId: log.executionId }] : []
        )
      ) ?? []
    return {
      runs: logs.map(toRunSummary),
      commands: new Map(logs.map((log) => [log.executionId, commandsTarget(log)])),
    }
  }, [pages])
  return {
    read,
    runs,
    commands,
    more: {
      hasMore: snapshot.hasNextPage,
      loading: snapshot.isFetchingNextPage,
      error: snapshot.isFetchNextPageError
        ? getErrorMessage(snapshot.error, 'More runs could not be loaded.')
        : undefined,
      onLoadMore: () => void snapshot.fetchNextPage(),
    },
    /** The index of the last run in view, which decides how a refresh keeps the reader's place. */
    onRowsInView: (lastIndex: number) => {
      lastRowInView.current = lastIndex
    },
  }
}

function snapshotRunIds(pages: readonly { logs: readonly WorkflowLogSummary[] }[]) {
  return pages.flatMap((page) =>
    page.logs.flatMap((log) => (log.executionId ? [log.executionId] : []))
  )
}

/**
 * The runs either side of one in its list's order, for legacy's ArrowUp/ArrowDown between runs. It
 * reads the list's own snapshot, the same query the list holds for the view, so the order is the one
 * the reader left. At the last run read so far, `readNext` reads the next page and answers the run
 * after it, as legacy's list loads more when its selection reaches the end.
 */
export function useRunNeighbors(workspaceId: string, executionId: string, view: RunListView) {
  const snapshot = useLogsSnapshot(workspaceId, listFilters(view))
  const ids = snapshotRunIds(snapshot.data?.pages ?? [])
  const index = ids.indexOf(executionId)
  return {
    previous: index > 0 ? ids[index - 1] : undefined,
    next: index >= 0 ? ids[index + 1] : undefined,
    /** The run is the last one read and the list has more. */
    hasMore: index >= 0 && index === ids.length - 1 && snapshot.hasNextPage,
    loadingMore: snapshot.isFetchingNextPage,
    readNext: async () => {
      const result = await snapshot.fetchNextPage()
      const read = snapshotRunIds(result.data?.pages ?? [])
      const at = read.indexOf(executionId)
      return at >= 0 ? read[at + 1] : undefined
    },
  }
}

/** A dashboard series point: the segment's start and its value. */
export interface RunSeriesPoint {
  at: number
  value: number
}

export interface RunDashboardWorkflow {
  id: string
  name: string
  runs: number
  /** Successful runs as a share of all, 0–100. */
  successRate: number
  segments: readonly { at: number; runs: number; failed: number; avgDurationMs: number }[]
}

function latestRun(workflow: DashboardStatsResponse['workflows'][number]) {
  for (let index = workflow.segments.length - 1; index >= 0; index--) {
    const segment = workflow.segments[index]
    if (segment.totalExecutions > 0) return Date.parse(segment.timestamp)
  }
  return 0
}

/**
 * Legacy's logs dashboard for the view's period and filters: runs, errors and average latency over
 * time, and each workflow's runs by segment, most recently run first. It reads again every few
 * seconds while open.
 */
export function useRunDashboard(workspaceId: string, view: RunListView) {
  const query = useDashboardStats(workspaceId, viewFilters(view), {
    enabled: view.view === 'dashboard',
    refetchInterval: DASHBOARD_REFRESH_MS,
  })
  const stats = query.data
  const series = (pick: (segment: DashboardStatsResponse['aggregateSegments'][number]) => number) =>
    stats?.aggregateSegments.map((segment) => ({
      at: Date.parse(segment.timestamp),
      value: pick(segment),
    })) ?? []
  return {
    read: queryRead(query, 'The dashboard could not be loaded.'),
    totals: stats && {
      runs: stats.totalRuns,
      errors: stats.totalErrors,
      latencyMs: stats.avgLatency,
    },
    runs: series((segment) => segment.totalExecutions),
    errors: series((segment) => segment.totalExecutions - segment.successfulExecutions),
    latency: series((segment) => segment.avgDurationMs),
    workflows: (stats?.workflows ?? [])
      .map((workflow) => ({ workflow, latest: latestRun(workflow) }))
      .sort(
        (left, right) =>
          right.latest - left.latest ||
          left.workflow.workflowName.localeCompare(right.workflow.workflowName)
      )
      .map(
        ({ workflow }): RunDashboardWorkflow => ({
          id: workflow.workflowId,
          name: workflow.workflowName,
          runs: workflow.totalExecutions,
          successRate: workflow.overallSuccessRate,
          segments: workflow.segments.map((segment) => ({
            at: Date.parse(segment.timestamp),
            runs: segment.totalExecutions,
            failed: segment.totalExecutions - segment.successfulExecutions,
            avgDurationMs: segment.avgDurationMs,
          })),
        })
      ),
  }
}

/**
 * One run's log, read again every few seconds while it is still going, and whether the viewer's
 * permission group lets them read its trace, input and output. Nothing reads as ready until both
 * answer, so a trace never shows and then hides.
 */
function useRunLog(workspaceId: string, executionId: string) {
  const query = useLogByExecutionId(workspaceId, executionId, {
    refetchInterval: (current) => {
      const status = current.state.data?.status
      return status === 'running' || status === 'pending' || status === 'redacting'
        ? ACTIVE_RUN_REFRESH_MS
        : false
    },
  })
  const traces = useTraceVisibility(workspaceId)
  const log = query.data && { ...query.data, executionId }
  const traced = traces === 'shown'
  const executed =
    log !== undefined &&
    log.trigger !== 'mothership' &&
    ((log.trigger === 'manual' && Boolean(log.duration)) || Boolean(log.executionData.traceSpans))
  return {
    log,
    traced,
    read:
      traces === 'pending'
        ? { status: 'pending' as const }
        : queryRead(query, 'This run could not be loaded.'),
    missing: isApiClientError(query.error) && query.error.status === 404,
    /** Legacy offers the frozen workflow of a workflow run whose trace the viewer may read. */
    hasSnapshot: traced && executed,
  }
}

/**
 * One run by its execution: its details, what its commands may do, and whether it has a snapshot,
 * with the log it was read from for a surface that shows more of it, such as a table cell's run.
 */
export function useLiveRun(workspaceId: string, executionId: string) {
  const { log, traced, read, missing, hasSnapshot } = useRunLog(workspaceId, executionId)
  return {
    read,
    missing,
    log,
    traced,
    run: log && toRunDetail(log, traced),
    commands: log && commandsTarget(log),
    hasSnapshot,
  }
}

/**
 * The run a chat's log resource names. The chat may hold its execution, or only the log row's id,
 * which is read for it.
 */
export function useLogResourceExecution(
  workspaceId: string,
  logId: string,
  executionId: string | undefined
) {
  const detail = useLogDetail(workspaceId, executionId ? undefined : logId)
  if (executionId) return { executionId, read: { status: 'ready' as const }, missing: false }
  return {
    executionId: detail.data?.executionId ?? undefined,
    read: queryRead(detail, 'This run could not be loaded.'),
    missing: isApiClientError(detail.error) && detail.error.status === 404,
  }
}

/**
 * Stop, Retry and Troubleshoot on a run, as legacy offers them: stopping waits until the run is
 * confirmed cancelled and needs edit access; retrying starts a new run from the same input; a failed
 * run can be handed to a new chat.
 */
export function useRunCommands(workspaceId: string) {
  const { canEdit } = useWorkspaceUserPermissions(workspaceId)
  const cancel = useCancelExecution(workspaceId)
  const retry = useRetryExecution()
  const troubleshoot = useTroubleshootRun()
  return {
    canStop: canEdit,
    /** Legacy's Export needs edit access too. */
    canExport: canEdit,
    stopping: (executionId: string) =>
      cancel.isPending && cancel.variables?.executionId === executionId,
    retrying: retry.isPending,
    stop: (workflowId: string, executionId: string) =>
      cancel.mutateAsync({ workflowId, executionId }),
    retry: (workflowId: string, executionId: string) =>
      retry.mutateAsync({ workflowId, executionId }),
    canTroubleshoot: troubleshoot.available,
    troubleshoot: (executionId: string, workflowName: string) =>
      troubleshoot.troubleshoot({ workspaceId, executionId, workflowName }),
  }
}

/** One block's run in a snapshot: its status on the canvas and its step for the inspector. */
interface SnapshotBlock {
  status: string
  output?: unknown
  step: TraceSpan
  /** The child workflow a workflow block ran, frozen as this run ran it, to open in its place. */
  child?: SnapshotWorkflow
}

/** A workflow as one run executed it: its frozen state and each block's run. */
interface SnapshotWorkflow {
  name: string
  workflowState: WorkflowState
  blocks: Map<string, SnapshotBlock>
}

function isPauseOutput(output: unknown) {
  return typeof output === 'object' && output !== null && '_pauseMetadata' in output
}

function isWorkflowState(value: unknown): value is WorkflowState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'blocks' in value &&
    typeof value.blocks === 'object' &&
    value.blocks !== null
  )
}

/**
 * A workflow block's child run, as legacy's snapshot drills into it: the child's frozen state by the
 * span's snapshot ID, and its block runs from the span's children (or, on logs stored before those,
 * the `childTraceSpans` its output carried). The name is the child's own, then the one its output
 * recorded.
 */
function childWorkflow(
  span: LogTraceSpan,
  origin: number,
  childStates: Readonly<Record<string, unknown>>
): SnapshotWorkflow | undefined {
  const snapshotId =
    'childWorkflowSnapshotId' in span && typeof span.childWorkflowSnapshotId === 'string'
      ? span.childWorkflowSnapshotId
      : undefined
  const state = snapshotId ? childStates[snapshotId] : undefined
  if (!isWorkflowState(state)) return undefined
  const output = typeof span.output === 'object' && span.output !== null ? span.output : undefined
  const stored =
    output && 'childTraceSpans' in output
      ? traceSpansSchema.safeParse(output.childTraceSpans)
      : undefined
  const spans = span.children?.length ? span.children : stored?.success ? stored.data : []
  const recordedName =
    output && 'childWorkflowName' in output && typeof output.childWorkflowName === 'string'
      ? output.childWorkflowName
      : undefined
  return {
    name: state.metadata?.name || recordedName || 'Child workflow',
    workflowState: state,
    blocks: snapshotBlocks(spans, origin, childStates),
  }
}

/** Each block's first recorded span, in trace order, as legacy's snapshot maps blocks to runs. */
function snapshotBlocks(
  spans: readonly LogTraceSpan[],
  origin: number,
  childStates: Readonly<Record<string, unknown>>
) {
  const blocks = new Map<string, SnapshotBlock>()
  const visit = (span: LogTraceSpan) => {
    if (span.blockId && !blocks.has(span.blockId))
      blocks.set(span.blockId, {
        status: isPauseOutput(span.output) ? 'pending' : (span.status ?? 'unknown'),
        output: span.output,
        step: toTraceSpan(span, origin),
        child: childWorkflow(span, origin, childStates),
      })
    span.children?.forEach(visit)
  }
  spans.forEach(visit)
  return blocks
}

/**
 * A run's frozen workflow: the state it executed with, which blocks ran and how, and each block's
 * step, with the child workflow a workflow block ran. A run recorded before snapshots existed has no state to draw, which `migrated` says. A run
 * without a snapshot reads as missing.
 */
export function useRunSnapshot(workspaceId: string, executionId: string) {
  const { log, read, missing, hasSnapshot } = useRunLog(workspaceId, executionId)
  const snapshot = useExecutionSnapshot(hasSnapshot ? executionId : undefined)
  const state = snapshot.data?.workflowState
  const migrated = state?._migrated === true
  const startedAt = log ? Date.parse(log.createdAt) : 0
  return {
    read:
      read.status === 'ready'
        ? queryRead(snapshot, 'This run snapshot could not be loaded.')
        : read,
    missing:
      missing ||
      (read.status === 'ready' && log !== undefined && !hasSnapshot) ||
      (snapshot.isSuccess && !state),
    run: log && toRunSummary(log),
    workflowState: migrated ? undefined : ((state ?? undefined) as WorkflowState | undefined),
    migrated,
    blocks: snapshotBlocks(
      log?.executionData.traceSpans ?? [],
      startedAt,
      snapshot.data?.childWorkflowSnapshots ?? {}
    ),
  }
}
