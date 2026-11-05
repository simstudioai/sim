import type { ReactNode } from 'react'
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
