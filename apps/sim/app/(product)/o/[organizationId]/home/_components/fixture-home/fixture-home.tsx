'use client'

import { useState } from 'react'
import type { RecentItem } from '@sim/emcn-platform/recent-items'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  useInterfacePreferences,
  useRecentHistory,
} from '@/app/(product)/_components/session/interface-preferences'
import { ZoneHomeDashboard } from '@/app/(product)/o/[organizationId]/home/_components/home-dashboard/zone-home-dashboard'
import type { EmailItem, HomeActions, HomeData, HomeView } from '@/platform/lib/data/models/home'
import type { ShellWorkspace } from '@/platform/lib/data/models/shell'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { platformHref } from '@/platform/lib/navigation'
import { useSurfaceScope } from '@/platform/lib/surface-scope'
import { workspaceHomePath } from '@/platform/lib/workspace-navigation'
import type {
  HomeCalendarDay,
  HomeConnectOption,
  HomeWidgetActions,
  HomeWidgetState,
} from '@/platform/shared/home'

const NO_ACTIVITY = { status: 'ready', points: [] } as const

const CONNECT_OPTIONS = {
  Email: [
    { id: 'Gmail', label: 'Gmail', icon: 'I005' },
    { id: 'Microsoft 365', label: 'Microsoft 365', icon: 'I085' },
  ],
  Calendar: [
    { id: 'Google Calendar', label: 'Google Calendar', icon: 'I088' },
    { id: 'Outlook', label: 'Outlook', icon: 'I120' },
  ],
} as const satisfies Record<string, readonly HomeConnectOption[]>

function sessionWidget<T>(
  widget: keyof typeof CONNECT_OPTIONS,
  connected: boolean,
  address: string | undefined,
  data: T
): HomeWidgetState<T> {
  return connected
    ? {
        status: 'ready',
        data,
        accounts: [{ id: 'session', label: address ?? '', canReconnect: false }],
      }
    : { status: 'not_connected', options: CONNECT_OPTIONS[widget] }
}

function calendarForOffset(data: HomeData, dayOffset: number): HomeCalendarDay {
  const date = new Date(`${data.calendar.date}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + dayOffset)
  return {
    date: date.toISOString().slice(0, 10),
    nowMinute: dayOffset === 0 ? data.calendar.nowMinute : null,
    status: 'ready',
    meetings: dayOffset === 0 ? data.calendar.meetings : [],
    allDay: [],
  }
}

function metricPoints(data: HomeData | null, field: 'tasks' | 'searches') {
  return data?.activity.map((day) => ({ date: day.date, value: day[field] }))
}

interface FixtureHomeProps {
  data: HomeData | null
  recentLinks: readonly RecentItem[]
  /** The sidebar's example workspaces, which Home's Workspaces lists without claiming any activity. */
  workspaces: readonly ShellWorkspace[]
}

/** The session implementation of Home's view: edits last as long as the product session. */
export function FixtureHome({ data, recentLinks, workspaces }: FixtureHomeProps) {
  const router = useRouter()
  const search = useSearchParams()
  const scope = useSurfaceScope()
  const preferences = useInterfacePreferences()
  const { recents, removeRecent } = useRecentHistory(recentLinks)
  const [dayOffset, setDayOffset] = useState(0)
  if (!preferences) throw new Error('Home needs interface preferences')
  const { connections, setConnections, hiddenWidgets, setHiddenWidgets } = preferences
  const widgetActions = (widget: keyof typeof CONNECT_OPTIONS): HomeWidgetActions => ({
    connect: data ? () => setConnections((current) => ({ ...current, [widget]: true })) : undefined,
    disconnect: () => setConnections((current) => ({ ...current, [widget]: false })),
    retry: () => {},
  })
  const connected = (widget: keyof typeof CONNECT_OPTIONS) =>
    Boolean(data && (connections[widget] ?? data.connected))
  const view: HomeView = {
    asOf: data?.asOf ?? 0,
    greeting: 'Good morning',
    firstName: data?.firstName,
    attention: { status: 'ready', items: data?.attention ?? [] },
    activity: {
      Build: data ? { status: 'ready', points: metricPoints(data, 'tasks') ?? [] } : NO_ACTIVITY,
      Search: data
        ? { status: 'ready', points: metricPoints(data, 'searches') ?? [] }
        : NO_ACTIVITY,
    },
    email: sessionWidget<readonly EmailItem[]>(
      'Email',
      connected('Email'),
      data?.address,
      data?.email ?? []
    ),
    calendar: data
      ? sessionWidget(
          'Calendar',
          connected('Calendar'),
          data.address,
          calendarForOffset(data, dayOffset)
        )
      : { status: 'not_connected', options: CONNECT_OPTIONS.Calendar },
    workspaces: {
      status: 'ready',
      items: workspaces.map(({ id, name }) => ({
        id,
        name,
        href: platformHref(workspaceHomePath(id, 'fixture'), search),
      })),
    },
    recents: { status: 'ready', items: recents },
    getStarted: [],
    composerInventory: data?.composerInventory,
  }
  const actions: HomeActions = {
    email: widgetActions('Email'),
    calendar: widgetActions('Calendar'),
    openEmail: () => router.push(platformHref(surfaceHref(scope, '/home'), search)),
    changeDay: (delta) => setDayOffset((offset) => offset + delta),
    returnToToday: () => setDayOffset(0),
    retryAttention: () => {},
    retryActivity: () => {},
    retryWorkspaces: () => {},
    retryRecents: () => {},
    removeRecent,
  }
  return (
    <ZoneHomeDashboard
      view={view}
      actions={actions}
      hiddenWidgets={hiddenWidgets}
      onWidgetHiddenChange={(widget, hidden) =>
        setHiddenWidgets((current) =>
          hidden
            ? current.includes(widget)
              ? current
              : [...current, widget]
            : current.filter((item) => item !== widget)
        )
      }
    />
  )
}
