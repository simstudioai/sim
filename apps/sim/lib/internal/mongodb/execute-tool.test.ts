/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => {
  class MongodbOperationInputError extends Error {}

  return {
    MongodbOperationInputError,
    executeMongodbAggregation: vi.fn(),
    executeMongodbDelete: vi.fn(),
    executeMongodbInsert: vi.fn(),
    executeMongodbIntrospection: vi.fn(),
    executeMongodbQuery: vi.fn(),
    executeMongodbUpdate: vi.fn(),
  }
})

vi.mock('@/lib/internal/mongodb/operations', () => operationMocks)

import { executeMongodbTool } from '@/lib/internal/mongodb/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const VALID_BODY = {
  host: 'db.example.com',
  port: 27017,
  database: 'application',
  username: 'application',
  password: 'secret',
  authSource: 'admin',
  ssl: 'required',
  collection: 'users',
  query: '{}',
  limit: 100,
} as const

const SUPPORTED_TOOL_IDS = [
  'mongodb_query',
  'mongodb_execute',
  'mongodb_insert',
  'mongodb_update',
  'mongodb_delete',
  'mongodb_introspect',
] as const

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'mongodb_query',
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

describe('executeMongodbTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates and executes the matching operation with cancellation', async () => {
    const controller = new AbortController()
    operationMocks.executeMongodbQuery.mockResolvedValue({
      message: 'Found 1 documents',
      documents: [{ id: 1 }],
      documentCount: 1,
    })

    const response = await executeMongodbTool(createRequest({ signal: controller.signal }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      message: 'Found 1 documents',
      documents: [{ id: 1 }],
      documentCount: 1,
    })
    expect(operationMocks.executeMongodbQuery).toHaveBeenCalledWith(VALID_BODY, controller.signal)
  })

  it('returns the canonical contract validation envelope before provider work', async () => {
    const response = await executeMongodbTool(createRequest({ input: { host: 'db.example.com' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeMongodbQuery).not.toHaveBeenCalled()
  })

  it.each(SUPPORTED_TOOL_IDS)('recognizes canonical tool ID %s', async (toolId) => {
    const response = await executeMongodbTool(createRequest({ toolId, input: {} }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid request data' })
  })

  it('preserves the route-compatible provider error envelope', async () => {
    operationMocks.executeMongodbQuery.mockRejectedValue(new Error('server unavailable'))

    const response = await executeMongodbTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'MongoDB query failed: server unavailable',
    })
  })

  it('preserves operation input validation as a 400 error', async () => {
    operationMocks.executeMongodbQuery.mockRejectedValue(
      new operationMocks.MongodbOperationInputError('Filter validation failed: invalid filter')
    )

    const response = await executeMongodbTool(createRequest())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Filter validation failed: invalid filter',
    })
  })

  it('propagates cancellation without converting it into a provider failure', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeMongodbTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeMongodbQuery).not.toHaveBeenCalled()
  })
})
