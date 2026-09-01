/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => ({
  createMongodbClient: vi.fn(),
}))

const validationMocks = vi.hoisted(() => ({
  sanitizeMongodbCollectionName: vi.fn((name: string) => name),
  validateMongodbFilter: vi.fn(),
  validateMongodbPipeline: vi.fn(),
}))

const introspectionMocks = vi.hoisted(() => ({
  introspectMongodb: vi.fn(),
}))

vi.mock('@/lib/internal/mongodb/client', () => clientMocks)
vi.mock('@/lib/internal/mongodb/input-validation', () => validationMocks)
vi.mock('@/lib/internal/mongodb/introspection', () => introspectionMocks)

import {
  executeMongodbDelete,
  executeMongodbInsert,
  executeMongodbIntrospection,
  executeMongodbQuery,
  executeMongodbUpdate,
  MongodbOperationInputError,
} from '@/lib/internal/mongodb/operations'

const CONNECTION = {
  host: 'db.example.com',
  port: 27017,
  database: 'application',
  username: 'application',
  password: 'secret',
  authSource: 'admin',
  ssl: 'required',
} as const

function createClient(collection: Record<string, unknown>) {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    db: vi.fn(() => ({ collection: vi.fn(() => collection) })),
  }
}

describe('MongoDB operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validationMocks.validateMongodbFilter.mockReturnValue({ isValid: true })
    validationMocks.validateMongodbPipeline.mockReturnValue({ isValid: true })
  })

  it('preserves query behavior, cancellation, and cleanup', async () => {
    const controller = new AbortController()
    const toArray = vi.fn().mockResolvedValue([{ id: 1 }])
    const limit = vi.fn(() => ({ toArray }))
    const sort = vi.fn(() => ({ limit }))
    const find = vi.fn(() => ({ limit, sort }))
    const client = createClient({ find })
    clientMocks.createMongodbClient.mockResolvedValue(client)

    await expect(
      executeMongodbQuery(
        {
          ...CONNECTION,
          collection: 'users',
          query: '{"active":true}',
          sort: '{"createdAt":-1}',
          limit: 25,
        },
        controller.signal
      )
    ).resolves.toEqual({
      message: 'Found 1 documents',
      documents: [{ id: 1 }],
      documentCount: 1,
    })
    expect(find).toHaveBeenCalledWith({ active: true }, { signal: controller.signal })
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 })
    expect(limit).toHaveBeenCalledWith(25)
    expect(client.close).toHaveBeenCalledOnce()
  })

  it('returns route-compatible validation errors before opening a connection', () => {
    validationMocks.validateMongodbFilter.mockReturnValue({
      isValid: false,
      error: 'Filter contains potentially dangerous operators',
    })

    expect(() =>
      executeMongodbQuery({
        ...CONNECTION,
        collection: 'users',
        query: '{"$where":"return true"}',
        limit: 100,
      })
    ).toThrow(
      new MongodbOperationInputError(
        'Filter validation failed: Filter contains potentially dangerous operators'
      )
    )
    expect(clientMocks.createMongodbClient).not.toHaveBeenCalled()
  })

  it('preserves single and multi-insert response shapes and cancellation', async () => {
    const controller = new AbortController()
    const insertOne = vi.fn().mockResolvedValue({ insertedId: { toString: () => 'id-1' } })
    const insertMany = vi.fn().mockResolvedValue({
      insertedIds: {
        0: { toString: () => 'id-1' },
        1: { toString: () => 'id-2' },
      },
    })
    const client = createClient({ insertMany, insertOne })
    clientMocks.createMongodbClient.mockResolvedValue(client)

    await expect(
      executeMongodbInsert(
        { ...CONNECTION, collection: 'users', documents: [{ name: 'One' }] },
        controller.signal
      )
    ).resolves.toEqual({
      message: 'Document inserted successfully',
      insertedId: 'id-1',
      documentCount: 1,
    })
    await expect(
      executeMongodbInsert(
        { ...CONNECTION, collection: 'users', documents: [{ name: 'One' }, { name: 'Two' }] },
        controller.signal
      )
    ).resolves.toEqual({
      message: '2 documents inserted successfully',
      insertedIds: ['id-1', 'id-2'],
      documentCount: 2,
    })
    expect(insertOne).toHaveBeenCalledWith({ name: 'One' }, { signal: controller.signal })
    expect(insertMany).toHaveBeenCalledWith([{ name: 'One' }, { name: 'Two' }], {
      signal: controller.signal,
    })
    expect(client.close).toHaveBeenCalledTimes(2)
  })

  it('preserves update and delete result envelopes', async () => {
    const updateMany = vi.fn().mockResolvedValue({
      matchedCount: 2,
      modifiedCount: 2,
      upsertedCount: 1,
      upsertedId: { toString: () => 'id-3' },
    })
    const deleteMany = vi.fn().mockResolvedValue({ deletedCount: 2 })
    const client = createClient({ deleteMany, updateMany })
    clientMocks.createMongodbClient.mockResolvedValue(client)

    await expect(
      executeMongodbUpdate({
        ...CONNECTION,
        collection: 'users',
        filter: '{"active":false}',
        update: '{"$set":{"active":true}}',
        multi: true,
        upsert: true,
      })
    ).resolves.toEqual({
      message: '2 documents updated, 1 documents upserted',
      matchedCount: 2,
      modifiedCount: 2,
      documentCount: 3,
      insertedId: 'id-3',
    })
    await expect(
      executeMongodbDelete({
        ...CONNECTION,
        collection: 'users',
        filter: '{"active":false}',
        multi: true,
      })
    ).resolves.toEqual({ message: '2 documents deleted', deletedCount: 2 })
    expect(updateMany).toHaveBeenCalledWith(
      { active: false },
      { $set: { active: true } },
      { upsert: true, signal: undefined }
    )
    expect(deleteMany).toHaveBeenCalledWith({ active: false }, { signal: undefined })
    expect(client.close).toHaveBeenCalledTimes(2)
  })

  it('normalizes an omitted introspection database to admin and closes the client', async () => {
    const controller = new AbortController()
    const client = createClient({})
    clientMocks.createMongodbClient.mockResolvedValue(client)
    introspectionMocks.introspectMongodb.mockResolvedValue({
      message: 'Found 1 databases',
      databases: ['application'],
      collections: [],
    })

    await expect(
      executeMongodbIntrospection(
        {
          host: CONNECTION.host,
          port: CONNECTION.port,
          ssl: CONNECTION.ssl,
        },
        controller.signal
      )
    ).resolves.toEqual({
      message: 'Found 1 databases',
      databases: ['application'],
      collections: [],
    })
    expect(clientMocks.createMongodbClient).toHaveBeenCalledWith(
      {
        host: CONNECTION.host,
        port: CONNECTION.port,
        ssl: CONNECTION.ssl,
        database: 'admin',
      },
      controller.signal
    )
    expect(introspectionMocks.introspectMongodb).toHaveBeenCalledWith(
      client,
      undefined,
      controller.signal
    )
    expect(client.close).toHaveBeenCalledOnce()
  })
})
