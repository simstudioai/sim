/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => ({
  createMSSQLConnection: vi.fn(),
}))

const queryMocks = vi.hoisted(() => ({
  buildDeleteQuery: vi.fn(),
  buildInsertQuery: vi.fn(),
  buildUpdateQuery: vi.fn(),
  executeQuery: vi.fn(),
  toRowsResponseBody: vi.fn((result: { rows: unknown[]; rowCount: number }, message: string) => ({
    message,
    rows: result.rows,
    rowCount: result.rowCount,
  })),
  validateQuery: vi.fn(),
  validateReadOnlyQuery: vi.fn(),
}))

const introspectionMocks = vi.hoisted(() => ({
  executeIntrospect: vi.fn(),
}))

vi.mock('@/lib/internal/mssql/client', () => clientMocks)
vi.mock('@/lib/internal/mssql/query', () => queryMocks)
vi.mock('@/lib/internal/mssql/introspection', () => introspectionMocks)

import {
  executeMssqlInsert,
  executeMssqlIntrospection,
  executeMssqlQuery,
  MssqlOperationInputError,
} from '@/lib/internal/mssql/operations'

const CONNECTION = {
  host: 'db.example.com',
  port: 1433,
  database: 'application',
  username: 'application',
  password: 'secret',
  encrypt: 'enabled',
  trustServerCertificate: 'disabled',
  connectionTimeout: 15000,
} as const

describe('Microsoft SQL Server operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryMocks.validateReadOnlyQuery.mockReturnValue({ isValid: true })
  })

  it('passes cancellation to the query and closes the pool after success', async () => {
    const controller = new AbortController()
    const pool = { close: vi.fn().mockResolvedValue(undefined) }
    clientMocks.createMSSQLConnection.mockResolvedValue(pool)
    queryMocks.executeQuery.mockResolvedValue({ rows: [{ value: 1 }], rowCount: 1 })

    await expect(
      executeMssqlQuery({ ...CONNECTION, query: 'SELECT 1' }, controller.signal)
    ).resolves.toEqual({
      message: 'Query executed successfully. 1 row(s) returned.',
      rows: [{ value: 1 }],
      rowCount: 1,
    })
    expect(clientMocks.createMSSQLConnection).toHaveBeenCalledWith(
      { ...CONNECTION, query: 'SELECT 1' },
      controller.signal
    )
    expect(queryMocks.executeQuery).toHaveBeenCalledWith(pool, 'SELECT 1', [], controller.signal)
    expect(pool.close).toHaveBeenCalledOnce()
  })

  it('closes the pool when the database query rejects', async () => {
    const pool = { close: vi.fn().mockResolvedValue(undefined) }
    clientMocks.createMSSQLConnection.mockResolvedValue(pool)
    queryMocks.executeQuery.mockRejectedValue(new Error('database unavailable'))

    await expect(executeMssqlQuery({ ...CONNECTION, query: 'SELECT 1' })).rejects.toThrow(
      'database unavailable'
    )
    expect(pool.close).toHaveBeenCalledOnce()
  })

  it('rejects disallowed read-only statements before opening a pool', () => {
    queryMocks.validateReadOnlyQuery.mockReturnValue({
      isValid: false,
      error: 'The Query operation cannot run DELETE.',
    })

    expect(() => executeMssqlQuery({ ...CONNECTION, query: 'DELETE FROM users' })).toThrow(
      new MssqlOperationInputError(
        'Query validation failed: The Query operation cannot run DELETE.'
      )
    )
    expect(clientMocks.createMSSQLConnection).not.toHaveBeenCalled()
  })

  it('rejects an invalid insert identifier before opening a pool', () => {
    queryMocks.buildInsertQuery.mockImplementation(() => {
      throw new Error('Invalid identifier: users-table')
    })

    expect(() =>
      executeMssqlInsert({
        ...CONNECTION,
        table: 'users-table',
        data: { value: 1 },
      })
    ).toThrow(
      new MssqlOperationInputError(
        'Microsoft SQL Server insert failed: Invalid identifier: users-table'
      )
    )
    expect(clientMocks.createMSSQLConnection).not.toHaveBeenCalled()
  })

  it('preserves introspection output, cancellation, and pool cleanup', async () => {
    const controller = new AbortController()
    const pool = { close: vi.fn().mockResolvedValue(undefined) }
    clientMocks.createMSSQLConnection.mockResolvedValue(pool)
    introspectionMocks.executeIntrospect.mockResolvedValue({
      tables: [],
      schemas: ['dbo'],
    })

    await expect(
      executeMssqlIntrospection({ ...CONNECTION, schema: 'dbo' }, controller.signal)
    ).resolves.toEqual({
      message: "Schema introspection completed. Found 0 table(s) in schema 'dbo'.",
      tables: [],
      schemas: ['dbo'],
    })
    expect(introspectionMocks.executeIntrospect).toHaveBeenCalledWith(
      pool,
      'dbo',
      controller.signal
    )
    expect(pool.close).toHaveBeenCalledOnce()
  })
})
