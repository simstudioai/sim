/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => ({
  createMysqlConnection: vi.fn(),
}))

const queryMocks = vi.hoisted(() => ({
  buildMysqlDeleteQuery: vi.fn(),
  buildMysqlInsertQuery: vi.fn(),
  buildMysqlUpdateQuery: vi.fn(),
  introspectMysqlDatabase: vi.fn(),
  queryMysql: vi.fn(),
  validateMysqlQuery: vi.fn(),
}))

vi.mock('@/lib/internal/mysql/client', () => clientMocks)
vi.mock('@/lib/internal/mysql/queries', () => queryMocks)

import {
  executeMysqlIntrospection,
  executeMysqlQuery,
  MysqlOperationInputError,
} from '@/lib/internal/mysql/operations'

const CONNECTION = {
  host: 'db.example.com',
  port: 3306,
  database: 'application',
  username: 'application',
  password: 'secret',
  ssl: 'required',
} as const

describe('MySQL operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes cancellation to the driver and closes the connection after success', async () => {
    const controller = new AbortController()
    const connection = { end: vi.fn().mockResolvedValue(undefined) }
    clientMocks.createMysqlConnection.mockResolvedValue(connection)
    queryMocks.validateMysqlQuery.mockReturnValue({ isValid: true })
    queryMocks.queryMysql.mockResolvedValue({ rows: [{ value: 1 }], rowCount: 1 })

    await expect(
      executeMysqlQuery({ ...CONNECTION, query: 'SELECT 1' }, controller.signal)
    ).resolves.toEqual({
      message: 'Query executed successfully. 1 row(s) returned.',
      rows: [{ value: 1 }],
      rowCount: 1,
    })
    expect(clientMocks.createMysqlConnection).toHaveBeenCalledWith(
      { ...CONNECTION, query: 'SELECT 1' },
      controller.signal
    )
    expect(queryMocks.queryMysql).toHaveBeenCalledWith(
      connection,
      'SELECT 1',
      undefined,
      controller.signal
    )
    expect(connection.end).toHaveBeenCalledOnce()
  })

  it('closes the connection when a database query rejects', async () => {
    const connection = { end: vi.fn().mockResolvedValue(undefined) }
    clientMocks.createMysqlConnection.mockResolvedValue(connection)
    queryMocks.validateMysqlQuery.mockReturnValue({ isValid: true })
    queryMocks.queryMysql.mockRejectedValue(new Error('database unavailable'))

    await expect(executeMysqlQuery({ ...CONNECTION, query: 'SELECT 1' })).rejects.toThrow(
      'database unavailable'
    )
    expect(connection.end).toHaveBeenCalledOnce()
  })

  it('rejects disallowed statements before opening a connection', () => {
    queryMocks.validateMysqlQuery.mockReturnValue({
      isValid: false,
      error:
        'Only SELECT, INSERT, UPDATE, DELETE, WITH, SHOW, DESCRIBE, and EXPLAIN statements are allowed',
    })

    expect(() => executeMysqlQuery({ ...CONNECTION, query: 'DROP TABLE users' })).toThrow(
      new MysqlOperationInputError(
        'Query validation failed: Only SELECT, INSERT, UPDATE, DELETE, WITH, SHOW, DESCRIBE, and EXPLAIN statements are allowed'
      )
    )
    expect(clientMocks.createMysqlConnection).not.toHaveBeenCalled()
  })

  it('preserves introspection output and cancellation', async () => {
    const controller = new AbortController()
    const connection = { end: vi.fn().mockResolvedValue(undefined) }
    clientMocks.createMysqlConnection.mockResolvedValue(connection)
    queryMocks.introspectMysqlDatabase.mockResolvedValue({
      tables: [],
      databases: ['application'],
    })

    await expect(executeMysqlIntrospection(CONNECTION, controller.signal)).resolves.toEqual({
      message: "Schema introspection completed. Found 0 table(s) in database 'application'.",
      tables: [],
      databases: ['application'],
    })
    expect(queryMocks.introspectMysqlDatabase).toHaveBeenCalledWith(
      connection,
      'application',
      controller.signal
    )
    expect(connection.end).toHaveBeenCalledOnce()
  })
})
