'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { useSession } from '@/lib/auth/client'
import { OAUTH_SEARCH_READ_SCOPE, oauthScopeSatisfies } from '@/lib/auth/oauth-provider'
import { getBrowserTimezone } from '@/lib/core/utils/timezone'
import { memberIntegrationEntries } from '@/lib/credential-groups/member-integrations'
import {
  liveSearchProviderForCredential,
  supportsLiveSearchMode,
} from '@/lib/sim-search/live/provider-catalog'
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
  HomeActions,
  HomeActivityState,
  HomeCalendarDay,
  HomeGetStartedStep,
  HomeListState,
  HomeView,
  HomeWidgetActions,
  HomeWidgetState,
} from '@/platform/app/(shell)/home/_components/model'
import {
  addDays,
  canReadHomeIntegrations,
  greetingAt,
  HOME_CALENDAR_SOURCES,
  HOME_EMAIL_SOURCES,
  localDate,
  minuteOfToday,
  settleReadAccounts,
  toCalendarDay,
  toEmailItems,
  toHomeConnection,
  toReadAccounts,
  toRecentItems,
  toTaskPoints,
} from '@/platform/lib/data/home-model'
import { useOrganization } from '@/platform/lib/data/organization'
import { legacyRoutes, type PlatformOrganization } from '@/platform/lib/data/organization-model'
import { useLiveShellData } from '@/platform/lib/data/shell-context'
import { toast } from '@/platform/lib/data/toast'

const MINUTE_MS = 60_000
/** Long enough to fit the 7, 30 and 90 day chart windows in one read of daily buckets. */
const ACTIVITY_DAYS = 90

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

/** A refusal is an answer about the viewer, not a failure that retrying could change. */
function isRefusal(error: unknown) {
  return isApiClientError(error) && error.status < 500
}

function useHomeIntegrations(organization: PlatformOrganization) {
  const organizationId = organization.organization.id
  const allowed = canReadHomeIntegrations(organization)
  const accounts = useOrganizationAccounts(allowed ? organizationId : undefined)
  const policies = useSearchIntegrations(organizationId, { enabled: allowed })
  const entries = useMemo(
    () =>
      accounts.data && policies.data
        ? memberIntegrationEntries(accounts.data, policies.data)
        : undefined,
    [accounts.data, policies.data]
  )
  const error = accounts.error ?? policies.error
  return {
    allowed,
    accounts,
    policies,
    entries,
    failure: !error ? undefined : isRefusal(error) ? ('refused' as const) : ('failed' as const),
    retrying: accounts.isFetching || policies.isFetching,
    retry: () => {
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

function useHomeEmail(
  organizationId: string,
  connection: ReturnType<typeof toHomeConnection>
): { state: HomeWidgetState<readonly EmailItem[]>; retry: () => void } {
  const read = useOrganizationHomeEmail(organizationId, {
    enabled: connection.status === 'connected',
  })
  const retry = () => void read.refetch()
  if (connection.status !== 'connected') return { state: connection, retry }
  if (read.isError) return { state: { status: 'error', retrying: read.isFetching }, retry }
  if (!read.data) return { state: { status: 'loading' }, retry }
  const accounts = toReadAccounts(read.data.accounts, connection.accounts)
  const settled = settleReadAccounts(accounts)
  if (settled?.status === 'error')
    return { state: { ...settled, retrying: read.isFetching }, retry }
  return {
    state: settled ?? {
      status: 'ready',
      data: toEmailItems(read.data),
      accounts: accounts.length ? accounts : connection.accounts,
    },
    retry,
  }
}

function useHomeCalendar(
  organizationId: string,
  connection: ReturnType<typeof toHomeConnection>,
  nowMs: number | null,
  timeZone: string,
  dayOffset: number
): { state: HomeWidgetState<HomeCalendarDay>; retry: () => void } {
  const today = nowMs === null ? null : localDate(new Date(nowMs), timeZone)
  const date = today && addDays(today, dayOffset)
  const read = useOrganizationHomeCalendar(organizationId, date ?? '', timeZone, {
    enabled: connection.status === 'connected' && date !== null,
  })
  const retry = () => void read.refetch()
  if (connection.status !== 'connected') return { state: connection, retry }
  if (!date || nowMs === null) return { state: { status: 'loading' }, retry }
  const nowMinute = dayOffset === 0 ? minuteOfToday(nowMs, timeZone) : null
  const pendingDay = (status: HomeCalendarDay['status']): HomeCalendarDay => ({
    date,
    nowMinute,
    status,
    meetings: [],
    allDay: [],
  })
  const ready = (day: HomeCalendarDay, accounts = connection.accounts) => ({
    state: { status: 'ready' as const, data: day, accounts },
    retry,
  })
  if (read.isError) return ready(pendingDay('error'))
  if (!read.data) return ready(pendingDay('loading'))
  const accounts = toReadAccounts(read.data.accounts, connection.accounts)
  const settled = settleReadAccounts(accounts)
  if (settled?.status === 'error') return ready(pendingDay('error'), accounts)
  if (settled) return { state: settled, retry }
  return ready(toCalendarDay(read.data, { date, nowMinute, timeZone }), accounts)
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
      startDate: today ? addDays(today, 1 - ACTIVITY_DAYS) : undefined,
      endDate: today ?? undefined,
      timezone: timeZone,
    },
    { enabled: allowed && today !== null }
  )
  const retry = () => void summary.refetch()
  if (!allowed || (summary.error && isRefusal(summary.error)))
    return { state: { status: 'hidden' }, retry }
  if (summary.isError) return { state: { status: 'error', retrying: summary.isFetching }, retry }
  return {
    state: summary.data
      ? { status: 'ready', points: toTaskPoints(summary.data, timeZone) }
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
  const state: HomeListState<ReturnType<typeof toRecentItems>[number]> = !allowed
    ? { status: 'ready', items: [] }
    : history.isError
      ? { status: 'error', retrying: history.isFetching }
      : history.data
        ? { status: 'ready', items: toRecentItems(history.data) }
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
  readAccounts: readonly { id: string; label: string; canReconnect: boolean; problem?: string }[]
): { state: HomeListState<AttentionItem>; retry: () => void } {
  const shell = useLiveShellData()
  const canReview = organization.settingsSections.includes('requests')
  const requests = useOrganizationAccessRequests(canReview ? organization.organization.id : '')
  const items: AttentionItem[] = []
  const seen = new Set<string>()
  const addReconnect = (id: string, title: string, detail: string) => {
    if (seen.has(id)) return
    seen.add(id)
    items.push({
      id: `reconnect-${id}`,
      title,
      detail,
      icon: 'I070',
      onOpen: () => reconnect?.(id),
    })
  }
  for (const entry of integrations.entries ?? []) {
    for (const account of entry.accounts) {
      if (
        account.status === 'needs_reauth' &&
        entry.reconnectAccountIds.includes(account.credentialId)
      )
        addReconnect(account.credentialId, `Reconnect ${entry.name}`, account.displayName)
    }
  }
  for (const account of readAccounts) {
    if (account.problem === 'needs_reauth' && account.canReconnect)
      addReconnect(account.id, `Reconnect ${account.label}`, 'Sim can no longer read this account')
  }
  for (const chat of shell?.chats ?? []) {
    if (!chat.isUnread) continue
    items.push({
      id: `chat-${chat.id}`,
      title: chat.title,
      detail: 'New reply in this chat',
      occurredAt: chat.updatedAt ? Date.parse(chat.updatedAt) : undefined,
      icon: 'I035',
      href: chat.href ?? `/chat/${chat.id}`,
    })
  }
  for (const request of canReview ? (requests.data?.requests ?? []) : []) {
    items.push({
      id: `request-${request.id}`,
      title: `${request.requester.name || request.requester.email} asked for ${request.targetLabel}`,
      detail: request.reason ?? 'Waiting for your review',
      occurredAt: Date.parse(request.createdAt),
      icon: 'I015',
      href: '/settings/requests',
    })
  }
  items.sort(
    (left, right) =>
      (right.occurredAt ?? Number.POSITIVE_INFINITY) - (left.occurredAt ?? Number.POSITIVE_INFINITY)
  )

  const sources = [
    integrations.allowed && {
      pending: !integrations.entries && !integrations.failure,
      failed: integrations.failure === 'failed',
    },
    shell?.status && {
      pending: shell.status.chats === 'pending',
      failed: shell.status.chats === 'error',
    },
    canReview && { pending: requests.isPending, failed: requests.isError },
  ].filter((source) => source !== false && source !== undefined)
  const failed = sources.some((source) => source.failed)
  const pending = sources.some((source) => source.pending)
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
    const accounts = integrations.accounts.data
    const approved = new Set(
      integrations.policies.data
        ?.filter((policy) => policy.approved && policy.available !== false)
        .map((policy) => policy.connectorType)
    )
    const readyOptions = new Set(
      accounts?.credentialGroup?.options
        .filter((option) => {
          const provider = liveSearchProviderForCredential(option.provider)
          return (
            option.status === 'active' &&
            option.configurationStatus === 'ready' &&
            provider &&
            supportsLiveSearchMode(provider, 'member') &&
            approved.has(provider)
          )
        })
        .map((option) => option.id)
    )
    const readyServers = new Set(
      accounts?.credentialGroup?.mcpServers
        .filter((server) => {
          const provider = liveSearchProviderForCredential(`mcp:${server.managedConnectorId}`)
          return (
            server.enabled &&
            provider &&
            approved.has(provider) &&
            accounts.availableMcpConnectors.some((id) => id === server.managedConnectorId)
          )
        })
        .map((server) => server.id)
    )
    const hasConnection =
      accounts?.credentialGroup?.status === 'active' &&
      (accounts.viewerAccounts?.some(
        (account) => account.status === 'active' && readyOptions.has(account.optionId)
      ) ||
        accounts.viewerMcpAccounts?.some(
          (account) => account.status === 'active' && readyServers.has(account.mcpServerId)
        ))
    steps.push({
      id: 'connect-integration',
      title: 'Connect an integration',
      detail: 'Choose what Sim can search for you',
      href: viewer.isAdmin ? routes.settingsSection('integrations') : '/integrations',
      complete: Boolean(
        hasConnection ||
          integrations.policies.data?.some(
            (policy) =>
              policy.approved && policy.available !== false && policy.configuredServiceSource
          )
      ),
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
  const [dayOffset, setDayOffset] = useState(0)
  const today = nowMs === null ? null : localDate(new Date(nowMs), timeZone)

  const integrations = useHomeIntegrations(organization)
  const connectionFor = (sources: typeof HOME_EMAIL_SOURCES) =>
    toHomeConnection({
      allowed: integrations.allowed,
      entries: integrations.entries,
      failure: integrations.failure,
      retrying: integrations.retrying,
      sources,
    })
  const emailConnection = connectionFor(HOME_EMAIL_SOURCES)
  const calendarConnection = connectionFor(HOME_CALENDAR_SOURCES)
  const connectionActions = useConnectionActions(organizationId)
  const email = useHomeEmail(organizationId, emailConnection)
  const calendar = useHomeCalendar(organizationId, calendarConnection, nowMs, timeZone, dayOffset)
  const activity = useHomeActivity(organization, today, timeZone)
  const recents = useHomeRecents(organization)
  const readAccounts = [email.state, calendar.state].flatMap((state) =>
    state.status === 'ready' || state.status === 'needs_reauth' ? state.accounts : []
  )
  const attention = useHomeAttention(
    organization,
    integrations,
    connectionActions.reconnect,
    readAccounts
  )
  const getStarted = useHomeGetStarted(organization, integrations, homeMode === 'Search')

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
      email: {
        ...connectionActions,
        retry: emailConnection.status === 'error' ? integrations.retry : email.retry,
      },
      calendar: {
        ...connectionActions,
        retry: calendarConnection.status === 'error' ? integrations.retry : calendar.retry,
      },
      openEmail: (mail) => {
        if (mail.url) window.open(mail.url, '_blank', 'noopener,noreferrer')
      },
      changeDay: (delta) => setDayOffset((offset) => offset + delta),
      returnToToday: () => setDayOffset(0),
      retryAttention: attention.retry,
      retryActivity: activity.retry,
      retryRecents: recents.retry,
      removeRecent: recents.remove,
    },
  }
}
