import { LoadingState } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import styles from '@/platform/app/(shell)/settings/_components/settings-screen/settings-screen.module.css'

/** The screen around a section while the route reads its gate and data. Its title arrives with it. */
export function SettingsScreenSkeleton() {
  return (
    <>
      <header aria-label='Settings location' className={styles.breadcrumb}>
        <span className={styles.parent} data-type='T057'>
          Settings
        </span>
      </header>
      <div className={styles.content}>
        <header className={styles.heading}>
          <span className={styles.titlePlaceholder} aria-hidden='true' />
        </header>
        <LoadingState label='Loading settings' />
      </div>
    </>
  )
}
