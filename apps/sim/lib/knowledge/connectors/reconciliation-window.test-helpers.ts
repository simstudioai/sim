import { dbChainMockFns } from '@sim/testing/mocks/database.mock'
import { toRecord } from '@sim/utils/object'

/** Reconciliation window tallies, which read through `db.execute`, queued in call order. */
export const windowTallies: unknown[][] = []

interface WindowRow {
  id: string
  tombstoned: boolean
}

/**
 * The one-row result of a completed listing's tally over a connector shorter than a window: the
 * listed count, then the absent documents with ACLs, to soft-delete and to hard-delete.
 */
export function windowTally(tally: {
  owned: number
  listed: number
  acl?: WindowRow[]
  soft?: WindowRow[]
  hard?: WindowRow[]
}) {
  const matching: WindowRow[][] = [[], tally.acl ?? [], tally.soft ?? [], tally.hard ?? []]
  return [
    {
      size: tally.owned,
      last: tally.owned > 0 ? 'last-owned' : null,
      counts: [tally.listed, ...matching.slice(1).map((rows) => rows.length)],
      ids: matching.map((rows) => rows.map((row) => row.id)),
      tombstoned: matching.map((rows) => rows.map((row) => row.tombstoned)),
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

/**
 * Empties {@link windowTallies} and routes `db.execute`: a window tally takes the next queued
 * result, a window scan finds nothing, so a walk no test expects fails on its empty result, and
 * any other statement reads the database clock, `databaseTime` when given and the worker's clock
 * otherwise.
 */
export function routeWindowTallies(databaseTime?: Date) {
  windowTallies.length = 0
  dbChainMockFns.execute.mockImplementation(async (...args: unknown[]) => {
    const text = statementText(args[0])
    if (text.includes('MATERIALIZED'))
      return text.includes('json_build_array') ? (windowTallies.shift() ?? []) : []
    return [{ startedAt: (databaseTime ?? new Date()).toISOString() }]
  })
}
