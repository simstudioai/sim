import { describe, expect, it, vi } from 'vitest'

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

import { executeClickHouseQuery } from '@/lib/internal/clickhouse/operations'

const CONNECTION = {
  host: 'clickhouse.example.com',
  port: 8443,
  database: 'analytics',
  username: 'default',
  password: 'secret',
  secure: true,
} as const

describe('ClickHouse operations', () => {
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
})
