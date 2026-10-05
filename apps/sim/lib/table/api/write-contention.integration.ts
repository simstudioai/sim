/**
 * A row write that loses a lock race must answer every table surface with a retryable 503, not the
 * generic 500. The races are real: a second session holds the lock the write needs until the
 * write's 3 s `lock_timeout` fires, and the error the service throws is projected as thrown.
 */
import { db } from '@sim/db'
import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { storageServiceMock } from '@sim/testing/mocks/storage-service.mock'
import { tableBillingMock, tableBillingMockFns } from '@sim/testing/mocks/table-billing.mock'
import { tableTriggerMock } from '@sim/testing/mocks/table-trigger.mock'
import { tableWorkflowColumnsMock } from '@sim/testing/mocks/table-workflow-columns.mock'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/table/billing', () => tableBillingMock)
vi.mock('@/lib/table/trigger', () => tableTriggerMock)
vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

import {
  internalTableRowsErrorPolicy,
  v2TableRowsErrorPolicy,
} from '@/lib/table/api/row-route-policies'
import { getDeleteSnapshotBatchSize, TABLE_LIMITS } from '@/lib/table/constants'
import { TablePartialWriteError } from '@/lib/table/errors'
import { deleteRowsByFilter, insertRow, updateRowsByFilter } from '@/lib/table/rows/service'
import { getTableById } from '@/lib/table/service'
import type { TableDefinition } from '@/lib/table/types'
import { orchestrationErrorResponse } from '@/app/api/table/utils'

const url = readTestDatabaseUrl()
if (process.env.DATABASE_URL !== url) {
  throw new Error('This suite requires only the disposable local test database')
}
const control = postgres(url, { max: 2, onnotice: () => {} })
const workspaceId = generateId()
const userId = generateId()

/** Only the migrated deferred trigger bumps `rows_version` at COMMIT; `db:push` installs none. */
const [{ migrated }] = await control<{ migrated: boolean }[]>`SELECT EXISTS (
  SELECT 1 FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE t.tgrelid = 'user_table_rows'::regclass
    AND t.tgname = 'user_table_rows_version_update_trigger'
    AND t.tgconstraint <> 0
    AND t.tginitdeferred
    AND p.proname = 'bump_user_table_rows_version_at_commit'
) AS migrated`

async function createTable(): Promise<TableDefinition> {
  const id = generateId()
  await db.insert(userTableDefinitions).values({
    id,
    workspaceId,
    name: id,
    schema: { columns: [{ id: 'note', name: 'note', type: 'string' }] },
    createdBy: userId,
  })
  const table = await getTableById(id)
  if (!table) throw new Error('Fixture table was not created')
  return table
}

/** Seeds `count` rows whose id order and row order agree, created before any write's cutoff. */
async function seedNotes(tableId: string, count: number): Promise<string[]> {
  const ids = Array.from(
    { length: count },
    (_, index) => `${tableId}-${String(index).padStart(4, '0')}`
  )
  const createdAt = new Date(Date.now() - 60_000)
  await db.insert(userTableRows).values(
    ids.map((id, index) => ({
      id,
      tableId,
      workspaceId,
      data: { note: 'n' },
      orderKey: `a${String(index).padStart(4, '0')}`,
      createdAt,
    }))
  )
  return ids
}

/** Runs `write` while a second session holds whatever `hold` locks, and returns what it threw. */
async function failedUnderLock(
  hold: (holder: postgres.ReservedSql) => Promise<unknown>,
  write: () => Promise<unknown>
): Promise<unknown> {
  const holder = await control.reserve()
  try {
    await holder`BEGIN`
    await hold(holder)
    return await write().then(
      () => {
        throw new Error('The write succeeded while its lock was held')
      },
      (error: unknown) => error
    )
  } finally {
    await holder`ROLLBACK`
    holder.release()
  }
}

/** The PL/pgSQL context Postgres attached to the error, from the driver error under Drizzle's wrapper. */
function postgresErrorContext(error: unknown): string | undefined {
  let current = error
  while (current instanceof Error) {
    if ('where' in current && typeof current.where === 'string') return current.where
    current = current.cause
  }
  return undefined
}

/** Every surface leaves the failure to the route's generic 500 rather than inviting a retry. */
async function expectNotRetryableOnAnySurface(error: unknown) {
  expect(internalTableRowsErrorPolicy.project(error)).toBeNull()
  expect(v2TableRowsErrorPolicy.render(error)).toBeNull()
  expect(orchestrationErrorResponse(error)).toBeNull()
}

async function expectRetryableOnEverySurface(error: unknown) {
  const internal = internalTableRowsErrorPolicy.project(error)
  expect(internal?.status).toBe(503)
  expect(new Headers(internal?.headers).get('Retry-After')).toBe('5')

  const v2 = v2TableRowsErrorPolicy.render(error)
  expect(v2?.status).toBe(503)
  expect(v2?.headers.get('Retry-After')).toBe('5')
  expect(await v2?.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } })

  const legacy = orchestrationErrorResponse(error)
  expect(legacy?.status).toBe(503)
  expect(legacy?.headers.get('Retry-After')).toBe('5')
}

describe('table writes that lose a lock race', () => {
  beforeAll(async () => {
    await control`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES (${userId}, 'Write contention fixture', ${`${userId}@example.test`}, true, now(), now())`
    await control`INSERT INTO workspace (id, name, owner_id, billed_account_user_id)
      VALUES (${workspaceId}, 'Write contention fixtures', ${userId}, ${userId})`
  })

  beforeEach(() => {
    tableBillingMockFns.mockAssertRowCapacity.mockResolvedValue(10_000)
  })

  afterAll(async () => {
    await control`DELETE FROM workspace WHERE id = ${workspaceId}`
    await control`DELETE FROM "user" WHERE id = ${userId}`
    await control.end()
  })

  it('answers an insert blocked on the row-order lock with a retryable 503', async () => {
    const table = await createTable()

    const error = await failedUnderLock(
      (holder) =>
        holder`SELECT pg_advisory_xact_lock(hashtextextended(${`user_table_rows_pos:${table.id}`}, 0))`,
      () =>
        insertRow(
          {
            tableId: table.id,
            workspaceId,
            data: { note: 'blocked' },
            secretProvenance: undefined,
            capabilityGovernedUserId: null,
          },
          table,
          'contention-insert'
        )
    )

    await expectRetryableOnEverySurface(error)
  })

  it.skipIf(!migrated)(
    'answers an update whose commit cannot take the definition row with a retryable 503',
    async () => {
      const table = await createTable()
      await db.insert(userTableRows).values({
        id: `${table.id}-row`,
        tableId: table.id,
        workspaceId,
        data: { note: 'n' },
        orderKey: 'a0',
      })

      const error = await failedUnderLock(
        (holder) =>
          holder`SELECT 1 FROM user_table_definitions WHERE id = ${table.id} FOR NO KEY UPDATE`,
        () =>
          updateRowsByFilter(
            table,
            {
              filter: { note: 'n' },
              data: { note: 'patched' },
              limit: 1,
              secretProvenance: undefined,
              capabilityGovernedUserId: null,
            },
            'contention-update'
          )
      )

      expect(postgresErrorContext(error)).toContain('bump_user_table_rows_version_at_commit')
      await expectRetryableOnEverySurface(error)
      const [row] = await control`SELECT data FROM user_table_rows
        WHERE id = ${`${table.id}-row`} AND table_id = ${table.id} AND workspace_id = ${workspaceId}`
      expect(row.data).toEqual({ note: 'n' })
    }
  )

  it('leaves a filtered update that loses a lock race after a committed page non-retryable', async () => {
    const table = await createTable()
    const ids = await seedNotes(table.id, TABLE_LIMITS.UPDATE_BATCH_SIZE + 1)
    const lastId = ids[ids.length - 1]

    const error = await failedUnderLock(
      (holder) => holder`SELECT 1 FROM user_table_rows
        WHERE id = ${lastId} AND table_id = ${table.id} AND workspace_id = ${workspaceId}
        FOR UPDATE`,
      () =>
        updateRowsByFilter(
          table,
          {
            filter: { note: 'n' },
            data: { note: 'patched' },
            secretProvenance: undefined,
            capabilityGovernedUserId: null,
          },
          'contention-partial-update'
        )
    )

    expect(error).toBeInstanceOf(TablePartialWriteError)
    expect(error).toMatchObject({ committedCount: TABLE_LIMITS.UPDATE_BATCH_SIZE })
    await expectNotRetryableOnAnySurface(error)
  })

  it('leaves a limited filtered delete that loses a lock race after a committed batch non-retryable', async () => {
    const table = await createTable()
    const batchSize = getDeleteSnapshotBatchSize()
    const ids = await seedNotes(table.id, batchSize + 1)
    const lastId = ids[ids.length - 1]

    const error = await failedUnderLock(
      (holder) => holder`SELECT 1 FROM user_table_rows
        WHERE id = ${lastId} AND table_id = ${table.id} AND workspace_id = ${workspaceId}
        FOR UPDATE`,
      () =>
        deleteRowsByFilter(
          table,
          { filter: { note: 'n' }, limit: batchSize + 1 },
          'contention-partial-delete'
        )
    )

    expect(error).toBeInstanceOf(TablePartialWriteError)
    expect(error).toMatchObject({ committedCount: batchSize })
    await expectNotRetryableOnAnySurface(error)
    const [{ remaining }] = await control<{ remaining: number }[]>`SELECT count(*)::int AS remaining
      FROM user_table_rows WHERE table_id = ${table.id} AND workspace_id = ${workspaceId}`
    expect(remaining).toBe(1)
  })
})
