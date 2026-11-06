import styles from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard.module.css'
import {
  SkeletonBlock,
  SkeletonLane,
} from '@/platform/app/(shell)/home/_components/widget-skeleton/widget-skeleton'
import { PageColumn, PageOverflow } from '@/platform/design-system/components'
import { PlatformSurface } from '@/platform/design-system/components/surface/platform-surface'

interface HomeDashboardSkeletonProps {
  requestMode?: 'agent' | 'assistant'
}

/** Home's arrangement before its data, so nothing moves when the page arrives. */
export function HomeDashboardSkeleton({ requestMode = 'agent' }: HomeDashboardSkeletonProps) {
  return (
    <div className={styles.scroller} aria-busy='true'>
      <PageColumn>
        <div className={styles.dashboard}>
          <PlatformSurface theme='system'>
            <div className={styles.lead}>
              <div className={styles.placeholderGreeting} />
              <div className={styles.placeholderWordmark} />
            </div>
          </PlatformSurface>
          <PlatformSurface theme='system'>
            <PageOverflow>
              <div className={styles.composer}>
                <div className={styles.placeholderComposer} data-mode={requestMode} />
              </div>
            </PageOverflow>
          </PlatformSurface>
          <PlatformSurface theme='system'>
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
          </PlatformSurface>
        </div>
      </PageColumn>
    </div>
  )
}
