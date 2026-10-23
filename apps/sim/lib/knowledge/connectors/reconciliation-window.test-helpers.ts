import { dbChainMockFns } from '@sim/testing/mocks/database.mock'
import { toRecord } from '@sim/utils/object'

/** Reconciliation window scans, which read through `db.execute`, queued in call order. */
export const windowScans: unknown[][] = []

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

function isWindowScan(query: unknown) {
  const { toSQL } = toRecord(query)
  return typeof toSQL === 'function' && String(toSQL().sql).includes('MATERIALIZED')
}

/**
 * Empties {@link windowScans} and routes `db.execute`: a window scan takes the next queued
 * result, and any other statement reads the database clock.
 */
export function routeWindowScans() {
  windowScans.length = 0
  dbChainMockFns.execute.mockImplementation(async (...args: unknown[]) =>
    isWindowScan(args[0]) ? (windowScans.shift() ?? []) : [{ startedAt: new Date().toISOString() }]
  )
}
