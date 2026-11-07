import type { ReactNode } from 'react'
import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import { Icon } from '@sim/emcn/icon'
import styles from '@/platform/app/(shell)/home/_components/home-section/home-section.module.css'

interface HomeSectionProps {
  title: string
  icon?: IconName
  actions?: ReactNode
  children: ReactNode
}

export function HomeSection({ title, icon, actions, children }: HomeSectionProps) {
  return (
    <section aria-label={title} className={styles.section}>
      <header className={styles.heading}>
        <h2 data-type='T042'>
          {icon && <Icon name={icon} />}
          {title}
        </h2>
        {actions && <span className={styles.actions}>{actions}</span>}
      </header>
      {children}
    </section>
  )
}
