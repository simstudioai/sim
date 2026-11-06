import type { ReactNode } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { FailureNotice } from '@/platform/design-system/components/status/status'
import styles from '@/platform/design-system/components/status/status.module.css'

interface LoadingRowsProps {
  /** Announced, since the rows themselves say nothing. */
  label: string
  rows?: number
}

/** Rows the height of the ones being read, at the place they will appear, so nothing reads as empty. */
export function LoadingRows({ label, rows = 3 }: LoadingRowsProps) {
  return (
    <div className={styles.loadingRows} role='status' aria-label={label}>
      <span data-visually-hidden>{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={styles.loadingRow} aria-hidden='true'>
          <span className={styles.loadingLabel} />
          <span className={styles.loadingControl} />
        </div>
      ))}
    </div>
  )
}

interface QueryRead<T> {
  /** Anything but `undefined` is shown, so a failed refresh keeps what it has. */
  data: T | undefined
  error?: unknown
  isFetching?: boolean
  refetch: () => unknown
}

interface QueryBoundaryProps<T> {
  query: QueryRead<T>
  /** The first read's failure, or how to word it from the error. */
  failure: string | ((error: unknown) => string)
  failureTitle?: string
  /** Announced while the first read runs. */
  loadingLabel: string
  rows?: number
  /** A placeholder shaped like the content, where rows would misrepresent it. */
  loading?: ReactNode
  /** Shown instead of `children` when the read holds nothing. */
  empty?: (data: T) => ReactNode | false | null | undefined
  children: (data: T) => ReactNode
}

/**
 * The one way a view shows a first read: loading, failure with its retry, empty, then content. A
 * background refresh that fails over content already on screen is the view's own notice, outside this.
 */
export function QueryBoundary<T>({
  query,
  failure,
  failureTitle,
  loadingLabel,
  rows,
  loading,
  empty,
  children,
}: QueryBoundaryProps<T>) {
  if (query.data !== undefined) return <>{empty?.(query.data) || children(query.data)}</>
  if (query.error) {
    return (
      <FailureNotice
        title={failureTitle}
        message={typeof failure === 'function' ? failure(query.error) : failure}
        retrying={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    )
  }
  return <>{loading ?? <LoadingRows label={loadingLabel} rows={rows} />}</>
}

/** The failure wording most reads use: the server's message, or this. */
export const errorMessageOr = (fallback: string) => (error: unknown) =>
  getErrorMessage(error, fallback)
