/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => ({
  createRdsClient: vi.fn(),
  executeDelete: vi.fn(),
  executeInsert: vi.fn(),
  executeIntrospect: vi.fn(),
  executeStatement: vi.fn(),
  executeUpdate: vi.fn(),
  validateQuery: vi.fn(),
}))

vi.mock('@/lib/internal/rds/client', () => clientMocks)

import {
  executeRdsIntrospection,
  executeRdsQuery,
  RdsOperationInputError,
} from '@/lib/internal/rds/operations'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  resourceArn: 'arn:aws:rds:us-east-1:123456789012:cluster:database',
  secretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:database',
  database: 'application',
} as const

describe('RDS operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the abort signal to RDS and destroys the client after success', async () => {
    const controller = new AbortController()
    const client = { destroy: vi.fn() }
    clientMocks.createRdsClient.mockReturnValue(client)
    clientMocks.validateQuery.mockReturnValue({ isValid: true })
    clientMocks.executeStatement.mockResolvedValue({ rows: [{ value: 1 }], rowCount: 1 })

    await expect(
      executeRdsQuery({ ...CONNECTION, query: 'SELECT 1' }, controller.signal)
    ).resolves.toEqual({
      message: 'Query executed successfully. 1 row(s) returned.',
      rows: [{ value: 1 }],
      rowCount: 1,
    })

    expect(clientMocks.createRdsClient).toHaveBeenCalledWith({
      ...CONNECTION,
      query: 'SELECT 1',
    })
    expect(clientMocks.executeStatement).toHaveBeenCalledWith(
      client,
      CONNECTION.resourceArn,
      CONNECTION.secretArn,
      CONNECTION.database,
      'SELECT 1',
      undefined,
      controller.signal
    )
    expect(client.destroy).toHaveBeenCalledOnce()
  })

  it('destroys the RDS client when the provider rejects', async () => {
    const client = { destroy: vi.fn() }
    clientMocks.createRdsClient.mockReturnValue(client)
    clientMocks.validateQuery.mockReturnValue({ isValid: true })
    clientMocks.executeStatement.mockRejectedValue(new Error('provider failed'))

    await expect(executeRdsQuery({ ...CONNECTION, query: 'SELECT 1' })).rejects.toThrow(
      'provider failed'
    )
    expect(client.destroy).toHaveBeenCalledOnce()
  })

  it('rejects disallowed query statements before creating an RDS client', () => {
    clientMocks.validateQuery.mockReturnValue({
      isValid: false,
      error: 'Only SELECT, INSERT, UPDATE, DELETE, WITH, EXPLAIN, and SHOW statements are allowed',
    })

    expect(() => executeRdsQuery({ ...CONNECTION, query: 'DROP TABLE users' })).toThrow(
      new RdsOperationInputError(
        'Only SELECT, INSERT, UPDATE, DELETE, WITH, EXPLAIN, and SHOW statements are allowed'
      )
    )
    expect(clientMocks.createRdsClient).not.toHaveBeenCalled()
  })

  it('passes cancellation into multi-query introspection and preserves its response', async () => {
    const controller = new AbortController()
    const client = { destroy: vi.fn() }
    clientMocks.createRdsClient.mockReturnValue(client)
    clientMocks.executeIntrospect.mockResolvedValue({
      engine: 'aurora-postgresql',
      tables: [],
      schemas: ['public'],
    })

    await expect(
      executeRdsIntrospection(
        { ...CONNECTION, schema: 'public', engine: 'aurora-postgresql' },
        controller.signal
      )
    ).resolves.toEqual({
      message: 'Schema introspection completed. Engine: aurora-postgresql. Found 0 table(s).',
      engine: 'aurora-postgresql',
      tables: [],
      schemas: ['public'],
    })

    expect(clientMocks.executeIntrospect).toHaveBeenCalledWith(
      client,
      CONNECTION.resourceArn,
      CONNECTION.secretArn,
      CONNECTION.database,
      'public',
      'aurora-postgresql',
      controller.signal
    )
    expect(client.destroy).toHaveBeenCalledOnce()
  })
})
