import type { ReactNode } from 'react'
import { Button } from '#emcn/components/button/button'
import styles from '#emcn/components/status/status.module.css'

type StatusIntent = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

interface StatusTagProps {
  label: string
  intent?: StatusIntent
  /** Announce changes to this tag, for a status that updates while it is on screen. */
  live?: boolean
  /** A mark before the label, such as the provider this tag names. */
  leading?: ReactNode
}

export function StatusTag({ label, intent = 'neutral', live, leading }: StatusTagProps) {
  return (
    <span
      className={styles.tag}
      data-intent={intent}
      data-type='T052'
      role={live ? 'status' : undefined}
    >
      {leading}
      {label}
    </span>
  )
}

interface StatusTextProps {
  label: string
  intent?: StatusIntent
}

/**
 * A state inside a table cell, list row or grid, as text in its semantic ink with no badge or glyph,
 * as Paper's run rows show a run's status. A settled state reads in secondary ink, and the text takes
 * its surrounding type role.
 */
export function StatusText({ label, intent = 'neutral' }: StatusTextProps) {
  return (
    <span className={styles.text} data-intent={intent}>
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
  /** `warning` for a read that partly answered, so what is on screen is still worth reading. */
  intent?: Extract<StatusIntent, 'danger' | 'warning'>
}

/** A read that failed, with its way back. It stays distinct from an empty list or an absent setting. */
export function FailureNotice({
  message,
  title,
  retrying,
  onRetry,
  intent = 'danger',
}: FailureNoticeProps) {
  return (
    <InlineNotice
      intent={intent}
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
