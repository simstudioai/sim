import React from 'react'
import { Badge } from '@sim/emcn'
import { formatRelativeTime } from '@sim/utils/formatting'
import { format } from 'date-fns'
import { getIntegrationMetadata } from '@/lib/logs/get-trigger-options'
import { getBlock } from '@/blocks/registry'
import { CORE_TRIGGER_TYPES } from '@/stores/logs/filters/types'

export const DELETED_WORKFLOW_LABEL = 'Deleted Workflow'

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
