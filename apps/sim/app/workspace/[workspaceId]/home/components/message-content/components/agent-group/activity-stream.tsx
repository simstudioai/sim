'use client'

import { useEffect, useState } from 'react'
import { ActivityStatus, type ActivityStatusProps } from '@/components/ui/activity-status'
import {
  ActivityDisclosure,
  type ActivityDisclosureProps,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/activity-disclosure'

const ACTIVITY_UPDATE_INTERVAL_MS = 1000

interface ActivityStreamProps extends Omit<ActivityDisclosureProps, 'header'> {
  activity: ActivityStatusProps
  activityKey?: string
  expandedLabel?: string
  attentionKey: string
  collapsible: boolean
}

/** Pace only the header; history and interactive tool state continue updating immediately. */
export function ActivityStream({
  activity,
  activityKey,
  expandedLabel,
  attentionKey,
  expanded,
  collapsible,
  children,
  onToggle,
  isStreaming,
  unbounded,
}: ActivityStreamProps) {
  const isExpanded = collapsible && expanded
  const key = `${activityKey}:${activity.label}`
  const resetKey = `${activity.isActive}:${isExpanded}:${Boolean(activityKey)}:${attentionKey}`
  const [visible, setVisible] = useState(() => ({
    activity,
    key,
    resetKey,
    shownAt: Date.now(),
  }))

  /** Completion, attention, and disclosure changes bypass the cosmetic delay. */
  if (visible.resetKey !== resetKey) {
    setVisible({ activity, key, resetKey, shownAt: Date.now() })
  }

  useEffect(() => {
    if (!activity.isActive || isExpanded || key === visible.key) return
    const remaining = Math.max(0, ACTIVITY_UPDATE_INTERVAL_MS - (Date.now() - visible.shownAt))
    const flush = () => setVisible({ activity, key, resetKey, shownAt: Date.now() })
    if (remaining === 0) {
      flush()
      return
    }
    const timer = setTimeout(flush, remaining)
    return () => clearTimeout(timer)
  }, [activity, key, resetKey, isExpanded, visible.key, visible.shownAt])

  const displayed =
    !activity.isActive || isExpanded || key === visible.key ? activity : visible.activity
  const header = (
    <ActivityStatus
      {...displayed}
      label={isExpanded ? (expandedLabel ?? displayed.label) : displayed.label}
      isActive={activity.isActive}
    />
  )
  return (
    <ActivityDisclosure
      header={header}
      collapsible={collapsible}
      expanded={expanded}
      onToggle={onToggle}
      isStreaming={isStreaming}
      unbounded={unbounded}
    >
      {children}
    </ActivityDisclosure>
  )
}
