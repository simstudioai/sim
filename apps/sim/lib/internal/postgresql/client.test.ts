/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostgresConnectionConfig } from '@/tools/postgresql/types'

const { mockValidateDatabaseHost, mockPostgres } = vi.hoisted(() => ({
  mockValidateDatabaseHost: vi.fn(),
  mockPostgres: vi.fn(() => ({})),
}))

vi.mock('postgres', () => ({ default: mockPostgres }))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateDatabaseHost: mockValidateDatabaseHost,
}))

import { createPostgresClient, executePostgresQuery } from '@/lib/internal/postgresql/client'

function makeConfig(overrides: Partial<PostgresConnectionConfig> = {}): PostgresConnectionConfig {
  return {
    host: 'db.example.com',
    port: 5432,
    database: 'app',
    username: 'app',
    password: 'secret',
    ssl: 'required',
    ...overrides,
  }
}

describe('PostgreSQL client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateDatabaseHost.mockResolvedValue({
      isValid: true,
      resolvedIP: '93.184.216.34',
      originalHostname: 'db.example.com',
    })
  })

  it('does not create a connection when host validation fails', async () => {
    mockValidateDatabaseHost.mockResolvedValue({
      isValid: false,
      error: 'host resolves to a blocked IP address',
    })

    await expect(
      createPostgresClient(makeConfig({ host: 'rebind.attacker.example' }))
    ).rejects.toThrow('host resolves to a blocked IP address')
    expect(mockPostgres).not.toHaveBeenCalled()
  })

  it.each(['disabled', 'required', 'preferred'] as const)(
    'pins the validated IP for ssl=%s',
    async (ssl) => {
      await createPostgresClient(makeConfig({ host: 'rebind.attacker.example', ssl }))

      expect(mockValidateDatabaseHost).toHaveBeenCalledWith('rebind.attacker.example', 'host')
      expect(mockPostgres.mock.calls[0][0]).toMatchObject({ host: '93.184.216.34' })
    }
  )

  it('preserves the original hostname as the TLS servername', async () => {
    await createPostgresClient(makeConfig({ host: 'db.example.com', ssl: 'required' }))

    expect(mockPostgres.mock.calls[0][0]).toMatchObject({
      host: '93.184.216.34',
      ssl: { rejectUnauthorized: false, servername: 'db.example.com' },
    })
  })

  it('does not validate or connect when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(createPostgresClient(makeConfig(), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(mockValidateDatabaseHost).not.toHaveBeenCalled()
    expect(mockPostgres).not.toHaveBeenCalled()
  })

  it('cancels an in-flight query when the signal aborts', async () => {
    const controller = new AbortController()
    let rejectQuery: (reason: Error) => void = () => undefined
    const pendingQuery = Object.assign(
      new Promise<never>((_resolve, reject) => {
        rejectQuery = reject
      }),
      {
        cancel: vi.fn(() => rejectQuery(new Error('query cancelled'))),
      }
    )

    const execution = executePostgresQuery(pendingQuery, controller.signal)
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(execution).rejects.toThrow('query cancelled')
    expect(pendingQuery.cancel).toHaveBeenCalledOnce()
  })
})
