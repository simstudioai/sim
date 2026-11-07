import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import styles from '#auth/components/resource/resource.module.css'

interface AuthResourceRowProps {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  disabled?: boolean
}
/** Wraps resource details and responsive actions; disabled does not disable child controls. */
export function AuthResourceRow({
  icon,
  title,
  description,
  actions,
  children,
  className,
  disabled,
}: AuthResourceRowProps) {
  return (
    <div className={clsx(styles.resourceRow, className)} aria-disabled={disabled || undefined}>
      <div className={styles.resourceIcon}>{icon}</div>
      <div className={styles.resourceText}>
        <div>{title}</div>
        {description && <p>{description}</p>}
        {children}
      </div>
      {actions && <div className={styles.resourceActions}>{actions}</div>}
    </div>
  )
}

interface AuthSectionProps {
  title: string
  children: ReactNode
  className?: string
  description?: ReactNode
}
/** Groups related controls under a section heading without reserving absent description space. */
export function AuthSection({ title, children, className, description }: AuthSectionProps) {
  return (
    <section className={clsx(styles.section, className)}>
      <div className={styles.sectionHeading}>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      <div>{children}</div>
    </section>
  )
}
