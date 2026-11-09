'use client'

import { useState, useSyncExternalStore } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import { useSession } from '@/lib/auth/client'
import { addCalendarDays, getBrowserTimezone } from '@/lib/core/utils/timezone'
import { memberIntegrationEntries } from '@/lib/credential-groups/member-integrations'
import { canReadMemberIntegrations } from '@/lib/credential-groups/member-integrations-access'
import { hasSearchIntegrationReady } from '@/lib/credential-groups/search-readiness'
import { organizationRoutes } from '@/lib/navigation/paths'
import { toast } from '@/lib/toast/sink'
import type { HomeWidget } from '@/app/(product)/_components/model'
import type {
  AttentionItem,
  EmailItem,
  HomeActions,
  HomeView,
} from '@/app/(product)/o/[organizationId]/home/_components/model'
import { useOrganizationAccessRequests } from '@/hooks/queries/access-requests'
import { useOrganizationMothershipChats } from '@/hooks/queries/mothership-chats'
import { useHasSearchAuthorization } from '@/hooks/queries/oauth-provider'
import { useOrganizationAccounts } from '@/hooks/queries/organization-accounts'
import { useOrganizationActivitySummary } from '@/hooks/queries/organization-activity'
import {
  useOrganizationHomeCalendar,
  useOrganizationHomeEmail,
  useOrganizationHomeWorkspaceActivity,
} from '@/hooks/queries/organization-home'
import { useRemoveSearchHistorySource, useSearchHistory } from '@/hooks/queries/search-history'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'
import { useOrderedWorkspacesQuery } from '@/hooks/queries/workspace'
import { useDebounce } from '@/hooks/use-debounce'
import { useHydrated } from '@/hooks/use-hydrated'
import { useCanOpenOrganizationChat } from '@/platform/lib/data/chat-list'
import {
  type CollapsedRecent,
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
  toHomeWorkspaceItems,
  toReadAccounts,
  toReadableProviders,
  toRecentItems,
  toTaskPoints,
} from '@/platform/lib/data/home-model'
import type { SavedSearchConnection } from '@/platform/lib/data/integration-handoff'
import { useIntegrationActions } from '@/platform/lib/data/integrations'
import { useOrganization } from '@/platform/lib/data/organization'
import { type PlatformOrganization, surfaceHref } from '@/platform/lib/data/organization-model'
import { workspaceHomePath } from '@/platform/lib/workspace-navigation'
import { wallClockMinute } from '@/platform/shared/calendar-meeting'
import type {
  HomeAccountView,
  HomeActivityState,
  HomeCalendarDay,
  HomeGetStartedStep,
  HomeListState,
  HomeWidgetActions,
  HomeWidgetState,
  HomeWorkspaceItem,
} from '@/platform/shared/home'
import { homeDayParam } from '@/platform/shared/home-params'
import { isRefusal } from '@/platform/shared/query-view'
import { MINUTE_MS } from '@/platform/shared/time'
import { useOrganizationHomeStore } from '@/stores/organization-home/store'

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

/** Home mounts only after hydration, behind its host's gate, so no markup can disagree. */
function useMinuteClock(): number {
  return useSyncExternalStore(subscribeToMinutes, currentMinute, currentMinute)
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

/** An account the viewer saves by hand, opened in place for Home to render with `SavedAccountModal`. */
interface HomeSavedConnection {
  organizationId: string
  connection: SavedSearchConnection
  close: () => void
}

/** `allowed` is the member-integrations gate; without it the viewer has no inventory to read. */
function useConnectionActions(
  organizationId: string,
  allowed: boolean
): {
  actions: Omit<HomeWidgetActions, 'retry'>
  savedConnection: HomeSavedConnection | null
} {
  const { connecting, connect, reconnect, disconnect, savedConnection, closeSavedConnection } =
    useIntegrationActions(organizationId, { enabled: allowed })
  return {
    actions: {
      connect: connecting ? undefined : (optionId) => connect({ optionId }),
      reconnect: connecting ? undefined : reconnect,
      disconnect: async (credentialId) => {
        await disconnect(credentialId)
      },
    },
    savedConnection: savedConnection && {
      organizationId,
      connection: savedConnection,
      close: closeSavedConnection,
    },
  }
}

interface HomeWidgetRead<T> {
  state: HomeWidgetState<T>
  retry: () => void
}

/** A read with nothing to show yet: failed and maybe retrying, or still on its way. */
function withoutResult(read: {
  isError: boolean
  isFetching: boolean
}): { status: 'error'; retrying: boolean } | { status: 'loading' } {
  return read.isError ? { status: 'error', retrying: read.isFetching } : { status: 'loading' }
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
  if (!read.data) return { state: withoutResult(read), retry }
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

/** Paging through days only reads the day the viewer stops on: each read costs provider requests. */
const CALENDAR_DAY_SETTLE_MS = 250

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
  const settledDate = useDebounce(date, CALENDAR_DAY_SETTLE_MS)
  // Keyed by the shown day throughout: the header moves at once, a day already read shows at once,
  // and any other reads as loading until it settles.
  const read = useOrganizationHomeCalendar(organizationId, date, timeZone, {
    enabled: connection.status === 'connected' && !hidden && settledDate === date,
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
  organization: PlatformOrganization,
  today: string,
  timeZone: string,
  hidden: boolean
): { state: HomeActivityState; retry: () => void } {
  const allowed = organization.settingsSections.includes('usage')
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
  return { state: withoutResult(summary), retry }
}

/**
 * The sidebar's list, from the same cache entry, so the rows cost no request and the two cannot
 * disagree. A viewer with no workspaces, or who hid the widget, never asks for activity. A failed
 * activity read keeps the rows and says so, because a row with no status must not pass for an idle
 * one.
 */
function useHomeWorkspaces(organizationId: string, hidden: boolean) {
  const list = useOrderedWorkspacesQuery()
  const workspaces = (list.data ?? [])
    .filter(
      (workspace) =>
        workspace.organizationId === organizationId || workspace.organizationId === null
    )
    .map(({ id, name }) => ({ id, name, href: workspaceHomePath(id, 'live') }))
  const activity = useOrganizationHomeWorkspaceActivity(organizationId, {
    enabled: workspaces.length > 0 && !hidden,
  })
  const state = ((): HomeListState<HomeWorkspaceItem> => {
    if (!list.data) return withoutResult(list)
    if (workspaces.length === 0) return { status: 'ready', items: [] }
    const settling = !activity.data && !activity.isError
    return {
      status: 'ready',
      items: toHomeWorkspaceItems(workspaces, activity.data),
      settling,
      partial: !settling && (!activity.data || activity.isRefetchError),
    }
  })()
  return {
    state,
    retry: () => {
      if (!list.data) void list.refetch()
      else void activity.refetch()
    },
  }
}

function useHomeRecents(organization: PlatformOrganization, userId: string | undefined) {
  const organizationId = organization.organization.id
  const allowed = organization.searchAccess.memberScoped
  const history = useSearchHistory(allowed ? organizationId : undefined, userId)
  const remove = useRemoveSearchHistorySource(organizationId, userId)
  const state: HomeListState<CollapsedRecent> = !allowed
    ? { status: 'ready', items: [] }
    : history.data
      ? { status: 'ready', items: toRecentItems(history.data) }
      : withoutResult(history)
  return {
    state,
    retry: () => void history.refetch(),
    remove: (id: string) =>
      remove.mutate(
        state.status === 'ready'
          ? (state.items.find((item) => item.id === id)?.urls ?? [id])
          : [id],
        {
          onError: (error) =>
            toast.error(getErrorMessage(error, 'That recent could not be removed.')),
        }
      ),
  }
}

function useHomeAttention(
  organization: PlatformOrganization,
  integrations: ReturnType<typeof useHomeIntegrations>,
  reconnect: HomeWidgetActions['reconnect'],
  readAccounts: readonly HomeAccountView[]
): { state: HomeListState<AttentionItem>; retry: () => void } {
  const organizationId = organization.organization.id
  const canReview = organization.viewer.isAdmin
  const chats = useOrganizationMothershipChats(organizationId)
  const canOpenChat = useCanOpenOrganizationChat()
  const requests = useOrganizationAccessRequests(canReview ? organizationId : '')
  const reviewFailed = canReview && requests.isError && !isRefusal(requests.error)
  const items = toAttentionItems({
    entries: integrations.entries ?? [],
    readAccounts,
    chats: (chats.data ?? []).filter(canOpenChat).map((chat) => ({
      id: chat.id,
      title: chat.name,
      href: surfaceHref(
        organization,
        chat.mode === 'assistant' ? `/search/chat/${chat.id}` : `/chat/${chat.id}`
      ),
      isUnread: chat.isUnread,
      updatedAt: chat.updatedAt.getTime(),
    })),
    requests: requests.data?.requests ?? [],
    reconnect,
    requestsHref: organizationRoutes(organizationId).settingsSection('requests'),
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

/** Get started: the onboarding steps a search-only member starts Home with. */
function useHomeGetStarted(
  organization: PlatformOrganization,
  integrations: ReturnType<typeof useHomeIntegrations>,
  enabled: boolean
): HomeGetStartedStep[] {
  const { viewer, connectedAccountsAvailable } = organization
  const shown = enabled && organization.searchAccess.memberScoped
  const canUseSearchMcp = shown && viewer.canUseSearchMcp
  const authorized = useHasSearchAuthorization(canUseSearchMcp)
  const routes = organizationRoutes(organization.organization.id)
  const steps: HomeGetStartedStep[] = []
  if (shown && viewer.canConnectSearchIntegrations && connectedAccountsAvailable) {
    steps.push({
      id: 'connect-integration',
      title: 'Connect an integration',
      detail: 'Choose what Sim can search for you',
      href: viewer.isAdmin
        ? routes.settingsSection('integrations')
        : surfaceHref(organization, '/integrations'),
      complete: hasSearchIntegrationReady(integrations.accounts.data, integrations.policies.data),
    })
  }
  if (canUseSearchMcp) {
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

/**
 * The Assistant landing's Get started: the steps Home gives a search-only member, read only while a
 * landing that shows them is mounted.
 */
export function useAssistantGetStarted(): HomeGetStartedStep[] {
  const organization = useOrganization()
  const integrations = useHomeIntegrations(organization)
  return useHomeGetStarted(organization, integrations, true)
}

const NO_WIDGETS: readonly HomeWidget[] = []

function isHomeWidget(widget: string): widget is HomeWidget {
  return (
    widget === 'Activity' || widget === 'Workspaces' || widget === 'Email' || widget === 'Calendar'
  )
}

export interface HiddenHomeWidgets {
  hiddenWidgets: readonly HomeWidget[]
  setWidgetHidden: (widget: HomeWidget, hidden: boolean) => void
}

/**
 * The viewer's Customize Home choices in this organization, kept in this browser across reloads under
 * the legacy Home's key and cleared with the viewer's other data on sign-out. Null until the render is
 * past hydration, which Home's clock-dependent markup waits for, and the session names the viewer.
 */
export function useHiddenHomeWidgets(): HiddenHomeWidgets | null {
  const hydrated = useHydrated()
  const organizationId = useOrganization().organization.id
  const userId = useSession().data?.user?.id
  const viewer = userId ? `${userId}:${organizationId}` : null
  const stored = useOrganizationHomeStore((state) =>
    viewer ? state.hiddenWidgets[viewer] : undefined
  )
  const setWidgetHidden = useOrganizationHomeStore((state) => state.setWidgetHidden)
  if (!hydrated || !viewer) return null
  return {
    hiddenWidgets: stored?.filter(isHomeWidget) ?? NO_WIDGETS,
    setWidgetHidden: (widget, hidden) => setWidgetHidden(viewer, widget, hidden),
  }
}

function firstNameOf(user: { name?: string | null; email?: string | null } | null | undefined) {
  return user?.name && user.name !== user.email ? user.name.split(/\s/u)[0] : undefined
}

/**
 * Home's view and actions. Every widget reads the same member inventory the Integrations page reads,
 * so the two cannot disagree on what is offered. `assistant` is whether the viewer searches rather
 * than builds here, which decides whether Get started is theirs. A hidden widget reads nothing.
 */
export function useLiveHome(
  assistant: boolean,
  hiddenWidgets: readonly HomeWidget[]
): { view: HomeView; actions: HomeActions; savedConnection: HomeSavedConnection | null } {
  const organization = useOrganization()
  const { data: session } = useSession()
  const organizationId = organization.organization.id
  const nowMs = useMinuteClock()
  const [timeZone] = useState(getBrowserTimezone)
  const [selectedDay, setSelectedDay] = useQueryState(homeDayParam.key, homeDayParam.parser)
  const today = localDate(new Date(nowMs), timeZone)
  const clock = { nowMs, today }

  const integrations = useHomeIntegrations(organization)
  const connectionFor = (sources: typeof HOME_EMAIL_SOURCES) =>
    toHomeConnection({ ...integrations, sources })
  const { actions: connectionActions, savedConnection } = useConnectionActions(
    organizationId,
    integrations.allowed
  )
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
  const workspaces = useHomeWorkspaces(organizationId, hiddenWidgets.includes('Workspaces'))
  const recents = useHomeRecents(organization, session?.user?.id)
  const attention = useHomeAttention(
    organization,
    integrations,
    connectionActions.reconnect,
    [email.state, calendar.state].flatMap((state) => ('accounts' in state ? state.accounts : []))
  )
  // Search-only members start here, so their onboarding comes with the Assistant composer.
  const getStarted = useHomeGetStarted(organization, integrations, assistant)

  const showDay = (day: string | null) =>
    void setSelectedDay(day === today ? null : day, { history: 'replace', scroll: false })

  return {
    view: {
      asOf: nowMs,
      greeting: greetingAt(nowMs, timeZone),
      firstName: firstNameOf(session?.user),
      attention: attention.state,
      /** Search has no daily count anywhere to read, so its chart is hidden rather than estimated. */
      activity: { Build: activity.state, Search: { status: 'hidden' } },
      email: email.state,
      calendar: calendar.state,
      workspaces: workspaces.state,
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
        showDay(addCalendarDays(selectedDay ?? today, delta))
      },
      returnToToday: () => showDay(null),
      retryAttention: attention.retry,
      retryActivity: activity.retry,
      retryWorkspaces: workspaces.retry,
      retryRecents: recents.retry,
      removeRecent: recents.remove,
    },
    savedConnection,
  }
}
