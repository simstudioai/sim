import type { ReactNode } from 'react'
import styles from '@/platform/app/(shell)/settings/_components/settings-screen/settings-screen.module.css'
import { Button } from '@/platform/design-system/components/button/button'

interface SettingsBreadcrumbProps {
  title: string
}

/** Settings' location bar, above every section whether it runs on this design or its older page. */
export function SettingsBreadcrumb({ title }: SettingsBreadcrumbProps) {
  return (
    <header aria-label='Settings location' className={styles.breadcrumb}>
      <span className={styles.parent} data-type='T057'>
        Settings
      </span>
      <span aria-hidden='true' className={styles.parent} data-type='T057'>
        /
      </span>
      <span className={styles.fullTitle} data-type='T057'>
        {title}
      </span>
      <span className={styles.compactTitle} data-type='T042'>
        {title}
      </span>
    </header>
  )
}

interface SettingsScreenProps {
  title: string
  description?: string
  docsHref?: string
  children?: ReactNode
}

/** A section's scrolling page: heading, description, docs link, then its cards. */
export function SettingsScreen({ title, description, docsHref, children }: SettingsScreenProps) {
  return (
    <div className={styles.body}>
      <div className={styles.content}>
        <header className={styles.heading}>
          <div className={styles.title}>
            <h1 data-type='T076'>{title}</h1>
            {description && <p data-type='T060'>{description}</p>}
          </div>
          {docsHref && (
            <span className={styles.docs}>
              <Button
                variant='quiet'
                size='compact'
                render={
                  <a href={docsHref} target='_blank' rel='noopener noreferrer'>
                    Docs
                  </a>
                }
              >
                Docs
              </Button>
            </span>
          )}
        </header>
        {children}
      </div>
    </div>
  )
}
