import React from 'react'
import { format } from 'date-fns'
import { Badge } from '@/components/emcn'
import { getIntegrationMetadata } from '@/lib/logs/get-trigger-options'
import { getBlock } from '@/blocks/registry'

const CORE_TRIGGER_TYPES = ['manual', 'api', 'schedule', 'chat', 'webhook', 'mcp'] as const
const RUNNING_COLOR = '#22c55e' as const
const PENDING_COLOR = '#f59e0b' as const
export type LogStatus = 'error' | 'pending' | 'running' | 'info' | 'cancelled'

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

/**
 * Checks if a hex color is gray/neutral (low saturation) or too light/dark
 */
export function isGrayOrNeutral(hex: string): boolean {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2 / 255

  const delta = max - min
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1)) / 255

  return saturation < 0.2 || lightness > 0.8 || lightness < 0.25
}

/**
 * Converts a hex color to a background variant with appropriate opacity
 */
export function hexToBackground(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, 0.2)`
}

/**
 * Lightens a hex color to make it more vibrant for text
 */
export function lightenColor(hex: string, percent = 30): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)

  const newR = Math.min(255, Math.round(r + (255 - r) * (percent / 100)))
  const newG = Math.min(255, Math.round(g + (255 - g) * (percent / 100)))
  const newB = Math.min(255, Math.round(b + (255 - b) * (percent / 100)))

  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`
}

interface StatusBadgeProps {
  status: LogStatus
}

/**
 * Displays a styled badge for a log execution status
 */
export const StatusBadge = React.memo(({ status }: StatusBadgeProps) => {
  const config = {
    error: {
      bg: 'var(--terminal-status-error-bg)',
      color: 'var(--text-error)',
      label: 'Error',
    },
    pending: {
      bg: hexToBackground(PENDING_COLOR),
      color: lightenColor(PENDING_COLOR, 65),
      label: 'Pending',
    },
    running: {
      bg: hexToBackground(RUNNING_COLOR),
      color: lightenColor(RUNNING_COLOR, 65),
      label: 'Running',
    },
    cancelled: {
      bg: 'var(--terminal-status-info-bg)',
      color: 'var(--terminal-status-info-color)',
      label: 'Cancelled',
    },
    info: {
      bg: 'var(--terminal-status-info-bg)',
      color: 'var(--terminal-status-info-color)',
      label: 'Info',
    },
  }[status]

  return React.createElement(
    'div',
    {
      className:
        'inline-flex items-center gap-[6px] rounded-[6px] px-[9px] py-[2px] font-medium text-[12px]',
      style: { backgroundColor: config.bg, color: config.color },
    },
    React.createElement('div', {
      className: 'h-[6px] w-[6px] rounded-[2px]',
      style: { backgroundColor: config.color },
    }),
    config.label
  )
})

StatusBadge.displayName = 'StatusBadge'

interface TriggerBadgeProps {
  trigger: string
}

/**
 * Displays a styled badge for a workflow trigger type
 */
export const TriggerBadge = React.memo(({ trigger }: TriggerBadgeProps) => {
  const metadata = getIntegrationMetadata(trigger)
  const isIntegration = !(CORE_TRIGGER_TYPES as readonly string[]).includes(trigger)
  const block = isIntegration ? getBlock(trigger) : null
  const IconComponent = block?.icon

  const isUnknownIntegration = isIntegration && trigger !== 'generic' && !block
  if (
    trigger === 'manual' ||
    trigger === 'generic' ||
    isUnknownIntegration ||
    isGrayOrNeutral(metadata.color)
  ) {
    return React.createElement(
      Badge,
      {
        variant: 'default',
        className:
          'inline-flex items-center gap-[6px] rounded-[6px] px-[9px] py-[2px] font-medium text-[12px]',
      },
      IconComponent && React.createElement(IconComponent, { className: 'h-[12px] w-[12px]' }),
      metadata.label
    )
  }

  const textColor = lightenColor(metadata.color, 65)

  return React.createElement(
    'div',
    {
      className:
        'inline-flex items-center gap-[6px] rounded-[6px] px-[9px] py-[2px] font-medium text-[12px]',
      style: { backgroundColor: hexToBackground(metadata.color), color: textColor },
    },
    IconComponent && React.createElement(IconComponent, { className: 'h-[12px] w-[12px]' }),
    metadata.label
  )
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
 * Format duration for display in logs UI
 * If duration is under 1 second, displays as milliseconds (e.g., "500ms")
 * If duration is 1 second or more, displays as seconds (e.g., "1.23s")
 * @param duration - Duration string (e.g., "500ms") or null
 * @returns Formatted duration string or null
 */
export function formatDuration(duration: string | null): string | null {
  if (!duration) return null

  // Extract numeric value from duration string (e.g., "500ms" -> 500)
  const ms = Number.parseInt(duration.replace(/[^0-9]/g, ''), 10)

  if (!Number.isFinite(ms)) return duration

  if (ms < 1000) {
    return `${ms}ms`
  }

  // Convert to seconds with up to 2 decimal places
  const seconds = ms / 1000
  return `${seconds.toFixed(2).replace(/\.?0+$/, '')}s`
}

/**
 * Format latency value for display in dashboard UI
 * If latency is under 1 second, displays as milliseconds (e.g., "500ms")
 * If latency is 1 second or more, displays as seconds (e.g., "1.23s")
 * @param ms - Latency in milliseconds (number)
 * @returns Formatted latency string
 */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'

  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }

  // Convert to seconds with up to 2 decimal places
  const seconds = ms / 1000
  return `${seconds.toFixed(2).replace(/\.?0+$/, '')}s`
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
