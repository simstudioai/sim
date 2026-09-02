/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => ({
  executeOracleStatements: vi.fn(),
}))
const introspectionMocks = vi.hoisted(() => ({
  executeOracleIntrospect: vi.fn(),
}))

vi.mock('@/lib/internal/oracledb/client', () => clientMocks)
vi.mock('@/lib/internal/oracledb/introspection', () => introspectionMocks)

import {
  executeOracleIntrospection,
  executeOracleQuery,
  executeOracleStatement,
  executeOracleUpdate,
  OracleOperationInputError,
} from '@/lib/internal/oracledb/operations'

const CONNECTION = {
  host: 'db.example.com',
  port: 1521,
  protocol: 'tcp',
  connectionType: 'serviceName',
  serviceName: 'FREEPDB1',
  username: 'application',
  password: 'secret',
  connectionTimeout: 15000,
} as const

describe('Oracle Database operations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs Query in one read-only worker request and forwards cancellation', async () => {
    const controller = new AbortController()
    clientMocks.executeOracleStatements.mockResolvedValue([
      { rows: [{ VALUE: '9007199254740993' }], rowCount: 1 },
    ])

    await expect(
      executeOracleQuery(
        { ...CONNECTION, query: 'SELECT :value AS value FROM DUAL', binds: { value: 'x' } },
        controller.signal
      )
    ).resolves.toEqual({
      message: 'Query executed successfully. 1 row(s) returned.',
      rows: [{ VALUE: '9007199254740993' }],
      rowCount: 1,
    })
    expect(clientMocks.executeOracleStatements).toHaveBeenCalledWith(
      CONNECTION,
      [
        {
          sql: 'SELECT :value AS value FROM DUAL',
          binds: { value: 'x' },
          maxRows: 10000,
        },
      ],
      { readOnlyTransaction: true },
      controller.signal
    )
  })

  it('rejects unsafe Query SQL before starting the worker', async () => {
    await expect(
      executeOracleQuery({ ...CONNECTION, query: 'DELETE FROM users' })
    ).rejects.toBeInstanceOf(OracleOperationInputError)
    expect(clientMocks.executeOracleStatements).not.toHaveBeenCalled()
  })

  it('binds structured update values and autocommits the DML statement', async () => {
    clientMocks.executeOracleStatements.mockResolvedValue([{ rows: [], rowCount: 2 }])

    await expect(
      executeOracleUpdate({
        ...CONNECTION,
        table: 'USERS',
        data: { status: 'active' },
        where: 'ID = 42',
      })
    ).resolves.toMatchObject({ rowCount: 2, rows: [] })
    expect(clientMocks.executeOracleStatements.mock.calls[0][1]).toEqual([
      {
        sql: 'UPDATE "USERS" SET "status" = :b1 WHERE ID = 42',
        binds: { b1: 'active' },
        autoCommit: true,
        maxRows: 10000,
      },
    ])
  })

  it.each([
    ['SELECT 1 FROM DUAL', false],
    ['WITH value_ AS (SELECT 1 AS id FROM DUAL) SELECT * FROM value_', false],
    ['UPDATE jobs SET state = :state WHERE id = :id', true],
    ['CREATE TABLE events (type VARCHAR2(20))', true],
  ] as const)('classifies Execute autocommit for %s', async (query, autoCommit) => {
    clientMocks.executeOracleStatements.mockResolvedValue([{ rows: [], rowCount: 0 }])

    await executeOracleStatement({
      ...CONNECTION,
      query,
      ...(query.startsWith('UPDATE') && { binds: { state: 'done', id: 7 } }),
    })

    expect(clientMocks.executeOracleStatements).toHaveBeenCalledWith(
      CONNECTION,
      [
        {
          sql: query,
          binds: query.startsWith('UPDATE') ? { state: 'done', id: 7 } : undefined,
          autoCommit,
          maxRows: 10000,
        },
      ],
      { readOnlyTransaction: !autoCommit },
      undefined
    )
  })

  it('discloses bounded introspection truncation in the message', async () => {
    introspectionMocks.executeOracleIntrospect.mockResolvedValue({
      tables: [],
      schemas: ['APP'],
      schema: 'APP',
      truncated: true,
    })

    await expect(executeOracleIntrospection(CONNECTION)).resolves.toEqual({
      message:
        "Schema introspection completed. Found 0 table(s) in schema 'APP'. Metadata was limited by the 1,000-table, 10,000-column, or 10 MiB ceiling.",
      tables: [],
      schemas: ['APP'],
    })
  })
})
