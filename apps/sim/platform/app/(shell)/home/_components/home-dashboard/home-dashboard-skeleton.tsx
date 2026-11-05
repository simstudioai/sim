import styles from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard.module.css'
import { SkeletonBlock } from '@/platform/app/(shell)/home/_components/widget-skeleton/widget-skeleton'

/** Home's arrangement before its data, so nothing moves when the page arrives. */
export function HomeDashboardSkeleton() {
  return (
    <div className={styles.dashboard} aria-busy='true'>
      <div className={styles.placeholderGreeting} />
      <div className={styles.placeholderComposer} />
      <div className={styles.columns}>
        <div className={styles.column}>
          <SkeletonBlock label='Loading activity' />
        </div>
        <div className={styles.column}>
          <SkeletonBlock label='Loading what needs your attention' />
        </div>
      </div>
    </div>
  )
}
