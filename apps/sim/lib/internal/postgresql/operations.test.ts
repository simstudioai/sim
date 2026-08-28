/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => ({
  createPostgresClient: vi.fn(),
}))

const queryMocks = vi.hoisted(() => ({
  deletePostgresRows: vi.fn(),
  insertPostgresRows: vi.fn(),
  introspectPostgresSchema: vi.fn(),
  queryPostgres: vi.fn(),
  updatePostgresRows: vi.fn(),
  validatePostgresQuery: vi.fn(),
}))

vi.mock('@/lib/internal/postgresql/client', () => clientMocks)
vi.mock('@/lib/internal/postgresql/queries', () => queryMocks)

import {
  executePostgresqlIntrospection,
  executePostgresqlQuery,
  executePostgresqlStatement,
  PostgresqlOperationInputError,
} from '@/lib/internal/postgresql/operations'

const CONNECTION = {
  host: 'db.example.com',
  port: 5432,
  database: 'application',
  username: 'application',
  password: 'secret',
  ssl: 'required',
} as const

describe('PostgreSQL operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes cancellation to the query and closes the client after success', async () => {
    const controller = new AbortController()
    const client = { end: vi.fn().mockResolvedValue(undefined) }
    clientMocks.createPostgresClient.mockResolvedValue(client)
    queryMocks.queryPostgres.mockResolvedValue({ rows: [{ value: 1 }], rowCount: 1 })

    await expect(
      executePostgresqlQuery({ ...CONNECTION, query: 'SELECT 1' }, controller.signal)
    ).resolves.toEqual({
      message: 'Query executed successfully. 1 row(s) returned.',
      rows: [{ value: 1 }],
      rowCount: 1,
    })

    expect(clientMocks.createPostgresClient).toHaveBeenCalledWith(
      { ...CONNECTION, query: 'SELECT 1' },
      controller.signal
    )
    expect(queryMocks.queryPostgres).toHaveBeenCalledWith(client, 'SELECT 1', [], controller.signal)
    expect(client.end).toHaveBeenCalledOnce()
  })

  it('closes the client when a database query rejects', async () => {
    const client = { end: vi.fn().mockResolvedValue(undefined) }
    clientMocks.createPostgresClient.mockResolvedValue(client)
    queryMocks.queryPostgres.mockRejectedValue(new Error('database unavailable'))

    await expect(executePostgresqlQuery({ ...CONNECTION, query: 'SELECT 1' })).rejects.toThrow(
      'database unavailable'
    )
    expect(client.end).toHaveBeenCalledOnce()
  })

  it('rejects disallowed execute statements before creating a connection', () => {
    queryMocks.validatePostgresQuery.mockReturnValue({
      isValid: false,
      error:
        'Only SELECT, INSERT, UPDATE, DELETE, WITH, EXPLAIN, ANALYZE, and SHOW statements are allowed',
    })

    expect(() => executePostgresqlStatement({ ...CONNECTION, query: 'DROP TABLE users' })).toThrow(
      new PostgresqlOperationInputError(
        'Query validation failed: Only SELECT, INSERT, UPDATE, DELETE, WITH, EXPLAIN, ANALYZE, and SHOW statements are allowed'
      )
    )
    expect(clientMocks.createPostgresClient).not.toHaveBeenCalled()
  })

  it('preserves introspection output and cancellation', async () => {
    const controller = new AbortController()
    const client = { end: vi.fn().mockResolvedValue(undefined) }
    clientMocks.createPostgresClient.mockResolvedValue(client)
    queryMocks.introspectPostgresSchema.mockResolvedValue({
      tables: [],
      schemas: ['public'],
    })

    await expect(
      executePostgresqlIntrospection({ ...CONNECTION, schema: 'public' }, controller.signal)
    ).resolves.toEqual({
      message: "Schema introspection completed. Found 0 table(s) in schema 'public'.",
      tables: [],
      schemas: ['public'],
    })
    expect(queryMocks.introspectPostgresSchema).toHaveBeenCalledWith(
      client,
      'public',
      controller.signal
    )
    expect(client.end).toHaveBeenCalledOnce()
  })
})
