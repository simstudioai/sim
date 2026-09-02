/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => {
  class OracleOperationInputError extends Error {}
  return {
    OracleOperationInputError,
    executeOracleDelete: vi.fn(),
    executeOracleInsert: vi.fn(),
    executeOracleIntrospection: vi.fn(),
    executeOracleQuery: vi.fn(),
    executeOracleStatement: vi.fn(),
    executeOracleUpdate: vi.fn(),
  }
})

vi.mock('@/lib/internal/oracledb/operations', () => operationMocks)

import { executeOracledbTool } from '@/lib/internal/oracledb/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const BASE_CONNECTION = {
  host: 'db.example.com',
  port: 1521,
  protocol: 'tcp',
  connectionType: 'serviceName',
  serviceName: 'FREEPDB1',
  username: 'application',
  password: 'secret',
  connectionTimeout: 15000,
} as const

const VALID_INPUT = {
  ...BASE_CONNECTION,
  query: 'SELECT 1 FROM DUAL',
} as const

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'oracledb_query',
    input: VALID_INPUT,
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

const TOOL_IDS = [
  'oracledb_query',
  'oracledb_execute',
  'oracledb_insert',
  'oracledb_update',
  'oracledb_delete',
  'oracledb_introspect',
] as const

const ROUTING_CASES = [
  {
    toolId: 'oracledb_query',
    input: { ...BASE_CONNECTION, query: 'SELECT 1 FROM DUAL' },
    operation: 'executeOracleQuery',
  },
  {
    toolId: 'oracledb_execute',
    input: { ...BASE_CONNECTION, query: 'DELETE FROM jobs WHERE id = 7' },
    operation: 'executeOracleStatement',
  },
  {
    toolId: 'oracledb_insert',
    input: { ...BASE_CONNECTION, table: 'JOBS', data: { ID: 7 } },
    operation: 'executeOracleInsert',
  },
  {
    toolId: 'oracledb_update',
    input: { ...BASE_CONNECTION, table: 'JOBS', data: { STATE: 'done' }, where: 'ID = 7' },
    operation: 'executeOracleUpdate',
  },
  {
    toolId: 'oracledb_delete',
    input: { ...BASE_CONNECTION, table: 'JOBS', where: 'ID = 7' },
    operation: 'executeOracleDelete',
  },
  {
    toolId: 'oracledb_introspect',
    input: { ...BASE_CONNECTION, schema: 'APP' },
    operation: 'executeOracleIntrospection',
  },
] as const

const EXECUTION_MOCKS = [
  operationMocks.executeOracleQuery,
  operationMocks.executeOracleStatement,
  operationMocks.executeOracleInsert,
  operationMocks.executeOracleUpdate,
  operationMocks.executeOracleDelete,
  operationMocks.executeOracleIntrospection,
]

describe('executeOracledbTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('validates and executes Query with cancellation', async () => {
    const controller = new AbortController()
    operationMocks.executeOracleQuery.mockResolvedValue({
      message: 'Query executed successfully. 1 row(s) returned.',
      rows: [{ VALUE: '1' }],
      rowCount: 1,
    })

    const response = await executeOracledbTool(request({ signal: controller.signal }))

    expect(response.status).toBe(200)
    expect(operationMocks.executeOracleQuery).toHaveBeenCalledWith(VALID_INPUT, controller.signal)
  })

  it.each(TOOL_IDS)('recognizes %s and validates before database work', async (toolId) => {
    const response = await executeOracledbTool(request({ toolId, input: {} }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
  })

  it.each(ROUTING_CASES)(
    'routes $toolId to its matching internal operation',
    async ({ toolId, input, operation }) => {
      operationMocks[operation].mockResolvedValue({ message: 'ok', rows: [], rowCount: 0 })

      const response = await executeOracledbTool(request({ toolId, input }))

      expect(response.status).toBe(200)
      expect(operationMocks[operation]).toHaveBeenCalledWith(input, undefined)
      expect(EXECUTION_MOCKS.filter((candidate) => candidate.mock.calls.length > 0)).toHaveLength(1)
    }
  )

  it('maps SQL input errors to 400 and provider failures to 500', async () => {
    operationMocks.executeOracleQuery.mockRejectedValueOnce(
      new operationMocks.OracleOperationInputError('Query validation failed: invalid SQL')
    )
    const inputResponse = await executeOracledbTool(request())
    expect(inputResponse.status).toBe(400)

    operationMocks.executeOracleQuery.mockRejectedValueOnce(new Error('database unavailable'))
    const providerResponse = await executeOracledbTool(request())
    expect(providerResponse.status).toBe(500)
    await expect(providerResponse.json()).resolves.toEqual({
      error: 'Oracle Database query failed: database unavailable',
    })
  })

  it('propagates cancellation instead of converting it to a provider error', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(executeOracledbTool(request({ signal: controller.signal }))).rejects.toMatchObject(
      { name: 'AbortError' }
    )
    expect(operationMocks.executeOracleQuery).not.toHaveBeenCalled()
  })
})
