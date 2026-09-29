import { toRecord } from '@sim/utils/object'
import type {
  QueryTableAnalyticsBody,
  QueryTableAnalyticsResponse,
} from '@/lib/api/contracts/table-analytics'
import {
  fillAnalyticsBuckets,
  floorAnalyticsBucket,
  resolveAnalyticsBucket,
} from '@/lib/table/analytics/buckets'
import {
  type AnalyticsQuery,
  type AnalyticsValue,
  analyticsQuerySchema,
} from '@/lib/table/analytics/schema'
import type { TableAnalyticsSource } from '@/hooks/queries/table-analytics'

type MockRow = Record<string, AnalyticsValue> & { createdAt: string }

interface MockTable {
  columnLabels: Record<string, string>
  rows: MockRow[]
}

const DAY_MS = 86_400_000
const HISTORY_DAYS = 45

/** Deterministic PRNG so the prototype renders the same numbers on every load. */
function mulberry32(seed: number) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(random: () => number, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = random() * total
  for (const [item, weight] of items) {
    roll -= weight
    if (roll <= 0) return item
  }
  return items[items.length - 1][0]
}

function generate(
  seed: number,
  perDay: number,
  build: (random: () => number, index: number) => Record<string, AnalyticsValue>
): MockRow[] {
  const random = mulberry32(seed)
  const now = Date.now()
  const rows: MockRow[] = []
  for (let day = HISTORY_DAYS; day >= 0; day--) {
    const weekday = new Date(now - day * DAY_MS).getUTCDay()
    const weekend = weekday === 0 || weekday === 6
    const count = Math.round(perDay * (weekend ? 0.55 : 1) * (0.75 + random() * 0.5))
    for (let i = 0; i < count; i++) {
      const at = now - day * DAY_MS - Math.floor(random() * DAY_MS)
      if (at > now) continue
      rows.push({ createdAt: new Date(at).toISOString(), ...build(random, rows.length) })
    }
  }
  return rows
}

const TABLES: Record<string, () => MockTable> = {
  tbl_example_support_tickets: () => ({
    columnLabels: {
      createdAt: 'Created at',
      col_ticket: 'Ticket',
      col_topic: 'Topic',
      col_channel: 'Channel',
      col_outcome: 'Outcome',
      col_ai_resolved_pct: 'AI resolved (%)',
      col_first_response_seconds: 'First response (s)',
    },
    rows: generate(7, 38, (random, index) => {
      const outcome = pick(random, [
        ['AI resolved', 62],
        ['Human resolved', 26],
        ['Escalated', 12],
      ] as const)
      return {
        col_ticket: `SUP-${4100 + index}`,
        col_topic: pick(random, [
          ['Billing', 24],
          ['Workflows', 30],
          ['Integrations', 22],
          ['Tables', 14],
          ['Account', 10],
        ] as const),
        col_channel: pick(random, [
          ['Chat', 50],
          ['Email', 32],
          ['Slack', 18],
        ] as const),
        col_outcome: outcome,
        col_ai_resolved_pct: outcome === 'AI resolved' ? 100 : 0,
        col_first_response_seconds:
          Math.round((3 + random() * (outcome === 'Escalated' ? 90 : 20)) * 10) / 10,
      }
    }),
  }),
  tbl_example_infra_incidents: () => ({
    columnLabels: {
      createdAt: 'Created at',
      col_alarm_name: 'Alarm name',
      col_source: 'Source',
      col_summary: 'Summary',
    },
    rows: generate(11, 3, (random) => {
      const alarm = pick(random, [
        ['api-p90-latency', 30],
        ['db-connection-saturation', 18],
        ['executor-queue-depth', 22],
        ['realtime-5xx', 12],
        ['trigger-task-failures', 18],
      ] as const)
      return {
        col_alarm_name: alarm,
        col_source: pick(random, [
          ['incident.io', 55],
          ['PagerDuty', 25],
          ['Manual', 20],
        ] as const),
        col_summary: `Investigated ${alarm}; root cause attached to run trace.`,
      }
    }),
  }),
  tbl_example_signups: () => ({
    columnLabels: {
      createdAt: 'Created at',
      col_email_domain: 'Domain',
      col_channel: 'Channel',
      col_activated_pct: 'Activated (%)',
      col_plan: 'Plan',
    },
    rows: generate(23, 64, (random) => {
      const channel = pick(random, [
        ['Organic', 40],
        ['Paid search', 22],
        ['Referral', 16],
        ['Content', 14],
        ['Partners', 8],
      ] as const)
      const activated = random() < (channel === 'Referral' ? 0.52 : 0.36)
      return {
        col_email_domain: pick(random, [
          ['gmail.com', 40],
          ['company', 60],
        ] as const),
        col_channel: channel,
        col_activated_pct: activated ? 100 : 0,
        col_plan: pick(random, [
          ['Free', 70],
          ['Pro', 24],
          ['Team', 6],
        ] as const),
      }
    }),
  }),
}

const cache = new Map<string, MockTable>()

function table(tableId: string): MockTable {
  const existing = cache.get(tableId)
  if (existing) return existing
  const build = TABLES[tableId]
  if (!build) throw new Error(`No mock rows for table ${tableId}`)
  const created = build()
  cache.set(tableId, created)
  return created
}

/** Walks the authored (pre-normalization) predicate; only `eq` leaves are used by the specs. */
function matches(row: MockRow, filter: unknown): boolean {
  const node = toRecord(filter)
  if (Array.isArray(node.all)) return node.all.every((part) => matches(row, part))
  if (Array.isArray(node.any)) return node.any.some((part) => matches(row, part))
  if (node.op !== 'eq' || typeof node.field !== 'string')
    throw new Error(`Mock analytics only supports eq filters, got ${String(node.op)}`)
  return row[node.field] === node.value
}

function aggregate(rows: MockRow[], measure: NonNullable<AnalyticsQuery['aggregate']>[string]) {
  if (measure.op === 'count') return rows.length
  if (measure.op === 'percent')
    return rows.length
      ? (100 * rows.filter((row) => matches(row, measure.filter)).length) / rows.length
      : null
  const field = measure.field
  if (!field) throw new Error(`${measure.op} requires a field`)
  const values = rows.map((row) => row[field]).filter((value) => value != null)
  if (measure.op === 'countDistinct') return new Set(values).size
  const numbers = values.filter((value): value is number => typeof value === 'number')
  if (!numbers.length) return null
  if (measure.op === 'avg') return numbers.reduce((a, b) => a + b, 0) / numbers.length
  if (measure.op === 'sum') return numbers.reduce((a, b) => a + b, 0)
  if (measure.op === 'min') return Math.min(...numbers)
  if (measure.op === 'max') return Math.max(...numbers)
  throw new Error(`Mock analytics does not support ${measure.op}`)
}

/** In-memory stand-in for `/api/table/[tableId]/analytics`, fed by seeded synthetic rows. */
export const mockTableAnalytics: TableAnalyticsSource = async (
  tableId: string,
  body: QueryTableAnalyticsBody
): Promise<QueryTableAnalyticsResponse> => {
  const query = analyticsQuerySchema.parse(body.query)
  const source = table(tableId)
  const time = query.timeField ?? 'createdAt'
  const from = Date.parse(query.from)
  const to = Date.parse(query.to)
  let rows = source.rows.filter((row) => {
    const at = Date.parse(String(row[time]))
    return at >= from && at < to
  })
  const filter = body.query.filter
  if (filter) rows = rows.filter((row) => matches(row, filter))

  const bucket = resolveAnalyticsBucket(query)
  let output: Record<string, AnalyticsValue>[]
  if (query.aggregate) {
    const groupBy = query.groupBy ?? []
    const groups = new Map<string, { keys: Record<string, AnalyticsValue>; rows: MockRow[] }>()
    for (const row of rows) {
      const keys = Object.fromEntries(
        groupBy.map((field) => [
          field,
          field === time && bucket
            ? floorAnalyticsBucket(String(row[field]), bucket).toISOString()
            : row[field],
        ])
      )
      const key = JSON.stringify(keys)
      const group = groups.get(key) ?? { keys, rows: [] }
      group.rows.push(row)
      groups.set(key, group)
    }
    if (!groupBy.length && !groups.size) groups.set('{}', { keys: {}, rows: [] })
    output = [...groups.values()].map((group) => ({
      ...group.keys,
      ...Object.fromEntries(
        Object.entries(query.aggregate ?? {}).map(([alias, measure]) => [
          alias,
          aggregate(group.rows, measure),
        ])
      ),
    }))
    if (bucket) {
      output.sort((a, b) => Date.parse(String(a[time])) - Date.parse(String(b[time])))
      output = fillAnalyticsBuckets(output, query, bucket)
    }
  } else {
    const columns = query.columns ?? Object.keys(source.columnLabels)
    output = [...rows]
      .sort((a, b) => String(b[time]).localeCompare(String(a[time])))
      .map((row) => Object.fromEntries(columns.map((field) => [field, row[field] ?? null])))
  }
  for (const sort of [...(query.sort ?? [])].reverse()) {
    const direction = sort.direction === 'desc' ? -1 : 1
    output.sort((a, b) => {
      const left = a[sort.field] ?? ''
      const right = b[sort.field] ?? ''
      return (left < right ? -1 : left > right ? 1 : 0) * direction
    })
  }
  const limit = query.limit ?? 500
  const columns = query.columns ?? [...(query.groupBy ?? []), ...Object.keys(query.aggregate ?? {})]
  return {
    rows: output.slice(0, limit),
    columns,
    columnLabels: Object.fromEntries(
      columns.map((field) => [field, source.columnLabels[field] ?? field])
    ),
    bucket,
    truncated: output.length > limit,
  }
}
