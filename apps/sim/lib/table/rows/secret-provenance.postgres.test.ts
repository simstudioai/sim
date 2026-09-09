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
import { loggingSessionMock } from '@sim/testing'
import { eq, sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROVENANCE_MAX_SERIALIZED_BYTES } from '@/lib/execution/provenance-limits'
import { createWorkflowCellProgressWriter } from '@/lib/table/cell-write'
import type { DbTransaction } from '@/lib/table/planner'
import {
  getTableSnapshotModelMountSafety,
  loadTableRowSecretProvenance,
  mutateTableRowsWithSecretProvenance,
  updateTableRowsWithDerivedSecretProvenance,
} from '@/lib/table/rows/secret-provenance'
import type { RowData, TableRowSecretProvenanceWrite } from '@/lib/table/types'
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
import type { ExecutionCallbacks } from '@/executor/execution/types'

const { database, mockIsEnforced, mockReport, mockError, mockExecuteWorkflowCore } = vi.hoisted(
  () => ({
    database: { current: undefined as PostgresJsDatabase | undefined },
    mockIsEnforced: vi.fn(() => false),
    mockReport: vi.fn(),
    mockError: vi.fn(),
    mockExecuteWorkflowCore: vi.fn(),
  })
)

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
  createLogger: () => ({ error: mockError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: vi.fn(async () => ({ decrypted: 'secret-value' })),
}))
vi.mock('@/lib/table/events', () => ({ appendTableEvent: vi.fn() }))
vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('@/lib/workflows/executor/execution-core', () => ({
  executeWorkflowCore: mockExecuteWorkflowCore,
}))
vi.mock('@/lib/workflows/executor/pause-persistence', () => ({
  handlePostExecutionPauseState: vi.fn(),
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
  data?: RowData
}

async function insertRow({
  id = 'row-1',
  version = 1,
  status,
  entries = [],
  stale,
  data = { retained: 'value', removed: 'other' },
}: Fixture) {
  if (!connection) throw new Error('PostgreSQL test database is not initialized')
  await connection`
    INSERT INTO user_table_rows (id, table_id, workspace_id, data, updated_at, secret_provenance_version)
    VALUES (${id}, 'table-1', 'workspace-1', ${JSON.stringify(data)}::jsonb, ${updatedAt.toISOString()}, ${version})
  `
  if (status !== undefined) {
    await connection`
      INSERT INTO user_table_row_secret_provenance (row_id, content_updated_at, status, entries)
      VALUES (${id}, ${(stale ? new Date(0) : updatedAt).toISOString()}, ${status}, ${JSON.stringify(entries)}::jsonb)
    `
  }
}

function wideRowFixture() {
  const scope = { userId: 'user-1', workspaceId: 'workspace-1' }
  const entries = Array.from({ length: 11 }, (_, index) => ({
    encryptedValue: `encrypted-${String(index).padStart(2, '0')}`,
    name: `SECRET_${index}`,
  }))
  const value = entries.map((entry) => entry.name).join(' ')
  const data: RowData = {}
  const provenance: TableRowSecretProvenanceWrite = { complete: true, columns: {} }
  for (let column = 0; column < 1_000; column++) {
    const columnId = `column-${String(column).padStart(3, '0')}`
    data[columnId] = value
    provenance.columns[columnId] = {
      version: 1,
      complete: true,
      entries,
      scope: column === 999 ? { ...scope, userId: 'foreign-user' } : scope,
    }
  }
  return { scope, entries, data, provenance }
}

async function writeWideRow() {
  if (!database.current) throw new Error('PostgreSQL test database is not initialized')
  const fixture = wideRowFixture()
  await database.current.transaction(async (tx) => {
    await mutateTableRowsWithSecretProvenance(tx as DbTransaction, {
      rows: [{ rowId: 'row-1', provenance: fixture.provenance }],
      rowState: 'new',
      mode: 'replace',
      mutate: async () => {
        await tx.execute(sql`
          INSERT INTO user_table_rows (id, table_id, workspace_id, data, updated_at)
          VALUES ('row-1', 'table-1', 'workspace-1', ${JSON.stringify(fixture.data)}::jsonb, ${updatedAt.toISOString()}::timestamp)
        `)
        return { value: undefined, affectedRowIds: ['row-1'] }
      },
    })
  })
  return fixture
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

  it.each(['exact', 'unknown', 'legacy'] as const)(
    'persists executor callback provenance across a retried partial write over a %s row',
    async (baseStatus) => {
      if (!connection || !database.current) throw new Error('PostgreSQL fixture unavailable')
      await insertRow({
        version: baseStatus === 'legacy' ? null : 1,
        ...(baseStatus === 'legacy' ? {} : { status: baseStatus }),
      })
      const onWriteError = vi.fn()
      let rejectFirstWrite = true
      const writer = createWorkflowCellProgressWriter({
        group: {
          id: 'group-1',
          workflowId: 'workflow-1',
          outputs: [
            { blockId: 'secret', path: 'output.value', columnName: 'derived' },
            { blockId: 'public', path: 'value', columnName: 'public' },
          ],
        },
        onWriteError,
        writeProgress: async ({ dataPatch, secretProvenance }) => {
          if (!dataPatch || !secretProvenance || !database.current)
            throw new Error('Missing progress data')
          if (rejectFirstWrite) {
            rejectFirstWrite = false
            throw new Error('Retryable write failure')
          }
          await database.current.transaction(async (tx) => {
            await mutateTableRowsWithSecretProvenance(tx as DbTransaction, {
              rows: [{ rowId: 'row-1', provenance: secretProvenance }],
              rowState: 'existing',
              mode: 'merge',
              mutate: async () => {
                await tx.execute(
                  sql`UPDATE user_table_rows SET data = data || ${JSON.stringify(dataPatch)}::jsonb WHERE id = 'row-1'`
                )
                return { value: undefined, affectedRowIds: ['row-1'] }
              },
            })
          })
          return 'wrote'
        },
      })
      mockExecuteWorkflowCore.mockImplementationOnce(
        async ({ callbacks }: { callbacks: ExecutionCallbacks }) => {
          for (const blockId of ['secret', 'public']) {
            await callbacks.onBlockComplete?.(blockId, blockId, 'function', {
              output:
                blockId === 'secret'
                  ? { output: { value: 'secret-value' } }
                  : { value: 'public-value' },
              resolvedSecretTraceProvenance: {
                version: 1,
                complete: true,
                entries:
                  blockId === 'secret'
                    ? [{ encryptedValue: 'encrypted-secret', name: 'SECRET' }]
                    : [],
                scope: { userId: 'user-1', workspaceId: 'workspace-1' },
              },
              executionTime: 1,
              executionOrder: 0,
              startedAt: updatedAt.toISOString(),
              endedAt: updatedAt.toISOString(),
            })
            await writer.waitForPendingWrites()
          }
          return {
            success: true,
            output: {},
            logs: [],
            status: 'completed',
            metadata: { duration: 1 },
          }
        }
      )
      await executeWorkflow(
        { id: 'workflow-1', userId: 'user-1', workspaceId: 'workspace-1' },
        'request-1',
        {},
        'user-1',
        {
          enabled: true,
          principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
          billingAttribution: {
            actorUserId: 'user-1',
            workspaceId: 'workspace-1',
            organizationId: null,
            billedAccountUserId: 'user-1',
            billingEntity: { type: 'user', id: 'user-1' },
            billingPeriod: { start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z' },
            payerSubscription: null,
          },
          onBlockComplete: writer.onBlockComplete,
        }
      )
      await writer.finish()
      expect(onWriteError).toHaveBeenCalledOnce()
      const rows = await connection`
        SELECT r.data, r.secret_provenance_version AS version, p.status, p.entries,
          p.content_updated_at = r.updated_at AS current
        FROM user_table_rows r JOIN user_table_row_secret_provenance p ON p.row_id = r.id WHERE r.id = 'row-1'
      `
      expect(rows).toEqual([
        {
          data: {
            retained: 'value',
            removed: 'other',
            derived: 'secret-value',
            public: 'public-value',
          },
          version: 1,
          status: baseStatus === 'unknown' ? 'unknown' : 'exact',
          entries:
            baseStatus === 'unknown'
              ? []
              : [
                  {
                    columnId: 'derived',
                    encryptedValue: 'encrypted-secret',
                    name: 'SECRET',
                    sourceUserId: 'user-1',
                    sourceWorkspaceId: 'workspace-1',
                  },
                ],
          current: true,
        },
      ])
    }
  )

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

  it('writes and reads 1,000 columns carrying eleven secrets without losing their column or source bindings', async () => {
    if (!connection) throw new Error('PostgreSQL test database is not initialized')
    const { scope, entries, data } = await writeWideRow()
    const [stored] = await connection`
      SELECT p.status, jsonb_array_length(p.entries) AS bindings,
        (SELECT count(DISTINCT entry ->> 'encryptedValue')::integer
          FROM jsonb_array_elements(p.entries) AS value(entry)) AS secrets,
        r.secret_provenance_version AS version, p.content_updated_at = r.updated_at AS current
      FROM user_table_rows r JOIN user_table_row_secret_provenance p ON p.row_id = r.id
    `
    expect(stored).toEqual({
      status: 'exact',
      bindings: 11_000,
      secrets: 11,
      version: 1,
      current: true,
    })
    for (const [columnId, expectedEntries] of [
      ['column-000', entries],
      ['column-999', entries.map(({ encryptedValue }) => ({ encryptedValue }))],
    ] as const) {
      await expect(
        loadTableRowSecretProvenance(
          [{ id: 'row-1', updatedAt, selectedValues: { [columnId]: data[columnId] } }],
          scope
        )
      ).resolves.toEqual({ version: 1, complete: true, entries: expectedEntries, scope })
    }
    expect(mockError).not.toHaveBeenCalled()
    expect(mockReport).not.toHaveBeenCalled()
  })

  it('preserves wide bindings through derived SQL and removes only the deleted column', async () => {
    if (!connection || !database.current)
      throw new Error('PostgreSQL test database is not initialized')
    const { scope, entries } = await writeWideRow()
    await database.current.transaction(async (tx) => {
      await updateTableRowsWithDerivedSecretProvenance(tx as DbTransaction, {
        rowWhere: eq(userTableRows.tableId, 'table-1'),
        transformation: {
          mode: 'preserve',
          dataExpression: sql`jsonb_set(${userTableRows.data}, '{column-000}', to_jsonb((${userTableRows.data} ->> 'column-000') || ' retained'))`,
        },
      })
    })
    const [preserved] = await connection`
      SELECT p.status, jsonb_array_length(p.entries) AS bindings,
        p.content_updated_at = r.updated_at AS current
      FROM user_table_rows r JOIN user_table_row_secret_provenance p ON p.row_id = r.id
    `
    expect(preserved).toEqual({ status: 'exact', bindings: 11_000, current: true })

    await database.current.transaction(async (tx) => {
      await updateTableRowsWithDerivedSecretProvenance(tx as DbTransaction, {
        rowWhere: eq(userTableRows.tableId, 'table-1'),
        transformation: { mode: 'remove-columns', columnIds: ['column-999'] },
      })
    })
    const [removed] = await connection`
      SELECT p.status, jsonb_array_length(p.entries) AS bindings,
        r.data ? 'column-999' AS has_removed_data,
        EXISTS (SELECT 1 FROM jsonb_array_elements(p.entries) AS value(entry)
          WHERE entry ->> 'columnId' = 'column-999') AS has_removed_binding,
        p.content_updated_at = r.updated_at AS current
      FROM user_table_rows r JOIN user_table_row_secret_provenance p ON p.row_id = r.id
    `
    expect(removed).toEqual({
      status: 'exact',
      bindings: 10_989,
      has_removed_data: false,
      has_removed_binding: false,
      current: true,
    })
    const [row] = await database.current
      .select({ updatedAt: userTableRows.updatedAt })
      .from(userTableRows)
    await expect(
      loadTableRowSecretProvenance([{ id: 'row-1', updatedAt: row.updatedAt }], scope)
    ).resolves.toEqual({ version: 1, complete: true, entries, scope })
    expect(mockError).not.toHaveBeenCalled()
  })

  it('merges a wide row without losing untouched column bindings', async () => {
    if (!connection || !database.current)
      throw new Error('PostgreSQL test database is not initialized')
    const { scope, entries, data } = await writeWideRow()
    await database.current.transaction(async (tx) => {
      await mutateTableRowsWithSecretProvenance(tx as DbTransaction, {
        rows: [
          {
            rowId: 'row-1',
            provenance: {
              complete: true,
              columns: { 'column-000': { version: 1, complete: true, entries: [] } },
            },
          },
        ],
        rowState: 'existing',
        mode: 'merge',
        mutate: async () => {
          await tx.execute(
            sql`UPDATE user_table_rows SET data = jsonb_set(data, '{column-000}', '"public"'::jsonb) WHERE id = 'row-1'`
          )
          return { value: undefined, affectedRowIds: ['row-1'] }
        },
      })
    })
    const [row] = await database.current
      .select({ updatedAt: userTableRows.updatedAt })
      .from(userTableRows)
    const [stored] =
      await connection`SELECT status, jsonb_array_length(entries) AS bindings FROM user_table_row_secret_provenance`
    expect(stored).toEqual({ status: 'exact', bindings: 10_989 })
    await expect(
      loadTableRowSecretProvenance(
        [{ id: 'row-1', updatedAt: row.updatedAt, selectedValues: { 'column-000': 'public' } }],
        scope
      )
    ).resolves.toEqual({ version: 1, complete: true, entries: [], scope })
    await expect(
      loadTableRowSecretProvenance(
        [
          {
            id: 'row-1',
            updatedAt: row.updatedAt,
            selectedValues: { 'column-001': data['column-001'] },
          },
        ],
        scope
      )
    ).resolves.toEqual({ version: 1, complete: true, entries, scope })
    expect(mockError).not.toHaveBeenCalled()
  })

  it.each(['distinct-secrets', 'serialized-bytes'] as const)(
    'keeps the %s bound in the real derived SQL predicate',
    async (limit) => {
      if (!connection || !database.current)
        throw new Error('PostgreSQL test database is not initialized')
      await insertRow({
        status: 'exact',
        entries:
          limit === 'distinct-secrets'
            ? Array.from({ length: 10_001 }, (_, index) => ({
                columnId: 'retained',
                encryptedValue: `encrypted-${index}`,
              }))
            : ['retained', 'removed'].map((columnId) => ({
                columnId,
                encryptedValue: 'x'.repeat(PROVENANCE_MAX_SERIALIZED_BYTES / 2),
              })),
      })
      await database.current.transaction(async (tx) => {
        await updateTableRowsWithDerivedSecretProvenance(tx as DbTransaction, {
          rowWhere: eq(userTableRows.tableId, 'table-1'),
          transformation: {
            mode: 'preserve',
            dataExpression: sql`${userTableRows.data} || '{"removed":"changed"}'::jsonb`,
          },
        })
      })
      expect(
        await connection`SELECT status, entries FROM user_table_row_secret_provenance`
      ).toEqual([{ status: 'unknown', entries: [] }])
      expect(mockError).toHaveBeenCalledWith(
        'Table row write staged unrecorded secret provenance',
        expect.objectContaining({ cause: 'derived-base-unnormalizable', rowCount: 1 })
      )
    }
  )
})
