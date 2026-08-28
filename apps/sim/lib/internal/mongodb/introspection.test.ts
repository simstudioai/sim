/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { introspectMongodb } from '@/lib/internal/mongodb/introspection'

describe('MongoDB introspection', () => {
  it('preserves collection shaping and passes cancellation to every operation', async () => {
    const controller = new AbortController()
    const indexes = vi
      .fn()
      .mockResolvedValue([{ name: 'email_1', key: { email: 1 }, unique: true, sparse: true }])
    const estimatedDocumentCount = vi.fn().mockResolvedValue(42)
    const collection = vi.fn(() => ({ indexes, estimatedDocumentCount }))
    const listCollections = vi.fn(() => ({
      toArray: vi.fn().mockResolvedValue([{ name: 'users', type: 'collection' }]),
    }))
    const db = vi.fn(() => ({ collection, listCollections }))
    const client = { db }

    await expect(
      introspectMongodb(client as never, 'application', controller.signal)
    ).resolves.toEqual({
      message: "Found 1 collections in database 'application'",
      databases: ['application'],
      collections: [
        {
          name: 'users',
          type: 'collection',
          documentCount: 42,
          indexes: [{ name: 'email_1', key: { email: 1 }, unique: true, sparse: true }],
        },
      ],
    })
    expect(listCollections).toHaveBeenCalledWith({}, { signal: controller.signal })
    expect(indexes).toHaveBeenCalledWith({ signal: controller.signal })
    expect(estimatedDocumentCount).toHaveBeenCalledWith({ signal: controller.signal })
  })

  it('preserves database-list introspection and cancellation', async () => {
    const controller = new AbortController()
    const listDatabases = vi.fn().mockResolvedValue({
      databases: [{ name: 'application' }, { name: 'analytics' }],
    })
    const client = {
      db: vi.fn(() => ({ admin: () => ({ listDatabases }) })),
    }

    await expect(introspectMongodb(client as never, undefined, controller.signal)).resolves.toEqual(
      {
        message: 'Found 2 databases',
        databases: ['application', 'analytics'],
        collections: [],
      }
    )
    expect(listDatabases).toHaveBeenCalledWith({ signal: controller.signal })
  })
})
