'use client'

import { IconButton } from '@sim/emcn/button'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/_components/refresh-status/refresh-status.module.css'
import { formatRelativeTime } from '@/platform/shared/time'

interface RefreshStatusProps {
  updatedAt: number
  /** The surface's single reference instant. */
  referenceTime: number
  onRefresh: () => void
}

/** When the data last refreshed, and a refresh that keeps the current data in place. */
export function RefreshStatus({ updatedAt, referenceTime, onRefresh }: RefreshStatusProps) {
  const age = formatRelativeTime(updatedAt, referenceTime)
  return (
    <>
      <span className={styles.status} data-type='T050' aria-live='polite'>
        {age === 'now' ? 'Updated just now' : `Updated ${age}`}
      </span>
      <IconButton tooltip label='Refresh' icon='I065' size='small' onClick={onRefresh} />
    </>
  )
}
