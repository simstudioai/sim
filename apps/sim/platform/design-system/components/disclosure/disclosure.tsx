import type { ReactNode } from 'react'
import { Collapsible } from '@base-ui/react/collapsible'
import styles from '@/platform/design-system/components/disclosure/disclosure.module.css'
import { Icon } from '@/platform/design-system/components/icon/icon'

type DisclosureProps = {
  label: string
  initiallyOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
} & (
  | { variant?: 'section'; actions?: ReactNode; introduction?: never }
  | { variant: 'activity'; introduction?: ReactNode; actions?: never }
)

export function Disclosure({
  label,
  initiallyOpen,
  open,
  onOpenChange,
  variant = 'section',
  actions,
  introduction,
  children,
}: DisclosureProps) {
  const title = (
    <>
      {label}
      <span className={styles.collapsed}>
        <Icon name='I090' />
      </span>
      <span className={styles.expanded}>
        <Icon name='I051' />
      </span>
    </>
  )
  if (variant === 'activity')
    return (
      <Collapsible.Root
        className={styles.activity}
        defaultOpen={initiallyOpen}
        open={open}
        onOpenChange={onOpenChange}
      >
        <Collapsible.Trigger className={styles.summary} data-type='T060'>
          {title}
        </Collapsible.Trigger>
        {introduction}
        <Collapsible.Panel>{children}</Collapsible.Panel>
      </Collapsible.Root>
    )
  const disclosure = (
    <details className={styles.disclosure} open={open ?? initiallyOpen}>
      <summary
        className={styles.summary}
        data-type='T052'
        onClick={
          onOpenChange &&
          ((event) => {
            event.preventDefault()
            onOpenChange(!open)
          })
        }
      >
        {title}
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
