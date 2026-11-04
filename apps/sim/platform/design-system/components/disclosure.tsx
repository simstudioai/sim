import type { ReactNode } from 'react'
import styles from '@/platform/design-system/components/choices.module.css'
import { Icon } from '@/platform/design-system/components/icon'

interface DisclosureProps {
  label: string
  expandedLabel?: string
  initiallyOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  variant?: 'section' | 'activity' | 'more'
  actions?: ReactNode
  children: ReactNode
}

export function Disclosure({
  label,
  expandedLabel,
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
        {expandedLabel ? (
          <>
            <span className={styles.collapsed}>{label}</span>
            <span className={styles.expanded}>{expandedLabel}</span>
          </>
        ) : (
          label
        )}
        {variant !== 'activity' && (
          <>
            <span className={styles.collapsed}>
              <Icon name={variant === 'more' ? 'I051' : 'I090'} />
            </span>
            <span className={styles.expanded}>
              <Icon name='I051' />
            </span>
          </>
        )}
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
