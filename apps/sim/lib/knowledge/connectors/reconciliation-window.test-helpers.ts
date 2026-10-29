import { dbChainMockFns } from '@sim/testing/mocks/database.mock'
import { toRecord } from '@sim/utils/object'

/** Reconciliation window scans, which read through `db.execute`, queued in call order. */
export const windowScans: unknown[][] = []

/** Reconciliation window counts, which read through `db.execute`, queued in call order. */
export const windowCounts: unknown[][] = []

/** The one-row result of a completed listing's counts over a connector shorter than a window. */
export function windowCount(counts: {
  owned: number
  listed: number
  acl?: number
  soft: number
  hard: number
}) {
  return [
    {
      size: counts.owned,
      last: counts.owned > 0 ? 'last-owned' : null,
      matching: [counts.listed, counts.acl ?? 0, counts.soft, counts.hard],
    },
  ]
}

/** The one-row result of a reconciliation window scan shorter than a full window. */
export function windowScan(rows: { id: string; tombstoned: boolean }[]) {
  return [
    {
      size: rows.length,
      last: rows.at(-1)?.id ?? null,
      ids: rows.map((row) => row.id),
      tombstoned: rows.map((row) => row.tombstoned),
    },
  ]
}

/** The mocked `sql` renders only its own strings, so nested fragments are read through `values`. */
function statementText(query: unknown): string {
  const { strings, values } = toRecord(query)
  if (!Array.isArray(strings)) return ''
  return [...strings, ...(Array.isArray(values) ? values.map(statementText) : [])].join(' ')
}

function windowStatement(query: unknown): 'scan' | 'count' | null {
  const text = statementText(query)
  if (!text.includes('MATERIALIZED')) return null
  return text.includes('json_build_array') ? 'count' : 'scan'
}

/**
 * Empties {@link windowScans} and {@link windowCounts} and routes `db.execute`: a window scan or
 * count takes the next queued result of its kind, and any other statement reads the database
 * clock, `databaseTime` when given and the worker's clock otherwise.
 */
export function routeWindowScans(databaseTime?: Date) {
  windowScans.length = 0
  windowCounts.length = 0
  dbChainMockFns.execute.mockImplementation(async (...args: unknown[]) => {
    const statement = windowStatement(args[0])
    if (statement === 'scan') return windowScans.shift() ?? []
    if (statement === 'count') return windowCounts.shift() ?? []
    return [{ startedAt: (databaseTime ?? new Date()).toISOString() }]
  })
}
