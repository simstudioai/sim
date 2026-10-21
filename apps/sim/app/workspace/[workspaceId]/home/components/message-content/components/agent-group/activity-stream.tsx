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
  /** The label only stands in until the header's call names itself (see `usePacedActivity`). */
  placeholder?: boolean
}

/**
 * The header activity to show: a new label waits until the current one has shown for the pacing
 * interval, and a burst of changes inside it settles on the latest. The label is paced across
 * liveness too: between a run's calls the lane briefly loses its live indicator, and an unpaced
 * label would flash the finished call's title before the next call's. Liveness itself is never
 * held. A change of `resetKey` (attention, disclosure) and an expanded group show at once, and a
 * placeholder (a call still awaiting its own title) never holds the header, so the title replaces
 * it as soon as it streams.
 */
export function usePacedActivity(
  activity: ActivityStatusProps,
  activityKey: string | undefined,
  resetKey: string,
  immediate: boolean,
  placeholder = false
): ActivityStatusProps {
  const key = `${activityKey}:${activity.label}`
  const [visible, setVisible] = useState(() => ({
    activity,
    key,
    resetKey,
    placeholder,
    shownAt: Date.now(),
  }))

  if (visible.resetKey !== resetKey) {
    setVisible({ activity, key, resetKey, placeholder, shownAt: Date.now() })
  } else if (key === visible.key && placeholder !== visible.placeholder) {
    // The same text now names the call itself (an activity title its description matches), so
    // it holds the header from here.
    setVisible({ ...visible, activity, placeholder, shownAt: Date.now() })
  }

  useEffect(() => {
    if (immediate || key === visible.key) return
    const remaining = visible.placeholder
      ? 0
      : Math.max(0, ACTIVITY_UPDATE_INTERVAL_MS - (Date.now() - visible.shownAt))
    const flush = () => setVisible({ activity, key, resetKey, placeholder, shownAt: Date.now() })
    if (remaining === 0) {
      flush()
      return
    }
    const timer = setTimeout(flush, remaining)
    return () => clearTimeout(timer)
  }, [activity, key, resetKey, immediate, placeholder, visible])

  return immediate || key === visible.key || visible.placeholder
    ? activity
    : { ...visible.activity, isActive: activity.isActive }
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
  placeholder,
}: ActivityStreamProps) {
  const isExpanded = collapsible && expanded
  const displayed = usePacedActivity(
    activity,
    activityKey,
    `${isExpanded}:${Boolean(activityKey)}:${attentionKey}`,
    isExpanded,
    placeholder
  )
  const header = (
    <ActivityStatus
      {...displayed}
      label={isExpanded ? (expandedLabel ?? displayed.label) : displayed.label}
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
