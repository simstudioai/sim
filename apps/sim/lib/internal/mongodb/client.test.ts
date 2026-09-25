import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockClient, mockCreatePinnedLookup, mockMongoClient, mockValidateDatabaseHost } =
  vi.hoisted(() => {
    const client = {
      close: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn(),
    }
    return {
      mockClient: client,
      mockCreatePinnedLookup: vi.fn(),
      mockMongoClient: vi.fn(function MockMongoClient() {
        return client
      }),
      mockValidateDatabaseHost: vi.fn(),
    }
  })

vi.mock('mongodb', () => ({ MongoClient: mockMongoClient }))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  createPinnedLookup: mockCreatePinnedLookup,
  validateDatabaseHost: mockValidateDatabaseHost,
}))

import { createMongodbClient, type MongodbConnectionConfig } from '@/lib/internal/mongodb/client'

const CONNECTION_CONFIG: MongodbConnectionConfig = {
  host: 'db.example.com',
  port: 27017,
  database: 'application',
  username: 'user@example.com',
  password: 'p@ss word',
  authSource: 'admin',
  ssl: 'required',
}

describe('MongoDB client', () => {
  beforeEach(() => {
    mockClient.close.mockResolvedValue(undefined)
    mockClient.connect.mockResolvedValue(mockClient)
    mockValidateDatabaseHost.mockResolvedValue({
      isValid: true,
      resolvedIP: '93.184.216.34',
      originalHostname: 'db.example.com',
    })
    mockCreatePinnedLookup.mockReturnValue('pinned-lookup')
  })

  it('does not construct a client when DNS validation fails', async () => {
    mockValidateDatabaseHost.mockResolvedValue({
      isValid: false,
      error: 'host resolves to a blocked IP address',
    })

    await expect(createMongodbClient(CONNECTION_CONFIG)).rejects.toThrow(
      'host resolves to a blocked IP address'
    )
    expect(mockMongoClient).not.toHaveBeenCalled()
  })

  it('closes a partially connected client when connection fails', async () => {
    mockClient.connect.mockRejectedValue(new Error('handshake failed'))

    await expect(createMongodbClient(CONNECTION_CONFIG)).rejects.toThrow('handshake failed')
    expect(mockClient.close).toHaveBeenCalledOnce()
  })
})
