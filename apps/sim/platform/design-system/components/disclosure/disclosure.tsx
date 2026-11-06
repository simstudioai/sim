import type { ReactNode } from 'react'
import { Collapsible } from '@base-ui/react/collapsible'
import { ControlRow } from '@/platform/design-system/components/button/control-row'
import styles from '@/platform/design-system/components/disclosure/disclosure.module.css'
import { Icon } from '@/platform/design-system/components/icon/icon'

type DisclosureProps = {
  label: string
  initiallyOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
} & (
  | { variant?: 'section' | 'navigation'; actions?: ReactNode; introduction?: never }
  | { variant: 'folder'; actions?: never; introduction?: never }
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
  if (variant === 'folder') {
    return (
      <details className={styles.folder} open={initiallyOpen}>
        <ControlRow render={<summary />} label={label} icon='I100' trailingIcon='I090' />
        {children}
      </details>
    )
  }
  if (variant === 'activity')
    return (
      <Collapsible.Root
        className={styles.activity}
        defaultOpen={initiallyOpen}
        open={open}
        onOpenChange={onOpenChange}
      >
        <Collapsible.Trigger className={styles.summary} data-type='T048'>
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
  if (!actions && variant !== 'navigation') return disclosure
  return (
    <section className={styles.collection} aria-label={label}>
      {disclosure}
      {actions && <div className={styles.collectionActions}>{actions}</div>}
    </section>
  )
}
