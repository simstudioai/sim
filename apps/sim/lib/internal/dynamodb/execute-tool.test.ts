/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOperations = vi.hoisted(() => ({
  executeDynamodbDelete: vi.fn(),
  executeDynamodbGet: vi.fn(),
  executeDynamodbIntrospect: vi.fn(),
  executeDynamodbPut: vi.fn(),
  executeDynamodbQuery: vi.fn(),
  executeDynamodbScan: vi.fn(),
  executeDynamodbUpdate: vi.fn(),
}))

vi.mock('@/lib/internal/dynamodb/operations', () => mockOperations)

import { executeDynamodbTool } from '@/lib/internal/dynamodb/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'dynamodb_get',
    input: { ...CONNECTION, tableName: 'test-table', key: { id: 'item-1' } },
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      metadata: {},
    },
    requestId: 'request-1',
    ...overrides,
  }
}

const TOOL_CASES = [
  {
    toolId: 'dynamodb_delete',
    input: { ...CONNECTION, tableName: 'test-table', key: { id: 'item-1' } },
    operation: mockOperations.executeDynamodbDelete,
  },
  {
    toolId: 'dynamodb_get',
    input: { ...CONNECTION, tableName: 'test-table', key: { id: 'item-1' } },
    operation: mockOperations.executeDynamodbGet,
  },
  {
    toolId: 'dynamodb_introspect',
    input: { ...CONNECTION, tableName: 'test-table' },
    operation: mockOperations.executeDynamodbIntrospect,
  },
  {
    toolId: 'dynamodb_put',
    input: { ...CONNECTION, tableName: 'test-table', item: { id: 'item-1' } },
    operation: mockOperations.executeDynamodbPut,
  },
  {
    toolId: 'dynamodb_query',
    input: {
      ...CONNECTION,
      tableName: 'test-table',
      keyConditionExpression: '#id = :id',
    },
    operation: mockOperations.executeDynamodbQuery,
  },
  {
    toolId: 'dynamodb_scan',
    input: { ...CONNECTION, tableName: 'test-table' },
    operation: mockOperations.executeDynamodbScan,
  },
  {
    toolId: 'dynamodb_update',
    input: {
      ...CONNECTION,
      tableName: 'test-table',
      key: { id: 'item-1' },
      updateExpression: 'SET #name = :name',
    },
    operation: mockOperations.executeDynamodbUpdate,
  },
] as const

describe('executeDynamodbTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(TOOL_CASES)('validates and dispatches $toolId', async ({ toolId, input, operation }) => {
    const controller = new AbortController()
    operation.mockResolvedValue({ toolId })

    const response = await executeDynamodbTool(
      createRequest({ toolId, input, signal: controller.signal })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ toolId })
    expect(operation).toHaveBeenCalledWith(input, controller.signal)
  })

  it('returns the route-compatible validation envelope before provider work', async () => {
    const response = await executeDynamodbTool(
      createRequest({ input: { ...CONNECTION, tableName: 'test-table', key: {} } })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(mockOperations.executeDynamodbGet).not.toHaveBeenCalled()
  })

  it('preserves the unprefixed provider error envelope', async () => {
    mockOperations.executeDynamodbGet.mockRejectedValue(new Error('AWS rejected credentials'))

    const response = await executeDynamodbTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'AWS rejected credentials' })
  })

  it('preserves the introspection provider error envelope', async () => {
    mockOperations.executeDynamodbIntrospect.mockRejectedValue(new Error('table unavailable'))

    const response = await executeDynamodbTool(
      createRequest({
        toolId: 'dynamodb_introspect',
        input: CONNECTION,
      })
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'DynamoDB introspection failed: table unavailable',
    })
  })

  it('propagates cancellation without starting provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeDynamodbTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockOperations.executeDynamodbGet).not.toHaveBeenCalled()
  })
})
