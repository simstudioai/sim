/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => ({
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
  executeClickHouseIntrospection: vi.fn(),
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
  executeClickHouseStatement: vi.fn(),
  executeClickHouseTableStats: vi.fn(),
  executeClickHouseTruncateTable: vi.fn(),
  executeClickHouseUpdate: vi.fn(),
}))

vi.mock('@/lib/internal/clickhouse/operations', () => operationMocks)

import { executeClickHouseTool } from '@/lib/internal/clickhouse/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CLICKHOUSE_TOOL_IDS = [
  'clickhouse_count_rows',
  'clickhouse_create_database',
  'clickhouse_create_table',
  'clickhouse_delete',
  'clickhouse_describe_table',
  'clickhouse_drop_database',
  'clickhouse_drop_partition',
  'clickhouse_drop_table',
  'clickhouse_execute',
  'clickhouse_insert_rows',
  'clickhouse_insert',
  'clickhouse_introspect',
  'clickhouse_kill_query',
  'clickhouse_list_clusters',
  'clickhouse_list_databases',
  'clickhouse_list_mutations',
  'clickhouse_list_partitions',
  'clickhouse_list_running_queries',
  'clickhouse_list_tables',
  'clickhouse_optimize_table',
  'clickhouse_query',
  'clickhouse_rename_table',
  'clickhouse_show_create_table',
  'clickhouse_table_stats',
  'clickhouse_truncate_table',
  'clickhouse_update',
] as const

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'clickhouse_query',
    input: {
      host: 'clickhouse.example.com',
      port: 8443,
      database: 'analytics',
      username: 'default',
      password: 'secret',
      secure: true,
      query: 'SELECT 1',
    },
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeClickHouseTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates the canonical contract and executes the matching operation', async () => {
    const controller = new AbortController()
    operationMocks.executeClickHouseQuery.mockResolvedValue({
      message: 'Query executed successfully. 1 row(s) returned.',
      rows: [{ value: 1 }],
      rowCount: 1,
    })

    const response = await executeClickHouseTool(createRequest({ signal: controller.signal }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      message: 'Query executed successfully. 1 row(s) returned.',
      rows: [{ value: 1 }],
      rowCount: 1,
    })
    expect(operationMocks.executeClickHouseQuery).toHaveBeenCalledWith(
      {
        host: 'clickhouse.example.com',
        port: 8443,
        database: 'analytics',
        username: 'default',
        password: 'secret',
        secure: true,
        query: 'SELECT 1',
      },
      controller.signal
    )
  })

  it('returns the canonical validation envelope before provider work', async () => {
    const response = await executeClickHouseTool(createRequest({ input: { host: '' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeClickHouseQuery).not.toHaveBeenCalled()
  })

  it('rejects non-object operation input', async () => {
    const response = await executeClickHouseTool(createRequest({ input: '{' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeClickHouseQuery).not.toHaveBeenCalled()
  })

  it.each(CLICKHOUSE_TOOL_IDS)('recognizes the canonical tool ID %s', async (toolId) => {
    const response = await executeClickHouseTool(createRequest({ toolId, input: {} }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
    })
  })

  it('preserves the route-compatible provider error prefix', async () => {
    operationMocks.executeClickHouseIntrospection.mockRejectedValue(new Error('connection refused'))

    const response = await executeClickHouseTool(
      createRequest({
        toolId: 'clickhouse_introspect',
        input: {
          host: 'clickhouse.example.com',
          port: 8443,
          database: 'analytics',
          username: 'default',
          password: 'secret',
          secure: true,
        },
      })
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'ClickHouse introspection failed: connection refused',
    })
  })

  it('rejects unsupported ClickHouse IDs without provider work', async () => {
    const response = await executeClickHouseTool(createRequest({ toolId: 'clickhouse_unknown' }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Unsupported ClickHouse tool: clickhouse_unknown',
    })
  })

  it('propagates cancellation without converting it into a provider failure', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeClickHouseTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeClickHouseQuery).not.toHaveBeenCalled()
  })
})
