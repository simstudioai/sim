import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

type DbModule = typeof import('./db')

let database: DbModule

/** postgres.js connects on first query, so unreachable URLs build real clients without a server. */
beforeAll(async () => {
  vi.stubEnv('SIM_DB_ROLE', undefined)
  vi.stubEnv('DATABASE_URL_WEB', undefined)
  vi.stubEnv('DATABASE_REPLICA_URL_WEB', undefined)
  vi.stubEnv('DATABASE_URL', 'postgres://127.0.0.1:1/primary')
  vi.stubEnv('DATABASE_REPLICA_URL', 'postgres://127.0.0.1:2/replica')
  database = await import('./db')
})

describe('isPrimaryPoolClient', () => {
  it('recognizes sub-pool clients, so process-wide caches keep serving their reads', () => {
    expect(database.isPrimaryPoolClient(database.db)).toBe(true)
    expect(database.isPrimaryPoolClient(database.dbFor('auth'))).toBe(true)
    expect(database.isPrimaryPoolClient(database.dbFor('billing'))).toBe(true)
  })

  it('rejects a separately configured replica, whose reads can lag the primary', () => {
    expect(database.dbReplica).not.toBe(database.db)
    expect(database.isPrimaryPoolClient(database.dbReplica)).toBe(false)
  })

  it('rejects an executor that is not one of the root clients', () => {
    expect(database.isPrimaryPoolClient({ ...database.db })).toBe(false)
  })
})
