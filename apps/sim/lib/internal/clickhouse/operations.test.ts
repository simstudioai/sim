/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sqlMocks = vi.hoisted(() => ({
  executeClickHouseCountRows: vi.fn(),
  executeClickHouseCreateDatabase: vi.fn(),
  executeClickHouseCreateTable: vi.fn(),
  executeClickHouseDelete: vi.fn(),
  executeClickHouseDescribeTable: vi.fn(),
  executeClickHouseDropDatabase: vi.fn(),
  executeClickHouseDropPartition: vi.fn(),
  executeClickHouseDropTable: vi.fn(),
  executeClickHouseInsert: vi.fn(),
  executeClickHouseInsertRows: vi.fn(),
  executeClickHouseIntrospect: vi.fn(),
  executeClickHouseKillQuery: vi.fn(),
  executeClickHouseListClusters: vi.fn(),
  executeClickHouseListDatabases: vi.fn(),
  executeClickHouseListMutations: vi.fn(),
  executeClickHouseListPartitions: vi.fn(),
  executeClickHouseListRunningQueries: vi.fn(),
  executeClickHouseListTables: vi.fn(),
  executeClickHouseOptimizeTable: vi.fn(),
  executeClickHouseQuery: vi.fn(),
  executeClickHouseRenameTable: vi.fn(),
  executeClickHouseShowCreateTable: vi.fn(),
  executeClickHouseTableStats: vi.fn(),
  executeClickHouseTruncateTable: vi.fn(),
  executeClickHouseUpdate: vi.fn(),
}))

vi.mock('@/lib/internal/clickhouse/sql', () => sqlMocks)

import {
  executeClickHouseCountRows,
  executeClickHouseCreateTable,
  executeClickHouseIntrospection,
  executeClickHouseQuery,
  executeClickHouseStatement,
  executeClickHouseUpdate,
} from '@/lib/internal/clickhouse/operations'

const CONNECTION = {
  host: 'clickhouse.example.com',
  port: 8443,
  database: 'analytics',
  username: 'default',
  password: 'secret',
  secure: true,
} as const

describe('ClickHouse operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('enforces read-only query execution and preserves its route response', async () => {
    const controller = new AbortController()
    sqlMocks.executeClickHouseQuery.mockResolvedValue({
      rows: [{ value: 1 }],
      rowCount: 1,
    })

    await expect(
      executeClickHouseQuery({ ...CONNECTION, query: 'SELECT 1' }, controller.signal)
    ).resolves.toEqual({
      message: 'Query executed successfully. 1 row(s) returned.',
      rows: [{ value: 1 }],
      rowCount: 1,
    })
    expect(sqlMocks.executeClickHouseQuery).toHaveBeenCalledWith(
      { ...CONNECTION, query: 'SELECT 1' },
      'SELECT 1',
      { enforceReadOnly: true },
      controller.signal
    )
  })

  it('keeps raw execution distinct from the read-only query operation', async () => {
    sqlMocks.executeClickHouseQuery.mockResolvedValue({ rows: [], rowCount: 4 })

    await expect(
      executeClickHouseStatement({ ...CONNECTION, query: 'ALTER TABLE events DELETE WHERE id=1' })
    ).resolves.toEqual({
      message: 'Statement executed successfully. 4 row(s) returned or affected.',
      rows: [],
      rowCount: 4,
    })
    expect(sqlMocks.executeClickHouseQuery).toHaveBeenCalledWith(
      { ...CONNECTION, query: 'ALTER TABLE events DELETE WHERE id=1' },
      'ALTER TABLE events DELETE WHERE id=1',
      {},
      undefined
    )
  })

  it('preserves introspection tables and the database-specific message', async () => {
    sqlMocks.executeClickHouseIntrospect.mockResolvedValue({
      tables: [
        {
          name: 'events',
          database: 'analytics',
          engine: 'MergeTree',
          columns: [],
        },
      ],
    })

    await expect(executeClickHouseIntrospection(CONNECTION)).resolves.toEqual({
      message: "Schema introspection completed. Found 1 table(s) in database 'analytics'.",
      tables: [
        {
          name: 'events',
          database: 'analytics',
          engine: 'MergeTree',
          columns: [],
        },
      ],
    })
  })

  it('preserves asynchronous mutation response semantics', async () => {
    sqlMocks.executeClickHouseUpdate.mockResolvedValue({ rows: [], rowCount: 3 })

    await expect(
      executeClickHouseUpdate({
        ...CONNECTION,
        table: 'events',
        data: { status: 'done' },
        where: 'id = 1',
      })
    ).resolves.toEqual({
      message:
        'Update mutation submitted. ClickHouse mutations run asynchronously. 3 row(s) written.',
      rows: [],
      rowCount: 3,
    })
  })

  it('forwards all create-table fields and cancellation', async () => {
    const controller = new AbortController()
    sqlMocks.executeClickHouseCreateTable.mockResolvedValue(undefined)
    const input = {
      ...CONNECTION,
      table: 'events',
      columns: [
        { name: 'id', type: 'UInt64' },
        { name: 'created_at', type: 'DateTime' },
      ],
      engine: 'MergeTree',
      orderBy: 'id',
      partitionBy: 'toYYYYMM(created_at)',
    }

    await expect(executeClickHouseCreateTable(input, controller.signal)).resolves.toEqual({
      message: "Table 'events' created.",
      rows: [],
      rowCount: 0,
    })
    expect(sqlMocks.executeClickHouseCreateTable).toHaveBeenCalledWith(
      input,
      'events',
      input.columns,
      'MergeTree',
      'id',
      'toYYYYMM(created_at)',
      controller.signal
    )
  })

  it('preserves count response semantics', async () => {
    sqlMocks.executeClickHouseCountRows.mockResolvedValue(12)

    await expect(
      executeClickHouseCountRows({ ...CONNECTION, table: 'events', where: 'active = 1' })
    ).resolves.toEqual({ message: 'Table contains 12 row(s).', count: 12 })
  })
})
