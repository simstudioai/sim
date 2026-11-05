import type { ReactNode } from 'react'
import { Button } from '@/platform/design-system/components/button/button'
import styles from '@/platform/design-system/components/status/status.module.css'

type StatusIntent = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

interface StatusTagProps {
  label: string
  intent?: StatusIntent
  /** Announce changes to this tag, for a status that updates while it is on screen. */
  live?: boolean
}

export function StatusTag({ label, intent = 'neutral', live }: StatusTagProps) {
  return (
    <span
      className={styles.tag}
      data-intent={intent}
      data-type='T052'
      role={live ? 'status' : undefined}
    >
      {label}
    </span>
  )
}

/** Work in progress beside its own label, so the motion needs no announcement of its own. */
export function Spinner() {
  return <span className={styles.spinner} aria-hidden='true' />
}

interface InlineNoticeProps {
  message: string
  title?: string
  intent?: StatusIntent
  action?: ReactNode
}

/** A persistent message in the page flow. A `danger` notice is announced as an alert. */
export function InlineNotice({ message, title, intent = 'neutral', action }: InlineNoticeProps) {
  return (
    <div
      className={styles.notice}
      data-intent={intent}
      role={intent === 'danger' ? 'alert' : 'status'}
    >
      <div className={styles.copy}>
        {title && <span data-type='T059'>{title}</span>}
        <span data-type='T060'>{message}</span>
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}

interface FailureNoticeProps {
  message: string
  title?: string
  retrying?: boolean
  onRetry?: () => void
}

/** A read that failed, with its way back. It stays distinct from an empty list or an absent setting. */
export function FailureNotice({ message, title, retrying, onRetry }: FailureNoticeProps) {
  return (
    <InlineNotice
      intent='danger'
      title={title}
      message={message}
      action={
        onRetry && (
          <Button variant='quiet' size='compact' disabled={retrying} onClick={onRetry}>
            {retrying ? 'Retrying…' : 'Retry'}
          </Button>
        )
      }
    />
  )
}
