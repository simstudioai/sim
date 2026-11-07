import { FailureNotice } from '@sim/emcn/status'
import type { ShellQueryStatus } from '@/app/o/[organizationId]/_redesign/rail/model'
import styles from '@/app/o/[organizationId]/_redesign/rail/sidebar-collections.module.css'

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
