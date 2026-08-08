import { formatDuration } from '@sim/utils/formatting'

export const LOG_COLUMNS = {
  workflow: { width: 'w-[22%]', minWidth: 'min-w-[140px]', label: 'Workflow' },
  date: { width: 'w-[18%]', minWidth: 'min-w-[140px]', label: 'Date' },
  status: { width: 'w-[12%]', minWidth: 'min-w-[100px]', label: 'Status' },
  cost: { width: 'w-[14%]', minWidth: 'min-w-[90px]', label: 'Cost' },
  trigger: { width: 'w-[14%]', minWidth: 'min-w-[110px]', label: 'Trigger' },
  duration: { width: 'w-[20%]', minWidth: 'min-w-[100px]', label: 'Duration' },
} as const

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

/**
 * Format latency value for display in dashboard UI
 * @param ms - Latency in milliseconds (number)
 * @returns Formatted latency string
 */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  return formatDuration(ms, { precision: 2 }) ?? '—'
}
