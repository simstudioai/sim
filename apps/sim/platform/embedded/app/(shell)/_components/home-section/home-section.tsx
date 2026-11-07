import type { ReactNode } from 'react'
import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import { Icon } from '@sim/emcn/icon'
import styles from '@/platform/embedded/app/(shell)/_components/home-section/home-section.module.css'

interface HomeSectionProps {
  title: string
  icon?: IconName
  actions?: ReactNode
  /** Lets the section grow past the widget cap, when its own control or notices set the height. */
  uncapped?: boolean
  children: ReactNode
}

export function HomeSection({ title, icon, actions, uncapped, children }: HomeSectionProps) {
  return (
    <section aria-label={title} className={styles.section} data-uncapped={uncapped || undefined}>
      <header className={styles.heading}>
        <h2 data-type='T042'>
          {icon && <Icon name={icon} />}
          {title}
        </h2>
        {actions}
      </header>
      {children}
    </section>
  )
}
