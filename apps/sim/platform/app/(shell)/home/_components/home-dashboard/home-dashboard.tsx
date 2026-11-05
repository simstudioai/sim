'use client'

import type { HomeWidget } from '@/platform/app/(shell)/_components/model'
import { usePlatformNotices } from '@/platform/app/(shell)/_components/notification-tray/notification-tray'
import { useInterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import { HomeActivityChart } from '@/platform/app/(shell)/home/_components/activity-chart/activity-chart'
import {
  AttentionList,
  EmailList,
} from '@/platform/app/(shell)/home/_components/activity-list/activity-list'
import { CalendarDay } from '@/platform/app/(shell)/home/_components/calendar/calendar-day'
import { ConnectedWidget } from '@/platform/app/(shell)/home/_components/connected-widget/connected-widget'
import { GetStarted } from '@/platform/app/(shell)/home/_components/get-started/get-started'
import { HomeComposer } from '@/platform/app/(shell)/home/_components/home-composer/home-composer'
import styles from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard.module.css'
import type { HomeActions, HomeView } from '@/platform/app/(shell)/home/_components/model'
import { SkeletonLane } from '@/platform/app/(shell)/home/_components/widget-skeleton/widget-skeleton'
import { ActionMenu, Button, InlineNotice, RecentItems } from '@/platform/design-system/components'

const WIDGETS: readonly HomeWidget[] = ['Activity', 'Email', 'Calendar']
const ACTIVITY_METRIC_TITLES = { Build: 'Tasks run', Search: 'Searches' } as const

interface HomeDashboardProps {
  view: HomeView
  actions: HomeActions
}

export function HomeDashboard({ view, actions }: HomeDashboardProps) {
  const preferences = useInterfacePreferences()
  const { notify, dismiss } = usePlatformNotices()
  if (!preferences) throw new Error('Home needs interface preferences')
  const { hiddenWidgets, setHiddenWidgets, profileName, homeMode, setHomeMode } = preferences
  const firstName = profileName?.split(/\s/u)[0] || view.firstName
  const metricTitle = ACTIVITY_METRIC_TITLES[homeMode]
  const activity = view.activity[homeMode]
  const widgetLabel = (widget: HomeWidget) => (widget === 'Activity' ? metricTitle : widget)
  const customizable = WIDGETS.filter(
    (widget) => widget !== 'Activity' || activity.status !== 'hidden'
  )
  function setVisible(widget: HomeWidget, visible: boolean) {
    const reveal = () => setHiddenWidgets((current) => current.filter((item) => item !== widget))
    const id = `hide-${widget}`
    if (visible) {
      reveal()
      dismiss(id)
    } else {
      setHiddenWidgets((current) => (current.includes(widget) ? current : [...current, widget]))
      notify({
        id,
        title: `${widgetLabel(widget)} hidden`,
        icon: 'I072',
        action: 'Undo',
        onAction: reveal,
      })
    }
  }
  return (
    <div className={styles.dashboard}>
      <header className={styles.greeting}>
        <div>
          <h1 data-type='T076'>{firstName ? `${view.greeting}, ${firstName}` : view.greeting}</h1>
          <p data-type='T048'>Your company’s knowledge and work, connected by Sim.</p>
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
      <HomeComposer mode={homeMode} onModeChange={setHomeMode} references={view.references} />
      {view.recents.status === 'loading' && <SkeletonLane label='Loading recents' />}
      {view.recents.status === 'error' && (
        <InlineNotice
          intent='warning'
          message='Recents could not load.'
          action={
            <Button size='compact' disabled={view.recents.retrying} onClick={actions.retryRecents}>
              Try again
            </Button>
          }
        />
      )}
      {view.recents.status === 'ready' && view.recents.items.length > 0 && (
        <div className={styles.recents}>
          <RecentItems label='Recents' items={view.recents.items} onRemove={actions.removeRecent} />
        </div>
      )}
      {homeMode === 'Search' && view.getStarted.length > 0 && (
        <GetStarted steps={view.getStarted} />
      )}
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
              {(items) => <EmailList items={items} asOf={view.asOf} onOpen={actions.openEmail} />}
            </ConnectedWidget>
          )}
        </div>
        <div className={styles.column}>
          <AttentionList state={view.attention} asOf={view.asOf} onRetry={actions.retryAttention} />
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
  )
}
