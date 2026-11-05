'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import { isApiClientError } from '@/lib/api/client/errors'
import { useSession } from '@/lib/auth/client'
import { OAUTH_SEARCH_READ_SCOPE, oauthScopeSatisfies } from '@/lib/auth/oauth-provider'
import { addCalendarDays, getBrowserTimezone } from '@/lib/core/utils/timezone'
import {
  canReadMemberIntegrations,
  hasSearchIntegrationReady,
  memberIntegrationEntries,
} from '@/lib/credential-groups/member-integrations'
import { useOrganizationAccessRequests } from '@/hooks/queries/access-requests'
import { useAuthorizedApps } from '@/hooks/queries/oauth-provider'
import {
  useConnectOrganizationAccount,
  useDisconnectPersonalOrganizationAccount,
  useOrganizationAccounts,
  useReconnectPersonalOrganizationAccount,
} from '@/hooks/queries/organization-accounts'
import { useOrganizationActivitySummary } from '@/hooks/queries/organization-activity'
import {
  organizationHomeKeys,
  useOrganizationHomeCalendar,
  useOrganizationHomeEmail,
} from '@/hooks/queries/organization-home'
import { useRemoveSearchHistorySource, useSearchHistory } from '@/hooks/queries/search-history'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'
import type { HomeMode } from '@/platform/app/(shell)/_components/model'
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
import type { RecentItem } from '@/platform/design-system/components/recent-items/recent-items'
import {
  greetingAt,
  HOME_CALENDAR_SOURCES,
  HOME_EMAIL_SOURCES,
  type HomeConnection,
  homeDayParam,
  localDate,
  settleReadAccounts,
  toAttentionItems,
  toCalendarDay,
  toEmailItems,
  toHomeConnection,
  toReadAccounts,
  toRecentItems,
  toTaskPoints,
  wallClockMinute,
} from '@/platform/lib/data/home-model'
import { useOrganization } from '@/platform/lib/data/organization'
import { legacyRoutes, type PlatformOrganization } from '@/platform/lib/data/organization-model'
import { useLiveShellData } from '@/platform/lib/data/shell-context'
import { toast } from '@/platform/lib/data/toast'

const MINUTE_MS = 60_000
/** Long enough to fit the 7, 30 and 90 day chart windows in one read of daily buckets. */
const ACTIVITY_DAYS = 90
const REFUSAL_STATUSES: ReadonlySet<number> = new Set([401, 403, 404, 409])

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

function serverMinute() {
  return null
}

/** The viewer's clock, unknown while rendering on the server so markup never disagrees with it. */
function useMinuteClock(): number | null {
  return useSyncExternalStore(subscribeToMinutes, currentMinute, serverMinute)
}

/** An answer about the viewer, which retrying cannot change, unlike a failure or a rate limit. */
function isRefusal(error: unknown) {
  return isApiClientError(error) && REFUSAL_STATUSES.has(error.status)
}

function useHomeIntegrations(organization: PlatformOrganization) {
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
  const queryClient = useQueryClient()
  const connect = useConnectOrganizationAccount()
  const reconnect = useReconnectPersonalOrganizationAccount()
  const disconnect = useDisconnectPersonalOrganizationAccount()
  const refreshWidgets = () =>
    queryClient.invalidateQueries({ queryKey: organizationHomeKeys.organization(organizationId) })
  const reportFailure = (error: unknown) =>
    toast.error(getErrorMessage(error, 'The account could not be connected.'))
  const connecting = connect.isPending || reconnect.isPending
  return {
    connect: connecting
      ? undefined
      : (optionId) =>
          connect.mutate(
            { organizationId, optionId },
            { onError: reportFailure, onSettled: refreshWidgets }
          ),
    reconnect: connecting
      ? undefined
      : (credentialId) =>
          reconnect.mutate(credentialId, { onError: reportFailure, onSettled: refreshWidgets }),
    disconnect: async (credentialId) => {
      await disconnect.mutateAsync({ credentialId, organizationId })
      await refreshWidgets()
    },
    disconnectNotice:
      'Sim will stop reading this account everywhere it is used, including Integrations. You can reconnect anytime.',
  }
}

interface HomeWidgetRead<T> {
  state: HomeWidgetState<T>
  retry: () => void
}

function useHomeEmail(
  organizationId: string,
  connection: HomeConnection,
  retryConnection: () => void
): HomeWidgetRead<readonly EmailItem[]> {
  const read = useOrganizationHomeEmail(organizationId, {
    enabled: connection.status === 'connected',
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
    state: settled ?? {
      status: 'ready',
      data: toEmailItems(read.data),
      accounts: accounts.length ? accounts : connection.accounts,
    },
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
  clock: HomeClock | null,
  selectedDay: string | null,
  timeZone: string
): HomeWidgetRead<HomeCalendarDay> {
  const date = selectedDay ?? clock?.today ?? null
  const read = useOrganizationHomeCalendar(organizationId, date ?? '', timeZone, {
    enabled: connection.status === 'connected' && date !== null,
  })
  const retry = () => void read.refetch()
  if (connection.status !== 'connected') return { state: connection, retry: retryConnection }
  if (!date || !clock) return { state: { status: 'loading' }, retry }
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
  return ready(
    toCalendarDay(read.data, { date, nowMinute, timeZone }),
    accounts.length ? accounts : connection.accounts
  )
}

function useHomeActivity(
  organization: PlatformOrganization,
  today: string | null,
  timeZone: string
): { state: HomeActivityState; retry: () => void } {
  const allowed = organization.settingsSections.includes('usage')
  const summary = useOrganizationActivitySummary(
    organization.organization.id,
    {
      preset: 'custom',
      startDate: today ? addCalendarDays(today, 1 - ACTIVITY_DAYS) : undefined,
      endDate: today ?? undefined,
      timezone: timeZone,
    },
    { enabled: allowed && today !== null }
  )
  const retry = () => void summary.refetch()
  if (!allowed || (summary.error && isRefusal(summary.error)))
    return { state: { status: 'hidden' }, retry }
  if (summary.data)
    return { state: { status: 'ready', points: toTaskPoints(summary.data, timeZone) }, retry }
  return {
    state: summary.isError
      ? { status: 'error', retrying: summary.isFetching }
      : { status: 'loading' },
    retry,
  }
}

function useHomeRecents(organization: PlatformOrganization) {
  const { data: session } = useSession()
  const organizationId = organization.organization.id
  const allowed = organization.searchAccess.memberScoped
  const history = useSearchHistory(allowed ? organizationId : undefined)
  const remove = useRemoveSearchHistorySource(organizationId, session?.user?.id)
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
  organization: PlatformOrganization,
  integrations: ReturnType<typeof useHomeIntegrations>,
  reconnect: HomeWidgetActions['reconnect'],
  readAccounts: readonly HomeAccountView[]
): { state: HomeListState<AttentionItem>; retry: () => void } {
  const shell = useLiveShellData()
  const canReview = organization.viewer.isAdmin
  const requests = useOrganizationAccessRequests(canReview ? organization.organization.id : '')
  const items = toAttentionItems({
    entries: integrations.entries ?? [],
    readAccounts,
    chats: shell?.chats ?? [],
    requests: requests.data?.requests ?? [],
    reconnect,
  })
  const chats = shell?.status?.chats
  const failed =
    integrations.failure === 'failed' || chats === 'error' || (canReview && requests.isError)
  const pending =
    (integrations.allowed && !integrations.entries && !integrations.failure) ||
    chats === 'pending' ||
    (canReview && requests.isPending)
  const state: HomeListState<AttentionItem> =
    items.length === 0 && pending
      ? { status: 'loading' }
      : items.length === 0 && failed
        ? { status: 'error', retrying: integrations.retrying || requests.isFetching }
        : { status: 'ready', items, partial: failed }
  return {
    state,
    retry: () => {
      integrations.retry()
      if (canReview) void requests.refetch()
    },
  }
}

/** Legacy Get started, shown where the legacy surface showed it: the Search landing. */
function useHomeGetStarted(
  organization: PlatformOrganization,
  integrations: ReturnType<typeof useHomeIntegrations>,
  searchLanding: boolean
): HomeGetStartedStep[] {
  const { viewer, connectedAccountsAvailable, searchAccess } = organization
  const canUseSearchMcp = viewer.canUseSearchMcp && searchLanding
  const apps = useAuthorizedApps('', { enabled: canUseSearchMcp })
  const authorized =
    apps.data?.pages.some((page) =>
      page.apps.some((app) => oauthScopeSatisfies(app.scopes, OAUTH_SEARCH_READ_SCOPE))
    ) ?? false
  const { hasNextPage, isFetching, isError, fetchNextPage } = apps
  useEffect(() => {
    if (canUseSearchMcp && !authorized && hasNextPage && !isFetching && !isError)
      void fetchNextPage()
  }, [canUseSearchMcp, authorized, hasNextPage, isFetching, isError, fetchNextPage])

  if (!searchLanding || !searchAccess.memberScoped) return []
  const routes = legacyRoutes(organization)
  const steps: HomeGetStartedStep[] = []
  if (viewer.canConnectSearchIntegrations && connectedAccountsAvailable) {
    steps.push({
      id: 'connect-integration',
      title: 'Connect an integration',
      detail: 'Choose what Sim can search for you',
      href: viewer.isAdmin ? routes.settingsSection('integrations') : '/integrations',
      complete: hasSearchIntegrationReady(integrations.accounts.data, integrations.policies.data),
    })
  }
  if (viewer.canUseSearchMcp) {
    steps.push({
      id: 'connect-sim-search',
      title: 'Connect Sim Search MCP',
      detail: 'Use your company’s knowledge from your other AI tools',
      href: routes.settingsSection('search-mcp'),
      complete: authorized,
    })
  }
  return steps
}

function firstNameOf(user: { name: string; email?: string } | undefined) {
  return user?.name && user.name !== user.email ? user.name.split(/\s/u)[0] : undefined
}

/**
 * Home on live data: the view and actions fixture sessions fill from memory. Every widget reads the
 * same member inventory the Integrations page reads, so the two cannot disagree on what is offered.
 */
export function useLiveHome(homeMode: HomeMode): { view: HomeView; actions: HomeActions } {
  const organization = useOrganization()
  const shell = useLiveShellData()
  const organizationId = organization.organization.id
  const nowMs = useMinuteClock()
  const [timeZone] = useState(getBrowserTimezone)
  const [selectedDay, setSelectedDay] = useQueryState('day', homeDayParam)
  const today = nowMs === null ? null : localDate(new Date(nowMs), timeZone)
  const clock = nowMs === null || today === null ? null : { nowMs, today }

  const integrations = useHomeIntegrations(organization)
  const connectionFor = (sources: typeof HOME_EMAIL_SOURCES) =>
    toHomeConnection({ ...integrations, sources })
  const connectionActions = useConnectionActions(organizationId)
  const email = useHomeEmail(organizationId, connectionFor(HOME_EMAIL_SOURCES), integrations.retry)
  const calendar = useHomeCalendar(
    organizationId,
    connectionFor(HOME_CALENDAR_SOURCES),
    integrations.retry,
    clock,
    selectedDay,
    timeZone
  )
  const activity = useHomeActivity(organization, today, timeZone)
  const recents = useHomeRecents(organization)
  const attention = useHomeAttention(
    organization,
    integrations,
    connectionActions.reconnect,
    [email.state, calendar.state].flatMap((state) => ('accounts' in state ? state.accounts : []))
  )
  const getStarted = useHomeGetStarted(organization, integrations, homeMode === 'Search')

  const showDay = (day: string | null) =>
    void setSelectedDay(day === today ? null : day, { history: 'replace', scroll: false })

  return {
    view: {
      asOf: nowMs,
      greeting: greetingAt(nowMs, timeZone),
      firstName: firstNameOf(shell?.user),
      attention: attention.state,
      /** Search has no daily count anywhere to read, so its chart is hidden rather than estimated. */
      activity: { Build: activity.state, Search: { status: 'hidden' } },
      email: email.state,
      calendar: calendar.state,
      recents: recents.state,
      getStarted,
    },
    actions: {
      email: { ...connectionActions, retry: email.retry },
      calendar: { ...connectionActions, retry: calendar.retry },
      openEmail: (mail) => {
        if (mail.url) window.open(mail.url, '_blank', 'noopener,noreferrer')
      },
      changeDay: (delta) => {
        const base = selectedDay ?? today
        if (base) showDay(addCalendarDays(base, delta))
      },
      returnToToday: () => showDay(null),
      retryAttention: attention.retry,
      retryActivity: activity.retry,
      retryRecents: recents.retry,
      removeRecent: recents.remove,
    },
  }
}
