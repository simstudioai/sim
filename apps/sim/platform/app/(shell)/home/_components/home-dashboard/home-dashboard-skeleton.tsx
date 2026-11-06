import conversationStyles from '@/platform/app/(shell)/_components/conversation/conversation.module.css'
import styles from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard.module.css'
import {
  SkeletonBlock,
  SkeletonLane,
  WidgetSkeleton,
} from '@/platform/app/(shell)/home/_components/widget-skeleton/widget-skeleton'
import { Surface } from '@/platform/design-system/components/surface/surface'

interface HomeDashboardSkeletonProps {
  requestMode: 'agent' | 'assistant'
}

/** Home's arrangement before its data, so nothing moves when the page arrives. */
export function HomeDashboardSkeleton({ requestMode }: HomeDashboardSkeletonProps) {
  return (
    <div className={styles.scroller} aria-busy='true'>
      <div className={styles.dashboard}>
        <Surface>
          <div className={styles.lead}>
            <div className={styles.placeholderGreeting} />
            <div className={styles.placeholderWordmark} />
          </div>
        </Surface>
        <Surface>
          <div className={styles.composer}>
            <div className={conversationStyles.placeholderComposer} />
          </div>
        </Surface>
        <Surface>
          <div className={styles.sections}>
            <SkeletonLane label='Loading recents' />
            {requestMode === 'assistant' && <div className={styles.placeholderGetStarted} />}
            <div className={styles.columns}>
              <div className={styles.column}>
                {requestMode === 'agent' && <SkeletonBlock label='Loading activity' />}
                <SkeletonBlock label='Loading what needs your attention' />
                {requestMode === 'agent' && (
                  <WidgetSkeleton label='Loading workspaces' glyph={false} />
                )}
              </div>
              <div className={styles.column}>
                <SkeletonBlock label='Loading email' />
                <SkeletonBlock label='Loading your calendar' />
              </div>
            </div>
          </div>
        </Surface>
      </div>
    </div>
  )
}
