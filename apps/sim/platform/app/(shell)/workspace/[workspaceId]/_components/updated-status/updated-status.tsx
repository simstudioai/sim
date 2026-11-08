import styles from '@/platform/app/(shell)/workspace/[workspaceId]/_components/updated-status/updated-status.module.css'
import { formatRelativeTime } from '@/platform/shared/time'

interface UpdatedStatusProps {
  updatedAt: number
  /** The surface's single reference instant. */
  referenceTime: number
}

/** When the page's data last refreshed. The page refreshes itself, so there is nothing to press. */
export function UpdatedStatus({ updatedAt, referenceTime }: UpdatedStatusProps) {
  const age = formatRelativeTime(updatedAt, referenceTime)
  return (
    <span className={styles.status} data-type='T050' aria-live='polite'>
      {age === 'now' ? 'Updated just now' : `Updated ${age}`}
    </span>
  )
}
