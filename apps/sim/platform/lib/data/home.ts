'use client'

import { useState, useSyncExternalStore } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import {
  isOrganizationSettingsSectionAvailable,
  resolveOrganizationSectionAccess,
} from '@/components/settings/navigation'
import { isApiClientError } from '@/lib/api/client/errors'
import { useSession } from '@/lib/auth/client'
import { addCalendarDays, getBrowserTimezone } from '@/lib/core/utils/timezone'
import {
  canReadMemberIntegrations,
  memberIntegrationEntries,
} from '@/lib/credential-groups/member-integrations'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import {
  type GetStartedStepId,
  useGetStartedSteps,
} from '@/app/o/[organizationId]/home/components/get-started/use-get-started-steps'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { useOrganizationAccessRequests } from '@/hooks/queries/access-requests'
import { useOrganizationMothershipChats } from '@/hooks/queries/mothership-chats'
import { useOrganizationAccounts } from '@/hooks/queries/organization-accounts'
import { useOrganizationActivitySummary } from '@/hooks/queries/organization-activity'
import {
  useOrganizationHomeCalendar,
  useOrganizationHomeEmail,
} from '@/hooks/queries/organization-home'
import { useRemoveSearchHistorySource, useSearchHistory } from '@/hooks/queries/search-history'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'
import type {
  AttentionItem,
  EmailItem,
  HomeAccountView,
  HomeActions,
  HomeActivityState,
  HomeCalendarDay,
  HomeGetStartedStep,
  HomeListState,
  HomeView,
  HomeWidgetActions,
  HomeWidgetState,
} from '@/platform/app/(shell)/home/_components/model'
import { homeDayParam } from '@/platform/app/(shell)/home/search-params'
import type { RecentItem } from '@/platform/design-system/components/recent-items/recent-items'
import { organizationChatHref } from '@/platform/lib/data/chat-list'
import {
  greetingAt,
  HOME_CALENDAR_SOURCES,
  HOME_EMAIL_SOURCES,
  type HomeConnection,
  localDate,
  settleReadAccounts,
  toAttentionItems,
  toCalendarDay,
  toEmailItems,
  toHomeConnection,
  toReadAccounts,
  toReadableProviders,
  toRecentItems,
  toTaskPoints,
  wallClockMinute,
} from '@/platform/lib/data/home-model'
import { useIntegrationActions } from '@/platform/lib/data/integrations'
import { MINUTE_MS } from '@/platform/lib/time'
import {
  type OrganizationHomeWidget,
  useOrganizationHomeStore,
} from '@/stores/organization-home/store'

/** Long enough to fit the 7, 30 and 90 day chart windows in one read of daily buckets. */
const ACTIVITY_DAYS = 90
const REFUSAL_STATUSES: ReadonlySet<number> = new Set([401, 403, 404, 409])
const NO_WIDGETS: readonly OrganizationHomeWidget[] = []

function subscribeToMinutes(onChange: () => void) {
  const interval = setInterval(onChange, MINUTE_MS)
  window.addEventListener('focus', onChange)
  return () => {
    clearInterval(interval)
    window.removeEventListener('focus', onChange)
  }
}

function currentMinute() {
  return Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS
}

/** Home mounts only after hydration, behind the conversation's own gate, so no markup can disagree. */
function useMinuteClock(): number {
  return useSyncExternalStore(subscribeToMinutes, currentMinute, currentMinute)
}

/** An answer about the viewer, which retrying cannot change, unlike a failure or a rate limit. */
function isRefusal(error: unknown) {
  return isApiClientError(error) && REFUSAL_STATUSES.has(error.status)
}

function useHomeIntegrations(organization: OrganizationSurfaceContext) {
  const organizationId = organization.organization.id
  const allowed = canReadMemberIntegrations(organization)
  const accounts = useOrganizationAccounts(allowed ? organizationId : undefined)
  const policies = useSearchIntegrations(organizationId, { enabled: allowed })
  const entries =
    accounts.data && policies.data
      ? memberIntegrationEntries(accounts.data, policies.data)
      : undefined
  const error = accounts.error ?? policies.error
  const failure = !error
    ? undefined
    : isRefusal(error)
      ? ('refused' as const)
      : entries
        ? undefined
        : ('failed' as const)
  return {
    allowed,
    accounts,
    policies,
    entries,
    readableProviders: toReadableProviders(
      accounts.data?.assistantProviders ?? [],
      policies.data ?? []
    ),
    failure,
    retrying: accounts.isFetching || policies.isFetching,
    retry: () => {
      if (!allowed) return
      void accounts.refetch()
      void policies.refetch()
    },
  }
}

function useConnectionActions(organizationId: string): Omit<HomeWidgetActions, 'retry'> {
  const { connecting, connect, reconnect, disconnect } = useIntegrationActions(organizationId)
  return {
    connect: connecting ? undefined : (optionId) => connect({ optionId }),
    reconnect: connecting ? undefined : reconnect,
    disconnect: async (credentialId) => {
      await disconnect(credentialId)
    },
  }
}

interface HomeWidgetRead<T> {
  state: HomeWidgetState<T>
  retry: () => void
}

function useHomeEmail(
  organizationId: string,
  connection: HomeConnection,
  retryConnection: () => void,
  hidden: boolean
): HomeWidgetRead<readonly EmailItem[]> {
  const read = useOrganizationHomeEmail(organizationId, {
    enabled: connection.status === 'connected' && !hidden,
  })
  const retry = () => void read.refetch()
  if (connection.status !== 'connected') return { state: connection, retry: retryConnection }
  if (!read.data) {
    return {
      state: read.isError ? { status: 'error', retrying: read.isFetching } : { status: 'loading' },
      retry,
    }
  }
  const accounts = toReadAccounts(read.data.accounts, connection.accounts)
  const settled = settleReadAccounts(accounts)
  if (settled?.status === 'error')
    return { state: { status: 'error', retrying: read.isFetching }, retry }
  return {
    state: settled ?? { status: 'ready', data: toEmailItems(read.data), accounts },
    retry,
  }
}

interface HomeClock {
  nowMs: number
  today: string
}

function useHomeCalendar(
  organizationId: string,
  connection: HomeConnection,
  retryConnection: () => void,
  clock: HomeClock,
  selectedDay: string | null,
  timeZone: string,
  hidden: boolean
): HomeWidgetRead<HomeCalendarDay> {
  const date = selectedDay ?? clock.today
  const read = useOrganizationHomeCalendar(organizationId, date, timeZone, {
    enabled: connection.status === 'connected' && !hidden,
  })
  const retry = () => void read.refetch()
  if (connection.status !== 'connected') return { state: connection, retry: retryConnection }
  const nowMinute = date === clock.today ? wallClockMinute(clock.nowMs, timeZone) : null
  const ready = (day: HomeCalendarDay, accounts: readonly HomeAccountView[]) => ({
    state: { status: 'ready' as const, data: day, accounts },
    retry,
  })
  const withoutData = (status: HomeCalendarDay['status'], accounts = connection.accounts) =>
    ready({ date, nowMinute, status, meetings: [], allDay: [] }, accounts)
  if (!read.data) return withoutData(read.isError ? 'error' : 'loading')
  const accounts = toReadAccounts(read.data.accounts, connection.accounts)
  const settled = settleReadAccounts(accounts)
  if (settled?.status === 'error') return withoutData('error', accounts)
  if (settled) return { state: settled, retry }
  return ready(toCalendarDay(read.data, { date, nowMinute, timeZone }), accounts)
}

/** Tasks run, behind the same gates as the settings section that shows them. */
function useHomeActivity(
  organization: OrganizationSurfaceContext,
  today: string,
  timeZone: string,
  hidden: boolean
): { state: HomeActivityState; retry: () => void } {
  const allowed =
    resolveOrganizationSectionAccess({
      section: 'usage',
      isTargetOrganizationMember: true,
      isTargetOrganizationAdmin: organization.viewer.isAdmin,
    }) !== 'unavailable' &&
    isOrganizationSettingsSectionAvailable('usage', organization.settingsFeatures)
  const summary = useOrganizationActivitySummary(
    organization.organization.id,
    {
      preset: 'custom',
      startDate: addCalendarDays(today, 1 - ACTIVITY_DAYS),
      endDate: today,
      timezone: timeZone,
    },
    { enabled: allowed && !hidden }
  )
  const retry = () => void summary.refetch()
  if (!allowed || (summary.error && isRefusal(summary.error)))
    return { state: { status: 'hidden' }, retry }
  if (summary.data) return { state: { status: 'ready', points: toTaskPoints(summary.data) }, retry }
  return {
    state: summary.isError
      ? { status: 'error', retrying: summary.isFetching }
      : { status: 'loading' },
    retry,
  }
}

function useHomeRecents(organization: OrganizationSurfaceContext, userId: string | undefined) {
  const organizationId = organization.organization.id
  const allowed = organization.searchAccess.memberScoped
  const history = useSearchHistory(allowed ? organizationId : undefined)
  const remove = useRemoveSearchHistorySource(organizationId, userId)
  const state: HomeListState<RecentItem> = !allowed
    ? { status: 'ready', items: [] }
    : history.data
      ? { status: 'ready', items: toRecentItems(history.data) }
      : history.isError
        ? { status: 'error', retrying: history.isFetching }
        : { status: 'loading' }
  return {
    state,
    retry: () => void history.refetch(),
    remove: (url: string) =>
      remove.mutate(url, {
        onError: (error) =>
          toast.error(getErrorMessage(error, 'That recent could not be removed.')),
      }),
  }
}

function useHomeAttention(
  organization: OrganizationSurfaceContext,
  integrations: ReturnType<typeof useHomeIntegrations>,
  reconnect: HomeWidgetActions['reconnect'],
  readAccounts: readonly HomeAccountView[]
): { state: HomeListState<AttentionItem>; retry: () => void } {
  const organizationId = organization.organization.id
  const routes = organizationRoutes(organizationId)
  const canReview = organization.viewer.isAdmin
  const chats = useOrganizationMothershipChats(organizationId)
  const requests = useOrganizationAccessRequests(canReview ? organizationId : '')
  const reviewFailed = canReview && requests.isError && !isRefusal(requests.error)
  const items = toAttentionItems({
    entries: integrations.entries ?? [],
    readAccounts,
    chats: (chats.data ?? []).map((chat) => ({
      id: chat.id,
      title: chat.name,
      href: organizationChatHref(chat, routes),
      isUnread: chat.isUnread,
      updatedAt: chat.updatedAt.getTime(),
    })),
    requests: requests.data?.requests ?? [],
    reconnect,
    requestsHref: routes.settingsSection('requests'),
  })
  const failed = integrations.failure === 'failed' || chats.isError || reviewFailed
  const pending =
    (integrations.allowed && !integrations.entries && !integrations.failure) ||
    chats.isPending ||
    (canReview && requests.isPending)
  const state: HomeListState<AttentionItem> =
    items.length === 0 && pending
      ? { status: 'loading' }
      : items.length === 0 && failed
        ? {
            status: 'error',
            retrying: integrations.retrying || chats.isFetching || requests.isFetching,
          }
        : { status: 'ready', items, partial: failed }
  return {
    state,
    retry: () => {
      integrations.retry()
      void chats.refetch()
      if (canReview) void requests.refetch()
    },
  }
}

const GET_STARTED_DETAILS: Record<GetStartedStepId, string> = {
  'connect-integration': 'Choose what Sim can search for you',
  'connect-sim-search': 'Use your company’s knowledge from your other AI tools',
}

/** Search-only members start here, so their onboarding comes with the Assistant composer. */
function useHomeGetStarted(
  organization: OrganizationSurfaceContext,
  assistant: boolean
): HomeGetStartedStep[] {
  const steps = useGetStartedSteps(assistant && organization.searchAccess.memberScoped)
  return steps.map(({ id, label, href, complete }) => ({
    id,
    title: label,
    detail: GET_STARTED_DETAILS[id],
    href,
    complete,
  }))
}

function firstNameOf(user: { name?: string | null; email?: string | null } | null | undefined) {
  return user?.name && user.name !== user.email ? user.name.split(/\s/u)[0] : undefined
}

/**
 * Home's view and actions. Every widget reads the same member inventory the Integrations page reads,
 * so the two cannot disagree on what is offered. `assistant` is whether the viewer searches rather
 * than builds here, which decides whether Get started is theirs.
 */
export function useLiveHome(assistant: boolean): { view: HomeView; actions: HomeActions } {
  const organization = useOrganizationContext()
  const { data: session } = useSession()
  const organizationId = organization.organization.id
  const viewer = `${session?.user?.id}:${organizationId}`
  const hiddenWidgets = useOrganizationHomeStore(
    (state) => state.hiddenWidgets[viewer] ?? NO_WIDGETS
  )
  const setWidgetHidden = useOrganizationHomeStore((state) => state.setWidgetHidden)
  const nowMs = useMinuteClock()
  const [timeZone] = useState(getBrowserTimezone)
  const [selectedDay, setSelectedDay] = useQueryState(homeDayParam.key, homeDayParam.parser)
  const today = localDate(new Date(nowMs), timeZone)
  const clock = { nowMs, today }

  const integrations = useHomeIntegrations(organization)
  const connectionFor = (sources: typeof HOME_EMAIL_SOURCES) =>
    toHomeConnection({ ...integrations, sources })
  const connectionActions = useConnectionActions(organizationId)
  const email = useHomeEmail(
    organizationId,
    connectionFor(HOME_EMAIL_SOURCES),
    integrations.retry,
    hiddenWidgets.includes('Email')
  )
  const calendar = useHomeCalendar(
    organizationId,
    connectionFor(HOME_CALENDAR_SOURCES),
    integrations.retry,
    clock,
    selectedDay,
    timeZone,
    hiddenWidgets.includes('Calendar')
  )
  const activity = useHomeActivity(
    organization,
    today,
    timeZone,
    hiddenWidgets.includes('Activity')
  )
  const recents = useHomeRecents(organization, session?.user?.id)
  const attention = useHomeAttention(
    organization,
    integrations,
    connectionActions.reconnect,
    [email.state, calendar.state].flatMap((state) => ('accounts' in state ? state.accounts : []))
  )
  const getStarted = useHomeGetStarted(organization, assistant)

  const showDay = (day: string | null) =>
    void setSelectedDay(day === today ? null : day, { history: 'replace', scroll: false })

  return {
    view: {
      asOf: nowMs,
      greeting: greetingAt(nowMs, timeZone),
      firstName: firstNameOf(session?.user),
      attention: attention.state,
      activity: activity.state,
      email: email.state,
      calendar: calendar.state,
      recents: recents.state,
      getStarted,
      hiddenWidgets,
    },
    actions: {
      email: { ...connectionActions, retry: email.retry },
      calendar: { ...connectionActions, retry: calendar.retry },
      openEmail: (mail) => {
        window.open(mail.url, '_blank', 'noopener,noreferrer')
      },
      changeDay: (delta) => {
        showDay(addCalendarDays(selectedDay ?? today, delta))
      },
      returnToToday: () => showDay(null),
      retryAttention: attention.retry,
      retryActivity: activity.retry,
      retryRecents: recents.retry,
      removeRecent: recents.remove,
      setWidgetHidden: (widget, hidden) => setWidgetHidden(viewer, widget, hidden),
    },
  }
}
