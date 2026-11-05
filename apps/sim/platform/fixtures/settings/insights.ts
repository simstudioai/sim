import { settingsMembers } from '@/platform/fixtures/settings/members'
import { settingsWorkspaces } from '@/platform/fixtures/settings/organization'
import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'
import { csvRow } from '@/platform/lib/data/csv'
import type { OrganizationUsageBreakdown, UsageBreakdownDimension } from '@/platform/lib/data/usage'
import { calendarDayFormatter } from '@/platform/lib/time'

const DAY = 86_400_000
const HOUR = 3_600_000
const WORKFLOWS = [
  'Customer operations review',
  'Quarterly forecast',
  'Inbox triage',
  'Weekly report',
]
const MODELS = [
  { id: 'gpt-4.1', label: 'GPT-4.1', providerId: 'openai' },
  { id: 'claude-sonnet-4', label: 'Claude Sonnet 4', providerId: 'anthropic' },
]
const SOURCES = [
  'workflow',
  'workspace-chat',
  'workflow',
  'knowledge-base',
  'enrichment',
  'workspace-chat',
  'mothership_block',
  'api-tool',
] as const
const TRIGGERS = [
  { id: 'schedule', label: 'Schedule' },
  { id: 'api', label: 'API' },
]

function sampleLedger(state: SettingsFixtureState, formatDay: (time: number) => string) {
  const members = settingsMembers(state)
  const count = state.scenario === 'empty' ? 0 : state.scenario === 'stress' ? 610 : 164
  return Array.from({ length: count }, (_, index) => {
    const workspace = settingsWorkspaces[Math.floor(index / 3) % settingsWorkspaces.length]
    const member = members[index % members.length]
    const model = MODELS[Math.floor(index / 3) % MODELS.length]
    const source = SOURCES[index % SOURCES.length]
    const workflow =
      source === 'workflow' ? WORKFLOWS[Math.floor(index / 5) % WORKFLOWS.length] : null
    const byok = index % 5 === 0
    const time = state.referenceTime - index * (state.scenario === 'stress' ? 2 : 8) * HOUR
    return {
      id: `event-${index}`,
      time,
      day: Date.parse(formatDay(time)),
      workspace,
      member,
      model,
      workflow,
      source,
      billingSource: source === 'workspace-chat' ? 'sim-chat' : source,
      trigger: TRIGGERS[Math.floor(index / 3) % TRIGGERS.length],
      byok,
      credits: byok ? 0 : 1 + (index % 9),
      tokens: 700 + index * 13,
      failed: index % 7 === 0,
      duration: 1200 + (index % 13) * 180,
      description: workflow ?? (source === 'workspace-chat' ? 'Organization chat' : source),
    }
  })
}

type Ledger = ReturnType<typeof sampleLedger>
type Event = Ledger[number]
type Dimension = UsageBreakdownDimension | 'trigger'

function reportingWindow(params: URLSearchParams, today: number) {
  const preset = params.get('preset')
  const month = new Date(today)
  const monthStart = Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)
  if (preset === 'custom')
    return [
      Date.parse(params.get('startDate') ?? ''),
      Date.parse(params.get('endDate') ?? '') + DAY,
    ]
  if (preset === 'previous-period')
    return [Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1), monthStart]
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : null
  return [days ? today - (days - 1) * DAY : monthStart, today + DAY]
}

function groupFor(event: Event, dimension: Dimension) {
  switch (dimension) {
    case 'member':
      return { id: event.member.id, label: event.member.name }
    case 'workspace':
      return { id: event.workspace.id, label: event.workspace.name }
    case 'workflow':
      return (
        event.workflow && { id: `${event.workspace.id}-${event.workflow}`, label: event.workflow }
      )
    case 'model':
      return !event.byok && event.model
    case 'byok':
      return event.byok && event.model
    case 'trigger':
      return event.workflow && event.trigger
    case 'source':
      return { id: event.billingSource, label: event.billingSource }
  }
}

function breakdown(
  events: Ledger,
  dimension: UsageBreakdownDimension,
  limit: number
): OrganizationUsageBreakdown {
  const groups = new Map<string, OrganizationUsageBreakdown['rows'][number]>()
  for (const event of events) {
    const group = groupFor(event, dimension)
    if (!group) continue
    const row = groups.get(group.id) ?? { ...group, credits: 0, events: 0, tokens: 0, share: 0 }
    row.credits += event.credits
    row.events++
    row.tokens = (row.tokens ?? 0) + event.tokens
    groups.set(group.id, row)
  }
  const score = (row: OrganizationUsageBreakdown['rows'][number]) =>
    dimension === 'byok' ? (row.tokens ?? 0) : row.credits
  const sorted = [...groups.values()].sort(
    (a, b) => score(b) - score(a) || a.label.localeCompare(b.label)
  )
  const total = sorted.reduce((sum, row) => sum + score(row), 0)
  for (const row of sorted) row.share = total ? score(row) / total : 0
  const other = { credits: 0, events: 0, tokens: 0, rowCount: 0 }
  for (const row of sorted.slice(limit)) {
    other.credits += row.credits
    other.tokens += row.tokens ?? 0
    other.events += row.events
    other.rowCount++
  }
  return {
    dimension,
    rows: sorted.slice(0, limit),
    totalCredits: sorted.reduce((sum, row) => sum + row.credits, 0),
    other,
  }
}

function metrics(events: Ledger) {
  const workflows = events.filter((event) => event.workflow)
  const chats = events.filter((event) => event.source === 'workspace-chat')
  const failed = workflows.filter((event) => event.failed).length
  return {
    workflowRuns: workflows.length,
    completed: workflows.length - failed,
    failed,
    chatRuns: chats.length,
    chatMembers: new Set(chats.map((event) => event.member.id)).size,
    failureRate: workflows.length ? failed / workflows.length : null,
    averageDurationMs: workflows.length
      ? workflows.reduce((sum, event) => sum + event.duration, 0) / workflows.length
      : null,
  }
}

function activityBreakdown(events: Ledger, dimension: Dimension, params: URLSearchParams) {
  const groups = new Map<string, { id: string; label: string; entries: Ledger }>()
  for (const event of events) {
    if (!event.workflow && event.source !== 'workspace-chat') continue
    if (dimension === 'member' && event.source !== 'workspace-chat') continue
    const group = groupFor(event, dimension)
    if (!group) continue
    const row = groups.get(group.id) ?? { ...group, entries: [] }
    row.entries.push(event)
    groups.set(row.id, row)
  }
  const rows = [...groups.values()].map(({ entries, ...group }) => {
    const workspace =
      dimension === 'workspace' || dimension === 'workflow' ? entries[0].workspace : null
    return {
      ...group,
      ...metrics(entries),
      workspaceId: workspace?.id ?? null,
      workspaceName: workspace?.name ?? null,
    }
  })
  const sort = params.get('sort')
  const score = (row: (typeof rows)[number]) =>
    sort === 'failures'
      ? row.failed
      : sort === 'duration'
        ? (row.averageDurationMs ?? 0)
        : row.workflowRuns + row.chatRuns
  rows.sort((a, b) => score(b) - score(a) || a.label.localeCompare(b.label))
  const offset = Number(params.get('page') ?? 0) * 25
  return { rows: rows.slice(offset, offset + 25), hasMore: rows.length > offset + 25 }
}

function eventView(event: Event) {
  return {
    id: event.id,
    createdAt: new Date(event.time).toISOString(),
    source: event.source,
    description: event.description,
    workflowName: event.workflow,
    credits: event.credits,
    hasCost: event.credits > 0,
  }
}

function dailyBuckets(start: number, end: number, events: Ledger) {
  const byDay = new Map<number, Ledger>()
  for (const event of events) {
    const entries = byDay.get(event.day)
    if (entries) entries.push(event)
    else byDay.set(event.day, [event])
  }
  return Array.from({ length: (end - start) / DAY }, (_, index) => {
    const day = start + index * DAY
    return { timestamp: new Date(day).toISOString(), entries: byDay.get(day) ?? [] }
  })
}

export function insightsFixture(request: Request, path: string, state: SettingsFixtureState) {
  const prefix = `/api/organizations/${state.organizationId}/usage/`
  if (!path.startsWith(prefix) || request.method !== 'GET') return
  const key = path.slice(prefix.length)
  const params = new URL(request.url).searchParams
  const workspaceId = params.get('workspaceId')
  const workspace = settingsWorkspaces.find((item) => item.id === workspaceId) ?? null
  if (workspaceId && !workspace)
    return Response.json({ error: 'Workspace unavailable' }, { status: 404 })
  const formatDay = calendarDayFormatter(params.get('timezone') ?? 'UTC')
  const today = Date.parse(formatDay(state.referenceTime))
  const scoped = sampleLedger(state, formatDay).filter(
    (event) => !workspaceId || workspaceId === event.workspace.id
  )
  const totalCredits = (entries: Ledger) => entries.reduce((sum, event) => sum + event.credits, 0)
  if (key === 'calendar') {
    const days = dailyBuckets(today - 364 * DAY, today + DAY, scoped)
    return {
      days: days.map(({ timestamp, entries }) => {
        const credits = totalCredits(entries)
        return { date: timestamp.slice(0, 10), credits, hasCost: credits > 0 }
      }),
    }
  }
  const [start, end] = reportingWindow(params, today)
  if (!(end > start && (end - start) / DAY <= 92))
    return Response.json({ error: 'Invalid reporting window' }, { status: 400 })
  const events = scoped.filter((event) => event.day >= start && event.day < end)
  const dimension = params.get('dimension') ?? 'workspace'
  const limit = Number(params.get('limit') ?? 50)
  const sources = params.getAll('source')
  switch (key) {
    case 'breakdown':
      return breakdown(events, dimension as UsageBreakdownDimension, limit)
    case 'overview': {
      const currentPeriod = !params.has('preset') || params.get('preset') === 'current-period'
      const isPeriod = currentPeriod || params.get('preset') === 'previous-period'
      const previousStart = isPeriod
        ? Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth() - 1, 1)
        : start - (end - start)
      const previousEvents = scoped.filter(
        (event) => event.day >= previousStart && event.day < start
      )
      return {
        window: {
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          source: isPeriod ? 'reporting' : 'range',
        },
        bucket: 'day',
        totals: { credits: totalCredits(events) },
        previousTotals: { credits: totalCredits(previousEvents) },
        limitCredits: !workspaceId && currentPeriod ? 1000 : null,
        series: dailyBuckets(start, end, events).map(({ timestamp, entries }) => {
          const sources: Record<string, number> = {}
          for (const entry of entries)
            if (entry.credits)
              sources[entry.billingSource] = (sources[entry.billingSource] ?? 0) + entry.credits
          return { timestamp, credits: totalCredits(entries), sources }
        }),
        members: breakdown(events, 'member', 5),
      }
    }
    case 'events': {
      const offset = Number(params.get('cursor') ?? 0)
      const matches = events.filter((event) => !sources.length || sources.includes(event.source))
      const hasMore = offset + limit < matches.length
      return {
        events: matches.slice(offset, offset + limit).map(eventView),
        hasMore,
        ...(hasMore && { nextCursor: String(offset + limit) }),
      }
    }
    case 'export': {
      const rows = events
        .filter((event) => !sources.length || sources.includes(event.source))
        .map((event) =>
          csvRow([
            new Date(event.time).toISOString(),
            event.source,
            event.description,
            event.workflow ?? '',
            event.credits,
          ])
        )
      return new Response(['Date,Source,Description,Workflow,Credits', ...rows].join('\n'), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
      })
    }
    case 'activity/summary':
      return {
        workspace,
        totals: metrics(events),
        series: dailyBuckets(start, end, events).map(({ timestamp, entries }) => ({
          timestamp,
          ...metrics(entries),
        })),
      }
    case 'activity/breakdown':
      return activityBreakdown(events, dimension as Dimension, params)
  }
}
