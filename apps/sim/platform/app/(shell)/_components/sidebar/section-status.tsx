import type { ShellQueryStatus } from '@/platform/app/(shell)/_components/model'
import styles from '@/platform/app/(shell)/_components/sidebar/sidebar-collections.module.css'
import { Button } from '@/platform/design-system/components'

interface SectionStatusProps {
  /** Absent means the rows are simply there, so nothing here applies. */
  status?: ShellQueryStatus
  isEmpty: boolean
  emptyLabel: string
  failureLabel: string
  onRetry?: () => void
}

/** Loading stays silent, like the legacy sidebar; empty and failure each say which they are. */
export function SectionStatus({
  status,
  isEmpty,
  emptyLabel,
  failureLabel,
  onRetry,
}: SectionStatusProps) {
  if (status === 'error')
    return (
      <div className={styles.message} role='alert'>
        <span data-type='T052'>{failureLabel}</span>
        {onRetry && (
          <Button size='compact' variant='quiet' onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    )
  if (status === 'success' && isEmpty)
    return (
      <p className={styles.message} data-type='T052'>
        {emptyLabel}
      </p>
    )
  return null
}
