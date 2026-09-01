/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => {
  class PostgresqlOperationInputError extends Error {}

  return {
    PostgresqlOperationInputError,
    executePostgresqlDelete: vi.fn(),
    executePostgresqlInsert: vi.fn(),
    executePostgresqlIntrospection: vi.fn(),
    executePostgresqlQuery: vi.fn(),
    executePostgresqlStatement: vi.fn(),
    executePostgresqlUpdate: vi.fn(),
  }
})

vi.mock('@/lib/internal/postgresql/operations', () => operationMocks)

import { executePostgresqlTool } from '@/lib/internal/postgresql/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const VALID_BODY = {
  host: 'db.example.com',
  port: 5432,
  database: 'application',
  username: 'application',
  password: 'secret',
  ssl: 'required',
  query: 'SELECT 1',
} as const

const SUPPORTED_TOOL_IDS = [
  'postgresql_query',
  'postgresql_execute',
  'postgresql_insert',
  'postgresql_update',
  'postgresql_delete',
  'postgresql_introspect',
] as const

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'postgresql_query',
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

describe('executePostgresqlTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates and executes the matching operation with cancellation', async () => {
    const controller = new AbortController()
    operationMocks.executePostgresqlQuery.mockResolvedValue({
      message: 'Query executed successfully. 1 row(s) returned.',
      rows: [{ value: 1 }],
      rowCount: 1,
    })

    const response = await executePostgresqlTool(createRequest({ signal: controller.signal }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      message: 'Query executed successfully. 1 row(s) returned.',
      rows: [{ value: 1 }],
      rowCount: 1,
    })
    expect(operationMocks.executePostgresqlQuery).toHaveBeenCalledWith(
      VALID_BODY,
      controller.signal
    )
  })

  it('returns the canonical contract validation envelope before database work', async () => {
    const response = await executePostgresqlTool(
      createRequest({ input: { host: 'db.example.com' } })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executePostgresqlQuery).not.toHaveBeenCalled()
  })

  it.each(SUPPORTED_TOOL_IDS)('recognizes the canonical tool ID %s', async (toolId) => {
    const response = await executePostgresqlTool(createRequest({ toolId, input: {} }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid request data' })
  })

  it('preserves the route-compatible provider error envelope', async () => {
    operationMocks.executePostgresqlQuery.mockRejectedValue(new Error('database unavailable'))

    const response = await executePostgresqlTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'PostgreSQL query failed: database unavailable',
    })
  })

  it('preserves execute query validation as a 400 error', async () => {
    operationMocks.executePostgresqlStatement.mockRejectedValue(
      new operationMocks.PostgresqlOperationInputError('Query validation failed: invalid query')
    )

    const response = await executePostgresqlTool(createRequest({ toolId: 'postgresql_execute' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Query validation failed: invalid query',
    })
  })

  it('propagates cancellation without converting it into a database failure', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executePostgresqlTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executePostgresqlQuery).not.toHaveBeenCalled()
  })
})
