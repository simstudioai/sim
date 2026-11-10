import type React from 'react'
import type { Badge } from '@sim/emcn-legacy'
import { formatRelativeTime } from '@sim/utils/formatting'
import { format } from 'date-fns'

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
