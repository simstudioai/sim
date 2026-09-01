import React from 'react'
import { Badge } from '@sim/emcn'
import { formatRelativeTime } from '@sim/utils/formatting'
import { format } from 'date-fns'
import { formatChartLatency } from '@/components/charts/chart-format'
import { getIntegrationMetadata } from '@/lib/logs/get-trigger-options'
import { getBlock } from '@/blocks/registry'
import { CORE_TRIGGER_TYPES } from '@/stores/logs/filters/types'

export const LOG_COLUMNS = {
  workflow: { width: 'w-[22%]', minWidth: 'min-w-[140px]', label: 'Workflow' },
  date: { width: 'w-[18%]', minWidth: 'min-w-[140px]', label: 'Date' },
  status: { width: 'w-[12%]', minWidth: 'min-w-[100px]', label: 'Status' },
  cost: { width: 'w-[14%]', minWidth: 'min-w-[90px]', label: 'Cost' },
  trigger: { width: 'w-[14%]', minWidth: 'min-w-[110px]', label: 'Trigger' },
  duration: { width: 'w-[20%]', minWidth: 'min-w-[100px]', label: 'Duration' },
} as const

/**
 * Resolves the workflow a log row points at, or null when there is nowhere to
 * navigate. Sim agent jobs have no workflow of their own, and a deleted
 * workflow leaves both id fields empty.
 *
 * Single source of truth for "is this log's workflow reachable" — the list row,
 * its context menu, and the details panel must agree, or a row can render as
 * "Deleted Workflow" while still linking somewhere.
 */
export function resolveLogWorkflowId(log: {
  trigger?: string | null
  workflowId?: string | null
  workflow?: { id?: string } | null
}): string | null {
  if (log.trigger === 'mothership') return null
  return log.workflow?.id || log.workflowId || null
}

/** Path to a workflow in the editor. */
export function workflowEditorPath(workspaceId: string, workflowId: string): string {
  return `/workspace/${workspaceId}/w/${workflowId}`
}

export type LogStatus =
  | 'error'
  | 'pending'
  | 'running'
  | 'redacting'
  | 'info'
  | 'cancelled'
  | 'cancelling'

/**
 * Maps raw status string to LogStatus for display.
 * @param status - Raw status from API
 * @returns Normalized LogStatus value
 */
export function getDisplayStatus(status: string | null | undefined): LogStatus {
  switch (status) {
    case 'running':
      return 'running'
    case 'redacting':
      return 'redacting'
    case 'pending':
      return 'pending'
    case 'cancelling':
      return 'cancelling'
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
  {
    variant: React.ComponentProps<typeof Badge>['variant']
    label: string
    color: string
    /** Whether this status appears as a filter option. Intermediary states (e.g. cancelling) are excluded. */
    filterable: boolean
  }
> = {
  error: { variant: 'red', label: 'Error', color: 'var(--text-error)', filterable: true },
  pending: { variant: 'amber', label: 'Pending', color: '#f59e0b', filterable: true },
  running: { variant: 'amber', label: 'Running', color: '#f59e0b', filterable: true },
  redacting: { variant: 'amber', label: 'Redacting', color: '#f59e0b', filterable: false },
  cancelling: { variant: 'amber', label: 'Cancelling...', color: '#f59e0b', filterable: false },
  cancelled: { variant: 'orange', label: 'Cancelled', color: '#f97316', filterable: true },
  info: {
    variant: 'gray',
    label: 'Info',
    color: 'var(--terminal-status-info-color)',
    filterable: true,
  },
}

const TRIGGER_VARIANT_MAP: Record<string, React.ComponentProps<typeof Badge>['variant']> = {
  manual: 'gray-secondary',
  api: 'blue',
  schedule: 'green',
  chat: 'purple',
  webhook: 'orange',
  mcp: 'cyan',
  copilot: 'pink',
  mothership: 'pink',
  workflow: 'blue-secondary',
  custom_block: 'blue-secondary',
}

interface StatusBadgeProps {
  status: LogStatus
}

/**
 * Renders a colored badge indicating log execution status.
 * @param props - Component props containing the status
 * @returns A Badge with dot indicator and status label
 */
export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status]
  return React.createElement(
    Badge,
    { variant: config.variant, dot: true, size: 'sm' },
    config.label
  )
}

interface TriggerBadgeProps {
  trigger: string
}

/**
 * Renders a colored badge indicating the workflow trigger type.
 * Core triggers display with their designated colors; integrations show with icons.
 * @param props - Component props containing the trigger type
 * @returns A Badge with appropriate styling for the trigger type
 */
export function TriggerBadge({ trigger }: TriggerBadgeProps) {
  const metadata = getIntegrationMetadata(trigger)
  const isIntegration = !(CORE_TRIGGER_TYPES as readonly string[]).includes(trigger)
  const block = isIntegration ? getBlock(trigger) : null
  const IconComponent = block?.icon

  const coreVariant = TRIGGER_VARIANT_MAP[trigger]
  if (coreVariant) {
    return React.createElement(
      Badge,
      { variant: coreVariant, size: 'sm', className: 'whitespace-nowrap' },
      metadata.label
    )
  }

  if (IconComponent) {
    return React.createElement(
      Badge,
      {
        variant: 'gray-secondary',
        size: 'sm',
        icon: IconComponent,
        className: 'whitespace-nowrap',
      },
      metadata.label
    )
  }

  return React.createElement(
    Badge,
    { variant: 'gray-secondary', size: 'sm', className: 'whitespace-nowrap' },
    metadata.label
  )
}

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
 * Format latency value for display in dashboard UI.
 *
 * Delegates so the axis ticks and the surrounding table can never disagree about
 * what a duration reads as.
 *
 * @param ms - Latency in milliseconds (number)
 * @returns Formatted latency string
 */
export function formatLatency(ms: number): string {
  return formatChartLatency(ms)
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
    relative: formatRelativeTime(dateString),
  }
}
