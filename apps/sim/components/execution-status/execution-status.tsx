import React from 'react'
import { Badge } from '@sim/emcn'

/**
 * Execution status and its badge — shared by every surface that renders one.
 *
 * Lives here rather than beside the logs page because three unrelated surfaces
 * draw the same badge: the logs list, a log's detail panel, and the tables grid's
 * workflow-output cells. The logs module additionally imports `getBlock` from the
 * block registry, so a table cell reaching there for a six-line badge pulled the
 * whole registry into the grid's module graph. Nothing in this file imports
 * anything but `Badge`.
 */
export type LogStatus =
  | 'error'
  | 'pending'
  | 'running'
  | 'redacting'
  | 'info'
  | 'cancelled'
  | 'cancelling'

/** Maps a raw status string to the {@link LogStatus} used for display. */
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

interface StatusBadgeProps {
  status: LogStatus
}

/** Renders a colored badge indicating execution status. */
export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status]
  return React.createElement(
    Badge,
    { variant: config.variant, dot: true, size: 'sm' },
    config.label
  )
}
