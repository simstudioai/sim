/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => {
  class MysqlOperationInputError extends Error {}

  return {
    MysqlOperationInputError,
    executeMysqlDelete: vi.fn(),
    executeMysqlInsert: vi.fn(),
    executeMysqlIntrospection: vi.fn(),
    executeMysqlQuery: vi.fn(),
    executeMysqlStatement: vi.fn(),
    executeMysqlUpdate: vi.fn(),
  }
})

vi.mock('@/lib/internal/mysql/operations', () => operationMocks)

import { executeMysqlTool } from '@/lib/internal/mysql/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const VALID_BODY = {
  host: 'db.example.com',
  port: 3306,
  database: 'application',
  username: 'application',
  password: 'secret',
  ssl: 'required',
  query: 'SELECT 1',
} as const

const SUPPORTED_TOOL_IDS = [
  'mysql_query',
  'mysql_execute',
  'mysql_insert',
  'mysql_update',
  'mysql_delete',
  'mysql_introspect',
] as const

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'mysql_query',
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

describe('executeMysqlTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates and executes the matching operation with cancellation', async () => {
    const controller = new AbortController()
    operationMocks.executeMysqlQuery.mockResolvedValue({
      message: 'Query executed successfully. 1 row(s) returned.',
      rows: [{ value: 1 }],
      rowCount: 1,
    })

    const response = await executeMysqlTool(createRequest({ signal: controller.signal }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      message: 'Query executed successfully. 1 row(s) returned.',
      rows: [{ value: 1 }],
      rowCount: 1,
    })
    expect(operationMocks.executeMysqlQuery).toHaveBeenCalledWith(VALID_BODY, controller.signal)
  })

  it('returns the canonical contract validation envelope before database work', async () => {
    const response = await executeMysqlTool(createRequest({ input: { host: 'db.example.com' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeMysqlQuery).not.toHaveBeenCalled()
  })

  it.each(SUPPORTED_TOOL_IDS)('recognizes the canonical tool ID %s', async (toolId) => {
    const response = await executeMysqlTool(createRequest({ toolId, input: {} }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid request data' })
  })

  it('preserves the route-compatible provider error envelope', async () => {
    operationMocks.executeMysqlQuery.mockRejectedValue(new Error('database unavailable'))

    const response = await executeMysqlTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'MySQL query failed: database unavailable',
    })
  })

  it('preserves query validation as a 400 error', async () => {
    operationMocks.executeMysqlQuery.mockRejectedValue(
      new operationMocks.MysqlOperationInputError('Query validation failed: invalid query')
    )

    const response = await executeMysqlTool(createRequest())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Query validation failed: invalid query',
    })
  })

  it('propagates cancellation without converting it into a database failure', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeMysqlTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeMysqlQuery).not.toHaveBeenCalled()
  })
})
