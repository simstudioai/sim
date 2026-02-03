import React from 'react'
import { format } from 'date-fns'
import { Badge } from '@/components/emcn'
import { formatDuration } from '@/lib/core/utils/formatting'
import { getIntegrationMetadata } from '@/lib/logs/get-trigger-options'
import { getBlock } from '@/blocks/registry'
import { CORE_TRIGGER_TYPES } from '@/stores/logs/filters/types'

export const LOG_COLUMNS = {
  date: { width: 'w-[8%]', minWidth: 'min-w-[70px]', label: 'Date' },
  time: { width: 'w-[12%]', minWidth: 'min-w-[90px]', label: 'Time' },
  status: { width: 'w-[12%]', minWidth: 'min-w-[100px]', label: 'Status' },
  workflow: { width: 'w-[22%]', minWidth: 'min-w-[140px]', label: 'Workflow' },
  cost: { width: 'w-[12%]', minWidth: 'min-w-[90px]', label: 'Cost' },
  trigger: { width: 'w-[14%]', minWidth: 'min-w-[110px]', label: 'Trigger' },
  duration: { width: 'w-[20%]', minWidth: 'min-w-[100px]', label: 'Duration' },
} as const

export type LogColumnKey = keyof typeof LOG_COLUMNS

export const LOG_COLUMN_ORDER: readonly LogColumnKey[] = [
  'date',
  'time',
  'status',
  'workflow',
  'cost',
  'trigger',
  'duration',
] as const

export const DELETED_WORKFLOW_LABEL = 'Deleted Workflow'
export const DELETED_WORKFLOW_COLOR = 'var(--text-tertiary)'

export type LogStatus = 'error' | 'pending' | 'running' | 'info' | 'cancelled'

/**
 * Maps raw status string to LogStatus for display.
 * @param status - Raw status from API
 * @returns Normalized LogStatus value
 */
export function getDisplayStatus(status: string | null | undefined): LogStatus {
  switch (status) {
    case 'running':
      return 'running'
    case 'pending':
      return 'pending'
    case 'cancelled':
      return 'cancelled'
    case 'failed':
      return 'error'
    default:
      return 'info'
  }
}

export const STATUS_CONFIG: Record<
  LogStatus,
  { variant: React.ComponentProps<typeof Badge>['variant']; label: string; color: string }
> = {
  error: { variant: 'red', label: 'Error', color: 'var(--text-error)' },
  pending: { variant: 'amber', label: 'Pending', color: '#f59e0b' },
  running: { variant: 'green', label: 'Running', color: '#22c55e' },
  cancelled: { variant: 'orange', label: 'Cancelled', color: '#f97316' },
  info: { variant: 'gray', label: 'Info', color: 'var(--terminal-status-info-color)' },
}

const TRIGGER_VARIANT_MAP: Record<string, React.ComponentProps<typeof Badge>['variant']> = {
  manual: 'gray-secondary',
  api: 'blue',
  schedule: 'green',
  chat: 'purple',
  webhook: 'orange',
  mcp: 'cyan',
  a2a: 'teal',
}

interface StatusBadgeProps {
  status: LogStatus
}

/**
 * Renders a colored badge indicating log execution status.
 * @param props - Component props containing the status
 * @returns A Badge with dot indicator and status label
 */
export const StatusBadge = React.memo(({ status }: StatusBadgeProps) => {
  const config = STATUS_CONFIG[status]
  return React.createElement(Badge, { variant: config.variant, dot: true }, config.label)
})

StatusBadge.displayName = 'StatusBadge'

interface TriggerBadgeProps {
  trigger: string
}

/**
 * Renders a colored badge indicating the workflow trigger type.
 * Core triggers display with their designated colors; integrations show with icons.
 * @param props - Component props containing the trigger type
 * @returns A Badge with appropriate styling for the trigger type
 */
export const TriggerBadge = React.memo(({ trigger }: TriggerBadgeProps) => {
  const metadata = getIntegrationMetadata(trigger)
  const isIntegration = !(CORE_TRIGGER_TYPES as readonly string[]).includes(trigger)
  const block = isIntegration ? getBlock(trigger) : null
  const IconComponent = block?.icon

  const coreVariant = TRIGGER_VARIANT_MAP[trigger]
  if (coreVariant) {
    return React.createElement(Badge, { variant: coreVariant }, metadata.label)
  }

  if (IconComponent) {
    return React.createElement(
      Badge,
      { variant: 'gray-secondary', icon: IconComponent },
      metadata.label
    )
  }

  return React.createElement(Badge, { variant: 'gray-secondary' }, metadata.label)
})

TriggerBadge.displayName = 'TriggerBadge'

interface LogWithDuration {
  totalDurationMs?: number | string
  duration?: number | string
}

/**
 * Parse duration from various log data formats.
 * Handles both numeric and string duration values.
 * @param log - Log object containing duration information
 * @returns Duration in milliseconds or null if not available
 */
export function parseDuration(log: LogWithDuration): number | null {
  let durationCandidate: number | null = null

  if (typeof log.totalDurationMs === 'number') {
    durationCandidate = log.totalDurationMs
  } else if (typeof log.duration === 'number') {
    durationCandidate = log.duration
  } else if (typeof log.totalDurationMs === 'string') {
    durationCandidate = Number.parseInt(String(log.totalDurationMs).replace(/[^0-9]/g, ''), 10)
  } else if (typeof log.duration === 'string') {
    durationCandidate = Number.parseInt(String(log.duration).replace(/[^0-9]/g, ''), 10)
  }

  return Number.isFinite(durationCandidate) ? durationCandidate : null
}

interface TraceSpan {
  output?: Record<string, unknown>
  status?: string
  error?: unknown
}

interface BlockExecution {
  outputData?: unknown
  errorMessage?: string
}

interface LogWithExecutionData {
  executionData?: {
    finalOutput?: unknown
    traceSpans?: TraceSpan[]
    blockExecutions?: BlockExecution[]
    output?: unknown
  }
  output?: string
  message?: string
}

/**
 * Extract output from various sources in execution data.
 * Checks multiple locations in priority order:
 * 1. executionData.finalOutput
 * 2. output (as string)
 * 3. executionData.traceSpans (iterates through spans)
 * 4. executionData.blockExecutions (last block)
 * 5. message (fallback)
 * @param log - Log object containing execution data
 * @returns Extracted output value or null
 */
export function extractOutput(log: LogWithExecutionData): unknown {
  let output: unknown = null

  // Check finalOutput first
  if (log.executionData?.finalOutput !== undefined) {
    output = log.executionData.finalOutput
  }

  // Check direct output field
  if (typeof log.output === 'string') {
    output = log.output
  } else if (log.executionData?.traceSpans && Array.isArray(log.executionData.traceSpans)) {
    // Search through trace spans
    const spans = log.executionData.traceSpans
    for (let i = spans.length - 1; i >= 0; i--) {
      const s = spans[i]
      if (s?.output && Object.keys(s.output).length > 0) {
        output = s.output
        break
      }
      const outputWithError = s?.output as Record<string, unknown> | undefined
      if (s?.status === 'error' && (outputWithError?.error || s?.error)) {
        output = outputWithError?.error || s.error
        break
      }
    }
    // Fallback to executionData.output
    if (!output && log.executionData?.output) {
      output = log.executionData.output
    }
  }

  // Check block executions
  if (!output) {
    const blockExecutions = log.executionData?.blockExecutions
    if (Array.isArray(blockExecutions) && blockExecutions.length > 0) {
      const lastBlock = blockExecutions[blockExecutions.length - 1]
      output = lastBlock?.outputData || lastBlock?.errorMessage || null
    }
  }

  // Final fallback to message
  if (!output) {
    output = log.message || null
  }

  return output
}

/** Execution log cost breakdown */
interface ExecutionCost {
  input: number
  output: number
  total: number
}

/** Mapped execution log format for UI consumption */
export interface ExecutionLog {
  id: string
  executionId: string
  startedAt: string
  level: string
  status: string
  trigger: string
  triggerUserId: string | null
  triggerInputs?: unknown
  outputs?: unknown
  errorMessage: string | null
  duration: number | null
  cost: ExecutionCost | null
  workflowName?: string
  workflowColor?: string
  hasPendingPause?: boolean
}

/** Raw API log response structure */
interface RawLogResponse extends LogWithDuration, LogWithExecutionData {
  id: string
  executionId: string
  startedAt?: string
  endedAt?: string
  createdAt?: string
  level?: string
  status?: string
  trigger?: string
  triggerUserId?: string | null
  error?: string
  cost?: {
    input?: number
    output?: number
    total?: number
  }
  workflowName?: string
  workflowColor?: string
  workflow?: {
    name?: string
    color?: string
  }
  hasPendingPause?: boolean
}

/**
 * Convert raw API log response to ExecutionLog format.
 * @param log - Raw log response from API
 * @returns Formatted execution log
 */
export function mapToExecutionLog(log: RawLogResponse): ExecutionLog {
  const started = log.startedAt
    ? new Date(log.startedAt)
    : log.endedAt
      ? new Date(log.endedAt)
      : null

  const startedAt =
    started && !Number.isNaN(started.getTime()) ? started.toISOString() : new Date().toISOString()

  const duration = parseDuration(log)
  const output = extractOutput(log)

  return {
    id: log.id,
    executionId: log.executionId,
    startedAt,
    level: log.level || 'info',
    status: log.status || 'completed',
    trigger: log.trigger || 'manual',
    triggerUserId: log.triggerUserId || null,
    triggerInputs: undefined,
    outputs: output || undefined,
    errorMessage: log.error || null,
    duration,
    cost: log.cost
      ? {
          input: log.cost.input || 0,
          output: log.cost.output || 0,
          total: log.cost.total || 0,
        }
      : null,
    workflowName: log.workflowName || log.workflow?.name,
    workflowColor: log.workflowColor || log.workflow?.color,
    hasPendingPause: log.hasPendingPause === true,
  }
}

/**
 * Alternative version that uses createdAt as fallback for startedAt.
 * Used in some API responses.
 * @param log - Raw log response from API
 * @returns Formatted execution log
 */
export function mapToExecutionLogAlt(log: RawLogResponse): ExecutionLog {
  const duration = parseDuration(log)
  const output = extractOutput(log)

  return {
    id: log.id,
    executionId: log.executionId,
    startedAt: log.createdAt || log.startedAt || new Date().toISOString(),
    level: log.level || 'info',
    status: log.status || 'completed',
    trigger: log.trigger || 'manual',
    triggerUserId: log.triggerUserId || null,
    triggerInputs: undefined,
    outputs: output || undefined,
    errorMessage: log.error || null,
    duration,
    cost: log.cost
      ? {
          input: log.cost.input || 0,
          output: log.cost.output || 0,
          total: log.cost.total || 0,
        }
      : null,
    workflowName: log.workflow?.name,
    workflowColor: log.workflow?.color,
    hasPendingPause: log.hasPendingPause === true,
  }
}

/**
 * Format latency value for display in dashboard UI
 * @param ms - Latency in milliseconds (number)
 * @returns Formatted latency string
 */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  return formatDuration(ms, { precision: 2 }) ?? '—'
}

export const formatDate = (dateString: string) => {
  const date = new Date(dateString)
  return {
    full: date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
    time: date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
    formatted: format(date, 'HH:mm:ss'),
    compact: format(date, 'MMM d HH:mm:ss'),
    compactDate: format(date, 'MMM d').toUpperCase(),
    compactTime: format(date, 'h:mm a'),
    relative: (() => {
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMins = Math.floor(diffMs / 60000)

      if (diffMins < 1) return 'just now'
      if (diffMins < 60) return `${diffMins}m ago`

      const diffHours = Math.floor(diffMins / 60)
      if (diffHours < 24) return `${diffHours}h ago`

      const diffDays = Math.floor(diffHours / 24)
      if (diffDays === 1) return 'yesterday'
      if (diffDays < 7) return `${diffDays}d ago`

      return format(date, 'MMM d')
    })(),
  }
}
