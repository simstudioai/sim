import React from 'react'
import { Badge } from '@/components/emcn'
import { getIntegrationMetadata } from '@/lib/logs/get-trigger-options'
import { getBlock } from '@/blocks/registry'
import { CORE_TRIGGER_TYPES } from '@/stores/logs/filters/types'

export type LogStatus = 'error' | 'pending' | 'running' | 'info' | 'cancelled' | 'cancelling'

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
  a2a: 'teal',
  copilot: 'pink',
  mothership: 'pink',
  workflow: 'blue-secondary',
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
