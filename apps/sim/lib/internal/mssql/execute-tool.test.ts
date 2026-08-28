/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => {
  class MssqlOperationInputError extends Error {}

  return {
    MssqlOperationInputError,
    executeMssqlDelete: vi.fn(),
    executeMssqlInsert: vi.fn(),
    executeMssqlIntrospection: vi.fn(),
    executeMssqlQuery: vi.fn(),
    executeMssqlStatement: vi.fn(),
    executeMssqlUpdate: vi.fn(),
  }
})

vi.mock('@/lib/internal/mssql/operations', () => operationMocks)

import { executeMssqlTool } from '@/lib/internal/mssql/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const VALID_BODY = {
  host: 'db.example.com',
  port: 1433,
  database: 'application',
  username: 'application',
  password: 'secret',
  encrypt: 'enabled',
  trustServerCertificate: 'disabled',
  connectionTimeout: 15000,
  query: 'SELECT 1',
} as const

const SUPPORTED_TOOL_IDS = [
  'mssql_query',
  'mssql_execute',
  'mssql_insert',
  'mssql_update',
  'mssql_delete',
  'mssql_introspect',
] as const

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'mssql_query',
    input: VALID_BODY,
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

describe('executeMssqlTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates and executes the matching operation with cancellation', async () => {
    const controller = new AbortController()
    operationMocks.executeMssqlQuery.mockResolvedValue({
      message: 'Query executed successfully. 1 row(s) returned.',
      rows: [{ value: 1 }],
      rowCount: 1,
    })

    const response = await executeMssqlTool(createRequest({ signal: controller.signal }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      message: 'Query executed successfully. 1 row(s) returned.',
      rows: [{ value: 1 }],
      rowCount: 1,
    })
    expect(operationMocks.executeMssqlQuery).toHaveBeenCalledWith(VALID_BODY, controller.signal)
  })

  it('returns the canonical contract validation envelope before database work', async () => {
    const response = await executeMssqlTool(createRequest({ input: { host: 'db.example.com' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeMssqlQuery).not.toHaveBeenCalled()
  })

  it.each(SUPPORTED_TOOL_IDS)('recognizes the canonical tool ID %s', async (toolId) => {
    const response = await executeMssqlTool(createRequest({ toolId, input: {} }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid request data' })
  })

  it('preserves the route-compatible provider error envelope', async () => {
    operationMocks.executeMssqlQuery.mockRejectedValue(new Error('database unavailable'))

    const response = await executeMssqlTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Microsoft SQL Server query failed: database unavailable',
    })
  })

  it('preserves query validation as a 400 error', async () => {
    operationMocks.executeMssqlQuery.mockRejectedValue(
      new operationMocks.MssqlOperationInputError('Query validation failed: invalid query')
    )

    const response = await executeMssqlTool(createRequest())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Query validation failed: invalid query',
    })
  })

  it('propagates cancellation without converting it into a database failure', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeMssqlTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeMssqlQuery).not.toHaveBeenCalled()
  })
})
