import type { ReactNode } from 'react'
import styles from '@/platform/design-system/components/disclosure/disclosure.module.css'
import { Icon } from '@/platform/design-system/components/icon/icon'

interface DisclosureProps {
  label: string
  initiallyOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  variant?: 'section' | 'activity'
  actions?: ReactNode
  children: ReactNode
}

export function Disclosure({
  label,
  initiallyOpen,
  open = initiallyOpen,
  onOpenChange,
  variant = 'section',
  actions,
  children,
}: DisclosureProps) {
  const disclosure = (
    <details className={styles.disclosure} data-variant={variant} open={open}>
      <summary
        className={styles.summary}
        data-type={variant === 'section' ? 'T052' : 'T060'}
        onClick={
          onOpenChange &&
          ((event) => {
            event.preventDefault()
            onOpenChange(!open)
          })
        }
      >
        {label}
        <span className={styles.collapsed}>
          <Icon name='I090' />
        </span>
        <span className={styles.expanded}>
          <Icon name='I051' />
        </span>
      </summary>
      {children}
    </details>
  )
  if (!actions) return disclosure
  return (
    <section className={styles.collection} aria-label={label}>
      {disclosure}
      <div className={styles.collectionActions}>{actions}</div>
    </section>
  )
}
