'use client'

import { memo } from 'react'
import { badgeVariants, cn } from '@sim/emcn'
import { BADGE_STYLE } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/types'

/**
 * Inline running badge for valid content inside a native terminal row button.
 */
const RunningBadge = memo(function RunningBadge() {
  return <span className={cn(badgeVariants({ variant: 'green' }), BADGE_STYLE)}>Running</span>
})

/**
 * Props for StatusDisplay component
 */
export interface StatusDisplayProps {
  isRunning: boolean
  isCanceled: boolean
  formattedDuration: string
}

/**
 * Reusable status display for terminal rows.
 * Shows Running badge, 'canceled' text, or formatted duration.
 */
export const StatusDisplay = memo(function StatusDisplay({
  isRunning,
  isCanceled,
  formattedDuration,
}: StatusDisplayProps) {
  if (isRunning) {
    return <RunningBadge />
  }
  if (isCanceled) {
    return <>canceled</>
  }
  return <>{formattedDuration}</>
})
