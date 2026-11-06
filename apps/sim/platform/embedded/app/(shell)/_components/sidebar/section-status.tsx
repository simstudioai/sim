import { FailureNotice } from '@/platform/design-system/components/status/status'
import styles from '@/platform/embedded/app/(shell)/_components/sidebar/sidebar-collections.module.css'
import type { ShellQueryStatus } from '@/platform/embedded/lib/data/shell-view'

interface SectionStatusProps {
  status: ShellQueryStatus
  isEmpty: boolean
  emptyLabel: string
  failureLabel: string
  onRetry: () => void
}

/** Loading stays silent, like the legacy sidebar; empty and failure each say which they are. */
export function SectionStatus({
  status,
  isEmpty,
  emptyLabel,
  failureLabel,
  onRetry,
}: SectionStatusProps) {
  if (status === 'error') return <FailureNotice message={failureLabel} onRetry={onRetry} />
  if (status === 'success' && isEmpty)
    return (
      <p className={styles.message} data-type='T052'>
        {emptyLabel}
      </p>
    )
  return null
}
