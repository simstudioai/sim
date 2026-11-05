'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import type { HomeWidget } from '@/platform/app/(shell)/_components/model'
import { usePlatformNotices } from '@/platform/app/(shell)/_components/notification-tray/notification-tray'
import { useInterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import {
  AttentionList,
  EmailList,
} from '@/platform/app/(shell)/home/_components/activity-list/activity-list'
import { CalendarDay } from '@/platform/app/(shell)/home/_components/calendar/calendar-day'
import { ConnectedWidget } from '@/platform/app/(shell)/home/_components/connected-widget/connected-widget'
import { HomeComposer } from '@/platform/app/(shell)/home/_components/home-composer/home-composer'
import styles from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard.module.css'
import type { HomeData } from '@/platform/app/(shell)/home/_components/model'
import { TasksRunChart } from '@/platform/app/(shell)/home/_components/tasks-chart/tasks-chart'
import { ActionMenu, ScrollArea } from '@/platform/design-system/components'
import { platformHref } from '@/platform/design-system/navigation'

const WIDGETS: readonly HomeWidget[] = ['Tasks run', 'Email', 'Calendar']

interface HomeDashboardProps {
  data: HomeData | null
}

export function HomeDashboard({ data }: HomeDashboardProps) {
  const router = useRouter()
  const search = useSearchParams()
  const preferences = useInterfacePreferences()
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
  const personal = (['Email', 'Calendar'] as const).filter(
    (widget) => !hiddenWidgets.includes(widget)
  )
  function setVisible(widget: HomeWidget, visible: boolean) {
    const reveal = () => setHiddenWidgets((current) => current.filter((item) => item !== widget))
    const id = `hide-${widget}`
    if (visible) {
      reveal()
      dismiss(id)
    } else {
      setHiddenWidgets((current) => (current.includes(widget) ? current : [...current, widget]))
      notify({ id, title: `${widget} hidden`, icon: 'I072', action: 'Undo', onAction: reveal })
    }
  }
  const goHome = () => router.push(platformHref('/home', search))
  const attention = <AttentionList rows={data?.attention ?? []} onOpen={goHome} />
  return (
    <div className={styles.viewport}>
      <ScrollArea label='Home dashboard'>
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
              actions={WIDGETS.map((label) => ({
                id: label,
                label,
                checked: !hiddenWidgets.includes(label),
                onSelect: () => setVisible(label, hiddenWidgets.includes(label)),
              }))}
            />
          </header>
          <HomeComposer mode={homeMode} onModeChange={setHomeMode} references={data?.references} />
          <div className={styles.columns}>
            <div className={styles.column}>
              {!hiddenWidgets.includes('Tasks run') && (
                <TasksRunChart title='Tasks run' ranges={data?.ranges ?? []} />
              )}
              {personal.length > 0 && attention}
            </div>
            <div className={styles.column}>
              {personal.length
                ? personal.map((widget) => (
                    <ConnectedWidget
                      key={widget}
                      title={widget}
                      address={data?.address}
                      connected={connections[widget] ?? data?.connected ?? false}
                      onConnectionChange={(value) =>
                        setConnections((current) => ({ ...current, [widget]: value }))
                      }
                      onHide={() => setVisible(widget, false)}
                    >
                      {widget === 'Calendar' ? (
                        <CalendarDay calendar={data?.calendar} />
                      ) : (
                        <EmailList messages={data?.email ?? []} onOpen={goHome} />
                      )}
                    </ConnectedWidget>
                  ))
                : attention}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
