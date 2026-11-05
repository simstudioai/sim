'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import type { HomeWidget } from '@/platform/app/(shell)/_components/model'
import { usePlatformNotices } from '@/platform/app/(shell)/_components/notification-tray/notification-tray'
import {
  useInterfacePreferences,
  useRecentHistory,
} from '@/platform/app/(shell)/_components/session/interface-preferences'
import { HomeActivityChart } from '@/platform/app/(shell)/home/_components/activity-chart/activity-chart'
import {
  AttentionList,
  EmailList,
} from '@/platform/app/(shell)/home/_components/activity-list/activity-list'
import { CalendarDay } from '@/platform/app/(shell)/home/_components/calendar/calendar-day'
import { ConnectedWidget } from '@/platform/app/(shell)/home/_components/connected-widget/connected-widget'
import { HomeComposer } from '@/platform/app/(shell)/home/_components/home-composer/home-composer'
import styles from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard.module.css'
import type { HomeData } from '@/platform/app/(shell)/home/_components/model'
import { ActionMenu, RecentItems } from '@/platform/design-system/components'
import type { RecentItem } from '@/platform/design-system/components/recent-items/recent-items'
import { platformHref } from '@/platform/design-system/navigation'

const WIDGETS: readonly HomeWidget[] = ['Activity', 'Email', 'Calendar']
const ACTIVITY_METRICS = {
  Build: { field: 'tasks', title: 'Tasks run' },
  Search: { field: 'searches', title: 'Searches' },
} as const

interface HomeDashboardProps {
  data: HomeData | null
  recentLinks: readonly RecentItem[]
}

export function HomeDashboard({ data, recentLinks }: HomeDashboardProps) {
  const router = useRouter()
  const search = useSearchParams()
  const preferences = useInterfacePreferences()
  const { recents, removeRecent } = useRecentHistory(recentLinks)
  const { notify, dismiss } = usePlatformNotices()
  if (!preferences) throw new Error('Home needs interface preferences')
  const {
    hiddenWidgets,
    setHiddenWidgets,
    profileName,
    homeMode,
    setHomeMode,
    connections,
    setConnections,
  } = preferences
  const firstName = profileName?.split(/\s/u)[0] || data?.firstName
  const metric = ACTIVITY_METRICS[homeMode]
  const widgetLabel = (widget: HomeWidget) => (widget === 'Activity' ? metric.title : widget)
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
  const goHome = () => router.push(platformHref('/home', search))
  function connectedWidget(widget: 'Email' | 'Calendar') {
    if (hiddenWidgets.includes(widget)) return null
    return (
      <ConnectedWidget
        title={widget}
        address={data?.address}
        connected={Boolean(data && (connections[widget] ?? data.connected))}
        onConnectionChange={
          data
            ? (value) => setConnections((current) => ({ ...current, [widget]: value }))
            : undefined
        }
        onHide={() => setVisible(widget, false)}
      >
        {widget === 'Email' ? (
          <EmailList data={data} onOpen={goHome} />
        ) : data ? (
          <CalendarDay calendar={data.calendar} />
        ) : null}
      </ConnectedWidget>
    )
  }
  return (
    <div className={styles.dashboard}>
      <header className={styles.greeting}>
        <div>
          <h1 data-type='T076'>{firstName ? `Good morning, ${firstName}` : 'Good morning'}</h1>
          <p data-type='T048'>Your company’s knowledge and work, connected by Sim.</p>
        </div>
        <ActionMenu
          label='Customize Home'
          heading='Customize Home'
          icon='I108'
          align='end'
          actions={WIDGETS.map((widget) => ({
            id: widget,
            label: widgetLabel(widget),
            checked: !hiddenWidgets.includes(widget),
            onSelect: () => setVisible(widget, hiddenWidgets.includes(widget)),
          }))}
        />
      </header>
      <HomeComposer mode={homeMode} onModeChange={setHomeMode} references={data?.references} />
      {recents.length > 0 && (
        <div className={styles.recents}>
          <RecentItems label='Recents' items={recents} onRemove={removeRecent} />
        </div>
      )}
      <div className={styles.columns}>
        <div className={styles.column}>
          <HomeActivityChart
            title={metric.title}
            points={data?.activity.map((day) => ({ date: day.date, value: day[metric.field] }))}
            hidden={hiddenWidgets.includes('Activity')}
          />
          {connectedWidget('Email')}
        </div>
        <div className={styles.column}>
          <AttentionList data={data} />
          {connectedWidget('Calendar')}
        </div>
      </div>
    </div>
  )
}
