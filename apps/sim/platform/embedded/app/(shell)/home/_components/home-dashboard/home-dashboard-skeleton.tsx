'use client'

import { useOrganization } from '@/lib/organizations/provider'
import { Surface } from '@/platform/design-system/components/surface/surface'
import { ComposerPlaceholder } from '@/platform/embedded/app/(shell)/_components/conversation/skeletons'
import styles from '@/platform/embedded/app/(shell)/home/_components/home-dashboard/home-dashboard.module.css'
import {
  SkeletonBlock,
  SkeletonLane,
  WidgetSkeleton,
} from '@/platform/embedded/app/(shell)/home/_components/widget-skeleton/widget-skeleton'

/**
 * Home's arrangement before its data, so nothing moves when the page arrives. The organization's
 * provider sits above every boundary this holds, so it shows this viewer's Home rather than a guess.
 */
export function HomeDashboardSkeleton() {
  const { canBuild, searchAccess, viewer, connectedAccountsAvailable } = useOrganization()
  const showsGetStarted =
    !canBuild &&
    searchAccess.memberScoped &&
    ((viewer.canConnectSearchIntegrations && connectedAccountsAvailable) || viewer.canUseSearchMcp)
  return (
    <div className={styles.scroller}>
      <div className={styles.dashboard}>
        <Surface>
          <span role='status' data-visually-hidden>
            Loading Home
          </span>
          <div className={styles.lead}>
            <div className={styles.placeholderGreeting} />
            <div className={styles.placeholderWordmark} />
          </div>
        </Surface>
        <div className={styles.composer}>
          <ComposerPlaceholder />
        </div>
        <Surface>
          <div className={styles.sections}>
            {searchAccess.memberScoped && <SkeletonLane label='Loading recents' silent />}
            {showsGetStarted && <div className={styles.placeholderGetStarted} />}
            <div className={styles.columns}>
              <div className={styles.column}>
                {canBuild && <SkeletonBlock label='Loading activity' silent />}
                <SkeletonBlock label='Loading what needs your attention' silent />
                {canBuild && <WidgetSkeleton label='Loading workspaces' glyph={false} silent />}
              </div>
              <div className={styles.column}>
                <SkeletonBlock label='Loading email' silent />
                <SkeletonBlock label='Loading your calendar' silent />
              </div>
            </div>
          </div>
        </Surface>
      </div>
    </div>
  )
}
