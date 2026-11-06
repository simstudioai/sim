import type { ReactNode } from 'react'
import { Button } from '@/platform/design-system/components/button/button'
import styles from '@/platform/embedded/app/(shell)/settings/_components/settings-screen/settings-screen.module.css'

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
      <span data-type='T057'>{title}</span>
    </header>
  )
}

/** The section's name, for the phone top bar that replaces the breadcrumb. */
export function SettingsMobileTitle({ title }: SettingsBreadcrumbProps) {
  return (
    <span className={styles.mobileTitle} data-type='T057'>
      {title}
    </span>
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
