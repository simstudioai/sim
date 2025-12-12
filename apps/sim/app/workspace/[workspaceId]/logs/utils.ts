/**
 * Parse duration from various log data formats
 */
export function parseDuration(log: any): number | null {
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

/**
 * Extract output from various sources in execution data
 * Checks multiple locations in priority order:
 * 1. executionData.finalOutput
 * 2. output (as string)
 * 3. executionData.traceSpans (iterates through spans)
 * 4. executionData.blockExecutions (last block)
 * 5. message (fallback)
 */
export function extractOutput(log: any): any {
  let output: any = null

  // Check finalOutput first
  if (log.executionData?.finalOutput !== undefined) {
    output = log.executionData.finalOutput
  }

  // Check direct output field
  if (typeof log.output === 'string') {
    output = log.output
  } else if (log.executionData?.traceSpans && Array.isArray(log.executionData.traceSpans)) {
    // Search through trace spans
    const spans: any[] = log.executionData.traceSpans
    for (let i = spans.length - 1; i >= 0; i--) {
      const s = spans[i]
      if (s?.output && Object.keys(s.output).length > 0) {
        output = s.output
        break
      }
      if (s?.status === 'error' && (s?.output?.error || s?.error)) {
        output = s.output?.error || s.error
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

/**
 * Map raw log data to ExecutionLog format
 */
export interface ExecutionLog {
  id: string
  executionId: string
  startedAt: string
  level: string
  trigger: string
  triggerUserId: string | null
  triggerInputs: any
  outputs: any
  errorMessage: string | null
  duration: number | null
  cost: {
    input: number
    output: number
    total: number
  } | null
  workflowName?: string
  workflowColor?: string
  hasPendingPause?: boolean
}

/**
 * Convert raw API log response to ExecutionLog format
 */
export function mapToExecutionLog(log: any): ExecutionLog {
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
 * Alternative version that uses createdAt as fallback for startedAt
 * (used in some API responses)
 */
export function mapToExecutionLogAlt(log: any): ExecutionLog {
  const duration = parseDuration(log)
  const output = extractOutput(log)

  return {
    id: log.id,
    executionId: log.executionId,
    startedAt: log.createdAt || log.startedAt,
    level: log.level || 'info',
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

import { format } from 'date-fns'

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
    compactTime: format(date, 'HH:mm:ss'),
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
