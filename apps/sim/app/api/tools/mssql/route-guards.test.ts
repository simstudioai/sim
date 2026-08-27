/**
 * @vitest-environment node
 *
 * The insert, update, and delete routes build their statement before opening a
 * connection, so a rejected WHERE clause or a bad identifier costs no TLS+login
 * round trip and answers 400 like the query and execute routes do.
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveHostAddresses, mockConnectionPool, mockQuery } = vi.hoisted(() => {
  const query = vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [1] })
  const pool = vi.fn(function ConnectionPool(this: Record<string, unknown>) {
    this.connect = vi.fn().mockResolvedValue(undefined)
    this.close = vi.fn().mockResolvedValue(undefined)
    this.request = () => ({ input: vi.fn(), query })
  })
  return { mockResolveHostAddresses: vi.fn(), mockConnectionPool: pool, mockQuery: query }
})

vi.mock('mssql', () => ({
  default: { ConnectionPool: mockConnectionPool },
  ConnectionPool: mockConnectionPool,
}))

vi.mock('@sim/security/dns', () => ({
  resolveHostAddresses: mockResolveHostAddresses,
  preferIpv4: (addresses: string[]) => addresses[0],
}))

import { POST as DELETE_POST } from '@/app/api/tools/mssql/delete/route'
import { POST as INSERT_POST } from '@/app/api/tools/mssql/insert/route'
import { POST as UPDATE_POST } from '@/app/api/tools/mssql/update/route'

const connection = {
  host: 'db.example.com',
  port: 1433,
  database: 'app',
  username: 'app',
  password: 'secret',
  encrypt: 'enabled',
  trustServerCertificate: 'disabled',
  connectionTimeout: 15000,
}

describe('MSSQL insert, update, and delete guards run before connecting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      authType: 'internal_jwt',
    })
    mockResolveHostAddresses.mockResolvedValue({ addresses: ['93.184.216.34'], isPrivate: false })
    mockQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] })
  })

  it.each([
    ['update', UPDATE_POST, { table: 'users', data: { a: 1 }, where: 'id = 1 OR 1=1' }],
    ['delete', DELETE_POST, { table: 'users', where: 'id = 1 OR 1=1' }],
  ])(
    'answers 400 for a rejected WHERE clause on %s without connecting',
    async (_op, handler, body) => {
      const response = await handler(createMockRequest('POST', { ...connection, ...body }))

      expect(response.status).toBe(400)
      expect(mockConnectionPool).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['insert', INSERT_POST, { table: 'users-table', data: { a: 1 } }],
    ['insert column', INSERT_POST, { table: 'users', data: { 'bad-col': 1 } }],
    ['update', UPDATE_POST, { table: 'users-table', data: { a: 1 }, where: 'id = 1' }],
    ['delete', DELETE_POST, { table: 'users-table', where: 'id = 1' }],
  ])('answers 400 for a bad identifier on %s without connecting', async (_op, handler, body) => {
    const response = await handler(createMockRequest('POST', { ...connection, ...body }))

    expect(response.status).toBe(400)
    expect(mockConnectionPool).not.toHaveBeenCalled()
  })

  it.each([
    ['insert', INSERT_POST, { table: 'users', data: { a: 1 } }],
    ['update', UPDATE_POST, { table: 'users', data: { a: 1 }, where: 'id = 1' }],
    ['delete', DELETE_POST, { table: 'users', where: 'id = 1' }],
  ])('still runs an accepted %s statement', async (_op, handler, body) => {
    const response = await handler(createMockRequest('POST', { ...connection, ...body }))

    expect(response.status).toBe(200)
    expect(mockConnectionPool).toHaveBeenCalledTimes(1)
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })
})
