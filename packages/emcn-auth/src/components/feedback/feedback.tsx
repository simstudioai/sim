import type { ReactNode } from 'react'
import { Icon } from '@sim/emcn/icon'
import styles from '#auth/components/feedback/feedback.module.css'

interface AuthFormMessageProps {
  type: 'error' | 'success' | 'info'
  align?: 'left' | 'center'
  children: ReactNode
}
/** Announces errors as alerts and other feedback as status, without owning validation. */
export function AuthFormMessage({ type, align = 'left', children }: AuthFormMessageProps) {
  return (
    <div
      className={styles.feedback}
      data-align={align}
      data-tone={type}
      role={type === 'error' ? 'alert' : 'status'}
    >
      <span className={styles.feedbackIcon}>
        <Icon name={type === 'error' ? 'warning-circle' : 'I072'} />
      </span>
      <div>{children}</div>
    </div>
  )
}
