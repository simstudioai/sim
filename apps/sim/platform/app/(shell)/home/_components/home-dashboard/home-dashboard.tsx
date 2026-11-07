'use client'

import type { ReactNode } from 'react'
import { Icon } from '@sim/emcn/icon'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { InlineNotice } from '@sim/emcn/status'
import { PageColumn, PageOverflow } from '@sim/emcn-platform/page-column'
import { RecentItems } from '@sim/emcn-platform/recent-items'
import { PlatformSurface } from '@sim/emcn-platform/surface/platform-surface'
import type { HomeMode, HomeWidget } from '@/platform/app/(shell)/_components/model'
import { usePlatformNotices } from '@/platform/app/(shell)/_components/notification-tray/notification-tray'
import { HomeActivityChart } from '@/platform/app/(shell)/home/_components/activity-chart/activity-chart'
import {
  AttentionList,
  EmailList,
} from '@/platform/app/(shell)/home/_components/activity-list/activity-list'
import { CalendarDay } from '@/platform/app/(shell)/home/_components/calendar/calendar-day'
import { ConnectedWidget } from '@/platform/app/(shell)/home/_components/connected-widget/connected-widget'
import { GetStarted } from '@/platform/app/(shell)/home/_components/get-started/get-started'
import styles from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard.module.css'
import type { HomeActions, HomeView } from '@/platform/app/(shell)/home/_components/model'
import { RetryButton } from '@/platform/app/(shell)/home/_components/retry-button/retry-button'
import { SkeletonLane } from '@/platform/app/(shell)/home/_components/widget-skeleton/widget-skeleton'

const WIDGETS: readonly HomeWidget[] = ['Activity', 'Email', 'Calendar']
const ACTIVITY_METRIC_TITLES: Record<HomeMode, string> = { Build: 'Tasks run', Search: 'Searches' }

interface HomeDashboardProps {
  view: HomeView
  actions: HomeActions
  /** Which activity metric the chart shows. */
  mode: HomeMode
  prompt: string
  /** The host's composer. It sits between surfaces: legacy chrome never renders inside one. */
  composer: ReactNode
  composerActions?: ReactNode
  hiddenWidgets: readonly HomeWidget[]
  onWidgetHiddenChange: (widget: HomeWidget, hidden: boolean) => void
}

/**
 * Home's arrangement, filled by its host: this app's shell, or the organization surface it is embedded
 * in. Everything that differs between the two arrives through these props.
 */
export function HomeDashboard({
  view,
  actions,
  mode,
  prompt,
  composer,
  composerActions,
  hiddenWidgets,
  onWidgetHiddenChange,
}: HomeDashboardProps) {
  const { notify, dismiss } = usePlatformNotices()
  const metricTitle = ACTIVITY_METRIC_TITLES[mode]
  const activity = view.activity[mode]
  const widgetLabel = (widget: HomeWidget) => (widget === 'Activity' ? metricTitle : widget)
  const customizable = WIDGETS.filter(
    (widget) => widget !== 'Activity' || activity.status !== 'hidden'
  )
  function setVisible(widget: HomeWidget, visible: boolean) {
    const id = `hide-${widget}`
    onWidgetHiddenChange(widget, !visible)
    if (visible) {
      dismiss(id)
    } else {
      notify({
        id,
        title: `${widgetLabel(widget)} hidden`,
        action: 'Undo',
        onAction: () => onWidgetHiddenChange(widget, false),
      })
    }
  }
  return (
    <div className={styles.scroller}>
      <PageColumn>
        <div className={styles.dashboard}>
          <PlatformSurface theme='system'>
            <div className={styles.lead}>
              <header className={styles.greeting}>
                <div>
                  <h1 data-type='T076'>
                    {view.firstName ? `${view.greeting}, ${view.firstName}` : view.greeting}
                  </h1>
                  <p data-type='T048'>{prompt}</p>
                </div>
                <ActionMenu
                  label='Customize Home'
                  heading='Customize Home'
                  icon='I108'
                  align='end'
                  actions={customizable.map((widget) => ({
                    id: widget,
                    label: widgetLabel(widget),
                    checked: !hiddenWidgets.includes(widget),
                    onSelect: () => setVisible(widget, hiddenWidgets.includes(widget)),
                  }))}
                />
              </header>
              <div className={styles.composerHeading}>
                <span className={styles.wordmark}>
                  <Icon name='I113' label='Sim' />
                </span>
                {composerActions}
              </div>
            </div>
          </PlatformSurface>
          <PageOverflow>
            <section className={styles.composer} aria-label='Start a conversation'>
              {composer}
            </section>
          </PageOverflow>
          <PlatformSurface theme='system'>
            <div className={styles.sections}>
              {view.recents.status === 'loading' && <SkeletonLane label='Loading recents' />}
              {view.recents.status === 'error' && (
                <InlineNotice
                  intent='warning'
                  message='Recents could not load.'
                  action={
                    <RetryButton retrying={view.recents.retrying} onRetry={actions.retryRecents} />
                  }
                />
              )}
              {view.recents.status === 'ready' && view.recents.items.length > 0 && (
                <div className={styles.recents}>
                  <RecentItems
                    label='Recents'
                    items={view.recents.items}
                    onRemove={actions.removeRecent}
                  />
                </div>
              )}
              {view.getStarted.length > 0 && <GetStarted steps={view.getStarted} />}
              <div className={styles.columns}>
                <div className={styles.column}>
                  <HomeActivityChart
                    title={metricTitle}
                    state={activity}
                    onRetry={actions.retryActivity}
                    hidden={hiddenWidgets.includes('Activity')}
                  />
                  {!hiddenWidgets.includes('Email') && (
                    <ConnectedWidget
                      title='Email'
                      state={view.email}
                      actions={actions.email}
                      onHide={() => setVisible('Email', false)}
                    >
                      {(items) => (
                        <EmailList items={items} asOf={view.asOf} onOpen={actions.openEmail} />
                      )}
                    </ConnectedWidget>
                  )}
                </div>
                <div className={styles.column}>
                  <AttentionList
                    state={view.attention}
                    asOf={view.asOf}
                    onRetry={actions.retryAttention}
                  />
                  {!hiddenWidgets.includes('Calendar') && (
                    <ConnectedWidget
                      title='Calendar'
                      state={view.calendar}
                      actions={actions.calendar}
                      onHide={() => setVisible('Calendar', false)}
                    >
                      {(calendar) => (
                        <CalendarDay
                          calendar={calendar}
                          onDayChange={actions.changeDay}
                          onReturnToToday={actions.returnToToday}
                          onRetry={actions.calendar.retry}
                        />
                      )}
                    </ConnectedWidget>
                  )}
                </div>
              </div>
            </div>
          </PlatformSurface>
        </div>
      </PageColumn>
    </div>
  )
}
