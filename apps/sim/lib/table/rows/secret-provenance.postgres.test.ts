/**
 * @vitest-environment node
 *
 * Runs the real Drizzle queries against temporary PostgreSQL tables. Set
 * TABLE_PROVENANCE_TEST_DATABASE_URL to a local test database to include this suite.
 * From apps/sim, run:
 * `TABLE_PROVENANCE_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/postgres bun run test lib/table/rows/secret-provenance.postgres.test.ts`
 * CI needs a local PostgreSQL service and this variable; the default unit suite separately
 * checks flag policy, stale-snapshot reporting, and write-event attribution without a database.
 */
import { userTableRows } from '@sim/db/schema'
import { eq, sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbTransaction } from '@/lib/table/planner'
import {
  getTableSnapshotModelMountSafety,
  mutateTableRowsWithSecretProvenance,
  updateTableRowsWithDerivedSecretProvenance,
} from '@/lib/table/rows/secret-provenance'

const { database, mockIsEnforced, mockReport, mockError } = vi.hoisted(() => ({
  database: { current: undefined as PostgresJsDatabase | undefined },
  mockIsEnforced: vi.fn(() => false),
  mockReport: vi.fn(),
  mockError: vi.fn(),
}))

vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')
vi.mock('@sim/db', () => ({
  db: {
    select: (...args: unknown[]) => {
      if (!database.current) throw new Error('PostgreSQL test database is not initialized')
      return Reflect.apply(database.current.select, database.current, args)
    },
  },
}))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: mockError, warn: vi.fn() }),
}))
vi.mock('@/lib/execution/durable-secret-provenance-enforcement', () => ({
  isDurableSecretProvenanceEnforced: mockIsEnforced,
  reportUnrecordedDurableProvenance: mockReport,
}))

const databaseUrl = process.env.TABLE_PROVENANCE_TEST_DATABASE_URL
if (databaseUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('Table provenance PostgreSQL tests require a local database')
}
const connection = databaseUrl ? postgres(databaseUrl, { max: 1 }) : undefined
const updatedAt = new Date('2026-08-05T00:00:00.123Z')
const secretEntry = { columnId: 'retained', encryptedValue: 'encrypted-secret', name: 'SECRET' }

interface Fixture {
  id?: string
  version?: number | null
  status?: string
  entries?: unknown
  stale?: boolean
}

async function insertRow({ id = 'row-1', version = 1, status, entries = [], stale }: Fixture) {
  if (!connection) throw new Error('PostgreSQL test database is not initialized')
  await connection`
    INSERT INTO user_table_rows (id, table_id, workspace_id, data, updated_at, secret_provenance_version)
    VALUES (${id}, 'table-1', 'workspace-1', '{"retained":"value","removed":"other"}', ${updatedAt.toISOString()}, ${version})
  `
  if (status !== undefined) {
    await connection`
      INSERT INTO user_table_row_secret_provenance (row_id, content_updated_at, status, entries)
      VALUES (${id}, ${(stale ? new Date(0) : updatedAt).toISOString()}, ${status}, ${JSON.stringify(entries)}::jsonb)
    `
  }
}

describe.skipIf(!databaseUrl)('table provenance in PostgreSQL', () => {
  beforeAll(async () => {
    if (!connection) throw new Error('PostgreSQL test database is not initialized')
    database.current = drizzle(connection)
    await connection.unsafe(`
      CREATE TEMP TABLE user_table_definitions (id text PRIMARY KEY, workspace_id text NOT NULL, rows_version integer NOT NULL);
      CREATE TEMP TABLE user_table_rows (
        id text PRIMARY KEY, table_id text NOT NULL, workspace_id text NOT NULL,
        data jsonb NOT NULL, updated_at timestamp NOT NULL, secret_provenance_version integer
      );
      CREATE TEMP TABLE user_table_row_secret_provenance (
        row_id text PRIMARY KEY, content_updated_at timestamp NOT NULL,
        status text NOT NULL, entries jsonb NOT NULL, updated_at timestamp DEFAULT now()
      );
      CREATE FUNCTION pg_temp.demote_changed_row() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
          IF NEW.data IS DISTINCT FROM OLD.data THEN
            NEW.updated_at := clock_timestamp();
            NEW.secret_provenance_version := NULL;
          END IF;
          RETURN NEW;
        END
      $body$;
      CREATE TRIGGER demote_changed_row BEFORE UPDATE ON user_table_rows
        FOR EACH ROW EXECUTE FUNCTION pg_temp.demote_changed_row();
    `)
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    mockIsEnforced.mockReturnValue(false)
    if (!connection) throw new Error('PostgreSQL test database is not initialized')
    await connection.unsafe(
      'TRUNCATE user_table_rows, user_table_row_secret_provenance, user_table_definitions'
    )
    await connection`INSERT INTO user_table_definitions VALUES ('table-1', 'workspace-1', 7)`
  })

  afterAll(async () => {
    await connection?.end()
  })

  it.each([
    { name: 'missing sidecar', fixture: {}, unrecorded: true },
    { name: 'stored unknown', fixture: { status: 'unknown' }, unrecorded: true },
    { name: 'stale binding', fixture: { status: 'exact', stale: true }, unrecorded: true },
    { name: 'unsupported tracked version', fixture: { version: 2 }, unrecorded: true },
    { name: 'legacy row', fixture: { version: null }, unrecorded: false },
    {
      name: 'legacy row with an obsolete sidecar',
      fixture: { version: null, status: 'unknown', stale: true },
      unrecorded: false,
    },
    { name: 'exact-empty', fixture: { status: 'exact' }, unrecorded: false },
  ])('classifies $name explicitly under both flag settings', async ({ fixture, unrecorded }) => {
    await insertRow(fixture)
    for (const enforced of [false, true]) {
      mockIsEnforced.mockReturnValue(enforced)
      mockReport.mockClear()
      await expect(
        getTableSnapshotModelMountSafety({
          tableId: 'table-1',
          workspaceId: 'workspace-1',
          rowsVersion: 7,
        })
      ).resolves.toBe(enforced && unrecorded ? 'unsafe-provenance' : 'safe')
      expect(mockReport).toHaveBeenCalledTimes(unrecorded && !enforced ? 1 : 0)
    }
  })

  it.each([
    { name: 'known secret entries', entries: [secretEntry] },
    { name: 'malformed array', entries: [null] },
    { name: 'malformed object', entries: {} },
  ])(
    'keeps $name unsafe with the flag off and does not report a proceeded read',
    async ({ entries }) => {
      await insertRow({ status: 'exact', entries })
      await insertRow({ id: 'unrecorded-row', status: 'unknown' })
      await expect(
        getTableSnapshotModelMountSafety({
          tableId: 'table-1',
          workspaceId: 'workspace-1',
          rowsVersion: 7,
        })
      ).resolves.toBe('unsafe-provenance')
      expect(mockReport).not.toHaveBeenCalled()
    }
  )

  it('returns one count for a stable allowed snapshot containing several unrecorded rows', async () => {
    await insertRow({ id: 'missing' })
    await insertRow({ id: 'unknown', status: 'unknown' })
    await expect(
      getTableSnapshotModelMountSafety({
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        rowsVersion: 7,
      })
    ).resolves.toBe('safe')
    expect(mockReport).toHaveBeenCalledExactlyOnceWith({
      surface: 'table-row',
      cause: 'row-sidecar-not-exact',
      affectedCount: 2,
      workspaceId: 'workspace-1',
    })
  })

  it('preserves legacy compatibility and records every SQL-derived unknown by cause', async () => {
    if (!connection || !database.current)
      throw new Error('PostgreSQL test database is not initialized')
    await insertRow({ id: 'legacy', version: null, status: 'unknown', stale: true })
    await insertRow({ id: 'exact', status: 'exact', entries: [secretEntry] })
    await insertRow({ id: 'unknown', status: 'unknown' })
    await insertRow({
      id: 'malformed',
      status: 'exact',
      entries: [{ encryptedValue: 'missing-column' }],
    })

    await database.current.transaction(async (tx) => {
      const count = await updateTableRowsWithDerivedSecretProvenance(tx as DbTransaction, {
        rowWhere: eq(userTableRows.tableId, 'table-1'),
        transformation: { mode: 'remove-columns', columnIds: ['removed'] },
      })
      expect(count).toBe(4)
    })
    const rows = await connection`
      SELECT r.id, r.secret_provenance_version AS version, p.status, p.entries,
        p.content_updated_at = r.updated_at AS current
      FROM user_table_rows r JOIN user_table_row_secret_provenance p ON p.row_id = r.id ORDER BY r.id
    `
    expect(rows).toEqual([
      { id: 'exact', version: 1, status: 'exact', entries: [secretEntry], current: true },
      { id: 'legacy', version: 1, status: 'exact', entries: [], current: true },
      { id: 'malformed', version: 1, status: 'unknown', entries: [], current: true },
      { id: 'unknown', version: 1, status: 'unknown', entries: [], current: true },
    ])
    for (const cause of ['derived-base-unvouchable', 'derived-base-unnormalizable']) {
      expect(mockError).toHaveBeenCalledWith(
        'Table row write staged unrecorded secret provenance',
        {
          surface: 'table-row',
          cause,
          mode: 'remove-columns',
          rowCount: 1,
          workspaceId: 'workspace-1',
          tableId: 'table-1',
        }
      )
    }
    expect(mockError).toHaveBeenCalledTimes(2)
  })

  it('applies the same derived logging to preserved-column transformations', async () => {
    if (!database.current) throw new Error('PostgreSQL test database is not initialized')
    await insertRow({ status: 'unknown' })
    await database.current.transaction(async (tx) => {
      await updateTableRowsWithDerivedSecretProvenance(tx as DbTransaction, {
        rowWhere: eq(userTableRows.tableId, 'table-1'),
        transformation: {
          mode: 'preserve',
          dataExpression: sql`${userTableRows.data} || '{"added":true}'::jsonb`,
        },
      })
    })
    expect(mockError).toHaveBeenCalledExactlyOnceWith(
      'Table row write staged unrecorded secret provenance',
      {
        surface: 'table-row',
        cause: 'derived-base-unvouchable',
        mode: 'preserve',
        rowCount: 1,
        workspaceId: 'workspace-1',
        tableId: 'table-1',
      }
    )
  })

  it('counts ordinary writes from rows actually bound rather than planned or nonexistent rows', async () => {
    if (!connection || !database.current)
      throw new Error('PostgreSQL test database is not initialized')
    await insertRow({ id: 'written', version: null })
    await insertRow({ id: 'untouched', version: null })
    await database.current.transaction(async (tx) => {
      await mutateTableRowsWithSecretProvenance(tx as DbTransaction, {
        rows: ['written', 'untouched', 'nonexistent'].map((rowId) => ({
          rowId,
          provenance: { complete: false, columns: {} },
        })),
        rowState: 'new',
        mode: 'replace',
        mutate: async () => ({ value: undefined, affectedRowIds: ['written', 'nonexistent'] }),
      })
    })
    const sidecars = await connection`SELECT row_id, status FROM user_table_row_secret_provenance`
    expect(sidecars).toEqual([{ row_id: 'written', status: 'unknown' }])
    expect(mockError).toHaveBeenCalledExactlyOnceWith(
      'Table row write staged unrecorded secret provenance',
      {
        surface: 'table-row',
        cause: 'incoming-provenance-incomplete',
        mode: 'replace',
        rowCount: 1,
        workspaceId: 'workspace-1',
        tableId: 'table-1',
      }
    )
  })
})
