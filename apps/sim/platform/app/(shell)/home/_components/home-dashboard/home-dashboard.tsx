'use client'

import type { ReactNode } from 'react'
import type { ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'
import { HomeActivityChart } from '@/platform/app/(shell)/home/_components/activity-chart/activity-chart'
import {
  AttentionList,
  EmailList,
} from '@/platform/app/(shell)/home/_components/activity-list/activity-list'
import { CalendarDay } from '@/platform/app/(shell)/home/_components/calendar/calendar-day'
import { ConnectedWidget } from '@/platform/app/(shell)/home/_components/connected-widget/connected-widget'
import { GetStarted } from '@/platform/app/(shell)/home/_components/get-started/get-started'
import styles from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard.module.css'
import { HomeRecents } from '@/platform/app/(shell)/home/_components/home-recents/home-recents'
import { HomeWorkspaces } from '@/platform/app/(shell)/home/_components/home-workspaces/home-workspaces'
import { SkeletonLane } from '@/platform/app/(shell)/home/_components/widget-skeleton/widget-skeleton'
import { FailureNotice } from '@/platform/design-system/components'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { ActionMenu } from '@/platform/design-system/components/menu/action-menu'
import { Surface } from '@/platform/design-system/components/surface/surface'
import type { HomeActions, HomeView } from '@/platform/lib/data/home-view'
import { usePlatformNotices } from '@/platform/lib/notices'
import type { OrganizationHomeWidget } from '@/stores/organization-home/store'

const WIDGETS: readonly OrganizationHomeWidget[] = ['Activity', 'Workspaces', 'Email', 'Calendar']
const WIDGET_LABELS: Record<OrganizationHomeWidget, string> = {
  Activity: 'Tasks run',
  Workspaces: 'Workspaces',
  Email: 'Email',
  Calendar: 'Calendar',
}

const COMPOSER_PROMPTS: Record<ChatRequestMode, string> = {
  agent: 'What should we get done?',
  plan: 'What should we understand and plan?',
  assistant: 'Ask about your company’s knowledge.',
}

interface HomeDashboardProps {
  view: HomeView
  actions: HomeActions
  requestMode: ChatRequestMode
  /** The real composer. It sits between surfaces: legacy chrome never renders inside one. */
  composer: ReactNode
}

export function HomeDashboard({ view, actions, requestMode, composer }: HomeDashboardProps) {
  const { notify, dismiss } = usePlatformNotices()
  const { activity, hiddenWidgets } = view
  const customizable = WIDGETS.filter(
    (widget) =>
      (widget !== 'Activity' || activity.status !== 'hidden') &&
      (widget !== 'Workspaces' || view.workspaceCount > 0)
  )
  function setVisible(widget: OrganizationHomeWidget, visible: boolean) {
    const id = `hide-${widget}`
    actions.setWidgetHidden(widget, !visible)
    if (visible) {
      dismiss(id)
    } else {
      notify({
        id,
        title: `${WIDGET_LABELS[widget]} hidden`,
        action: 'Undo',
        onAction: () => actions.setWidgetHidden(widget, false),
      })
    }
  }
  return (
    <main className={styles.scroller}>
      <div className={styles.dashboard}>
        <Surface>
          <div className={styles.lead}>
            <header className={styles.greeting}>
              <div>
                <h1 data-type='T076'>
                  {view.firstName ? `${view.greeting}, ${view.firstName}` : view.greeting}
                </h1>
                <p data-type='T048'>{COMPOSER_PROMPTS[requestMode]}</p>
              </div>
              <ActionMenu
                label='Customize Home'
                heading='Customize Home'
                icon='I108'
                align='end'
                actions={customizable.map((widget) => ({
                  id: widget,
                  label: WIDGET_LABELS[widget],
                  checked: !hiddenWidgets.includes(widget),
                  onSelect: () => setVisible(widget, hiddenWidgets.includes(widget)),
                }))}
              />
            </header>
            <span className={styles.wordmark}>
              <Icon name='I113' label='Sim' />
            </span>
          </div>
        </Surface>
        <section className={styles.composer} aria-label='Start a conversation'>
          {composer}
        </section>
        <Surface>
          <div className={styles.sections}>
            {view.recents.status === 'loading' && <SkeletonLane label='Loading recents' />}
            {view.recents.status === 'error' && (
              <FailureNotice
                intent='warning'
                message='Recents could not load.'
                retrying={view.recents.retrying}
                onRetry={actions.retryRecents}
              />
            )}
            {view.recents.status === 'ready' && view.recents.items.length > 0 && (
              <div className={styles.recents}>
                <HomeRecents items={view.recents.items} onRemove={actions.removeRecent} />
              </div>
            )}
            {view.getStarted.length > 0 && <GetStarted steps={view.getStarted} />}
            <div className={styles.columns}>
              <div className={styles.column}>
                {!hiddenWidgets.includes('Activity') && (
                  <HomeActivityChart
                    title={WIDGET_LABELS.Activity}
                    state={activity}
                    days={view.activityDays}
                    onDaysChange={actions.setActivityDays}
                    onRetry={actions.retryActivity}
                  />
                )}
                <AttentionList
                  state={view.attention}
                  asOf={view.asOf}
                  onRetry={actions.retryAttention}
                />
                {!hiddenWidgets.includes('Workspaces') && (
                  <HomeWorkspaces
                    state={view.workspaces}
                    count={view.workspaceCount}
                    asOf={view.asOf}
                    onRetry={actions.retryWorkspaces}
                  />
                )}
              </div>
              <div className={styles.column}>
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
        </Surface>
      </div>
    </main>
  )
}
