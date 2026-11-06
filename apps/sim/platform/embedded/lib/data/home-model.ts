import type { AccessRequestRecord } from '@/lib/api/contracts/access-requests'
import type { SearchHistoryResponse } from '@/lib/api/contracts/knowledge/search-history'
import type { SearchIntegrationStatus } from '@/lib/api/contracts/knowledge/search-integrations'
import type { OrganizationActivitySummary } from '@/lib/api/contracts/organization-activity'
import type {
  HomeWidgetAccount,
  OrganizationHomeCalendar,
  OrganizationHomeEmail,
  OrganizationHomeWorkspaceActivity,
} from '@/lib/api/contracts/organization-home'
import { assistantSearchSourceForProvider } from '@/lib/assistant-actions/providers'
import { getWallClockParts, zonedWallClock } from '@/lib/core/utils/timezone'
import type { MemberIntegration } from '@/lib/credential-groups/member-integrations'
import {
  type CredentialGroupProvider,
  getCredentialGroupProviderId,
} from '@/lib/credential-groups/providers'
import { requiresScopedRetrieval } from '@/lib/sim-search/live/policy-schema'
import { linkSiteName } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-link'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { providerMark } from '@/platform/design-system/components/icon/provider-marks'
import type { RecentItem } from '@/platform/design-system/components/recent-items/recent-items'
import type {
  AttentionItem,
  CalendarMeeting,
  EmailItem,
  HomeAccountView,
  HomeCalendarDay,
  HomeConnectOption,
  HomeWidgetState,
  HomeWorkspaceItem,
} from '@/platform/embedded/lib/data/home-view'

interface HomeWidgetSource {
  /** The member inventory provider this widget draws on, so both surfaces agree by construction. */
  provider: string
  /** The credential provider the widget's read is allowed through. */
  credentialProvider: CredentialGroupProvider
  icon: IconName
}

/** Outlook appears twice on purpose: one Microsoft account serves both mail and calendar. */
export const HOME_EMAIL_SOURCES: readonly HomeWidgetSource[] = [
  { provider: 'gmail', credentialProvider: 'gmail', icon: 'I005' },
  { provider: 'outlook', credentialProvider: 'outlook', icon: 'I120' },
]
export const HOME_CALENDAR_SOURCES: readonly HomeWidgetSource[] = [
  { provider: 'google_calendar', credentialProvider: 'google-calendar', icon: 'I088' },
  { provider: 'outlook', credentialProvider: 'outlook', icon: 'I120' },
]

function accountView(
  account: MemberIntegration['accounts'][number],
  entry: MemberIntegration
): HomeAccountView {
  return {
    id: account.credentialId,
    label: account.displayName || entry.name,
    canReconnect: entry.reconnectAccountIds.includes(account.credentialId),
    ...(account.status === 'needs_reauth' ? { problem: 'needs_reauth' as const } : {}),
  }
}

export type HomeConnection =
  | Exclude<HomeWidgetState<never>, { status: 'ready' }>
  | { status: 'connected'; accounts: readonly HomeAccountView[] }

interface HomeConnectionInput {
  allowed: boolean
  /** Undefined until both the accounts and the policies have loaded. */
  entries: readonly MemberIntegration[] | undefined
  /** The widget's read answers to this list, so nothing outside it is shown or offered. */
  readableProviders: readonly CredentialGroupProvider[]
  /** A refusal means the viewer has no inventory; anything else can be retried. */
  failure: 'refused' | 'failed' | undefined
  retrying: boolean
  sources: readonly HomeWidgetSource[]
}

/**
 * The two gates a widget's server read applies: the viewer's permission group, and a Search source's
 * content boundary, which a direct read would sidestep.
 */
export function toReadableProviders(
  assistantProviders: readonly CredentialGroupProvider[],
  policies: readonly SearchIntegrationStatus[]
): CredentialGroupProvider[] {
  return assistantProviders.filter((provider) => {
    const source = assistantSearchSourceForProvider(getCredentialGroupProviderId(provider))
    const policy = policies.find((candidate) => candidate.connectorType === source)?.policy
    return !(source && policy && requiresScopedRetrieval(source, policy))
  })
}

/** Where a widget stands before any provider is asked, from the member inventory alone. */
export function toHomeConnection({
  allowed,
  entries,
  readableProviders,
  failure,
  retrying,
  sources,
}: HomeConnectionInput): HomeConnection {
  if (!allowed || failure === 'refused') return { status: 'not_offered' }
  if (failure === 'failed') return { status: 'error', retrying }
  if (!entries) return { status: 'loading' }
  const readable = sources.filter((source) => readableProviders.includes(source.credentialProvider))
  const matched = readable.flatMap((source) => {
    const entry = entries.find((candidate) => candidate.provider === source.provider)
    return entry ? [{ source, entry }] : []
  })
  const accounts = matched.flatMap(({ entry }) =>
    entry.accounts.map((account) => accountView(account, entry))
  )
  if (accounts.length === 0) {
    const options: HomeConnectOption[] = matched.flatMap(({ source, entry }) => {
      const target = entry.connectionTarget
      return entry.ready && target && 'optionId' in target
        ? [{ id: target.optionId, label: entry.name, icon: source.icon }]
        : []
    })
    return options.length ? { status: 'not_connected', options } : { status: 'not_offered' }
  }
  return accounts.every((account) => account.problem === 'needs_reauth')
    ? { status: 'needs_reauth', accounts }
    : { status: 'connected', accounts }
}

/** The inventory says what is connected; the read says what actually answered just now. */
export function toReadAccounts(
  read: readonly HomeWidgetAccount[],
  connected: readonly HomeAccountView[]
): HomeAccountView[] {
  if (read.length === 0) return [...connected]
  return read.map((account) => ({
    id: account.credentialId,
    label: account.displayName,
    canReconnect: connected.some((view) => view.id === account.credentialId && view.canReconnect),
    ...(account.state === 'ready' ? {} : { problem: account.state }),
  }))
}

/** What a read's accounts amount to: `null` when at least one answered, so its data can show. */
export function settleReadAccounts(
  accounts: readonly HomeAccountView[]
):
  | { status: 'not_offered' }
  | { status: 'needs_reauth'; accounts: readonly HomeAccountView[] }
  | { status: 'error' }
  | null {
  if (accounts.some((account) => !account.problem)) return null
  if (accounts.every((account) => account.problem === 'not_offered'))
    return { status: 'not_offered' }
  const reauth = accounts.filter((account) => account.problem === 'needs_reauth')
  return reauth.length ? { status: 'needs_reauth', accounts: reauth } : { status: 'error' }
}

export function toEmailItems(email: OrganizationHomeEmail): EmailItem[] {
  return email.threads.map((thread) => ({
    id: `${thread.credentialId}:${thread.id}`,
    sender: thread.sender,
    subject: thread.subject,
    excerpt: thread.excerpt,
    receivedAt: Date.parse(thread.receivedAt),
    count: thread.messageCount,
    url: thread.url,
  }))
}

const MINUTES_PER_DAY = 24 * 60

export function wallClockMinute(instantMs: number, timeZone: string): number {
  const { hour, minute } = getWallClockParts(new Date(instantMs), timeZone)
  return hour * 60 + minute
}

/** A wall-clock minute of the requested day; an instant outside it clamps to that day's edge. */
function minuteOfDay(
  instant: string,
  window: OrganizationHomeCalendar['window'],
  timeZone: string
) {
  if (instant <= window.startAt) return 0
  if (instant >= window.endAt) return MINUTES_PER_DAY
  return wallClockMinute(Date.parse(instant), timeZone)
}

export function toCalendarDay(
  calendar: OrganizationHomeCalendar,
  day: { date: string; nowMinute: number | null; timeZone: string }
): HomeCalendarDay {
  const meetings: CalendarMeeting[] = []
  const allDay: HomeCalendarDay['allDay'][number][] = []
  for (const event of calendar.events) {
    const id = `${event.credentialId}:${event.id}`
    const runsBefore = event.startAt < calendar.window.startAt
    const runsAfter = event.endAt > calendar.window.endAt
    // A timed event filling the whole day would only be a card too tall to read.
    const fillsDay =
      event.startAt <= calendar.window.startAt && event.endAt >= calendar.window.endAt
    if (event.allDay || fillsDay) {
      allDay.push({ id, title: event.title, providerUrl: event.url })
      continue
    }
    const startMinute = minuteOfDay(event.startAt, calendar.window, day.timeZone)
    meetings.push({
      id,
      title: event.title,
      startMinute,
      duration: Math.max(0, minuteOfDay(event.endAt, calendar.window, day.timeZone) - startMinute),
      ...(runsBefore || runsAfter
        ? {
            clock: {
              startMinute: wallClockMinute(Date.parse(event.startAt), day.timeZone),
              endMinute: wallClockMinute(Date.parse(event.endAt), day.timeZone),
            },
          }
        : {}),
      providerUrl: event.url,
      people: event.people,
    })
  }
  return { date: day.date, nowMinute: day.nowMinute, status: 'ready', meetings, allDay }
}

export function localDate(instant: Date, timeZone: string): string {
  return zonedWallClock(instant, timeZone).slice(0, 10)
}

/**
 * "Tasks run" counts both things Sim ran on the organization's behalf: workflow runs and chat runs.
 * Buckets arrive as civil timestamps on the viewer's calendar days, one for every day in the window.
 */
export function toTaskPoints(summary: OrganizationActivitySummary) {
  return summary.series.map((point) => ({
    date: point.timestamp.slice(0, 10),
    value: point.workflowRuns + point.chatRuns,
  }))
}

export function toRecentItems(history: SearchHistoryResponse): RecentItem[] {
  return history.sources.map((source) => {
    const mark = source.connectorType ? providerMark(source.connectorType) : undefined
    return {
      id: source.url,
      label: source.title ?? linkSiteName(source.url, source.siteName),
      href: source.url,
      icon: typeof mark === 'string' ? mark : undefined,
    }
  })
}

export function greetingAt(nowMs: number, timeZone: string): string {
  const { hour } = getWallClockParts(new Date(nowMs), timeZone)
  if (hour < 12) return 'Good morning'
  return hour < 18 ? 'Good afternoon' : 'Good evening'
}

/** A chat row: its link depends on its mode, so the caller, which knows the mode, supplies it. */
interface AttentionChat {
  id: string
  title: string
  href: string
  isUnread: boolean
  updatedAt: number
}

interface AttentionInput {
  entries: readonly MemberIntegration[]
  readAccounts: readonly HomeAccountView[]
  chats: readonly AttentionChat[]
  requests: readonly AccessRequestRecord[]
  reconnect: ((accountId: string) => void) | undefined
  requestsHref: string
}

/** What is waiting on the viewer. Items with no moment of their own lead the list. */
export function toAttentionItems({
  entries,
  readAccounts,
  chats,
  requests,
  reconnect,
  requestsHref,
}: AttentionInput): AttentionItem[] {
  const reconnects = new Map<string, Pick<AttentionItem, 'title' | 'detail'>>()
  for (const entry of entries) {
    for (const account of entry.accounts) {
      if (
        account.status === 'needs_reauth' &&
        entry.reconnectAccountIds.includes(account.credentialId)
      )
        reconnects.set(account.credentialId, {
          title: `Reconnect ${entry.name}`,
          detail: account.displayName,
        })
    }
  }
  for (const account of readAccounts) {
    if (account.problem === 'needs_reauth' && account.canReconnect && !reconnects.has(account.id))
      reconnects.set(account.id, {
        title: `Reconnect ${account.label}`,
        detail: 'Sim can no longer read this account',
      })
  }
  const items: AttentionItem[] = [...reconnects].map(([id, copy]) => ({
    ...copy,
    id: `reconnect-${id}`,
    icon: 'I070',
    onOpen: () => reconnect?.(id),
  }))
  for (const chat of chats) {
    if (!chat.isUnread) continue
    items.push({
      id: `chat-${chat.id}`,
      title: chat.title,
      detail: 'New reply in this chat',
      occurredAt: chat.updatedAt,
      icon: 'I073',
      href: chat.href,
    })
  }
  for (const request of requests) {
    items.push({
      id: `request-${request.id}`,
      title: `${request.requester.name || request.requester.email} asked for ${request.targetLabel}`,
      detail: request.reason ?? 'Waiting for your review',
      occurredAt: Date.parse(request.createdAt),
      icon: 'I015',
      href: requestsHref,
    })
  }
  return items.sort(
    (left, right) =>
      (right.occurredAt ?? Number.POSITIVE_INFINITY) - (left.occurredAt ?? Number.POSITIVE_INFINITY)
  )
}

type WorkspaceActivity = OrganizationHomeWorkspaceActivity['workspaces'][number]

function workspaceDetail({ status, statusWorkflowName, lastRun }: WorkspaceActivity) {
  if (status) return statusWorkflowName ?? undefined
  if (!lastRun) return 'No recent workflow runs'
  const label = lastRun.failed ? 'Last run failed' : 'Last run'
  return lastRun.workflowName ? `${label}: ${lastRun.workflowName}` : label
}

const STATUS_RANK = { review: 0, running: 1 } as const
const WITHOUT_STATUS_RANK = 2

function workspaceRank(item: HomeWorkspaceItem) {
  return item.status ? STATUS_RANK[item.status] : WITHOUT_STATUS_RANK
}

/**
 * The sidebar's rows and order, with what needs a person first, then what is live. A workspace the
 * read did not cover keeps its place among the rest and claims nothing.
 */
export function toHomeWorkspaceItems(
  workspaces: readonly Pick<HomeWorkspaceItem, 'id' | 'name' | 'href'>[],
  activity: OrganizationHomeWorkspaceActivity | undefined
): HomeWorkspaceItem[] {
  const byWorkspace = new Map(activity?.workspaces.map((row) => [row.workspaceId, row]))
  const items = workspaces.map((workspace): HomeWorkspaceItem => {
    const row = byWorkspace.get(workspace.id)
    if (!row) return { ...workspace }
    return {
      ...workspace,
      detail: workspaceDetail(row),
      ...(row.status ? { status: row.status } : {}),
      ...(!row.status && row.lastRun ? { lastRunAt: Date.parse(row.lastRun.startedAt) } : {}),
    }
  })
  return items.sort((left, right) => workspaceRank(left) - workspaceRank(right))
}
