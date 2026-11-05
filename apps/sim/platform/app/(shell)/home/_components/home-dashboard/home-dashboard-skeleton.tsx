import { RedesignSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import styles from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard.module.css'
import {
  SkeletonBlock,
  SkeletonLane,
} from '@/platform/app/(shell)/home/_components/widget-skeleton/widget-skeleton'

interface HomeDashboardSkeletonProps {
  requestMode: 'agent' | 'assistant'
}

/** Home's arrangement before its data, so nothing moves when the page arrives. */
export function HomeDashboardSkeleton({ requestMode }: HomeDashboardSkeletonProps) {
  return (
    <div className={styles.scroller} aria-busy='true'>
      <div className={styles.dashboard}>
        <RedesignSurface>
          <div className={styles.lead}>
            <div className={styles.placeholderGreeting} />
            <div className={styles.placeholderWordmark} />
          </div>
        </RedesignSurface>
        <div className={styles.composer}>
          <RedesignSurface>
            <div className={styles.placeholderComposer} data-mode={requestMode} />
          </RedesignSurface>
        </div>
        <RedesignSurface>
          <div className={styles.sections}>
            <SkeletonLane label='Loading recents' />
            {requestMode === 'assistant' && <div className={styles.placeholderGetStarted} />}
            <div className={styles.columns}>
              <div className={styles.column}>
                {requestMode === 'agent' && <SkeletonBlock label='Loading activity' />}
                <SkeletonBlock label='Loading email' />
              </div>
              <div className={styles.column}>
                <SkeletonBlock label='Loading what needs your attention' />
                <SkeletonBlock label='Loading your calendar' />
              </div>
            </div>
          </div>
        </RedesignSurface>
      </div>
    </div>
  )
}
