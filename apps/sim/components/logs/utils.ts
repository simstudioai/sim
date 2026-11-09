import type React from 'react'
import type { Badge } from '@sim/emcn-legacy'
import { formatRelativeTime } from '@sim/utils/formatting'
import { format } from 'date-fns'

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
 * navigate. Sim agent jobs have no workflow of their own, a deleted workflow
 * leaves both id fields empty, and an archived workflow keeps its id but can no
 * longer be opened.
 *
 * Single source of truth for "is this log's workflow reachable" — the list row,
 * its context menu, and the details panel must agree, or a row can render as
 * "Deleted Workflow" while still linking somewhere.
 */
export function resolveLogWorkflowId(log: {
  trigger?: string | null
  workflowId?: string | null
  workflow?: { id?: string; archivedAt?: string | null } | null
}): string | null {
  if (log.trigger === 'mothership' || log.workflow?.archivedAt) return null
  return log.workflow?.id || log.workflowId || null
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
