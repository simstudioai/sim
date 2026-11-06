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
import { useGetStartedSteps } from '@/app/o/[organizationId]/home/components/get-started/use-get-started-steps'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { useOrganizationAccessRequests } from '@/hooks/queries/access-requests'
import { useOrganizationMothershipChats } from '@/hooks/queries/mothership-chats'
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
import {
  ACTIVITY_WINDOW_DAYS,
  type ActivityWindowDays,
  type AttentionItem,
  type EmailItem,
  type HomeAccountView,
  type HomeActions,
  type HomeActivityState,
  type HomeCalendarDay,
  type HomeListState,
  type HomeView,
  type HomeWidgetActions,
  type HomeWidgetState,
  type HomeWorkspaceItem,
} from '@/platform/app/(shell)/home/_components/model'
import { homeDayParam } from '@/platform/app/(shell)/home/search-params'
import type { RecentItem } from '@/platform/design-system/components/recent-items/recent-items'
import { organizationChatHref, useCanOpenOrganizationChat } from '@/platform/lib/data/chat-list'
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
  toHomeWorkspaceItems,
  toReadAccounts,
  toReadableProviders,
  toRecentItems,
  toTaskPoints,
  wallClockMinute,
} from '@/platform/lib/data/home-model'
import { useIntegrationActions } from '@/platform/lib/data/integrations'
import { workspaceHref } from '@/platform/lib/data/workspaces'
import { currentMinute, MINUTE_MS } from '@/platform/lib/time'
import {
  type OrganizationHomeWidget,
  useOrganizationHomeStore,
} from '@/stores/organization-home/store'

/** How long a day must stay chosen before it is read, so a run of clicks is one read at the provider. */
const CALENDAR_DAY_SETTLE_MS = 250
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
  // and any other reads as loading until it settles, exactly as an unread day always has.
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
  organization: OrganizationSurfaceContext,
  today: string,
  timeZone: string,
  hidden: boolean
): {
  state: HomeActivityState
  days: ActivityWindowDays
  setDays: (days: ActivityWindowDays) => void
  retry: () => void
} {
  const [days, setSelectedDays] = useState<ActivityWindowDays>(ACTIVITY_WINDOW_DAYS[0])
  // The widest window read so far, which holds every narrower one, so going back costs nothing.
  const [readDays, setReadDays] = useState<ActivityWindowDays>(days)
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
      startDate: addCalendarDays(today, 1 - readDays),
      endDate: today,
      timezone: timeZone,
    },
    { enabled: allowed && !hidden, keepPreviousWindow: true }
  )
  const setDays = (next: ActivityWindowDays) => {
    setSelectedDays(next)
    setReadDays(summary.isError ? next : (Math.max(readDays, next) as ActivityWindowDays))
  }
  const retry = () => void summary.refetch()
  const range = { days, setDays, retry }
  if (!allowed || (summary.error && isRefusal(summary.error)))
    return { state: { status: 'hidden' }, ...range }
  const points = summary.data && toTaskPoints(summary.data)
  // The narrower window a wider read replaces can still answer for a range it covers.
  if (points && (!summary.isPlaceholderData || points.length >= days))
    return { state: { status: 'ready', points }, ...range }
  return { state: withoutResult(summary), ...range }
}

function useHomeRecents(organization: OrganizationSurfaceContext, userId: string | undefined) {
  const organizationId = organization.organization.id
  const allowed = organization.searchAccess.memberScoped
  const history = useSearchHistory(allowed ? organizationId : undefined, userId)
  const remove = useRemoveSearchHistorySource(organizationId, userId)
  const state: HomeListState<RecentItem> = !allowed
    ? { status: 'ready', items: [] }
    : history.data
      ? { status: 'ready', items: toRecentItems(history.data) }
      : withoutResult(history)
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
  const canOpenChat = useCanOpenOrganizationChat()
  const requests = useOrganizationAccessRequests(canReview ? organizationId : '')
  const reviewFailed = canReview && requests.isError && !isRefusal(requests.error)
  const items = toAttentionItems({
    entries: integrations.entries ?? [],
    readAccounts,
    chats: (chats.data ?? []).filter(canOpenChat).map((chat) => ({
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

/**
 * The sidebar's list, from the same cache entry, so the rows cost no request and the two cannot
 * disagree. A viewer with no workspaces never asks for activity. A failed activity read keeps the
 * rows and says so, because a row with no status must not pass for an idle one.
 */
function useHomeWorkspaces(organizationId: string, hidden: boolean) {
  const list = useOrderedWorkspacesQuery()
  const workspaces = (list.data ?? [])
    .filter((workspace) => workspace.organizationId === organizationId)
    .map(({ id, name }) => ({ id, name, href: workspaceHref(id) }))
  const activity = useOrganizationHomeWorkspaceActivity(organizationId, {
    enabled: workspaces.length > 0 && !hidden,
  })
  const state = ((): HomeListState<HomeWorkspaceItem> => {
    if (!list.data)
      return list.isError ? { status: 'error', retrying: list.isFetching } : { status: 'loading' }
    if (workspaces.length === 0) return { status: 'ready', items: [] }
    if (!activity.data && !activity.isError) return { status: 'loading' }
    return {
      status: 'ready',
      items: toHomeWorkspaceItems(workspaces, activity.data),
      partial: !activity.data || activity.isRefetchError,
    }
  })()
  return {
    state,
    count: workspaces.length,
    retry: () => {
      if (!list.data) void list.refetch()
      else void activity.refetch()
    },
  }
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
  const userId = session?.user?.id
  const viewer = userId ? `${userId}:${organizationId}` : null
  const hiddenWidgets = useOrganizationHomeStore((state) =>
    viewer ? (state.hiddenWidgets[viewer] ?? NO_WIDGETS) : NO_WIDGETS
  )
  /**
   * What a viewer hid is keyed by who they are, and the organization layout seeds no session, so a
   * first load does not know yet. Until it does every widget paints as loading and reads nothing,
   * since any of them might be one this viewer turned off.
   */
  const readHeld = (widget: OrganizationHomeWidget) => !viewer || hiddenWidgets.includes(widget)
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
    readHeld('Email')
  )
  const calendar = useHomeCalendar(
    organizationId,
    connectionFor(HOME_CALENDAR_SOURCES),
    integrations.retry,
    clock,
    selectedDay,
    timeZone,
    readHeld('Calendar')
  )
  const activity = useHomeActivity(organization, today, timeZone, readHeld('Activity'))
  const workspaces = useHomeWorkspaces(organizationId, readHeld('Workspaces'))
  const recents = useHomeRecents(organization, userId)
  const attention = useHomeAttention(
    organization,
    integrations,
    connectionActions.reconnect,
    [email.state, calendar.state].flatMap((state) => ('accounts' in state ? state.accounts : []))
  )
  // Search-only members start here, so their onboarding comes with the Assistant composer.
  const getStarted = useGetStartedSteps(assistant && organization.searchAccess.memberScoped)

  const showDay = (day: string | null) =>
    void setSelectedDay(day === today ? null : day, { history: 'replace', scroll: false })

  return {
    view: {
      asOf: nowMs,
      greeting: greetingAt(nowMs, timeZone),
      firstName: firstNameOf(session?.user),
      attention: attention.state,
      activity: activity.state,
      activityDays: activity.days,
      email: email.state,
      calendar: calendar.state,
      workspaces: workspaces.state,
      workspaceCount: workspaces.count,
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
      setActivityDays: activity.setDays,
      retryWorkspaces: workspaces.retry,
      retryRecents: recents.retry,
      removeRecent: recents.remove,
      setWidgetHidden: (widget, hidden) => {
        if (viewer) setWidgetHidden(viewer, widget, hidden)
      },
    },
  }
}
