/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateConnection, mockNetConnect, mockTypedParameterNull, mockValidateDatabaseHost } =
  vi.hoisted(() => {
    class MockTypedParameter {}
    return {
      mockCreateConnection: vi.fn(),
      mockNetConnect: vi.fn(),
      mockTypedParameterNull: vi.fn(() => new MockTypedParameter()),
      mockValidateDatabaseHost: vi.fn(),
    }
  })

vi.mock('node:net', () => ({
  default: { connect: mockNetConnect },
}))

vi.mock('mysql2/promise', () => ({
  default: {
    createConnection: mockCreateConnection,
    TypedParameter: { NULL: mockTypedParameterNull },
  },
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateDatabaseHost: mockValidateDatabaseHost,
}))

import {
  createMysqlConnection,
  executeMysqlCommand,
  type MysqlConnectionConfig,
} from '@/lib/internal/mysql/client'

const CONNECTION_CONFIG: MysqlConnectionConfig = {
  host: 'db.example.com',
  port: 3306,
  database: 'application',
  username: 'application',
  password: 'secret',
  ssl: 'required',
}

describe('MySQL client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateDatabaseHost.mockResolvedValue({
      isValid: true,
      resolvedIP: '93.184.216.34',
      originalHostname: 'db.example.com',
    })
    mockCreateConnection.mockResolvedValue({ end: vi.fn(), destroy: vi.fn() })
    mockNetConnect.mockReturnValue({ setNoDelay: vi.fn(), destroy: vi.fn() })
  })

  it('does not create a connection when DNS validation fails', async () => {
    mockValidateDatabaseHost.mockResolvedValue({
      isValid: false,
      error: 'host resolves to a blocked IP address',
    })

    await expect(createMysqlConnection(CONNECTION_CONFIG)).rejects.toThrow(
      'host resolves to a blocked IP address'
    )
    expect(mockCreateConnection).not.toHaveBeenCalled()
  })

  it.each([
    ['disabled', undefined],
    ['required', { rejectUnauthorized: true }],
    ['preferred', { rejectUnauthorized: false }],
  ] as const)('pins the validated IP and preserves ssl=%s', async (ssl, expectedSsl) => {
    await createMysqlConnection({ ...CONNECTION_CONFIG, ssl })

    const options = mockCreateConnection.mock.calls[0][0]
    expect(options.host).toBe('db.example.com')
    expect(options.ssl).toEqual(expectedSsl)
    const socket = options.stream()
    expect(mockNetConnect).toHaveBeenCalledWith({
      host: '93.184.216.34',
      port: 3306,
      timeout: 10000,
    })
    expect(socket.setNoDelay).toHaveBeenCalledWith(true)
  })

  it('does no DNS or connection work when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(createMysqlConnection(CONNECTION_CONFIG, controller.signal)).rejects.toMatchObject(
      { name: 'AbortError' }
    )
    expect(mockValidateDatabaseHost).not.toHaveBeenCalled()
    expect(mockCreateConnection).not.toHaveBeenCalled()
  })

  it('destroys the connection when an in-flight command is cancelled', async () => {
    const controller = new AbortController()
    let rejectCommand: (reason: Error) => void = () => undefined
    const connection = {
      execute: vi.fn(
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectCommand = reject
          })
      ),
      destroy: vi.fn(() => rejectCommand(new Error('connection closed'))),
    }

    const execution = executeMysqlCommand(
      connection as never,
      'SELECT SLEEP(10)',
      undefined,
      controller.signal
    )
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(execution).rejects.toMatchObject({ name: 'AbortError' })
    expect(connection.destroy).toHaveBeenCalledOnce()
  })

  it('rejects unsupported bind values before executing the query', async () => {
    const connection = { execute: vi.fn(), destroy: vi.fn() }

    await expect(executeMysqlCommand(connection as never, 'SELECT ?', [undefined])).rejects.toThrow(
      'MySQL bind values must contain only supported scalar or structured values'
    )
    expect(connection.execute).not.toHaveBeenCalled()
  })

  it.each([
    new Map([['key', 'value']]),
    new Set(['value']),
    /value/,
    Object.assign(Object.create(null) as Record<string, unknown>, { key: 'value' }),
  ])('rejects non-plain structured bind values: %s', async (value) => {
    const connection = { execute: vi.fn(), destroy: vi.fn() }

    await expect(executeMysqlCommand(connection as never, 'SELECT ?', [value])).rejects.toThrow(
      'MySQL bind values must contain only supported scalar or structured values'
    )
    expect(connection.execute).not.toHaveBeenCalled()
  })

  it('accepts nested plain structured bind values', async () => {
    const result = { affectedRows: 1 }
    const values = [{ nested: ['value', 1, true, null] }]
    const connection = {
      execute: vi.fn().mockResolvedValue([result]),
      destroy: vi.fn(),
    }

    await expect(executeMysqlCommand(connection as never, 'SELECT ?', values)).resolves.toBe(result)
    expect(connection.execute).toHaveBeenCalledWith('SELECT ?', values)
  })

  it('accepts mysql2 typed parameters', async () => {
    const result = { affectedRows: 1 }
    const typedParameter = mockTypedParameterNull()
    const connection = {
      execute: vi.fn().mockResolvedValue([result]),
      destroy: vi.fn(),
    }

    await expect(
      executeMysqlCommand(connection as never, 'SELECT ?', [typedParameter])
    ).resolves.toBe(result)
    expect(connection.execute).toHaveBeenCalledWith('SELECT ?', [typedParameter])
  })
})
