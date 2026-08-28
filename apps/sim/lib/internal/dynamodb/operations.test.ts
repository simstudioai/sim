/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createDocumentClient: vi.fn(),
  createRawClient: vi.fn(),
  describeTable: vi.fn(),
  documentDestroy: vi.fn(),
  getItem: vi.fn(),
  listTables: vi.fn(),
  rawDestroy: vi.fn(),
}))

vi.mock('@/lib/internal/dynamodb/client', () => ({
  createDynamoDBClient: mocks.createDocumentClient,
  createRawDynamoDBClient: mocks.createRawClient,
  deleteItem: vi.fn(),
  describeTable: mocks.describeTable,
  getItem: mocks.getItem,
  listTables: mocks.listTables,
  putItem: vi.fn(),
  queryItems: vi.fn(),
  scanItems: vi.fn(),
  updateItem: vi.fn(),
}))

import { executeDynamodbGet, executeDynamodbIntrospect } from '@/lib/internal/dynamodb/operations'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

describe('DynamoDB operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createDocumentClient.mockReturnValue({ destroy: mocks.documentDestroy })
    mocks.createRawClient.mockReturnValue({ destroy: mocks.rawDestroy })
  })

  it('forwards cancellation and destroys the document client after success', async () => {
    const controller = new AbortController()
    mocks.getItem.mockResolvedValue({ item: { id: 'item-1' } })

    await expect(
      executeDynamodbGet(
        { ...CONNECTION, tableName: 'test-table', key: { id: 'item-1' }, consistentRead: true },
        controller.signal
      )
    ).resolves.toEqual({ message: 'Item retrieved successfully', item: { id: 'item-1' } })
    expect(mocks.getItem).toHaveBeenCalledWith(
      { destroy: mocks.documentDestroy },
      'test-table',
      { id: 'item-1' },
      true,
      controller.signal
    )
    expect(mocks.documentDestroy).toHaveBeenCalledOnce()
  })

  it('destroys the document client when provider execution fails', async () => {
    mocks.getItem.mockRejectedValue(new Error('provider failure'))

    await expect(
      executeDynamodbGet({ ...CONNECTION, tableName: 'test-table', key: { id: 'item-1' } })
    ).rejects.toThrow('provider failure')
    expect(mocks.documentDestroy).toHaveBeenCalledOnce()
  })

  it('forwards cancellation across introspection and destroys the raw client', async () => {
    const controller = new AbortController()
    const tableDetails = {
      tableName: 'test-table',
      tableStatus: 'ACTIVE',
      keySchema: [],
      attributeDefinitions: [],
      globalSecondaryIndexes: [],
      localSecondaryIndexes: [],
      itemCount: 0,
      tableSizeBytes: 0,
      billingMode: 'PAY_PER_REQUEST',
    }
    mocks.listTables.mockResolvedValue({ tables: ['test-table'] })
    mocks.describeTable.mockResolvedValue({ tableDetails })

    await expect(
      executeDynamodbIntrospect({ ...CONNECTION, tableName: 'test-table' }, controller.signal)
    ).resolves.toEqual({
      message: "Table 'test-table' described successfully.",
      tables: ['test-table'],
      tableDetails,
    })
    expect(mocks.listTables).toHaveBeenCalledWith({ destroy: mocks.rawDestroy }, controller.signal)
    expect(mocks.describeTable).toHaveBeenCalledWith(
      { destroy: mocks.rawDestroy },
      'test-table',
      controller.signal
    )
    expect(mocks.rawDestroy).toHaveBeenCalledOnce()
  })
})
