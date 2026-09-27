/**
 * Row-write integration tests against the provisioned, disposable TEST_DATABASE_URL database (the
 * integration setup points DATABASE_URL at it too). The `rows_version` cases need the migrated
 * deferred trigger and skip without it.
 */
import { db } from '@sim/db'
import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { tableTriggerMock } from '@sim/testing/mocks/table-trigger.mock'
import { tableWorkflowColumnsMock } from '@sim/testing/mocks/table-workflow-columns.mock'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/table/trigger', () => tableTriggerMock)
vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

import { updateRow } from '@/lib/table/rows/service'
import { getTableById } from '@/lib/table/service'
import { getOrCreateTableSnapshot } from '@/lib/table/snapshot-cache'
import type { ColumnDefinition, TableDefinition } from '@/lib/table/types'

const url = readTestDatabaseUrl()
if (process.env.DATABASE_URL !== url) {
  throw new Error('This suite requires only the disposable local test database')
}
const control = postgres(url, { max: 4, onnotice: () => {} })
const workspaceId = generateId()
const userId = generateId()

/**
 * `db:push` never installs the migration-only `rows_version` triggers, and a database migrated
 * only through 0240 has a statement-level UPDATE trigger under the same name. Only the deferred
 * constraint trigger satisfies the `rows_version` cases, so only it enables them.
 */
const [{ migrated }] = await control<{ migrated: boolean }[]>`SELECT EXISTS (
  SELECT 1 FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE t.tgrelid = 'user_table_rows'::regclass
    AND t.tgname = 'user_table_rows_version_update_trigger'
    AND t.tgconstraint <> 0
    AND t.tgdeferrable
    AND t.tginitdeferred
    AND p.proname = 'bump_user_table_rows_version_at_commit'
) AS migrated`

async function createTable(columns: ColumnDefinition[]): Promise<TableDefinition> {
  const id = generateId()
  await db
    .insert(userTableDefinitions)
    .values({ id, workspaceId, name: id, schema: { columns }, createdBy: userId })
  const table = await getTableById(id)
  if (!table) throw new Error('Fixture table was not created')
  return table
}

async function seedRows(
  tableId: string,
  rows: Array<{ id: string; data: Record<string, string>; orderKey: string | null }>
) {
  await db.insert(userTableRows).values(rows.map((row) => ({ ...row, tableId, workspaceId })))
}

async function rowsVersion(tableId: string): Promise<number> {
  const [row] = await control`SELECT rows_version FROM user_table_definitions WHERE id = ${tableId}`
  return Number(row.rows_version)
}

const textColumns = (...ids: string[]): ColumnDefinition[] =>
  ids.map((id) => ({ id, name: id, type: 'string' }))

describe('table row writes against real PostgreSQL', () => {
  beforeAll(async () => {
    await control`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES (${userId}, 'Row write fixture', ${`${userId}@example.test`}, true, now(), now())`
    await control`INSERT INTO workspace (id, name, owner_id, billed_account_user_id)
      VALUES (${workspaceId}, 'Row write fixtures', ${userId}, ${userId})`
  })

  afterAll(async () => {
    await control`DELETE FROM workspace WHERE id = ${workspaceId}`
    await control`DELETE FROM "user" WHERE id = ${userId}`
    await control.end()
  })

  describe.skipIf(!migrated)('rows_version', () => {
    it('advances once for a transaction that edits cells across several statements', async () => {
      const table = await createTable(textColumns('name'))
      await seedRows(table.id, [
        { id: `${table.id}-a`, data: { name: 'a' }, orderKey: 'a0' },
        { id: `${table.id}-b`, data: { name: 'b' }, orderKey: 'a1' },
      ])
      const before = await rowsVersion(table.id)

      await control.begin(async (tx) => {
        await tx`UPDATE user_table_rows SET data = '{"name":"a2"}' WHERE id = ${`${table.id}-a`}`
        await tx`UPDATE user_table_rows SET data = '{"name":"b2"}' WHERE id = ${`${table.id}-b`}`
        await tx`UPDATE user_table_rows SET data = '{"name":"a3"}' WHERE id = ${`${table.id}-a`}`
      })

      expect(await rowsVersion(table.id)).toBe(before + 1)
    })

    it('advances each table once for a transaction that edits rows in two tables', async () => {
      const first = await createTable(textColumns('name'))
      const second = await createTable(textColumns('name'))
      for (const table of [first, second]) {
        await seedRows(table.id, [
          { id: `${table.id}-a`, data: { name: 'a' }, orderKey: 'a0' },
          { id: `${table.id}-b`, data: { name: 'b' }, orderKey: 'a1' },
        ])
      }
      const [firstBefore, secondBefore] = [
        await rowsVersion(first.id),
        await rowsVersion(second.id),
      ]

      await control.begin(async (tx) => {
        await tx`UPDATE user_table_rows SET data = '{"name":"a2"}' WHERE id = ${`${first.id}-a`}`
        await tx`UPDATE user_table_rows SET data = '{"name":"a2"}' WHERE id = ${`${second.id}-a`}`
        await tx`UPDATE user_table_rows SET data = '{"name":"b2"}' WHERE id = ${`${first.id}-b`}`
        await tx`UPDATE user_table_rows SET order_key = 'a2' WHERE id = ${`${second.id}-b`}`
      })

      expect(await rowsVersion(first.id)).toBe(firstBefore + 1)
      expect(await rowsVersion(second.id)).toBe(secondBefore + 1)
    })

    it('advances once for a transaction that reorders rows across several statements', async () => {
      const table = await createTable(textColumns('name'))
      await seedRows(table.id, [
        { id: `${table.id}-a`, data: { name: 'a' }, orderKey: 'a0' },
        { id: `${table.id}-b`, data: { name: 'b' }, orderKey: 'a1' },
      ])
      const before = await rowsVersion(table.id)

      await control.begin(async (tx) => {
        await tx`UPDATE user_table_rows SET order_key = 'a2' WHERE id = ${`${table.id}-a`}`
        await tx`UPDATE user_table_rows SET order_key = 'Zz' WHERE id = ${`${table.id}-b`}`
      })

      expect(await rowsVersion(table.id)).toBe(before + 1)
    })

    it('advances once for a service cell edit that also writes executions and provenance', async () => {
      const table = await createTable(textColumns('name'))
      await seedRows(table.id, [{ id: `${table.id}-a`, data: { name: 'a' }, orderKey: 'a0' }])
      const before = await rowsVersion(table.id)

      await updateRow(
        {
          tableId: table.id,
          rowId: `${table.id}-a`,
          workspaceId,
          data: { name: 'edited' },
          secretProvenance: { complete: true, columns: {} },
          capabilityGovernedUserId: null,
          executionsPatch: {
            'group-1': {
              status: 'completed',
              executionId: generateId(),
              jobId: null,
              workflowId: 'workflow-1',
              error: null,
            },
          },
        },
        table,
        'rows-version-service-edit'
      )

      expect(await rowsVersion(table.id)).toBe(before + 1)
    })

    it('stays put for provenance-only, timestamp-only, and executions-only writes', async () => {
      const table = await createTable(textColumns('name'))
      await seedRows(table.id, [{ id: `${table.id}-a`, data: { name: 'a' }, orderKey: 'a0' }])
      const before = await rowsVersion(table.id)

      await control`UPDATE user_table_rows SET secret_provenance_version = 1 WHERE id = ${`${table.id}-a`}`
      await control`UPDATE user_table_rows SET updated_at = now() WHERE id = ${`${table.id}-a`}`
      await control`UPDATE user_table_rows SET data = data WHERE id = ${`${table.id}-a`}`
      await updateRow(
        {
          tableId: table.id,
          rowId: `${table.id}-a`,
          workspaceId,
          data: {},
          secretProvenance: undefined,
          capabilityGovernedUserId: null,
          executionsPatch: {
            'group-1': {
              status: 'running',
              executionId: generateId(),
              jobId: null,
              workflowId: 'workflow-1',
              error: null,
            },
          },
        },
        table,
        'rows-version-executions-only'
      )

      expect(await rowsVersion(table.id)).toBe(before)
    })

    it('lets a second writer commit while the first holds an uncommitted row edit', async () => {
      const table = await createTable(textColumns('name'))
      await seedRows(table.id, [
        { id: `${table.id}-a`, data: { name: 'a' }, orderKey: 'a0' },
        { id: `${table.id}-b`, data: { name: 'b' }, orderKey: 'a1' },
      ])
      const before = await rowsVersion(table.id)
      const first = await control.reserve()
      const second = await control.reserve()
      try {
        await first`BEGIN`
        await first`UPDATE user_table_rows SET data = '{"name":"a2"}' WHERE id = ${`${table.id}-a`}`

        await second`BEGIN`
        await second`SET LOCAL lock_timeout = '1s'`
        await second`UPDATE user_table_rows SET data = '{"name":"b2"}' WHERE id = ${`${table.id}-b`}`
        await second`COMMIT`
        expect(await rowsVersion(table.id)).toBe(before + 1)

        await first`COMMIT`
        expect(await rowsVersion(table.id)).toBe(before + 2)
      } finally {
        await first`ROLLBACK`.catch(() => {})
        await second`ROLLBACK`.catch(() => {})
        first.release()
        second.release()
      }
    })

    it('re-keys a snapshot when a writer commits during materialization', async () => {
      const table = await createTable(textColumns('name'))
      await seedRows(table.id, [{ id: `${table.id}-a`, data: { name: 'a' }, orderKey: 'a0' }])
      const before = await rowsVersion(table.id)

      const stored = new Map<string, string>()
      let concurrentWriteDone = false
      storageServiceMockFns.mockHeadObject.mockImplementation(async (key: string) =>
        stored.has(key) ? { size: Buffer.byteLength(stored.get(key) ?? '') } : null
      )
      storageServiceMockFns.mockDeleteFile.mockImplementation(async ({ key }: { key: string }) => {
        stored.delete(key)
      })
      storageServiceMockFns.mockCreateMultipartUpload.mockImplementation(
        async ({ key }: { key: string }) => {
          let body = ''
          return {
            write: async (chunk: string) => {
              if (!concurrentWriteDone) {
                concurrentWriteDone = true
                await control`UPDATE user_table_rows SET data = '{"name":"during"}' WHERE id = ${`${table.id}-a`}`
              }
              body += chunk
            },
            complete: async () => {
              stored.set(key, body)
              return { size: Buffer.byteLength(body) }
            },
            abort: async () => {},
          }
        }
      )

      const snapshot = await getOrCreateTableSnapshot(table, 'rows-version-snapshot')

      expect(snapshot.version).toBe(before + 1)
      expect(snapshot.key).toContain(`/v${before + 1}-`)
      expect(stored.get(snapshot.key)).toContain('during')
    })
  })
})
