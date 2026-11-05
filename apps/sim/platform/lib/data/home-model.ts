import type { SearchHistoryResponse } from '@/lib/api/contracts/knowledge/search-history'
import type { OrganizationActivitySummary } from '@/lib/api/contracts/organization-activity'
import type {
  HomeWidgetAccount,
  OrganizationHomeCalendar,
  OrganizationHomeEmail,
} from '@/lib/api/contracts/organization-home'
import { getWallClockParts } from '@/lib/core/utils/timezone'
import type { MemberIntegration } from '@/lib/credential-groups/member-integrations'
import type {
  CalendarMeeting,
  EmailItem,
  HomeAccountView,
  HomeCalendarDay,
  HomeConnectOption,
  HomeWidgetState,
} from '@/platform/app/(shell)/home/_components/model'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { providerMark } from '@/platform/design-system/components/icon/provider-marks'
import type { RecentItem } from '@/platform/design-system/components/recent-items/recent-items'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'

/** The gate on the member Integrations page, whose inventory the Home widgets read. */
export function canReadHomeIntegrations(organization: PlatformOrganization): boolean {
  const { searchAccess, viewer, connectedAccountsAvailable } = organization
  return (
    searchAccess.memberScoped && viewer.canConnectSearchIntegrations && connectedAccountsAvailable
  )
}

interface HomeWidgetSource {
  /** The member inventory entry this widget draws on, so both surfaces agree by construction. */
  entryId: string
  icon: IconName
}

/** Outlook appears twice on purpose: one Microsoft account serves both mail and calendar. */
export const HOME_EMAIL_SOURCES: readonly HomeWidgetSource[] = [
  { entryId: 'source:gmail', icon: 'I005' },
  { entryId: 'app:outlook', icon: 'I120' },
]
export const HOME_CALENDAR_SOURCES: readonly HomeWidgetSource[] = [
  { entryId: 'source:google_calendar', icon: 'I088' },
  { entryId: 'app:outlook', icon: 'I120' },
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
  /** A refusal means the viewer has no inventory; anything else can be retried. */
  failure: 'refused' | 'failed' | undefined
  retrying: boolean
  sources: readonly HomeWidgetSource[]
}

/** Where a widget stands before any provider is asked, from the member inventory alone. */
export function toHomeConnection({
  allowed,
  entries,
  failure,
  retrying,
  sources,
}: HomeConnectionInput): HomeConnection {
  if (!allowed || failure === 'refused') return { status: 'not_offered' }
  if (failure === 'failed') return { status: 'error', retrying }
  if (!entries) return { status: 'loading' }
  const matched = sources.flatMap((source) => {
    const entry = entries.find((candidate) => candidate.id === source.entryId)
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
  return read.map((account) => ({
    id: account.credentialId,
    label: account.displayName,
    canReconnect: connected.some((view) => view.id === account.credentialId && view.canReconnect),
    ...(account.state === 'ready' ? {} : { problem: account.state }),
  }))
}

/** Resolves a read whose accounts all failed, the same way each time for email and calendar. */
export function settleReadAccounts(
  accounts: readonly HomeAccountView[]
): Extract<HomeWidgetState<never>, { status: 'not_offered' | 'needs_reauth' | 'error' }> | null {
  if (accounts.length === 0 || accounts.some((account) => !account.problem)) return null
  if (accounts.every((account) => account.problem === 'not_offered'))
    return { status: 'not_offered' }
  const reauth = accounts.filter((account) => account.problem === 'needs_reauth')
  return reauth.length
    ? { status: 'needs_reauth', accounts: reauth }
    : { status: 'error', retrying: false }
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

/** A wall-clock minute of the requested day; an instant outside it clamps to that day's edge. */
function minuteOfDay(
  instant: string,
  window: OrganizationHomeCalendar['window'],
  timeZone: string
) {
  if (instant <= window.startAt) return 0
  if (instant >= window.endAt) return MINUTES_PER_DAY
  const { hour, minute } = getWallClockParts(new Date(instant), timeZone)
  return hour * 60 + minute
}

export function toCalendarDay(
  calendar: OrganizationHomeCalendar,
  day: { date: string; nowMinute: number | null; timeZone: string }
): HomeCalendarDay {
  const meetings: CalendarMeeting[] = []
  const allDay: HomeCalendarDay['allDay'][number][] = []
  for (const event of calendar.events) {
    const id = `${event.credentialId}:${event.id}`
    if (event.allDay) {
      allDay.push({ id, title: event.title, providerUrl: event.url })
      continue
    }
    const startMinute = minuteOfDay(event.startAt, calendar.window, day.timeZone)
    meetings.push({
      id,
      title: event.title,
      startMinute,
      duration: Math.max(1, minuteOfDay(event.endAt, calendar.window, day.timeZone) - startMinute),
      providerUrl: event.url,
      people: event.people,
    })
  }
  return { date: day.date, nowMinute: day.nowMinute, status: 'ready', meetings, allDay }
}

/** The calendar day an instant falls on in a zone. */
export function localDate(instant: Date, timeZone: string): string {
  const { year, month, day } = getWallClockParts(instant, timeZone)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

/**
 * "Tasks run" counts both things Sim ran on the organization's behalf: workflow runs and chat runs.
 * Buckets arrive at the start of the viewer's calendar days, one for every day in the window.
 */
export function toTaskPoints(summary: OrganizationActivitySummary, timeZone: string) {
  return summary.series.map((point) => ({
    date: localDate(new Date(point.timestamp), timeZone),
    value: point.workflowRuns + point.chatRuns,
  }))
}

export function toRecentItems(history: SearchHistoryResponse): RecentItem[] {
  return history.sources.map((source) => {
    const mark = source.connectorType ? providerMark(source.connectorType) : undefined
    return {
      id: source.url,
      label: source.title ?? source.siteName ?? new URL(source.url).hostname,
      href: source.url,
      icon: typeof mark === 'string' ? mark : undefined,
    }
  })
}

export function minuteOfToday(nowMs: number, timeZone: string): number {
  const { hour, minute } = getWallClockParts(new Date(nowMs), timeZone)
  return hour * 60 + minute
}

export function greetingAt(nowMs: number | null, timeZone: string): string {
  if (nowMs === null) return 'Welcome'
  const { hour } = getWallClockParts(new Date(nowMs), timeZone)
  if (hour < 12) return 'Good morning'
  return hour < 18 ? 'Good afternoon' : 'Good evening'
}
