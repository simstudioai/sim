import { MongoClient } from 'mongodb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolve } = vi.hoisted(() => ({
  mockResolve: vi.fn(),
}))

vi.mock('@sim/security/dns', () => ({
  resolveHostAddresses: mockResolve,
  preferIpv4: (addresses: string[]) =>
    addresses.find((address) => address.includes('.')) ?? addresses[0],
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
  let connect: ReturnType<typeof vi.spyOn>
  let close: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // A wildcard DNS zone answers any name, including one shaped like a seed list.
    mockResolve.mockResolvedValue({ addresses: ['93.184.216.34'], preferred: '93.184.216.34' })
    connect = vi.spyOn(MongoClient.prototype, 'connect').mockImplementation(async function (
      this: MongoClient
    ) {
      return this
    })
    close = vi.spyOn(MongoClient.prototype, 'close').mockResolvedValue(undefined)
  })

  it('connects to exactly the validated host, without following advertised members', async () => {
    const client = await createMongodbClient(CONNECTION_CONFIG)

    expect(client.options.hosts.map(String)).toEqual(['db.example.com:27017'])
    expect(client.options.directConnection).toBe(true)
    expect(client.options.proxyHost).toBeUndefined()
    expect(client.options.loadBalanced).toBe(false)
    expect(client.options.tls).toBe(true)
    expect(client.options.credentials?.username).toBe('user@example.com')
    expect(client.options.credentials?.password).toBe('p@ss word')
    expect(client.options.credentials?.source).toBe('admin')
  })

  it('authenticates against the database when no auth source is given', async () => {
    const client = await createMongodbClient({ ...CONNECTION_CONFIG, authSource: '' })

    expect(client.options.credentials?.source).toBe('application')
  })

  it.each([
    ['a seed list naming an internal address', '127.0.0.1:6379,db.example.com'],
    ['a path and options after the host', 'db.example.com/admin?directConnection=false'],
  ])('refuses %s as the host', async (_case, host) => {
    await expect(createMongodbClient({ ...CONNECTION_CONFIG, host })).rejects.toThrow(
      'host must be a single hostname or IP address'
    )
    expect(connect).not.toHaveBeenCalled()
  })

  it.each([
    ['connection-string options', 'db?directConnection=false&proxyHost=127.0.0.1&proxyPort=1080'],
    ['a path separator', 'app/other'],
    ['a dot', 'app.other'],
  ])('refuses a database name carrying %s', async (_case, database) => {
    await expect(createMongodbClient({ ...CONNECTION_CONFIG, database })).rejects.toThrow(
      'database must be'
    )
    expect(connect).not.toHaveBeenCalled()
  })

  it.each([0, 27017.5, 70000])('refuses port %s', async (port) => {
    await expect(createMongodbClient({ ...CONNECTION_CONFIG, port })).rejects.toThrow(
      'port must be an integer'
    )
    expect(connect).not.toHaveBeenCalled()
  })

  it('does not connect when the host resolves to a private address', async () => {
    mockResolve.mockResolvedValue({ addresses: ['10.0.0.5'], preferred: '10.0.0.5' })

    await expect(createMongodbClient(CONNECTION_CONFIG)).rejects.toThrow('private or reserved')
    expect(connect).not.toHaveBeenCalled()
  })

  it('closes a partially connected client when connection fails', async () => {
    connect.mockRejectedValue(new Error('handshake failed'))

    await expect(createMongodbClient(CONNECTION_CONFIG)).rejects.toThrow('handshake failed')
    expect(close).toHaveBeenCalledOnce()
  })
})
